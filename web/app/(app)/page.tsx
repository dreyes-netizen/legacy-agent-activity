import { Users, CalendarClock, Database, Clock } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatTile } from '@/components/ui/StatTile';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { CARD, CARD_PAD, MICRO_LABEL } from '@/components/ui/style';
import { getCoverage, getSyncStatus } from '@/lib/queries';
import { MANILA, dateTimeIn, longDateIn } from '@/lib/time';
import { cn } from '@/lib/utils';

// The sync writes every few minutes; a cached render would defeat the point of
// showing how fresh the data is.
export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [sync, coverage] = await Promise.all([getSyncStatus(), getCoverage()]);

  const first = coverage.firstBucket ? new Date(coverage.firstBucket) : null;
  const last = coverage.lastBucket ? new Date(coverage.lastBucket) : null;

  return (
    <>
      <PageHeader
        label="Alliance Global Solutions"
        title="Agent Activity"
        subtitle="Online, session and login time"
        meta={<FreshnessBadge lastSyncIso={sync.lastSyncAt} />}
      />

      <div className="px-4 md:px-8 py-4 md:py-6 flex flex-col gap-4 md:gap-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatTile
            label="Agents tracked"
            value={String(coverage.agents)}
            icon={<Users className="w-3.5 h-3.5" aria-hidden="true" />}
          />
          <StatTile
            label="Shifts defined"
            value={String(coverage.shiftsDefined)}
            tone={coverage.shiftsDefined === 0 ? 'text-amber-dark' : 'text-app-text'}
            sub={coverage.shiftsDefined === 0 ? 'Needed for per-shift login time' : undefined}
            icon={<CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />}
          />
          <StatTile
            label="Hourly buckets"
            value={coverage.hourlyBuckets.toLocaleString('en-GB')}
            icon={<Database className="w-3.5 h-3.5" aria-hidden="true" />}
          />
          <StatTile
            label="Syncs, last 24h"
            value={String(sync.runsToday)}
            icon={<Clock className="w-3.5 h-3.5" aria-hidden="true" />}
          />
        </div>

        <section className={cn(CARD, CARD_PAD)}>
          <h2 className={cn(MICRO_LABEL, 'text-2xs mb-3')}>Data coverage</h2>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-md">
            <div className="flex justify-between gap-4 border-b border-row-border pb-2.5">
              <dt className="text-muted">Earliest data</dt>
              <dd className="font-mono text-sm tabular-nums text-right">
                {first ? longDateIn(first, MANILA) : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-row-border pb-2.5">
              <dt className="text-muted">Latest data</dt>
              <dd className="font-mono text-sm tabular-nums text-right">
                {last ? dateTimeIn(last, MANILA) : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Calendar-day rows</dt>
              <dd className="font-mono text-sm tabular-nums text-right">{coverage.dayRows}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Last sync status</dt>
              <dd className="font-mono text-sm text-right">{sync.lastStatus ?? '—'}</dd>
            </div>
          </dl>
          <p className="text-2xs text-muted mt-3">
            Times shown in Manila. The filtered agent table lands next.
          </p>
        </section>
      </div>
    </>
  );
}
