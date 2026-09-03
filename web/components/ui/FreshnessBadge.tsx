'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { isStale, relativeAge } from '@/lib/time';
import { freshnessBadgeClass } from './style';

/**
 * "Last synced 2m ago" for the PageHeader's meta slot.
 *
 * Every way the external scheduler can fail is silent -- an expired token, a
 * mistyped event type, the workflow moved off the default branch -- so the UI
 * watches how old the data is rather than whether a job reported success. Three
 * missed ticks (15 minutes) turns this amber.
 *
 * Client component purely so the age keeps counting up without a reload; the
 * timestamp itself is rendered on the server and passed in.
 */
export function FreshnessBadge({ lastSyncIso }: { lastSyncIso: string | null }) {
  const lastSync = lastSyncIso ? new Date(lastSyncIso) : null;
  const [now, setNow] = useState<Date | null>(null);

  // Start ticking only after mount. Rendering a relative age during SSR would
  // produce server/client mismatch, since the two evaluate at different times.
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!lastSync) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-2xs tracking-mono-label uppercase',
          freshnessBadgeClass(true),
        )}
      >
        never synced
      </span>
    );
  }

  const stale = now ? isStale(lastSync, now) : false;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-2xs tracking-mono-label uppercase',
        freshnessBadgeClass(stale),
      )}
      title={lastSync.toISOString()}
    >
      <span
        aria-hidden="true"
        className={cn('w-1.5 h-1.5 rounded-full', stale ? 'bg-amber' : 'bg-safe-green')}
      />
      {/* Fixed text until the clock starts, so SSR and the first client render agree. */}
      synced {now ? relativeAge(lastSync, now) : '—'}
    </span>
  );
}
