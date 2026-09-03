"""
Window resolution: turning "agent X, date Y" into the exact epoch windows to
ask CTM for.

Because CTM ignores the "interval" param, every window we want costs one API
call. So the resolver's job is to produce the smallest set of windows that
still answers the question.
"""

from datetime import date, datetime, time as dt_time, timedelta

from . import ctm

TZ = ctm.TZ

# How long after a bucket closes we keep re-querying it, in case CTM revises
# numbers slightly after the fact. Every window I sampled was already stable,
# so this is insurance rather than a measured requirement -- lower it to 1 if
# the numbers prove settled.
SETTLING_HOURS = 2


def hour_buckets(start_dt, end_dt):
    """
    Non-overlapping [HH:00:00, HH:59:59] buckets covering the range.

    Stepping by 3600 real seconds is safe across DST here: US Eastern is always
    a whole-hour offset from UTC, so local hour boundaries line up with UTC
    ones. A 25-hour fall-back day simply produces 25 buckets.
    """
    cursor = start_dt.astimezone(TZ).replace(minute=0, second=0, microsecond=0)
    buckets = []
    while cursor < end_dt:
        bucket_end = cursor + timedelta(seconds=3599)
        buckets.append((cursor, bucket_end))
        cursor = cursor + timedelta(hours=1)
    return buckets


def hot_hours(now=None, settling_hours=SETTLING_HOURS):
    """
    The hour buckets a tick should re-query: the in-progress hour plus the
    previous `settling_hours`. Everything older is already final.
    """
    now = (now or datetime.now(TZ)).astimezone(TZ)
    current = now.replace(minute=0, second=0, microsecond=0)
    buckets = []
    for offset in range(settling_hours, -1, -1):
        start = current - timedelta(hours=offset)
        buckets.append((start, start + timedelta(seconds=3599)))
    return buckets


def day_window(local_date):
    """Full America/New_York calendar day, as one continuous window."""
    return ctm.day_start(local_date), ctm.day_end(local_date)


def day_range(start_date, end_date):
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


def shift_window(start_local, end_local, shift_date):
    """
    Concrete window for one shift occurrence.

    end_local <= start_local means the shift crosses midnight, so the end
    lands on the following calendar day. shift_date is always the date the
    shift STARTED -- that is what keeps a 21:00-06:00 shift on a single row
    instead of splitting it across two days.
    """
    start_dt = datetime.combine(shift_date, start_local, tzinfo=TZ)
    end_date = shift_date if end_local > start_local else shift_date + timedelta(days=1)
    end_dt = datetime.combine(end_date, end_local, tzinfo=TZ)
    return start_dt, end_dt


def shift_applies(shift, shift_date):
    weekdays = shift.get("weekdays")
    if not weekdays:
        return True
    # Postgres array comes back as a Python list. 0=Sunday..6=Saturday.
    return ((shift_date.weekday() + 1) % 7) in weekdays


def open_shift_windows(shifts, now=None):
    """
    Shift occurrences that are still in progress (or ended within the settling
    window), for today and yesterday -- yesterday matters because a night
    shift that started at 21:00 is still open at 02:00 the next day.
    """
    now = (now or datetime.now(TZ)).astimezone(TZ)
    cutoff = now - timedelta(hours=SETTLING_HOURS)
    today = now.date()
    out = []
    for shift in shifts:
        for shift_date in (today - timedelta(days=1), today):
            if not shift_applies(shift, shift_date):
                continue
            start_dt, end_dt = shift_window(shift["start_local"], shift["end_local"], shift_date)
            if start_dt <= now and end_dt >= cutoff:
                out.append((shift, shift_date, start_dt, min(end_dt, now)))
    return out


def hot_days(now=None, settling_hours=SETTLING_HOURS):
    """
    Calendar days whose exact login_time still needs refreshing: today, plus
    yesterday while we are inside the settling window after midnight.
    """
    now = (now or datetime.now(TZ)).astimezone(TZ)
    days = [now.date()]
    if now.hour < settling_hours + 1:
        days.insert(0, now.date() - timedelta(days=1))
    return days


def clamp_to_now(start_dt, end_dt, now=None):
    """Never ask CTM about the future; an open window ends at 'now'."""
    now = (now or datetime.now(TZ)).astimezone(TZ)
    return start_dt, min(end_dt, now)
