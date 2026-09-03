'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  CARD,
  TABLE_CELL,
  TABLE_HEADER,
  TABLE_HEADER_SHADOW,
  TABLE_NUM,
  TABLE_ROW,
} from '@/components/ui/style';
import { hms } from '@/lib/time';
import { cn } from '@/lib/utils';

export interface TableRow {
  ctmUserId: string;
  name: string;
  onlineSeconds: number;
  sessionSeconds: number;
  talkSeconds: number;
  holdSeconds: number;
  inboundCalls: number;
  outboundCalls: number;
}

type LoginState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; login: Record<string, number>; source: string }
  | { status: 'error'; message: string }
  | { status: 'unavailable' };

type SortKey = 'name' | 'login' | 'session' | 'online' | 'talk' | 'occupancy';

/**
 * How the login column is populated. login_time is only ever correct at the
 * exact grain it was queried for, so each anchor needs a different source:
 *
 *   fetch        one continuous window -> /api/login-exact (client fetch, so
 *                the additive columns are usable immediately)
 *   given        shift anchor -> already supplied from agent_shift, which the
 *                sync wrote from each shift's own window
 *   unavailable  multi-day custom time window -> would need one CTM call per
 *                day, too slow for a request, so it is not offered
 */
export type LoginMode = 'fetch' | 'given' | 'unavailable';

export function AgentTable({
  rows,
  loginMode,
  windowStartIso,
  windowEndIso,
  givenLogin,
  missingLoginCount = 0,
}: {
  rows: TableRow[];
  loginMode: LoginMode;
  windowStartIso: string | null;
  windowEndIso: string | null;
  givenLogin?: Record<string, number | null>;
  /** Shift occurrences with no exact login row yet -- surfaced, not hidden. */
  missingLoginCount?: number;
}) {
  const [login, setLogin] = useState<LoginState>({ status: 'idle' });
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'session',
    dir: 'desc',
  });

  // login_time cannot be derived from the stored hourly data, so it is fetched
  // separately once the additive columns are already on screen. The table is
  // useful immediately; this one column fills in a beat later.
  useEffect(() => {
    if (loginMode === 'unavailable') {
      setLogin({ status: 'unavailable' });
      return;
    }
    if (loginMode === 'given') {
      // Already exact, straight from agent_shift -- nothing to fetch.
      setLogin({ status: 'ready', login: {}, source: 'shift' });
      return;
    }
    if (!windowStartIso || !windowEndIso) {
      setLogin({ status: 'unavailable' });
      return;
    }
    const controller = new AbortController();
    setLogin({ status: 'loading' });
    const params = new URLSearchParams({ start: windowStartIso, end: windowEndIso });
    fetch(`/api/login-exact?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        setLogin({ status: 'ready', login: body.login ?? {}, source: body.source });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLogin({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load login time',
        });
      });
    return () => controller.abort();
  }, [windowStartIso, windowEndIso, loginMode]);

  const loginFor = (id: string): number | null => {
    if (loginMode === 'given') return givenLogin?.[id] ?? null;
    return login.status === 'ready' ? (login.login[id] ?? 0) : null;
  };

  const sorted = useMemo(() => {
    const value = (row: TableRow): number | string => {
      switch (sort.key) {
        case 'name':
          return row.name.toLowerCase();
        case 'login':
          return loginFor(row.ctmUserId) ?? -1;
        case 'online':
          return row.onlineSeconds;
        case 'talk':
          return row.talkSeconds;
        case 'occupancy':
          return row.sessionSeconds > 0 ? row.talkSeconds / row.sessionSeconds : -1;
        default:
          return row.sessionSeconds;
      }
    };
    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const comparison =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return sort.dir === 'asc' ? comparison : -comparison;
    });
  }, [rows, sort, login]);

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );
  }

  const Th = ({
    label,
    sortKey,
    align = 'right',
    hint,
  }: {
    label: string;
    sortKey?: SortKey;
    align?: 'left' | 'right';
    hint?: string;
  }) => (
    <th
      scope="col"
      title={hint}
      onClick={sortKey ? () => toggleSort(sortKey) : undefined}
      aria-sort={
        sortKey && sort.key === sortKey
          ? sort.dir === 'asc'
            ? 'ascending'
            : 'descending'
          : undefined
      }
      className={cn(
        TABLE_HEADER,
        TABLE_HEADER_SHADOW,
        align === 'right' ? 'text-right' : 'text-left',
        sortKey && 'cursor-pointer select-none',
      )}
    >
      {label}
      {sortKey && sort.key === sortKey && (
        <span className="ml-0.5 text-2xs">{sort.dir === 'asc' ? '▲' : '▼'}</span>
      )}
    </th>
  );

  if (rows.length === 0) {
    return (
      <div className={cn(CARD, 'p-8 text-center')}>
        <p className="text-md text-muted">No agent activity in this range.</p>
      </div>
    );
  }

  return (
    <div className={cn(CARD, 'overflow-hidden')}>
      {login.status === 'error' && (
        <p className="flex items-start gap-1.5 px-4 py-2.5 bg-amber/10 text-amber-dark text-xs border-b border-border">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Login time unavailable: {login.message}. The other columns are unaffected.
          </span>
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th label="Agent" sortKey="name" align="left" />
              <Th
                label="Login"
                sortKey="login"
                hint="Time signed into CTM at all, including breaks. Queried for this exact window — it cannot be summed."
              />
              <Th
                label="Session"
                sortKey="session"
                hint="Active working time. Equals Online + Talk exactly."
              />
              <Th
                label="Online"
                sortKey="online"
                hint="Available and NOT on a call. Excludes talk time."
              />
              <Th label="Talk" sortKey="talk" hint="Time on calls, including hold." />
              <Th
                label="Occ %"
                sortKey="occupancy"
                hint="Talk ÷ Session — busy over busy-plus-idle, the standard occupancy figure."
              />
              <Th label="In" hint="Inbound calls answered" />
              <Th label="Out" hint="Outbound dial attempts" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => {
              const loginSeconds = loginFor(row.ctmUserId);
              const occupancy =
                row.sessionSeconds > 0 ? (row.talkSeconds / row.sessionSeconds) * 100 : null;
              return (
                <tr
                  key={row.ctmUserId}
                  className={cn(TABLE_ROW, index % 2 === 1 && 'bg-row-alt')}
                >
                  <td className={cn(TABLE_CELL, 'font-medium text-md')}>{row.name}</td>
                  <td className={cn(TABLE_CELL, TABLE_NUM, 'text-right')}>
                    {login.status === 'loading' ? (
                      <Loader2
                        className="w-3.5 h-3.5 animate-spin text-muted inline-block"
                        aria-label="Loading login time"
                      />
                    ) : login.status === 'unavailable' ? (
                      <span className="text-muted" title="Not available with a time-of-day filter">
                        n/a
                      </span>
                    ) : loginSeconds === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      hms(loginSeconds)
                    )}
                  </td>
                  <td className={cn(TABLE_CELL, TABLE_NUM, 'text-right')}>
                    {hms(row.sessionSeconds)}
                  </td>
                  <td className={cn(TABLE_CELL, TABLE_NUM, 'text-right')}>
                    {hms(row.onlineSeconds)}
                  </td>
                  <td className={cn(TABLE_CELL, TABLE_NUM, 'text-right')}>
                    {hms(row.talkSeconds)}
                  </td>
                  <td className={cn(TABLE_CELL, TABLE_NUM, 'text-right')}>
                    {occupancy === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      `${occupancy.toFixed(1)}%`
                    )}
                  </td>
                  <td className={cn(TABLE_CELL, TABLE_NUM, 'text-right')}>{row.inboundCalls}</td>
                  <td className={cn(TABLE_CELL, TABLE_NUM, 'text-right')}>{row.outboundCalls}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2.5 text-2xs text-muted border-t border-border">
        Durations as H:MM:SS. Session = Online + Talk (verified exact).
        {loginMode === 'given' && ' Login from each shift’s own exact window.'}
        {loginMode === 'fetch' && login.status === 'ready' && login.source === 'ctm' &&
          ' Login queried live from CTM.'}
        {loginMode === 'fetch' && login.status === 'ready' && login.source === 'cache' &&
          ' Login served from cache.'}
        {missingLoginCount > 0 &&
          ` ${missingLoginCount} shift occurrence${missingLoginCount === 1 ? '' : 's'} not yet
            synced for login — the hourly settle pass will fill them in.`}
      </p>
    </div>
  );
}
