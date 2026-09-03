// The Overview read layer.
//
// Split by how each metric behaves under time slicing, which is not a
// stylistic choice -- it is forced by the data:
//
//   online / session / talk / hold / calls
//       Additive. Summed from agent_hourly, clipped to the window. Verified
//       against single-window CTM queries: identical to the second.
//
//   login
//       NOT additive, and not summable across days either. Summing three
//       daily figures under-counted one agent by 8h19m against a single
//       three-day query, because each daily query clips a session at midnight
//       and clipping loses login time. It therefore only ever comes from an
//       exact query of the displayed window -- see
//       /api/login-exact.
import 'server-only';
import { sql } from './db/neon';
import type { LocalBounds } from './filters';

export interface Window {
  startAt: Date;
  endAt: Date;
  /** endAt clamped to now -- CTM has nothing to say about the future. */
  effectiveEndAt: Date;
  inProgress: boolean;
}

/**
 * Turn local wall-clock bounds into absolute instants.
 *
 * Done in Postgres rather than JavaScript: `AT TIME ZONE` uses the real IANA
 * database, so a Manila or Eastern local time resolves correctly on both sides
 * of a DST change without any offset arithmetic here.
 */
export async function resolveWindow(bounds: LocalBounds): Promise<Window> {
  const rows = (await sql`
    SELECT (${bounds.startLocal}::timestamp AT TIME ZONE ${bounds.zone}::text) AS start_at,
           (${bounds.endLocal}::timestamp   AT TIME ZONE ${bounds.zone}::text) AS end_at,
           now() AS now_at
  `) as Array<{ start_at: string; end_at: string; now_at: string }>;

  const startAt = new Date(rows[0].start_at);
  const endAt = new Date(rows[0].end_at);
  const now = new Date(rows[0].now_at);
  const inProgress = endAt > now;

  return {
    startAt,
    endAt,
    effectiveEndAt: inProgress ? now : endAt,
    inProgress,
  };
}

export interface AgentRow {
  ctmUserId: string;
  name: string;
  email: string;
  onlineSeconds: number;
  sessionSeconds: number;
  talkSeconds: number;
  holdSeconds: number;
  inboundCalls: number;
  outboundCalls: number;
  /** Null until the exact-window query resolves; never derived by summing. */
  loginSeconds: number | null;
}

/**
 * Additive metrics per agent for a window.
 *
 * Buckets are included when they overlap the window at all, and each bucket is
 * a whole clock hour. A window that starts mid-hour therefore includes that
 * whole hour -- acceptable for the day/shift anchors whose bounds are on hour
 * boundaries, and flagged in the UI for a custom time window that is not.
 */
export async function getAgentTotals(
  window: Window,
  agentIds: string[],
): Promise<AgentRow[]> {
  const filterAgents = agentIds.length > 0;
  const rows = (await sql`
    SELECT a.ctm_user_id, a.name, a.email,
           COALESCE(SUM(h.online_seconds),  0) AS online_seconds,
           COALESCE(SUM(h.session_seconds), 0) AS session_seconds,
           COALESCE(SUM(h.talk_seconds),    0) AS talk_seconds,
           COALESCE(SUM(h.hold_seconds),    0) AS hold_seconds,
           COALESCE(SUM(h.inbound_calls),   0) AS inbound_calls,
           COALESCE(SUM(h.outbound_calls),  0) AS outbound_calls
      FROM agents a
      LEFT JOIN agent_hourly h
             ON h.ctm_user_id = a.ctm_user_id
            AND h.bucket_start <  ${window.effectiveEndAt.toISOString()}::timestamptz
            AND h.bucket_end   >= ${window.startAt.toISOString()}::timestamptz
     WHERE a.is_active
       AND (${!filterAgents}::boolean OR a.ctm_user_id = ANY(${agentIds}::text[]))
     GROUP BY a.ctm_user_id, a.name, a.email
     ORDER BY a.name
  `) as Array<Record<string, string>>;

  return rows.map((row) => ({
    ctmUserId: row.ctm_user_id,
    name: row.name,
    email: row.email,
    onlineSeconds: Number(row.online_seconds),
    sessionSeconds: Number(row.session_seconds),
    talkSeconds: Number(row.talk_seconds),
    holdSeconds: Number(row.hold_seconds),
    inboundCalls: Number(row.inbound_calls),
    outboundCalls: Number(row.outbound_calls),
    loginSeconds: null,
  }));
}

export interface AgentOption {
  ctmUserId: string;
  name: string;
}

export async function getAgentOptions(): Promise<AgentOption[]> {
  const rows = (await sql`
    SELECT ctm_user_id, name FROM agents WHERE is_active ORDER BY name
  `) as Array<{ ctm_user_id: string; name: string }>;
  return rows.map((row) => ({ ctmUserId: row.ctm_user_id, name: row.name }));
}

/** Occupancy: talk / session -- the same busy/(busy+idle) figure CTM reports. */
export function occupancyPercent(row: AgentRow): number | null {
  if (row.sessionSeconds <= 0) return null;
  return (row.talkSeconds / row.sessionSeconds) * 100;
}
