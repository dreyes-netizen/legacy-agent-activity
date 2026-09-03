"""
Neon (Postgres) access layer.

Every write is an idempotent upsert keyed on (agent, window). That matters more
than it sounds: cron schedulers double-fire, GitHub Actions retries, and a
partially-failed tick gets re-run. Without upserts, a re-run would append and
silently double an agent's online time. With them, replaying a tick is a no-op.
"""

import os

import psycopg
from psycopg.rows import dict_row


def connect():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("Missing required environment variable: DATABASE_URL")
    return psycopg.connect(url, row_factory=dict_row, autocommit=False)


def apply_migrations(conn, migrations_dir):
    """Run every .sql file in name order. Files are written to be idempotent."""
    applied = []
    for name in sorted(os.listdir(migrations_dir)):
        if not name.endswith(".sql"):
            continue
        path = os.path.join(migrations_dir, name)
        with open(path, encoding="utf-8") as handle:
            sql = handle.read()
        with conn.cursor() as cur:
            cur.execute(sql)
        applied.append(name)
    conn.commit()
    return applied


def upsert_agents(conn, agents):
    """agents: list of {ctm_user_id, email, name} from ctm.alliance_agents()."""
    if not agents:
        return 0
    rows = [(a["ctm_user_id"], a["email"], a["name"]) for a in agents]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO agents (ctm_user_id, email, name)
            VALUES (%s, %s, %s)
            ON CONFLICT (ctm_user_id) DO UPDATE
               SET email = EXCLUDED.email,
                   name = EXCLUDED.name,
                   is_active = true,
                   updated_at = now()
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def set_numeric_ids(conn, numeric_id_by_email):
    """
    CTM metric rows carry a numeric user_id; the roster carries a "USR..." sid.
    Email is the only reliable join, so we record the numeric id the first time
    we see it and keep it fresh afterwards.
    """
    if not numeric_id_by_email:
        return 0
    rows = [(int(nid), email) for email, nid in numeric_id_by_email.items() if str(nid).isdigit()]
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE agents SET ctm_numeric_id = %s, updated_at = now() WHERE email = %s",
            rows,
        )
    conn.commit()
    return len(rows)


def agent_id_by_email(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT ctm_user_id, email FROM agents")
        return {row["email"]: row["ctm_user_id"] for row in cur.fetchall()}


HOURLY_UPSERT = """
INSERT INTO agent_hourly (
    ctm_user_id, bucket_start, bucket_end,
    online_seconds, session_seconds, talk_seconds, hold_seconds,
    inbound_calls, outbound_calls, login_seconds_approx, is_final, synced_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (ctm_user_id, bucket_start) DO UPDATE SET
    bucket_end = EXCLUDED.bucket_end,
    online_seconds = EXCLUDED.online_seconds,
    session_seconds = EXCLUDED.session_seconds,
    talk_seconds = EXCLUDED.talk_seconds,
    hold_seconds = EXCLUDED.hold_seconds,
    inbound_calls = EXCLUDED.inbound_calls,
    outbound_calls = EXCLUDED.outbound_calls,
    login_seconds_approx = EXCLUDED.login_seconds_approx,
    is_final = EXCLUDED.is_final,
    synced_at = now()
"""

DAY_UPSERT = """
INSERT INTO agent_day (
    ctm_user_id, local_date, window_start, window_end,
    login_seconds, online_seconds, session_seconds, is_final, synced_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (ctm_user_id, local_date) DO UPDATE SET
    window_start = EXCLUDED.window_start,
    window_end = EXCLUDED.window_end,
    login_seconds = EXCLUDED.login_seconds,
    online_seconds = EXCLUDED.online_seconds,
    session_seconds = EXCLUDED.session_seconds,
    is_final = EXCLUDED.is_final,
    synced_at = now()
"""

SHIFT_UPSERT = """
INSERT INTO agent_shift (
    ctm_user_id, shift_date, shift_id, window_start, window_end,
    login_seconds, online_seconds, session_seconds, talk_seconds, hold_seconds,
    is_final, synced_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (ctm_user_id, shift_date) DO UPDATE SET
    shift_id = EXCLUDED.shift_id,
    window_start = EXCLUDED.window_start,
    window_end = EXCLUDED.window_end,
    login_seconds = EXCLUDED.login_seconds,
    online_seconds = EXCLUDED.online_seconds,
    session_seconds = EXCLUDED.session_seconds,
    talk_seconds = EXCLUDED.talk_seconds,
    hold_seconds = EXCLUDED.hold_seconds,
    is_final = EXCLUDED.is_final,
    synced_at = now()
"""


def _metric(metrics, column):
    return round(float(metrics.get(column) or 0), 2)


def upsert_hourly(conn, bucket_start, bucket_end, metrics_by_id, email_by_id,
                  agent_ids, is_final):
    rows = []
    for numeric_id, metrics in metrics_by_id.items():
        email = email_by_id.get(numeric_id)
        agent_id = agent_ids.get(email)
        if not agent_id:
            continue  # not an Alliance agent, or roster not yet synced
        rows.append((
            agent_id, bucket_start, bucket_end,
            _metric(metrics, "online_seconds"),
            _metric(metrics, "session_seconds"),
            _metric(metrics, "talk_seconds"),
            _metric(metrics, "hold_seconds"),
            int(metrics.get("inbound_calls") or 0),
            int(metrics.get("outbound_calls") or 0),
            _metric(metrics, "login_seconds"),
            is_final,
        ))
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(HOURLY_UPSERT, rows)
    conn.commit()
    return len(rows)


def upsert_day(conn, local_date, window_start, window_end, metrics_by_id,
               email_by_id, agent_ids, is_final):
    rows = []
    for numeric_id, metrics in metrics_by_id.items():
        email = email_by_id.get(numeric_id)
        agent_id = agent_ids.get(email)
        if not agent_id:
            continue
        rows.append((
            agent_id, local_date, window_start, window_end,
            _metric(metrics, "login_seconds"),
            _metric(metrics, "online_seconds"),
            _metric(metrics, "session_seconds"),
            is_final,
        ))
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(DAY_UPSERT, rows)
    conn.commit()
    return len(rows)


def upsert_shift(conn, shift_date, window_start, window_end, shift_id,
                 agent_id, metrics, is_final):
    with conn.cursor() as cur:
        cur.execute(SHIFT_UPSERT, (
            agent_id, shift_date, shift_id, window_start, window_end,
            _metric(metrics, "login_seconds"),
            _metric(metrics, "online_seconds"),
            _metric(metrics, "session_seconds"),
            _metric(metrics, "talk_seconds"),
            _metric(metrics, "hold_seconds"),
            is_final,
        ))
    conn.commit()
    return 1


def finalize_stale(conn, cutoff):
    """
    Mark buckets older than the settling cutoff as final so the tick stops
    re-querying them. This is what keeps a 5-minute cadence to a handful of
    API calls instead of growing without bound.
    """
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE agent_hourly SET is_final = true "
            "WHERE NOT is_final AND bucket_end < %s",
            (cutoff,),
        )
        hourly = cur.rowcount
        cur.execute(
            "UPDATE agent_day SET is_final = true "
            "WHERE NOT is_final AND window_end < %s",
            (cutoff,),
        )
        day = cur.rowcount
    conn.commit()
    return hourly + day


def start_run(conn, trigger):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sync_runs (trigger) VALUES (%s) RETURNING id",
            (trigger,),
        )
        run_id = cur.fetchone()["id"]
    conn.commit()
    return run_id


def finish_run(conn, run_id, windows, rows, api_seconds, status, error=None):
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sync_runs
               SET finished_at = now(), windows_queried = %s, rows_upserted = %s,
                   api_seconds = %s, status = %s, error = %s
             WHERE id = %s
            """,
            (windows, rows, round(api_seconds, 2), status,
             (error[:2000] if error else None), run_id),
        )
    conn.commit()


def enqueue(conn, grain, window_start, window_end, ctm_user_id=None,
            shift_date=None, reason=None):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO backfill_queue
                (grain, window_start, window_end, ctm_user_id, shift_date, reason)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (grain, window_start, window_end, ctm_user_id, shift_date, reason),
        )
    conn.commit()


def claim_pending(conn, limit):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM backfill_queue
             WHERE completed_at IS NULL AND attempts < 5
             ORDER BY enqueued_at
             LIMIT %s
            """,
            (limit,),
        )
        return cur.fetchall()


def complete_pending(conn, queue_id, error=None):
    with conn.cursor() as cur:
        if error:
            cur.execute(
                "UPDATE backfill_queue SET attempts = attempts + 1, error = %s "
                "WHERE id = %s",
                (error[:2000], queue_id),
            )
        else:
            cur.execute(
                "UPDATE backfill_queue SET completed_at = now(), "
                "attempts = attempts + 1, error = NULL WHERE id = %s",
                (queue_id,),
            )
    conn.commit()


def active_shifts(conn, local_date):
    """Shift definitions in force on a given local date."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.*, a.ctm_user_id AS agent_id, a.email AS agent_email
              FROM shifts s
              JOIN agents a ON a.ctm_user_id = s.ctm_user_id
             WHERE s.effective_from <= %s
               AND (s.effective_to IS NULL OR s.effective_to >= %s)
               AND a.is_active
            """,
            (local_date, local_date),
        )
        return cur.fetchall()
