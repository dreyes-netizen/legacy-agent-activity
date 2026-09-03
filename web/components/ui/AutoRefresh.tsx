'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-fetches the current server-rendered page on an interval.
 *
 * Two independent loops keep the screen current: the Python sync writes to Neon
 * every ~5 minutes, and this polls Neon every 60s. Polling faster than the sync
 * is deliberate -- if the two ran at the same cadence and this fired just before
 * a sync landed, the screen would sit up to 10 minutes stale. A read from Neon
 * is one indexed query, so 60s costs little and caps the extra lag at a minute.
 *
 * router.refresh() re-runs the server component and patches the result in,
 * preserving scroll position, filter state and focus -- unlike a reload.
 */
const REFRESH_MS = 60_000;

export function AutoRefresh({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || paused) return;

    function tick() {
      // Skip while the tab is hidden: refreshing a background tab burns a
      // serverless invocation and a database query for something nobody is
      // looking at. The visibilitychange handler below refreshes on return.
      if (document.visibilityState !== 'visible') return;
      startTransition(() => router.refresh());
    }

    timer.current = setInterval(tick, REFRESH_MS);

    // Coming back to the tab should show current data immediately rather than
    // whatever was on screen when it was hidden, possibly hours ago.
    function onVisible() {
      if (document.visibilityState === 'visible') {
        startTransition(() => router.refresh());
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, paused, router]);

  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() => setPaused((value) => !value)}
      aria-pressed={paused}
      title={
        paused
          ? 'Auto-refresh is paused. Click to resume updating every minute.'
          : 'Updating every minute. Click to pause.'
      }
      className="inline-flex items-center gap-1 font-mono text-2xs tracking-mono-label uppercase text-white/50 hover:text-white/80 transition-colors"
    >
      <span
        aria-hidden="true"
        className={
          paused
            ? 'w-1.5 h-1.5 rounded-full bg-white/40'
            : `w-1.5 h-1.5 rounded-full bg-safe-green ${isPending ? 'animate-pulse' : ''}`
        }
      />
      {paused ? 'paused' : 'live'}
    </button>
  );
}
