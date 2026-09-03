import { Users, Clock, Radio, PhoneCall } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatTile } from '@/components/ui/StatTile';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { FilterBar } from '@/components/filters/FilterBar';
import { AgentTable } from '@/components/agents/AgentTable';
import { getSyncStatus } from '@/lib/queries';
import { getAgentOptions, getAgentTotals, resolveWindow } from '@/lib/metrics';
import { describeRange, localBounds, parseFilters, type RawFilterParams } from '@/lib/filters';
import { ZONE_LABEL, dateTimeIn, hms } from '@/lib/time';

// The sync writes every few minutes and the filters live in the URL, so there
// is nothing worth caching at the page level.
export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: RawFilterParams;
}) {
  const filters = parseFilters(searchParams);
  const bounds = localBounds(filters);

  const [sync, agentOptions, window] = await Promise.all([
    getSyncStatus(),
    getAgentOptions(),
    resolveWindow(bounds),
  ]);

  const rows = await getAgentTotals(window, filters.agents);

  // A custom time-of-day window would need one CTM call per day in the range
  // for an exact login figure, which is too slow for a page load. Every other
  // anchor is a single continuous window, so one call covers it.
  const loginAvailable = filters.anchor !== 'custom' || filters.from === filters.to;

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
          windowStartIso={window.startAt.toISOString()}
          windowEndIso={window.effectiveEndAt.toISOString()}
          loginAvailable={loginAvailable}
        />

        <p className="text-2xs text-muted">
          Window: {dateTimeIn(window.startAt, filters.zone)} –{' '}
          {dateTimeIn(window.effectiveEndAt, filters.zone)} {ZONE_LABEL[filters.zone]}
          {window.inProgress && ' · range still in progress, clamped to now'}
        </p>
      </div>
    </>
  );
}
