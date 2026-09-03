"""
Historical backfill.

Kept strictly separate from the 5-minute tick, because its cost profile is
completely different. At ~30s per window:

  day grain    1 call/day    ->  ~30s per day of history
  hour grain  24 calls/day   ->  ~12 min per day of history

So a month of hourly history is roughly six hours of wall clock. The usual
approach is to backfill day grain over the whole period you care about (cheap,
and gives exact login_time per calendar day), then run hour grain only over the
window where you actually need the fine-grained time filter.

Resumable by design: windows already stored as final are skipped, so an
interrupted run can simply be re-run.
"""

import argparse
import sys
import time
from datetime import datetime, timedelta

from . import ctm, db, windows


def _existing_final_days(conn, start_date, end_date):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT local_date, count(*) AS n FROM agent_day "
            "WHERE is_final AND local_date BETWEEN %s AND %s GROUP BY local_date",
            (start_date, end_date),
        )
        return {row["local_date"] for row in cur.fetchall()}


def _existing_final_hours(conn, start_dt, end_dt):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT bucket_start, count(*) AS n FROM agent_hourly "
            "WHERE is_final AND bucket_start BETWEEN %s AND %s GROUP BY bucket_start",
            (start_dt, end_dt),
        )
        return {row["bucket_start"] for row in cur.fetchall()}


def backfill(start_date, end_date, grain, resume=True, trigger="backfill"):
    credentials = ctm.get_credentials()
    conn = db.connect()
    run_id = db.start_run(conn, trigger)
    queried = 0
    upserted = 0
    api_seconds = 0.0
    now = datetime.now(ctm.TZ)
    try:
        agents = None
        if not db.agent_id_by_email(conn):
            from .tick import refresh_roster
            agents = refresh_roster(conn, credentials)
            print(f"roster: {len(agents)} Alliance agents")
        agent_ids = db.agent_id_by_email(conn)

        numeric_ids = {}
        done_days = _existing_final_days(conn, start_date, end_date) if resume else set()

        if grain in ("day", "both"):
            for local_date in windows.day_range(start_date, end_date):
                if local_date in done_days:
                    print(f"  day  {local_date} already final, skipping")
                    continue
                start, end = windows.day_window(local_date)
                # A day still in progress must not be marked final.
                final = end < now
                end = min(end, now)
                if end <= start:
                    continue
                metrics, emails, elapsed = ctm.fetch_window(credentials, start, end)
                rows = db.upsert_day(conn, local_date, start, end, metrics,
                                     emails, agent_ids, is_final=final)
                for uid, email in emails.items():
                    if email in agent_ids:
                        numeric_ids[email] = uid
                queried += 1
                upserted += rows
                api_seconds += elapsed
                print(f"  day  {local_date}  {rows:3} rows  {elapsed:.1f}s"
                      f"{'' if final else '  (in progress)'}")

        if grain in ("hour", "both"):
            range_start = ctm.day_start(start_date)
            range_end = min(ctm.day_end(end_date), now)
            done_hours = _existing_final_hours(conn, range_start, range_end) if resume else set()
            for start, end in windows.hour_buckets(range_start, range_end):
                if start in done_hours:
                    continue
                final = end < now
                capped_end = min(end, now)
                if capped_end <= start:
                    continue
                metrics, emails, elapsed = ctm.fetch_window(credentials, start, capped_end)
                rows = db.upsert_hourly(conn, start, end, metrics, emails,
                                        agent_ids, is_final=final)
                for uid, email in emails.items():
                    if email in agent_ids:
                        numeric_ids[email] = uid
                queried += 1
                upserted += rows
                api_seconds += elapsed
                print(f"  hour {start:%Y-%m-%d %H:%M}  {rows:3} rows  {elapsed:.1f}s"
                      f"{'' if final else '  (in progress)'}")

        db.set_numeric_ids(conn, numeric_ids)
        db.finish_run(conn, run_id, queried, upserted, api_seconds, "ok")
        print(f"OK  windows={queried} rows={upserted} api={api_seconds:.1f}s")
        return 0
    except Exception as exc:  # noqa: BLE001
        import traceback
        db.finish_run(conn, run_id, queried, upserted, api_seconds, "error", str(exc))
        print(f"ERROR: {exc}", file=sys.stderr)
        traceback.print_exc()
        return 1
    finally:
        conn.close()


def parse_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit(f"Invalid date '{value}'. Use YYYY-MM-DD.") from exc


def main():
    parser = argparse.ArgumentParser(description="Backfill historical CTM agent activity.")
    parser.add_argument("--start-date", required=True, help="YYYY-MM-DD (America/New_York)")
    parser.add_argument("--end-date", help="YYYY-MM-DD, defaults to today")
    parser.add_argument("--grain", choices=["day", "hour", "both"], default="day")
    parser.add_argument("--no-resume", action="store_true",
                        help="Re-query windows already stored as final.")
    args = parser.parse_args()

    ctm.load_dotenv(".env.local")
    ctm.load_dotenv(".env")
    start_date = parse_date(args.start_date)
    end_date = parse_date(args.end_date) if args.end_date else datetime.now(ctm.TZ).date()
    if start_date > end_date:
        raise SystemExit("--start-date must be on or before --end-date.")

    days = (end_date - start_date).days + 1
    per_day = {"day": 1, "hour": 24, "both": 25}[args.grain]
    print(f"Backfilling {start_date} .. {end_date} ({days} days) at {args.grain} grain")
    print(f"Estimated {days * per_day} API calls, roughly "
          f"{days * per_day * 30 / 60:.0f} minutes at 30s per call\n")

    began = time.monotonic()
    code = backfill(start_date, end_date, args.grain, resume=not args.no_resume)
    print(f"total wall clock {(time.monotonic() - began) / 60:.1f} min")
    return code


if __name__ == "__main__":
    sys.exit(main())
