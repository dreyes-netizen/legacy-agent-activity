import Link from 'next/link';
import { Users, Clock, Radio, PhoneCall, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatTile } from '@/components/ui/StatTile';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { FilterBar } from '@/components/filters/FilterBar';
import { AgentTable, type TableRow } from '@/components/agents/AgentTable';
import { getSyncStatus } from '@/lib/queries';
import { getAgentOptions, getAgentTotals, resolveWindow } from '@/lib/metrics';
import { countShifts, getShiftAnchoredTotals } from '@/lib/shifts';
import { describeRange, localBounds, parseFilters, type RawFilterParams } from '@/lib/filters';
import { ZONE_LABEL, dateTimeIn, hms } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: RawFilterParams;
}) {
  const filters = parseFilters(searchParams);
  const isShiftAnchor = filters.anchor === 'shift';

  const [sync, agentOptions, shiftCount] = await Promise.all([
    getSyncStatus(),
    getAgentOptions(),
    countShifts(),
  ]);

  let rows: TableRow[] = [];
  // Login is served three different ways depending on the anchor, because
  // login_time is only ever correct at the exact grain it was queried for.
  //   shift  -> agent_shift, written by the sync from each shift's own window
  //   other  -> /api/login-exact for the one continuous window (client fetch)
  //   custom multi-day time window -> not offered at all
  let shiftLogin: Record<string, number | null> | undefined;
  let missingShiftLogin = 0;
  let window: Awaited<ReturnType<typeof resolveWindow>> | null = null;

  if (isShiftAnchor) {
    // A shift-anchored query has a DIFFERENT window per agent, so there is no
    // single pair of instants to resolve -- the windows are built in SQL.
    const shiftRows = await getShiftAnchoredTotals(filters.from, filters.to, filters.agents);
    rows = shiftRows.map((row) => ({
      ctmUserId: row.ctmUserId,
      name: row.name,
      onlineSeconds: row.onlineSeconds,
      sessionSeconds: row.sessionSeconds,
      talkSeconds: row.talkSeconds,
      holdSeconds: row.holdSeconds,
      inboundCalls: row.inboundCalls,
      outboundCalls: row.outboundCalls,
    }));
    shiftLogin = Object.fromEntries(shiftRows.map((row) => [row.ctmUserId, row.loginSeconds]));
    missingShiftLogin = shiftRows.reduce((sum, row) => sum + row.missingLogin, 0);
  } else {
    window = await resolveWindow(localBounds(filters));
    rows = await getAgentTotals(window, filters.agents);
  }

  // A custom time-of-day window spanning several days would need one CTM call
  // per day for an exact login figure -- too slow for a page load.
  const loginMode: 'fetch' | 'given' | 'unavailable' = isShiftAnchor
    ? 'given'
    : filters.anchor === 'custom' && filters.from !== filters.to
      ? 'unavailable'
      : 'fetch';

  const active = rows.filter((row) => row.sessionSeconds > 0);
  const totalSession = active.reduce((sum, row) => sum + row.sessionSeconds, 0);
  const totalOnline = active.reduce((sum, row) => sum + row.onlineSeconds, 0);
  const totalTalk = active.reduce((sum, row) => sum + row.talkSeconds, 0);
  const totalCalls = rows.reduce((sum, row) => sum + row.inboundCalls + row.outboundCalls, 0);
  const occupancy = totalSession > 0 ? (totalTalk / totalSession) * 100 : null;

  return (
    <>
      <PageHeader
        label="Alliance Global Solutions"
        title="Agent Activity"
        subtitle={describeRange(filters)}
        meta={<FreshnessBadge lastSyncIso={sync.lastSyncAt} />}
        actions={<FilterBar filters={filters} agentOptions={agentOptions} />}
      />

      <div className="px-4 md:px-8 py-4 md:py-6 flex flex-col gap-4 md:gap-6">
        {isShiftAnchor && shiftCount === 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-amber/10 px-4 py-3 text-md text-amber-dark">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              No shifts are defined, so this anchor has nothing to group by and the table is
              empty.{' '}
              <Link href="/shifts" className="underline font-medium">
                Define shifts
              </Link>{' '}
              to use it.
            </span>
          </p>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatTile
            label="Agents active"
            value={`${active.length} / ${rows.length}`}
            icon={<Users className="w-3.5 h-3.5" aria-hidden="true" />}
          />
          <StatTile
            label="Total session time"
            value={hms(totalSession)}
            sub={`Online ${hms(totalOnline)} + Talk ${hms(totalTalk)}`}
            icon={<Clock className="w-3.5 h-3.5" aria-hidden="true" />}
          />
          <StatTile
            label="Occupancy"
            value={occupancy === null ? '—' : `${occupancy.toFixed(1)}%`}
            sub="Talk ÷ Session"
            icon={<Radio className="w-3.5 h-3.5" aria-hidden="true" />}
          />
          <StatTile
            label="Calls handled"
            value={totalCalls.toLocaleString('en-GB')}
            icon={<PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />}
          />
        </div>

        <AgentTable
          rows={rows}
          loginMode={loginMode}
          windowStartIso={window?.startAt.toISOString() ?? null}
          windowEndIso={window?.effectiveEndAt.toISOString() ?? null}
          givenLogin={shiftLogin}
          missingLoginCount={missingShiftLogin}
        />

        <p className="text-2xs text-muted">
          {isShiftAnchor ? (
            <>
              Anchored to each agent&apos;s own shift window, filed under the date the shift
              started. Shift dates {filters.from} – {filters.to}.
            </>
          ) : (
            window && (
              <>
                Window: {dateTimeIn(window.startAt, filters.zone)} –{' '}
                {dateTimeIn(window.effectiveEndAt, filters.zone)} {ZONE_LABEL[filters.zone]}
                {window.inProgress && ' · range still in progress, clamped to now'}
              </>
            )
          )}
        </p>
      </div>
    </>
  );
}
