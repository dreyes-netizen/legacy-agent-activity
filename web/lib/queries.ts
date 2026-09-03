// Read layer. Every query here hits Neon only -- the Python sync in this repo
// is what talks to CallTrackingMetrics, so no page render waits on an external
// API. The one exception will be /api/login-exact, which queries an exact
// window on demand because login_time cannot be derived from stored data.
import 'server-only';
import { sql } from './db/neon';

export interface SyncStatus {
  lastSyncAt: string | null;
  lastStatus: string | null;
  runsToday: number;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const rows = (await sql`
    SELECT
      (SELECT max(started_at) FROM sync_runs WHERE status = 'ok')          AS last_ok,
      (SELECT status FROM sync_runs ORDER BY id DESC LIMIT 1)              AS last_status,
      (SELECT count(*) FROM sync_runs WHERE started_at > now() - interval '24 hours')
                                                                          AS runs_today
  `) as Array<{ last_ok: string | null; last_status: string | null; runs_today: string }>;

  const row = rows[0];
  return {
    lastSyncAt: row?.last_ok ?? null,
    lastStatus: row?.last_status ?? null,
    runsToday: Number(row?.runs_today ?? 0),
  };
}

export interface CoverageSummary {
  agents: number;
  shiftsDefined: number;
  hourlyBuckets: number;
  dayRows: number;
  /** Earliest and latest hourly bucket we hold, as ISO strings. */
  firstBucket: string | null;
  lastBucket: string | null;
}

export async function getCoverage(): Promise<CoverageSummary> {
  const rows = (await sql`
    SELECT
      (SELECT count(*) FROM agents WHERE is_active)  AS agents,
      (SELECT count(*) FROM shifts)                  AS shifts_defined,
      (SELECT count(*) FROM agent_hourly)            AS hourly_buckets,
      (SELECT count(*) FROM agent_day)               AS day_rows,
      (SELECT min(bucket_start) FROM agent_hourly)   AS first_bucket,
      (SELECT max(bucket_start) FROM agent_hourly)   AS last_bucket
  `) as Array<Record<string, string | null>>;

  const row = rows[0] ?? {};
  return {
    agents: Number(row.agents ?? 0),
    shiftsDefined: Number(row.shifts_defined ?? 0),
    hourlyBuckets: Number(row.hourly_buckets ?? 0),
    dayRows: Number(row.day_rows ?? 0),
    firstBucket: row.first_bucket ?? null,
    lastBucket: row.last_bucket ?? null,
  };
}

export interface AgentDayTotals {
  ctmUserId: string;
  name: string;
  email: string;
  localDate: string;
  loginSeconds: number;
  onlineSeconds: number;
  sessionSeconds: number;
}

/**
 * Per-agent totals for whole America/New_York calendar days.
 *
 * Reads agent_day, not a sum over agent_hourly: login_seconds is only correct
 * at the grain it was queried for. Summing hourly buckets drifts by up to six
 * hours, so it must never be the source for a login figure.
 */
export async function getAgentDays(fromDate: string, toDate: string): Promise<AgentDayTotals[]> {
  const rows = (await sql`
    SELECT a.ctm_user_id, a.name, a.email, d.local_date,
           d.login_seconds, d.online_seconds, d.session_seconds
      FROM agent_day d
      JOIN agents a ON a.ctm_user_id = d.ctm_user_id
     WHERE d.local_date BETWEEN ${fromDate}::date AND ${toDate}::date
     ORDER BY a.name, d.local_date
  `) as Array<Record<string, string>>;

  return rows.map((row) => ({
    ctmUserId: row.ctm_user_id,
    name: row.name,
    email: row.email,
    localDate: row.local_date,
    loginSeconds: Number(row.login_seconds),
    onlineSeconds: Number(row.online_seconds),
    sessionSeconds: Number(row.session_seconds),
  }));
}
