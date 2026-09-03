"""
CallTrackingMetrics client, narrowed to what the activity sync needs.

Carried over from the legacy KPI pipeline (ctm_kpi_raw_dry_run.py) rather than
imported, so this repo can deploy without the Excel/Google Sheets dependency
stack. The hard-won bits are preserved along with why they matter:

  * Windows are epoch SECONDS, not dates. CTM honours arbitrary windows,
    including ones that cross local midnight -- verified 2026-09-02 22:00 ->
    2026-09-03 06:00 returned exactly the night crew. This is the whole reason
    night-shift reporting works without stitching calendar days together.
  * The "interval" param is IGNORED. interval=hour returns byte-identical
    totals to interval=day, and the per-row "hourly" sub-object always comes
    back empty. Sub-day granularity therefore costs one API call per window.
  * The "users" map in a response only contains users WITH ACTIVITY in that
    window. The agent roster must come from /users.json or agents silently
    disappear on days they did not work.
  * A single call returns every agent, so per-window cost is flat regardless
    of headcount.
"""

import base64
import json
import os
import time
from collections import defaultdict
from datetime import datetime, time as dt_time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

EMAIL_DOMAIN = "@allianceglobalsolutions.com"
TIMEZONE_NAME = "America/New_York"
# CTM wants the literal label "EST" year-round; ZoneInfo above handles the
# actual DST offset when converting to epoch. Matches the legacy pipeline.
TIMEZONE_LABEL = "EST"
TZ = ZoneInfo(TIMEZONE_NAME)

USER_AGENT = "legacy-agent-activity/1.0"
MAX_RETRIES = 4

# Metric name in CTM -> column name here.
DURATION_METRICS = {
    "online": "online_seconds",
    "session_time": "session_seconds",
    "login_time": "login_seconds",
    "talk_time": "talk_seconds",
    "hold_time": "hold_seconds",
}
COUNT_METRICS = {
    "inbound_calls": "inbound_calls",
    "outbound_calls": "outbound_calls",
}


def load_dotenv(path):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def get_credentials():
    def need(*names):
        for name in names:
            value = os.getenv(name)
            if value:
                return value
        raise SystemExit("Missing required environment variable: " + " or ".join(names))

    return {
        "api_host": (os.getenv("CTM_API_HOST") or "https://api.calltrackingmetrics.com").rstrip("/"),
        "access_key": need("CTM_ACCESS_KEY", "CTM_API_KEY"),
        "secret_key": need("CTM_SECRET_KEY", "CTM_API_SECRET"),
        "account_id": need("CTM_ACCOUNT_ID"),
    }


def api_get(credentials, path, params):
    url = f"{credentials['api_host']}{path}?{urlencode(params)}"
    token = f"{credentials['access_key']}:{credentials['secret_key']}".encode("utf-8")
    request = Request(
        url,
        headers={
            "Authorization": f"Basic {base64.b64encode(token).decode('ascii')}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )

    # Utilization calls routinely take 20-40s, so the timeout is generous and
    # transient failures are retried -- a dropped tick means a gap in the data.
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            with urlopen(request, timeout=180) as response:
                return json.loads(response.read().decode("utf-8")), url
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            # 4xx other than rate limiting will not fix themselves on retry.
            if exc.code != 429 and 400 <= exc.code < 500:
                raise RuntimeError(f"CTM HTTP {exc.code} for {path}: {detail}") from exc
            last_error = RuntimeError(f"CTM HTTP {exc.code} for {path}: {detail}")
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = RuntimeError(f"CTM request failed for {path}: {exc}")
        if attempt < MAX_RETRIES - 1:
            time.sleep(2 ** attempt * 3)
    raise last_error


def to_epoch(local_dt):
    """Local wall-clock datetime -> epoch seconds, DST handled by ZoneInfo."""
    if local_dt.tzinfo is None:
        local_dt = local_dt.replace(tzinfo=TZ)
    return int(local_dt.timestamp())


def day_start(local_date):
    return datetime.combine(local_date, dt_time(0, 0, 0), tzinfo=TZ)


def day_end(local_date):
    return datetime.combine(local_date, dt_time(23, 59, 59), tzinfo=TZ)


def fetch_all_users(credentials):
    path = f"/api/v1/accounts/{credentials['account_id']}/users.json"
    users = []
    page = 1
    while True:
        payload, _url = api_get(credentials, path, {"per_page": 100, "page": page})
        batch = payload.get("users") or []
        if isinstance(batch, dict):
            batch = list(batch.values())
        users.extend(batch)
        if not payload.get("next_page"):
            return users
        page += 1


def alliance_agents(users):
    """The @allianceglobalsolutions.com agents (18 of ~103 CTM users)."""
    rows = []
    for user in users:
        email = (user.get("email") or "").strip().lower()
        if not email.endswith(EMAIL_DOMAIN):
            continue
        name = (user.get("name") or "").strip()
        if not name:
            name = " ".join(p for p in [user.get("first_name"), user.get("last_name")] if p).strip()
        rows.append({
            "ctm_user_id": (user.get("id") or "").strip(),
            "email": email,
            "name": name or email,
        })
    return sorted(rows, key=lambda row: (row["name"].lower(), row["email"]))


def fetch_window(credentials, start_dt, end_dt):
    """
    Utilization for one arbitrary window.

    Returns (metrics_by_numeric_id, email_by_numeric_id, elapsed_seconds).
    The numeric id is CTM's internal user_id used in metric rows, which is NOT
    the same as the "USR..." sid on the roster -- the email is the only reliable
    join between them, which is why email_by_numeric_id comes back too.

    "interval" is sent for parity with the legacy pipeline but CTM ignores it;
    the window bounds are what actually determine the result.
    """
    path = f"/api/v1/accounts/{credentials['account_id']}/agents/utilization.json"
    params = {
        "start_time": to_epoch(start_dt),
        "end_time": to_epoch(end_dt),
        "timezone": TIMEZONE_LABEL,
        "interval": "day",
        "statistic": "occupancy",
        "view_by": "agent",
        "es": "1",
    }
    began = time.monotonic()
    payload, _url = api_get(credentials, path, params)
    elapsed = time.monotonic() - began

    users = {str(k): v for k, v in (payload.get("users") or {}).items()}
    email_by_id = {
        uid: (info.get("email") or "").strip().lower()
        for uid, info in users.items()
    }

    metrics = defaultdict(dict)
    all_metrics = payload.get("metrics") or {}
    for ctm_name, column in DURATION_METRICS.items():
        for row in all_metrics.get(ctm_name) or []:
            uid = str(row.get("user_id") or "").strip()
            if uid:
                metrics[uid][column] = float(row.get("total") or 0)
    for ctm_name, column in COUNT_METRICS.items():
        for row in all_metrics.get(ctm_name) or []:
            uid = str(row.get("user_id") or "").strip()
            if uid:
                metrics[uid][column] = int(float(row.get("count") or 0))

    return dict(metrics), email_by_id, elapsed


def hms(seconds):
    total = int(round(float(seconds or 0)))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}"
