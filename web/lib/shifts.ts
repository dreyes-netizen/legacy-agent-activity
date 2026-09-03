// Shift definitions and shift-anchored aggregation.
//
// Shift anchoring is the only day boundary that keeps every agent's working
// period on one row. The two clusters here cross midnight in *different*
// timezones -- roughly six agents cross Manila midnight, one or two cross
// Eastern midnight -- so no single calendar-day anchor can serve both. A
// shift's own start and end can.
//
// That also means a shift-anchored query has a DIFFERENT window per agent,
// unlike every other anchor. The windows are therefore built in SQL from the
// shifts table rather than passed in as one pair of instants.
import 'server-only';
import { sql } from './db/neon';
import { MANILA } from './time';

export interface Shift {
  id: number;
  ctmUserId: string;
  agentName: string;
  startLocal: string; // HH:MM
  endLocal: string;
  timezone: string;
  /** 0=Sunday..6=Saturday; null means every day. */
  weekdays: number[] | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string | null;
  crossesMidnight: boolean;
  updatedAt: string;
}

function toShift(row: Record<string, unknown>): Shift {
  const startLocal = String(row.start_local).slice(0, 5);
  const endLocal = String(row.end_local).slice(0, 5);
  return {
    id: Number(row.id),
    ctmUserId: String(row.ctm_user_id),
    agentName: String(row.agent_name ?? ''),
    startLocal,
    endLocal,
    timezone: String(row.timezone),
    weekdays: (row.weekdays as number[] | null) ?? null,
    effectiveFrom: String(row.effective_from).slice(0, 10),
    effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    // end <= start means the window runs past midnight into the next day.
    crossesMidnight: endLocal <= startLocal,
    updatedAt: String(row.updated_at),
  };
}

export async function listShifts(): Promise<Shift[]> {
  const rows = (await sql`
    SELECT s.id, s.ctm_user_id, a.name AS agent_name, s.start_local, s.end_local,
           s.timezone, s.weekdays, s.effective_from, s.effective_to,
           s.created_by, s.updated_at
      FROM shifts s
      JOIN agents a ON a.ctm_user_id = s.ctm_user_id
     ORDER BY a.name, s.effective_from DESC
  `) as Array<Record<string, unknown>>;
  return rows.map(toShift);
}

export interface ShiftInput {
  ctmUserId: string;
  startLocal: string;
  endLocal: string;
  timezone?: string;
  weekdays?: number[] | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  createdBy?: string | null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateShift(input: ShiftInput): string | null {
  if (!input.ctmUserId) return 'Pick an agent.';
  if (!TIME_RE.test(input.startLocal)) return 'Start time must be HH:MM.';
  if (!TIME_RE.test(input.endLocal)) return 'End time must be HH:MM.';
  if (input.startLocal === input.endLocal) {
    return 'Start and end cannot be the same time.';
  }
  if (!DATE_RE.test(input.effectiveFrom)) return 'Effective from must be a date.';
  if (input.effectiveTo && !DATE_RE.test(input.effectiveTo)) {
    return 'Effective to must be a date.';
  }
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
    return 'Effective to cannot be before effective from.';
  }
  if (input.weekdays && input.weekdays.some((day) => day < 0 || day > 6)) {
    return 'Weekdays must be between 0 (Sunday) and 6 (Saturday).';
  }
  return null;
}

/**
 * Create or update a shift, and queue the exact login re-query it invalidates.
 *
 * online/session for a new window recompute from agent_hourly instantly, but
 * login_time cannot be derived from anything stored -- it has to be asked of
 * CTM for the exact window. So every write enqueues the affected shift dates
 * in backfill_queue, which the sync's `settle` pass drains.
 */
export async function saveShift(
  input: ShiftInput,
  id?: number,
): Promise<{ id: number; queued: number; queueError?: string }> {
  const timezone = input.timezone || MANILA;
  const weekdays = input.weekdays && input.weekdays.length > 0 ? input.weekdays : null;

  const saved = (
    id
      ? ((await sql`
          UPDATE shifts
             SET ctm_user_id = ${input.ctmUserId},
                 start_local = ${input.startLocal}::time,
                 end_local = ${input.endLocal}::time,
                 timezone = ${timezone},
                 weekdays = ${weekdays}::smallint[],
                 effective_from = ${input.effectiveFrom}::date,
                 effective_to = ${input.effectiveTo ?? null}::date,
                 created_by = ${input.createdBy ?? null},
                 updated_at = now()
           WHERE id = ${id}
         RETURNING id
        `) as Array<{ id: number }>)
      : ((await sql`
          INSERT INTO shifts (ctm_user_id, start_local, end_local, timezone, weekdays,
                              effective_from, effective_to, created_by)
          VALUES (${input.ctmUserId}, ${input.startLocal}::time, ${input.endLocal}::time,
                  ${timezone}, ${weekdays}::smallint[], ${input.effectiveFrom}::date,
                  ${input.effectiveTo ?? null}::date, ${input.createdBy ?? null})
          RETURNING id
        `) as Array<{ id: number }>)
  )[0];

  if (!saved) throw new Error('Shift was not saved.');

  // The shift write and the queueing are separate statements (the Neon HTTP
  // driver has no transaction that can carry the RETURNING id between them), so
  // a queue failure must not be reported as a failed save -- the shift really
  // is stored, and saying otherwise sends someone to re-enter it. The queue is
  // recoverable: re-saving the shift enqueues it again.
  try {
    const queued = await enqueueShiftBackfill(saved.id);
    return { id: saved.id, queued };
  } catch (error) {
    return {
      id: saved.id,
      queued: 0,
      queueError: error instanceof Error ? error.message : 'could not queue login backfill',
    };
  }
}

export async function deleteShift(id: number): Promise<void> {
  await sql`DELETE FROM shifts WHERE id = ${id}`;
}

/**
 * Queue an exact login query for every occurrence of a shift, from its
 * effective start up to today. Capped so a shift dated far in the past cannot
 * enqueue thousands of windows in one click.
 */
const MAX_QUEUED_OCCURRENCES = 120;

export async function enqueueShiftBackfill(shiftId: number): Promise<number> {
  const rows = (await sql`
    WITH s AS (
      SELECT * FROM shifts WHERE id = ${shiftId}
    ),
    occurrences AS (
      SELECT s.ctm_user_id,
             d::date AS shift_date,
             ((d::date + s.start_local) AT TIME ZONE s.timezone) AS window_start,
             ((CASE WHEN s.end_local > s.start_local THEN d::date ELSE d::date + 1 END
               + s.end_local) AT TIME ZONE s.timezone) AS window_end
        FROM s
        -- The ::int cast is required, not decorative. The driver sends bound
        -- parameters untyped, so CURRENT_DATE - $1 is ambiguous: Postgres
        -- resolves $1 as a date, making the expression date - date -> integer,
        -- and GREATEST(date, integer) then fails with "types date and integer
        -- cannot be matched". Forcing $1 to int selects date - int -> date.
        CROSS JOIN generate_series(
               GREATEST(s.effective_from, (CURRENT_DATE - ${MAX_QUEUED_OCCURRENCES}::int)),
               LEAST(COALESCE(s.effective_to, CURRENT_DATE), CURRENT_DATE),
               interval '1 day') AS d
       WHERE s.weekdays IS NULL
          OR EXTRACT(DOW FROM d)::smallint = ANY(s.weekdays)
    )
    INSERT INTO backfill_queue (grain, window_start, window_end, ctm_user_id,
                                shift_date, reason)
    SELECT 'shift', o.window_start, o.window_end, o.ctm_user_id, o.shift_date,
           ${'shift ' + shiftId + ' saved'}
      FROM occurrences o
     WHERE o.window_end <= now()
    RETURNING id
  `) as Array<{ id: number }>;
  return rows.length;
}

export interface ShiftAnchoredRow {
  ctmUserId: string;
  name: string;
  occurrences: number;
  onlineSeconds: number;
  sessionSeconds: number;
  talkSeconds: number;
  holdSeconds: number;
  inboundCalls: number;
  outboundCalls: number;
  /** From agent_shift, which the sync populates exactly. Null when not yet synced. */
  loginSeconds: number | null;
  /** Occurrences with no exact login row yet -- surfaced rather than hidden. */
  missingLogin: number;
}

/**
 * Per-agent totals over each agent's own shift windows.
 *
 * `from`/`to` are shift dates in the shift's own timezone (Manila by default),
 * and a shift date is always the date the shift STARTED -- which is what keeps
 * a window running past midnight on one row.
 *
 * Note on precision: agent_hourly buckets are whole clock hours. Manila and
 * Eastern are both whole-hour offsets from UTC, so a shift on the hour aligns
 * exactly. A shift starting at, say, 21:30 will include the whole 21:00 hour.
 */
export async function getShiftAnchoredTotals(
  fromDate: string,
  toDate: string,
  agentIds: string[],
): Promise<ShiftAnchoredRow[]> {
  const filterAgents = agentIds.length > 0;
  const rows = (await sql`
    WITH occurrences AS (
      SELECT s.id AS shift_id,
             s.ctm_user_id,
             d::date AS shift_date,
             ((d::date + s.start_local) AT TIME ZONE s.timezone) AS window_start,
             ((CASE WHEN s.end_local > s.start_local THEN d::date ELSE d::date + 1 END
               + s.end_local) AT TIME ZONE s.timezone) AS window_end
        FROM shifts s
        CROSS JOIN generate_series(${fromDate}::date, ${toDate}::date, interval '1 day') AS d
       WHERE s.effective_from <= d::date
         AND (s.effective_to IS NULL OR s.effective_to >= d::date)
         AND (s.weekdays IS NULL OR EXTRACT(DOW FROM d)::smallint = ANY(s.weekdays))
    ),
    -- Sum the additive metrics over each occurrence's own window.
    additive AS (
      SELECT o.ctm_user_id,
             count(DISTINCT o.shift_date) AS occurrences,
             COALESCE(SUM(h.online_seconds),  0) AS online_seconds,
             COALESCE(SUM(h.session_seconds), 0) AS session_seconds,
             COALESCE(SUM(h.talk_seconds),    0) AS talk_seconds,
             COALESCE(SUM(h.hold_seconds),    0) AS hold_seconds,
             COALESCE(SUM(h.inbound_calls),   0) AS inbound_calls,
             COALESCE(SUM(h.outbound_calls),  0) AS outbound_calls
        FROM occurrences o
        LEFT JOIN agent_hourly h
               ON h.ctm_user_id = o.ctm_user_id
              AND h.bucket_start <  o.window_end
              AND h.bucket_end   >= o.window_start
       GROUP BY o.ctm_user_id
    ),
    -- login comes from agent_shift, which the sync writes from an exact query
    -- of that shift's window. Never summed from hourly buckets.
    logins AS (
      SELECT o.ctm_user_id,
             SUM(sh.login_seconds) AS login_seconds,
             count(*) FILTER (WHERE sh.ctm_user_id IS NULL) AS missing
        FROM occurrences o
        LEFT JOIN agent_shift sh
               ON sh.ctm_user_id = o.ctm_user_id
              AND sh.shift_date = o.shift_date
       GROUP BY o.ctm_user_id
    )
    SELECT a.ctm_user_id, a.name,
           COALESCE(ad.occurrences, 0)      AS occurrences,
           COALESCE(ad.online_seconds, 0)   AS online_seconds,
           COALESCE(ad.session_seconds, 0)  AS session_seconds,
           COALESCE(ad.talk_seconds, 0)     AS talk_seconds,
           COALESCE(ad.hold_seconds, 0)     AS hold_seconds,
           COALESCE(ad.inbound_calls, 0)    AS inbound_calls,
           COALESCE(ad.outbound_calls, 0)   AS outbound_calls,
           l.login_seconds,
           COALESCE(l.missing, 0)           AS missing_login
      FROM agents a
      JOIN additive ad ON ad.ctm_user_id = a.ctm_user_id
      LEFT JOIN logins l ON l.ctm_user_id = a.ctm_user_id
     WHERE a.is_active
       AND (${!filterAgents}::boolean OR a.ctm_user_id = ANY(${agentIds}::text[]))
     ORDER BY a.name
  `) as Array<Record<string, string | null>>;

  return rows.map((row) => ({
    ctmUserId: String(row.ctm_user_id),
    name: String(row.name),
    occurrences: Number(row.occurrences),
    onlineSeconds: Number(row.online_seconds),
    sessionSeconds: Number(row.session_seconds),
    talkSeconds: Number(row.talk_seconds),
    holdSeconds: Number(row.hold_seconds),
    inboundCalls: Number(row.inbound_calls),
    outboundCalls: Number(row.outbound_calls),
    loginSeconds: row.login_seconds === null ? null : Number(row.login_seconds),
    missingLogin: Number(row.missing_login),
  }));
}

export async function countShifts(): Promise<number> {
  const rows = (await sql`SELECT count(*) AS n FROM shifts`) as Array<{ n: string }>;
  return Number(rows[0]?.n ?? 0);
}
