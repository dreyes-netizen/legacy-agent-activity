"""
The recurring sync.

Runs in two modes:

  tick    (every ~5 min) Refresh only what is still moving: the in-progress
          hour, any open shift window, and today's calendar day. Deliberately
          budget-capped so a tick can never overrun its own interval.
  settle  (hourly) The deeper pass: re-query recently closed hours and days in
          case CTM revised them, drain the backfill queue, then mark old
          windows final so the tick stops looking at them.

Why the budget matters: one utilization call takes 20-40 seconds and CTM
ignores the "interval" param, so every window is a separate round trip. Six
windows is already three to four minutes of wall clock. The tick therefore
queries windows in priority order and stops when it runs out of budget --
whatever it skips gets picked up by the next tick or by settle.
"""

import argparse
import os
import sys
import time
import traceback
from datetime import datetime, timedelta

from . import ctm, db, windows

ROSTER_MAX_AGE_MINUTES = 60


def _roster_is_stale(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n, max(updated_at) AS newest FROM agents")
        row = cur.fetchone()
    if not row or not row["n"]:
        return True
    return row["newest"] < datetime.now(ctm.TZ) - timedelta(minutes=ROSTER_MAX_AGE_MINUTES)


def refresh_roster(conn, credentials):
    users = ctm.fetch_all_users(credentials)
    agents = ctm.alliance_agents(users)
    db.upsert_agents(conn, agents)
    return agents


def _plan(conn, mode, now):
    """
    Ordered list of (kind, payload) windows to query. Earlier entries are more
    valuable, so a truncated run still refreshes what matters most.
    """
    plan = []

    # 1. The in-progress hour -- the whole point of a 5-minute cadence.
    for start, end in windows.hot_hours(now, settling_hours=0):
        plan.append(("hour", (start, end)))

    # 2. Open shift windows, deduplicated: agents sharing a shift pattern
    #    share one API call, since a response covers every agent anyway.
    today = now.date()
    shift_rows = db.active_shifts(conn, today) + db.active_shifts(conn, today - timedelta(days=1))
    seen = {}
    for shift, shift_date, start, end in windows.open_shift_windows(shift_rows, now):
        seen.setdefault((start, end), []).append((shift, shift_date))
    for (start, end), members in seen.items():
        plan.append(("shift", (start, end, members)))

    # 3. Today's calendar day -- the exact login_time source that does not
    #    depend on any shift being defined yet.
    for local_date in windows.hot_days(now):
        start, end = windows.day_window(local_date)
        plan.append(("day", (local_date, start, min(end, now))))

    if mode == "settle":
        # 4. Recently closed hours, in case CTM revised them.
        for start, end in windows.hot_hours(now)[:-1]:
            plan.append(("hour", (start, end)))

    return plan


def run(mode="tick", trigger="manual", max_windows=6, queue_items=2):
    credentials = ctm.get_credentials()
    conn = db.connect()
    run_id = db.start_run(conn, trigger)
    queried = 0
    upserted = 0
    api_seconds = 0.0
    try:
        if _roster_is_stale(conn):
            refresh_roster(conn, credentials)

        agent_ids = db.agent_id_by_email(conn)
        now = datetime.now(ctm.TZ)
        plan = _plan(conn, mode, now)

        numeric_ids = {}
        for kind, payload in plan:
            if queried >= max_windows:
                print(f"budget reached ({max_windows} windows); deferring the rest")
                break

            if kind == "hour":
                start, end = payload
                metrics, emails, elapsed = ctm.fetch_window(credentials, start, min(end, now))
                upserted += db.upsert_hourly(conn, start, end, metrics, emails,
                                             agent_ids, is_final=False)
            elif kind == "day":
                local_date, start, end = payload
                metrics, emails, elapsed = ctm.fetch_window(credentials, start, end)
                upserted += db.upsert_day(conn, local_date, start, end, metrics,
                                          emails, agent_ids, is_final=False)
            elif kind == "shift":
                start, end, members = payload
                metrics, emails, elapsed = ctm.fetch_window(credentials, start, end)
                by_email = {emails.get(uid): m for uid, m in metrics.items() if emails.get(uid)}
                for shift, shift_date in members:
                    agent_metrics = by_email.get(shift["agent_email"], {})
                    upserted += db.upsert_shift(conn, shift_date, start, end,
                                                shift["id"], shift["agent_id"],
                                                agent_metrics, is_final=False)
            else:
                continue

            for uid, email in emails.items():
                if email in agent_ids:
                    numeric_ids[email] = uid
            queried += 1
            api_seconds += elapsed
            # Normalise to the reporting timezone before printing. Shift windows
            # are built in the shift's own zone (usually Asia/Manila), so a raw
            # %H:%M would render Manila local time here and make a 09:00 ET shift
            # look like it starts at 21:00.
            log_start = start.astimezone(ctm.TZ)
            log_end = end.astimezone(ctm.TZ)
            print(f"  {kind:5} {log_start:%Y-%m-%d %H:%M} -> {log_end:%H:%M} ET  {elapsed:.1f}s")

        db.set_numeric_ids(conn, numeric_ids)

        if mode == "settle":
            upserted += _drain_queue(conn, credentials, agent_ids, queue_items)
            cutoff = now - timedelta(hours=windows.SETTLING_HOURS + 1)
            finalized = db.finalize_stale(conn, cutoff)
            print(f"  finalized {finalized} rows older than {cutoff:%Y-%m-%d %H:%M}")

        db.finish_run(conn, run_id, queried, upserted, api_seconds, "ok")
        print(f"OK  mode={mode} windows={queried} rows={upserted} api={api_seconds:.1f}s")
        return 0
    except Exception as exc:  # noqa: BLE001 - the run log is the error channel
        db.finish_run(conn, run_id, queried, upserted, api_seconds, "error",
                      f"{exc}\n{traceback.format_exc()}")
        print(f"ERROR mode={mode}: {exc}", file=sys.stderr)
        traceback.print_exc()
        return 1
    finally:
        conn.close()


def _drain_queue(conn, credentials, agent_ids, limit):
    """
    Exact re-queries requested by a shift edit or a manual backfill. Kept off
    the 5-minute path so a team leader editing shifts can never starve the
    live sync.
    """
    upserted = 0
    for item in db.claim_pending(conn, limit):
        try:
            metrics, emails, _elapsed = ctm.fetch_window(
                credentials, item["window_start"], item["window_end"])
            if item["grain"] == "hour":
                upserted += db.upsert_hourly(conn, item["window_start"], item["window_end"],
                                             metrics, emails, agent_ids, is_final=True)
            elif item["grain"] == "day":
                upserted += db.upsert_day(conn, item["window_start"].date(),
                                          item["window_start"], item["window_end"],
                                          metrics, emails, agent_ids, is_final=True)
            elif item["grain"] == "shift":
                by_email = {emails.get(uid): m for uid, m in metrics.items() if emails.get(uid)}
                with conn.cursor() as cur:
                    cur.execute("SELECT email FROM agents WHERE ctm_user_id = %s",
                                (item["ctm_user_id"],))
                    row = cur.fetchone()
                if row:
                    upserted += db.upsert_shift(conn, item["shift_date"],
                                                item["window_start"], item["window_end"],
                                                None, item["ctm_user_id"],
                                                by_email.get(row["email"], {}), is_final=True)
            db.complete_pending(conn, item["id"])
        except Exception as exc:  # noqa: BLE001
            db.complete_pending(conn, item["id"], str(exc))
    return upserted


def main():
    parser = argparse.ArgumentParser(description="Sync CTM agent activity into Neon.")
    parser.add_argument("--mode", choices=["tick", "settle"], default="tick")
    parser.add_argument("--trigger", default=os.getenv("SYNC_TRIGGER", "manual"))
    parser.add_argument("--max-windows", type=int, default=6,
                        help="Cap on API calls per run, so a run cannot overrun its interval.")
    parser.add_argument("--queue-items", type=int, default=2)
    args = parser.parse_args()

    ctm.load_dotenv(".env.local")
    ctm.load_dotenv(".env")
    began = time.monotonic()
    code = run(args.mode, args.trigger, args.max_windows, args.queue_items)
    print(f"total wall clock {time.monotonic() - began:.1f}s")
    return code


if __name__ == "__main__":
    sys.exit(main())
