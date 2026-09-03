# Legacy Agent Activity

Syncs CallTrackingMetrics agent **online time**, **session time** and **login time**
into Neon Postgres, sliceable by arbitrary date *and* time — so night shifts that
cross midnight report as one shift instead of being split across two calendar days.

Feeds a Next.js dashboard (not in this repo yet). The dashboard reads Neon only;
nothing user-facing ever calls CTM.

## Why the schema looks like this

The three metrics come from the same endpoint but behave differently when you
slice the time window. Measured against the live API on 2026-09-02:

| Metric | Additive? | Evidence |
|---|---|---|
| `online` | **Yes** | 24 hourly buckets summed to within 4s of the single full-day query |
| `session_time` | **Yes** | same, within 6s |
| `login_time` | **No** | summing 24 hourly buckets drifted up to **−6 hours** (one agent: `8:57:26` exact vs `2:50:39` summed) |

So:

- **`agent_hourly` is the immutable source of truth** for `online`/`session`.
  Any window a team leader defines later — including one that crosses midnight —
  is answerable in SQL retroactively, with no re-query.
- **`login_time` only exists at the grain it was queried for**: `agent_day`
  (exact per America/New_York calendar day) and `agent_shift` (exact per shift
  window). The hourly copy is named `login_seconds_approx` and is diagnostic
  only. Never `SUM()` it.

Cross-check that validates the whole approach: for a night-shift agent,
summing hourly buckets from 21:00 Sep 2 to 06:00 Sep 3 gave
`online 4:21:51`; asking CTM directly for that exact window gave `4:21:57`.
Six seconds apart, across a midnight boundary.

## CTM API facts worth not rediscovering

- Windows are **epoch seconds**, and CTM honours arbitrary ones — including
  across local midnight. This is why night shifts work at all.
- The **`interval` param is ignored.** `interval=hour` returns byte-identical
  totals to `interval=day`, and each row's `hourly` sub-object is always empty.
  Sub-day granularity costs one API call per window.
- The **`users` map only contains users with activity in that window.** The
  roster must come from `/users.json` (103 users, 18 on
  `@allianceglobalsolutions.com`) or agents vanish on days they didn't work.
- **One call returns every agent**, so cost per window is flat regardless of
  headcount. Measured latency: **0.6–2.9s** per window.
- `session_time` and `occupancy` are the same number; `occupancy` just adds a
  `percent` field.
- `/agents/events.json` exists and emits raw `online`/`offline` state changes
  with millisecond timestamps — but every time-filter param is ignored (it
  always returns the last hour, 30 rows/page, walkable backwards only via the
  `search_before` cursor). Usable as a forward-running collector for a true
  per-minute timeline; useless for backfill.

## Layout

```
db/migrations/     schema (idempotent SQL, applied in name order)
sync/ctm.py        CTM client — auth, windows, roster, metric extraction
sync/db.py         Neon access — all writes are idempotent upserts
sync/windows.py    window resolver — hour buckets, day, shift, DST-safe
sync/tick.py       the recurring sync (tick / settle modes)
sync/backfill.py   one-off historical backfill
scripts/migrate.py apply migrations
```

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env.local          # fill in CTM keys + Neon DATABASE_URL
python scripts/migrate.py
```

Neon project: **Legacy Agent Activity** (Postgres 18, `aws-us-east-1`, AGS org) —
find its id with `neon projects list --org-id <org>`. Use the `-pooler` host for
anything serverless; the direct host is fine for the sync job, which holds one
connection per run.

## Running

```bash
# recurring sync — only what is still moving
python -m sync.tick --mode tick          # ~11s, 2-6 windows
python -m sync.tick --mode settle        # hourly: re-query closed windows, drain queue, finalize

# one-off history
python -m sync.backfill --start-date 2026-09-01 --grain day    # 1 call/day, exact login_time
python -m sync.backfill --start-date 2026-09-01 --grain hour   # 24 calls/day, fine-grained
```

Backfill is **resumable** — windows already stored as final are skipped, so an
interrupted run can just be re-run. At ~1.4s per call, a month of hourly
history is roughly 17 minutes; three months about 50.

Every run writes a row to `sync_runs`. The dashboard's "Last synced" reads from
there, so any number on screen is attributable to a known run.

## Scheduling

`.github/workflows/sync.yml` wires three triggers so the driver can change
without touching the code:

- `workflow_dispatch` — manual, works now
- `repository_dispatch` — external scheduler (cron-job.org and friends):
  ```
  POST https://api.github.com/repos/OWNER/REPO/dispatches
  Authorization: Bearer <PAT>
  Accept: application/vnd.github+json
  {"event_type": "sync-tick"}     # or "sync-settle"
  ```
  The token needs write access to this repo's contents: a classic PAT with
  `repo` scope (verified working), or a fine-grained PAT scoped to this
  repository only with **Contents: Read and write**. `Actions: write` alone
  is not sufficient for the dispatch endpoint.
- `schedule` — commented out, but **free to enable on this repo**, which is
  public and therefore gets unlimited Actions minutes. Worth turning on purely
  as a *fallback* behind cron-job.org: if an external poke is missed, the next
  scheduled run catches up, and because every write is an idempotent upsert an
  overlapping run costs nothing but wasted seconds.

  (For reference, on a **private** repo this would not be free: ~8,640 runs a
  month each billing the 1-minute minimum — the sync is ~11s, but checkout and
  pip install push a run to ~40-50s — against an included 2,000–3,000 minutes,
  so roughly $45-55/month in overage.)

Two cron-job.org jobs are needed, since `tick` and `settle` are separate passes:

| Interval | Body |
|---|---|
| every 5 min | `{"event_type": "sync-tick"}` |
| hourly | `{"event_type": "sync-settle"}` |

GitHub's own `schedule` is best-effort — firings get delayed or dropped under
load, it is UTC-only, and scheduled workflows are auto-disabled after 60 days
of repo inactivity. That is why an external poker is the primary driver here
even though the schedule is free.

## Shifts

`shifts` is empty by design — team leaders populate it from the dashboard.
`start_local`/`end_local` are clock times, so `end_local <= start_local` means
the shift crosses midnight, and `shift_date` is always the date the shift
**started**.

Editing a shift does not silently invalidate stored data:

- `online`/`session` for the new window recompute from `agent_hourly` in SQL,
  instantly and retroactively.
- `login_time` needs an exact re-query, so the edit enqueues a row in
  `backfill_queue`, drained by the next `settle` run. Until it lands, show the
  hourly-derived value flagged as approximate — and remember how wrong that can
  be (see the table above).
