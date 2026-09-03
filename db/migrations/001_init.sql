-- Legacy Agent Activity -- initial schema.
--
-- Grain is deliberately split because the three CTM metrics behave differently
-- under window slicing (verified against the live API on 2026-09-02):
--
--   online, session_time  ADDITIVE. Splitting a day into two 12h windows and
--                         summing matched the single full-day query to within
--                         1 second. Safe to store hourly and SUM() over any
--                         range the user picks.
--   login_time            NOT ADDITIVE, and badly so. A 12h split lost 16-19
--                         minutes per agent; summing 24 HOURLY buckets drifts
--                         by up to SIX HOURS (measured 2026-09-02: one agent's
--                         exact day figure was 8:57:26 against 2:50:39 summed).
--                         Only ever trustworthy at the exact window it was
--                         queried for, so it lives in agent_day / agent_shift.
--                         The hourly copy is diagnostic only -- never SUM() it.
--
-- All timestamps are timestamptz (stored UTC). America/New_York is the
-- reporting timezone, matching the existing legacy KPI pipeline.

CREATE TABLE IF NOT EXISTS agents (
    ctm_user_id   text PRIMARY KEY,          -- CTM "USR..." sid
    ctm_numeric_id bigint,                   -- numeric user_id used in metrics rows
    email         text NOT NULL UNIQUE,
    name          text NOT NULL,
    is_active     boolean NOT NULL DEFAULT true,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Editable by team leaders in the dashboard. Local clock times, not
-- timestamps: "21:00 to 06:00" is a recurring pattern, not a single event.
-- end_local < start_local means the shift crosses midnight.
CREATE TABLE IF NOT EXISTS shifts (
    id             bigserial PRIMARY KEY,
    ctm_user_id    text NOT NULL REFERENCES agents(ctm_user_id) ON DELETE CASCADE,
    start_local    time NOT NULL,
    end_local      time NOT NULL,
    -- 0=Sun..6=Sat; NULL means every day.
    weekdays       smallint[],
    effective_from date NOT NULL,
    effective_to   date,                     -- NULL = still current
    created_by     text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shifts_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS shifts_agent_effective_idx
    ON shifts (ctm_user_id, effective_from DESC);

-- Immutable source of truth. One row per agent per clock hour.
-- is_final flips once the bucket is old enough that CTM will not revise it,
-- after which the sync never queries it again.
CREATE TABLE IF NOT EXISTS agent_hourly (
    ctm_user_id          text NOT NULL REFERENCES agents(ctm_user_id) ON DELETE CASCADE,
    bucket_start         timestamptz NOT NULL,
    bucket_end           timestamptz NOT NULL,
    online_seconds       numeric(12,2) NOT NULL DEFAULT 0,
    session_seconds      numeric(12,2) NOT NULL DEFAULT 0,
    talk_seconds         numeric(12,2) NOT NULL DEFAULT 0,
    hold_seconds         numeric(12,2) NOT NULL DEFAULT 0,
    inbound_calls        integer NOT NULL DEFAULT 0,
    outbound_calls       integer NOT NULL DEFAULT 0,
    -- Sum these at your peril; see the header note on login_time.
    login_seconds_approx numeric(12,2) NOT NULL DEFAULT 0,
    is_final             boolean NOT NULL DEFAULT false,
    synced_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ctm_user_id, bucket_start)
);
CREATE INDEX IF NOT EXISTS agent_hourly_bucket_idx ON agent_hourly (bucket_start);
CREATE INDEX IF NOT EXISTS agent_hourly_not_final_idx ON agent_hourly (bucket_start) WHERE NOT is_final;

-- Exact login_time per America/New_York calendar day (00:00:00 - 23:59:59),
-- queried as one continuous window so it is never a sum of sub-windows.
CREATE TABLE IF NOT EXISTS agent_day (
    ctm_user_id     text NOT NULL REFERENCES agents(ctm_user_id) ON DELETE CASCADE,
    local_date      date NOT NULL,
    window_start    timestamptz NOT NULL,
    window_end      timestamptz NOT NULL,
    login_seconds   numeric(12,2) NOT NULL DEFAULT 0,
    online_seconds  numeric(12,2) NOT NULL DEFAULT 0,
    session_seconds numeric(12,2) NOT NULL DEFAULT 0,
    is_final        boolean NOT NULL DEFAULT false,
    synced_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ctm_user_id, local_date)
);

-- Exact login_time per shift window. Populated only once a shift is defined;
-- editing a shift enqueues a re-query rather than recomputing from hourly.
CREATE TABLE IF NOT EXISTS agent_shift (
    ctm_user_id     text NOT NULL REFERENCES agents(ctm_user_id) ON DELETE CASCADE,
    -- The local date the shift STARTED. This is what makes a 21:00-06:00
    -- shift report under one day instead of splitting across two.
    shift_date      date NOT NULL,
    shift_id        bigint REFERENCES shifts(id) ON DELETE SET NULL,
    window_start    timestamptz NOT NULL,
    window_end      timestamptz NOT NULL,
    login_seconds   numeric(12,2) NOT NULL DEFAULT 0,
    online_seconds  numeric(12,2) NOT NULL DEFAULT 0,
    session_seconds numeric(12,2) NOT NULL DEFAULT 0,
    talk_seconds    numeric(12,2) NOT NULL DEFAULT 0,
    hold_seconds    numeric(12,2) NOT NULL DEFAULT 0,
    is_final        boolean NOT NULL DEFAULT false,
    synced_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ctm_user_id, shift_date)
);
CREATE INDEX IF NOT EXISTS agent_shift_date_idx ON agent_shift (shift_date);

-- Work queue for windows that need an exact CTM re-query: new/edited shifts,
-- or a manual backfill request. Drained by the tick job after its hot windows.
CREATE TABLE IF NOT EXISTS backfill_queue (
    id           bigserial PRIMARY KEY,
    grain        text NOT NULL CHECK (grain IN ('hour', 'day', 'shift')),
    window_start timestamptz NOT NULL,
    window_end   timestamptz NOT NULL,
    ctm_user_id  text,                       -- NULL = all agents (one API call covers everyone)
    shift_date   date,
    reason       text,
    enqueued_at  timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    completed_at timestamptz,
    error        text,
    attempts     integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS backfill_queue_pending_idx
    ON backfill_queue (enqueued_at) WHERE completed_at IS NULL;

-- One row per sync invocation. The dashboard's "Last synced" reads from here,
-- so an on-screen number is always attributable to a known run.
CREATE TABLE IF NOT EXISTS sync_runs (
    id              bigserial PRIMARY KEY,
    trigger         text NOT NULL,           -- schedule | dispatch | manual | backfill
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    windows_queried integer NOT NULL DEFAULT 0,
    rows_upserted   integer NOT NULL DEFAULT 0,
    api_seconds     numeric(10,2),
    status          text NOT NULL DEFAULT 'running',  -- running | ok | error
    error           text
);
CREATE INDEX IF NOT EXISTS sync_runs_started_idx ON sync_runs (started_at DESC);
