import { NextResponse, type NextRequest } from 'next/server';
import { sql } from '@/lib/db/neon';
import { fetchWindowMetrics } from '@/lib/ctm';

// Needs Buffer and a 30s outbound fetch, so Node runtime rather than edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exact login_seconds per agent for one window.
 *
 * Exists because login_time cannot be derived from anything we store: it is
 * not additive across hours (drifts up to six hours) and not summable across
 * days (one agent under-counted by 8h19m over three days). So the exact window
 * is queried from CTM once, memoised in agent_range, and served from there
 * afterwards.
 */
export async function GET(request: NextRequest) {
  const startParam = request.nextUrl.searchParams.get('start');
  const endParam = request.nextUrl.searchParams.get('end');
  if (!startParam || !endParam) {
    return NextResponse.json({ error: 'start and end are required' }, { status: 400 });
  }

  const startAt = new Date(startParam);
  const endAt = new Date(endParam);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return NextResponse.json({ error: 'start and end must be ISO timestamps' }, { status: 400 });
  }
  if (endAt <= startAt) {
    return NextResponse.json({ error: 'end must be after start' }, { status: 400 });
  }

  const startIso = startAt.toISOString();
  const endIso = endAt.toISOString();

  // Serve from cache when we can. A window fully in the past never changes; a
  // window still in progress really means "up to now", so it is only trusted
  // for as long as the sync cadence.
  const cached = (await sql`
    SELECT ctm_user_id, login_seconds
      FROM agent_range
     WHERE window_start = ${startIso}::timestamptz
       AND window_end   = ${endIso}::timestamptz
       AND (is_final OR synced_at > now() - interval '5 minutes')
  `) as Array<{ ctm_user_id: string; login_seconds: string }>;

  if (cached.length > 0) {
    return NextResponse.json({
      source: 'cache',
      login: Object.fromEntries(cached.map((r) => [r.ctm_user_id, Number(r.login_seconds)])),
    });
  }

  // The roster does not depend on the CTM response, so fetch both at once
  // rather than paying the Neon round trip after the CTM call has finished.
  const rosterPromise = sql`
    SELECT ctm_user_id, email FROM agents WHERE is_active
  `;

  let metrics: Awaited<ReturnType<typeof fetchWindowMetrics>>;
  let rosterRows: Record<string, unknown>[];
  try {
    [metrics, rosterRows] = await Promise.all([
      fetchWindowMetrics(startAt, endAt),
      rosterPromise,
    ]);
  } catch (error) {
    // The additive columns are already on screen and correct; only this one
    // column is unavailable, so say so rather than failing the whole view.
    const message = error instanceof Error ? error.message : 'CTM request failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const roster = rosterRows as Array<{ ctm_user_id: string; email: string }>;

  // Only rows we can attribute to a known agent are kept -- CTM returns every
  // user on the account, most of whom are not Alliance agents.
  const rows = roster
    .map((agent) => ({ agent, m: metrics.byEmail[agent.email.toLowerCase()] }))
    .filter((entry): entry is { agent: typeof entry.agent; m: NonNullable<typeof entry.m> } =>
      Boolean(entry.m),
    );

  // A window whose end is in the future is not final: it would otherwise mint
  // a fresh cache row every minute as "now" moves.
  const isFinal = endAt.getTime() < Date.now() - 2 * 60 * 60 * 1000;

  // One statement, not one per agent. The Neon HTTP driver makes every query a
  // separate round trip, so a loop of 13 inserts turned a 2.1s CTM call into an
  // 8.9s request. UNNEST zips the per-agent arrays into rows server-side; the
  // window bounds and is_final are scalars, identical for every row.
  if (rows.length > 0) {
    await sql`
      INSERT INTO agent_range (ctm_user_id, window_start, window_end,
                               login_seconds, online_seconds, session_seconds,
                               talk_seconds, hold_seconds, is_final)
      SELECT u.ctm_user_id, ${startIso}::timestamptz, ${endIso}::timestamptz,
             u.login, u.online, u.session, u.talk, u.hold, ${isFinal}::boolean
        FROM UNNEST(
               ${rows.map((r) => r.agent.ctm_user_id)}::text[],
               ${rows.map((r) => r.m.loginSeconds)}::numeric[],
               ${rows.map((r) => r.m.onlineSeconds)}::numeric[],
               ${rows.map((r) => r.m.sessionSeconds)}::numeric[],
               ${rows.map((r) => r.m.talkSeconds)}::numeric[],
               ${rows.map((r) => r.m.holdSeconds)}::numeric[]
             ) AS u(ctm_user_id, login, online, session, talk, hold)
      ON CONFLICT (ctm_user_id, window_start, window_end) DO UPDATE SET
              login_seconds = EXCLUDED.login_seconds,
              online_seconds = EXCLUDED.online_seconds,
              session_seconds = EXCLUDED.session_seconds,
              talk_seconds = EXCLUDED.talk_seconds,
              hold_seconds = EXCLUDED.hold_seconds,
              is_final = EXCLUDED.is_final,
              synced_at = now()
    `;
  }

  return NextResponse.json({
    source: 'ctm',
    elapsedMs: metrics.elapsedMs,
    cached: isFinal,
    login: Object.fromEntries(rows.map(({ agent, m }) => [agent.ctm_user_id, m.loginSeconds])),
  });
}
