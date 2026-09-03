// Minimal CallTrackingMetrics client -- one call, for one purpose.
//
// This is the ONLY place the dashboard talks to CTM, and only because
// login_time cannot be derived from stored data: it is not additive across
// hours (drifts up to six hours) and not summable across days either (one
// agent was under-counted by 8h19m over three days, because a per-day query
// clips a session at midnight and clipping loses login time). The exact
// window has to be asked for directly.
//
// The Python sync in this repo carries the full client and the notes behind
// these choices; the essentials that matter here:
//   * the window is epoch SECONDS and arbitrary windows are honoured,
//     including across midnight
//   * one call returns every agent, so cost does not scale with headcount
//   * measured latency is roughly 0.6-3s
import 'server-only';

export interface CtmCredentials {
  apiHost: string;
  accessKey: string;
  secretKey: string;
  accountId: string;
}

export function getCtmCredentials(): CtmCredentials {
  const accessKey = process.env.CTM_ACCESS_KEY;
  const secretKey = process.env.CTM_SECRET_KEY;
  const accountId = process.env.CTM_ACCOUNT_ID;
  if (!accessKey || !secretKey || !accountId) {
    throw new Error(
      'CTM credentials are not configured. Set CTM_ACCESS_KEY, CTM_SECRET_KEY and CTM_ACCOUNT_ID (see .env.example).',
    );
  }
  return {
    apiHost: (process.env.CTM_API_HOST || 'https://api.calltrackingmetrics.com').replace(/\/+$/, ''),
    accessKey,
    secretKey,
    accountId,
  };
}

interface MetricRow {
  user_id: number | string;
  total?: number | string;
  count?: number | string;
}

interface UtilizationPayload {
  users?: Record<string, { email?: string; name?: string }>;
  metrics?: Record<string, MetricRow[]>;
}

export interface WindowMetrics {
  /** Keyed by lower-cased email -- the only reliable join to our roster,
   *  because CTM's metric rows use a numeric user_id while the roster uses a
   *  "USR..." sid. */
  byEmail: Record<
    string,
    {
      loginSeconds: number;
      onlineSeconds: number;
      sessionSeconds: number;
      talkSeconds: number;
      holdSeconds: number;
    }
  >;
  elapsedMs: number;
}

const METRIC_FIELDS: Array<[string, keyof WindowMetrics['byEmail'][string]]> = [
  ['login_time', 'loginSeconds'],
  ['online', 'onlineSeconds'],
  ['session_time', 'sessionSeconds'],
  ['talk_time', 'talkSeconds'],
  ['hold_time', 'holdSeconds'],
];

export async function fetchWindowMetrics(
  startAt: Date,
  endAt: Date,
  credentials: CtmCredentials = getCtmCredentials(),
): Promise<WindowMetrics> {
  const params = new URLSearchParams({
    start_time: String(Math.floor(startAt.getTime() / 1000)),
    end_time: String(Math.floor(endAt.getTime() / 1000)),
    // CTM wants this literal label year-round; the epochs above already carry
    // the correct offset, so DST is handled before the request is made.
    timezone: 'EST',
    // Sent for parity with the sync, though CTM ignores it -- interval=hour
    // returns byte-identical totals to interval=day. The window bounds are
    // what actually determine the result.
    interval: 'day',
    statistic: 'occupancy',
    view_by: 'agent',
    es: '1',
  });

  const url = `${credentials.apiHost}/api/v1/accounts/${credentials.accountId}/agents/utilization.json?${params}`;
  const auth = Buffer.from(`${credentials.accessKey}:${credentials.secretKey}`).toString('base64');

  const began = Date.now();
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'User-Agent': 'legacy-agent-activity-web/1.0',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`CTM returned HTTP ${response.status}: ${detail}`);
  }

  const payload = (await response.json()) as UtilizationPayload;
  const elapsedMs = Date.now() - began;

  const emailById = new Map<string, string>();
  for (const [id, user] of Object.entries(payload.users ?? {})) {
    const email = (user?.email ?? '').trim().toLowerCase();
    if (email) emailById.set(String(id), email);
  }

  const byEmail: WindowMetrics['byEmail'] = {};
  for (const [ctmName, field] of METRIC_FIELDS) {
    for (const row of payload.metrics?.[ctmName] ?? []) {
      const email = emailById.get(String(row.user_id));
      if (!email) continue;
      byEmail[email] ??= {
        loginSeconds: 0,
        onlineSeconds: 0,
        sessionSeconds: 0,
        talkSeconds: 0,
        holdSeconds: 0,
      };
      byEmail[email][field] = Number(row.total ?? 0);
    }
  }

  return { byEmail, elapsedMs };
}
