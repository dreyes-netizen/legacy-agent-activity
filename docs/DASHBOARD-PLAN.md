# Dashboard plan

Next.js dashboard over the Neon data the Python sync maintains. Lives in
`web/` in this repo so it shares the migrations the sync depends on.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Location | Separate app, in `web/` here | Shares migrations with the sync; AGS KPI App untouched |
| UI | AGS KPI App design system, ported | Match the tool the team already uses |
| Display timezone | Asia/Manila default, ET available | Team leaders are in Manila |
| `login_time` for custom ranges | On-demand CTM query, cached | Calls are ~1.4s and cover all agents at once |
| Auth | Single shared password | Accepted trade-off: no audit trail on shift edits |
| v1 scope | Overview + shift management | Shift CRUD is what turns on exact per-shift login |

## Why shift-anchored days, not a timezone fix

Agents split into clusters that each cross midnight in *one* timezone:

| Cluster | ET hours | Manila hours | Crosses midnight in |
|---|---|---|---|
| A (6 agents) | 09:00-17:00 | 21:00-05:00 | **Manila** |
| B (5 agents) | 00:00-08:00 | 12:00-20:00 | neither |
| C (1-2 agents) | 18:00-02:00 | 06:00-15:00 | **ET** |

No timezone fixes everyone. `agent_shift.shift_date` — the date the shift
*started* — is the only universal answer, which makes the timezone question
purely about display.

The Manila/ET offset is **12h now, 13h from November** (ET returns to standard
time; Manila has no DST). Anything storing a clock time must record its
timezone or it silently drifts twice a year.

## Schema additions (migration 002)

```sql
ALTER TABLE shifts ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Manila';

CREATE TABLE agent_range (   -- memoised exact login_time for arbitrary windows
    ctm_user_id     text NOT NULL REFERENCES agents(ctm_user_id) ON DELETE CASCADE,
    window_start    timestamptz NOT NULL,
    window_end      timestamptz NOT NULL,
    login_seconds   numeric(12,2) NOT NULL DEFAULT 0,
    online_seconds  numeric(12,2) NOT NULL DEFAULT 0,
    session_seconds numeric(12,2) NOT NULL DEFAULT 0,
    is_final        boolean NOT NULL DEFAULT false,
    synced_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ctm_user_id, window_start, window_end)
);
```

`agent_range` turns out to subsume more than custom ranges: a **Manila calendar
day is just an arbitrary window** in ET terms, so the same mechanism serves it.
No separate Manila-day table needed.

Only windows fully in the past (`is_final = true`) are cached permanently. An
in-progress window ends at "now", which changes every minute and would generate
a cache row per minute — those get a short TTL matching the sync cadence.

`agent_day` and `agent_shift` still earn their place: the tick keeps them warm,
so today's figures load with no spinner.

## Filter to data mapping

This table drives the UI, because it says exactly when a spinner appears.

| "Day defined by" | online / session | login |
|---|---|---|
| Shift | `agent_hourly`, instant | `agent_shift`, instant |
| ET calendar day | instant | `agent_day`, instant |
| Manila calendar day | instant | `agent_range`, ~1.5s first view |
| Custom range | instant | `agent_range`, ~1.5s first view |
| + time-of-day window | instant | **not offered** |

The time-of-day case is the only gap: exact login there needs one CTM call per
day in the range (a fortnight would be ~20s), too slow for a request. That
column reads "n/a with a time filter" rather than showing a wrong number. If it
is wanted later it becomes a queued job via `backfill_queue`.

**Never render a summed-hourly login figure.** It drifts by up to six hours.

## Filters

**Primary**

1. Date range — `<input type="date">` pairs plus presets (Today, Yesterday,
   This week, Last week, This month)
2. **Day defined by** — Shift / ET day / Manila day. The filter that answers
   the original night-shift problem, so it is explicit and visible
3. Time-of-day window — optional, may cross midnight
4. Agents — multi-select
5. Shift pattern — once `shifts` is populated

**Display**

6. Grain — Day / Shift / Hour
7. Columns — login, session, online, talk, hold, occupancy %, inbound, outbound
8. Timezone toggle — Manila / ET
9. Compare to previous period (later)

Filter state lives in the URL (`?from=&to=&anchor=shift&agents=`) so a view can
be linked to someone.

## Routes

```
/login              password form -> signed httpOnly cookie
/                   Overview: filters + agent x metrics table
/shifts             Shift management (CRUD)

/api/metrics        filtered read from Neon
/api/login-exact    on-demand CTM query + agent_range cache
/api/shifts         CRUD; writes enqueue backfill_queue rows
```

Auth is a server-set signed httpOnly cookie checked in middleware — not the
password in `localStorage`, which any script on the page could read.

## Porting the design system

From `C:\Users\D_Reyes\Desktop\AGS KPI App`:

- `tailwind.config.ts` — palette, the `3xs`-`2xl` type scale, radii, mono
  letter-spacing, `light-only` (no dark-mode strategy)
- `next/font` — Inter as `--font-sans`, JetBrains Mono as `--font-mono`
- `lib/utils.ts` — `cn()`
- `components/kpi/style.ts` — `CARD`, `CARD_PAD`, `CARD_HOVER`, `STAT_NUM`,
  `MICRO_LABEL`, `INPUT`, `LABEL`
- Shell — `flex h-screen overflow-hidden bg-ground`, `w-[220px] bg-navy`
  sidebar, `MobileNav`, navy `PageHeader` with `meta` and `actions` slots
- Table idiom — sticky white mono-uppercase header, sticky first column with
  edge shadow, `border-row-border`, `hover:bg-row-hover`, `tabular-nums`
- `FreshnessStrip` -> "Last synced" in `PageHeader`'s `meta` slot
- `MultiSelectFilter` -> the agent picker
- `StatTile` -> headline numbers

Constraints that app documents, to be respected rather than rediscovered:

- **`amber` fails AA as text** (~2.5:1 on white). Text and badges use
  `amber-dark`; plain `amber` is for fills and dots. Our "stale sync" warning
  is a text case.
- **`text-base` stays 16px** — inputs rely on `text-base md:text-[13px]` to
  stop iOS Safari zooming on focus.
- **Light-only**, deliberately.
- **`@base-ui/react` is installed but unused there** — dropdowns stay
  hand-rolled, so we hand-roll too rather than being the odd one out.

That app has **no date-range picker** (only a month `<select>`), so ours is new:
native `date`/`time` inputs styled with the `INPUT` token plus preset buttons.
No new dependency, correct mobile behaviour, and nothing to drift.

## Build order

1. Migration `002` — `shifts.timezone`, `agent_range`
2. Timezone-aware shift windows in `sync/windows.py`; range upsert in `sync/db.py`
3. Next.js scaffold in `web/` — ported config, fonts, shell, auth cookie
4. `/api/metrics` + Overview table with filters
5. `/api/login-exact` + the on-demand login column
6. `/shifts` CRUD, enqueuing `backfill_queue` on write

Steps 1-2 are testable against real data before any UI exists, so the dashboard
gets built on windows already verified correct.
