# Driving the sync from cron-job.org

The sync runs as a GitHub Actions workflow triggered by `repository_dispatch`.
cron-job.org POSTs to GitHub's dispatch endpoint on a schedule; GitHub queues
the workflow; the workflow runs `sync.tick`. cron-job.org never waits for the
sync itself — GitHub returns `204` in under a second and the work happens
asynchronously, so cron-job.org's execution timeout is irrelevant here.

Two jobs are needed, because `tick` and `settle` are separate passes:

| Job | Interval | `event_type` |
|---|---|---|
| tick | every 5 minutes | `sync-tick` |
| settle | hourly | `sync-settle` |

---

## Step 1 — Create the GitHub token

Fine-grained PATs cannot be created via API, so this is a browser step.

1. Go to <https://github.com/settings/personal-access-tokens/new>
2. **Token name:** `cron-job.org - legacy-agent-activity`
3. **Resource owner:** `Ditherys`
4. **Expiration:** pick a date and set a calendar reminder — an expired token
   breaks the sync *silently* (see Gotcha 3)
5. **Repository access:** *Only select repositories* → `legacy-agent-activity`
6. **Permissions** → *Repository permissions* → **Contents: Read and write**
7. Generate, and copy the token — it is shown only once

`Contents: Read and write` is what the dispatch endpoint requires. `Actions:
write` alone is **not** sufficient. A classic PAT with `repo` scope also works,
but scope it narrowly: this token is going to live in a third-party service, so
it should be able to do as little as possible.

## Step 2 — Test the token before storing it anywhere

```bash
curl -i -X POST \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/Ditherys/legacy-agent-activity/dispatches \
  -d '{"event_type":"sync-tick"}'
```

Expect `HTTP/2 204`. Then confirm a run actually started:

```bash
gh run list --repo Ditherys/legacy-agent-activity --limit 3
```

Reading failures:

| Response | Meaning |
|---|---|
| `204` **and** a new run appears | Working |
| `204` but **no run** | `event_type` does not match the workflow's `types:` list |
| `401 Bad credentials` | Token wrong, or expired |
| `403` | Token lacks `Contents: Read and write`, or was not granted this repo |
| `404` | Repo path typo, or the token cannot see the repo |

## Step 3 — The tick job (every 5 minutes)

Sign in at <https://cron-job.org> and choose **Create cronjob**.

**Common tab**

- **Title:** `Legacy Agent Activity - tick`
- **URL:** `https://api.github.com/repos/Ditherys/legacy-agent-activity/dispatches`
- **Execution schedule:** every 5 minutes (`*/5` in the minutes field, every
  hour, every day)
- **Enable job:** on

**Advanced tab**

- **Request method:** `POST`
- **Headers:**

  | Header | Value |
  |---|---|
  | `Authorization` | `Bearer YOUR_TOKEN_HERE` |
  | `Accept` | `application/vnd.github+json` |
  | `Content-Type` | `application/json` |

- **Request body:**

  ```json
  {"event_type":"sync-tick"}
  ```

Save.

## Step 4 — The settle job (hourly)

Identical, with three changes:

- **Title:** `Legacy Agent Activity - settle`
- **Schedule:** hourly at **minute 7** — offset so it does not collide with a
  tick. The workflow has a `concurrency` group so a collision would just queue,
  but offsetting keeps the run history readable.
- **Body:** `{"event_type":"sync-settle"}`

`settle` is the pass that re-queries recently closed windows, drains
`backfill_queue` (the exact re-queries a shift edit needs), and marks old
windows final so `tick` stops looking at them. Without it, `tick` keeps working
but shift edits never get their exact `login_time` and nothing is ever
finalized.

## Step 5 — Verify it is actually working

Three independent checks, in increasing order of trustworthiness:

```bash
# 1. cron-job.org's own history should show 204 responses.

# 2. GitHub actually ran something:
gh run list --repo Ditherys/legacy-agent-activity --limit 10

# 3. The database actually changed -- the only check that proves the whole
#    chain. `trigger` should read 'dispatch'.
```

```sql
SELECT id, trigger, status, windows_queried, rows_upserted, started_at
  FROM sync_runs ORDER BY id DESC LIMIT 10;
```

## Health check

The failure mode that matters is a **silent** one: cron-job.org shows green,
GitHub shows nothing, and the dashboard quietly serves stale numbers. Alert on
data freshness rather than on job success:

```sql
-- Stale if the newest successful run is more than 15 minutes old
-- (3 missed ticks). Wire this to whatever alerting you use.
SELECT now() - max(started_at) AS staleness
  FROM sync_runs
 WHERE status = 'ok';
```

The dashboard should surface this directly — read `max(started_at)` from
`sync_runs` and show it as "Last synced", so a stale number is visibly stale
instead of silently wrong.

## Gotchas

1. **`204` does not mean the workflow ran.** A wrong `event_type` returns
   `204 No Content` and creates no run — verified. cron-job.org will report
   success. This is the single most likely way to think it works when it does
   not. Always confirm with check 2 or 3 above the first time.
2. **`repository_dispatch` only triggers workflows on the default branch.**
   The workflow must be on `main`. Editing it on a branch has no effect until
   merged.
3. **Token expiry breaks the sync silently** — you get `401`s that only
   cron-job.org sees. This is why the health check watches data freshness, not
   job status.
4. **Never put the token in the URL.** Headers only; cron-job.org stores job
   URLs in its history.
5. **Rate limits are not a concern.** 288 ticks + 24 settles = ~312 requests a
   day against GitHub's 5,000/hour authenticated limit.
6. **An overlapping run is harmless.** Every write is an idempotent upsert, so
   a duplicate poke costs a few wasted seconds and nothing else.

## Optional: schedule as a fallback

This repo is public, so Actions minutes are free. Uncommenting the `schedule`
block in `.github/workflows/sync.yml` adds a safety net: if a cron-job.org poke
is missed, the next scheduled run catches up. Because writes are idempotent,
running both drivers concurrently is safe.

GitHub's `schedule` is best-effort (delayed or dropped under load), UTC-only,
and auto-disables after 60 days of repository inactivity — which is exactly why
it is the fallback rather than the primary driver.
