-- 002: shift timezones + the memoised exact-login cache.
--
-- WHY shifts.timezone: team leaders enter shifts in Manila time, but the sync
-- builds CTM query windows from clock times. Without recording which zone a
-- clock time belongs to, every shift silently moves by an hour in November,
-- when America/New_York returns to standard time and the Manila offset goes
-- from +12h to +13h (Manila itself has no DST). Storing the zone makes the
-- conversion explicit and DST-correct in both directions.

ALTER TABLE shifts
    ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Manila';

-- Reject a zone Postgres cannot resolve, so a typo fails at write time rather
-- than producing silently wrong windows months later.
ALTER TABLE shifts
    DROP CONSTRAINT IF EXISTS shifts_timezone_valid;
ALTER TABLE shifts
    ADD CONSTRAINT shifts_timezone_valid
    CHECK (now() AT TIME ZONE timezone IS NOT NULL);

-- WHY agent_range: login_time is only correct at the exact window it was
-- queried for (summing 24 hourly buckets drifts up to six hours), so an
-- arbitrary user-selected range cannot be answered from stored hourly data.
-- CTM calls are ~1.4s and one call covers every agent, so the dashboard
-- queries the exact window on demand and memoises it here.
--
-- This subsumes more than custom ranges: a Manila calendar day is just an
-- arbitrary window in ET terms, so the same table serves the "Manila day"
-- filter with no separate day table.
CREATE TABLE IF NOT EXISTS agent_range (
    ctm_user_id     text NOT NULL REFERENCES agents(ctm_user_id) ON DELETE CASCADE,
    window_start    timestamptz NOT NULL,
    window_end      timestamptz NOT NULL,
    login_seconds   numeric(12,2) NOT NULL DEFAULT 0,
    online_seconds  numeric(12,2) NOT NULL DEFAULT 0,
    session_seconds numeric(12,2) NOT NULL DEFAULT 0,
    talk_seconds    numeric(12,2) NOT NULL DEFAULT 0,
    hold_seconds    numeric(12,2) NOT NULL DEFAULT 0,
    -- false while the window's end is still in the future: such a window ends
    -- at "now" and would otherwise mint a fresh cache row every minute. Only
    -- final rows are trusted indefinitely; non-final ones are re-queried once
    -- older than the sync cadence.
    is_final        boolean NOT NULL DEFAULT false,
    synced_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ctm_user_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS agent_range_window_idx
    ON agent_range (window_start, window_end);
-- Lets the staleness sweep find refreshable rows without scanning the cache.
CREATE INDEX IF NOT EXISTS agent_range_not_final_idx
    ON agent_range (synced_at) WHERE NOT is_final;
