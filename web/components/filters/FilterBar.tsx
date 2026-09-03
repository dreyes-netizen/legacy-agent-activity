'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { HEADER_INPUT, HEADER_LABEL } from '@/components/ui/style';
import { AgentPicker } from './AgentPicker';
import { PRESETS, applyPreset } from './presets';
import {
  ANCHOR_LABEL,
  anchorZone,
  serializeFilters,
  todayIn,
  type Anchor,
  type Filters,
} from '@/lib/filters';
import { EASTERN, MANILA, ZONE_LABEL, type DisplayZone } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { AgentOption } from '@/lib/metrics';

const ANCHOR_ORDER: Anchor[] = ['mnl-day', 'et-day', 'shift', 'custom'];

export function FilterBar({
  filters,
  agentOptions,
}: {
  filters: Filters;
  agentOptions: AgentOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function update(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };

    // Switching the anchor changes which zone the dates are read in, and Manila
    // and Eastern are on different dates for half of every day. Someone looking
    // at "today" who switches to the Eastern-day anchor would otherwise keep the
    // Manila date -- which in Eastern terms has not happened yet, emptying the
    // table as though something were broken. Re-resolve only when the dates
    // still are today in the old zone, so an explicitly chosen date is kept
    // (comparing one specific day across both anchors is a real thing to want).
    if (patch.anchor && patch.anchor !== filters.anchor) {
      const oldToday = todayIn(anchorZone(filters));
      if (filters.from === oldToday && filters.to === oldToday) {
        const newToday = todayIn(anchorZone(next));
        next.from = newToday;
        next.to = newToday;
      }
    }

    startTransition(() => {
      router.push(`/?${serializeFilters(next)}`);
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Row 1: presets + anchor + timezone */}
      <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <div className="flex flex-col gap-1">
          <span className={HEADER_LABEL}>Quick range</span>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => update(applyPreset(filters, preset.id))}
                className="h-11 md:h-9 px-2.5 rounded-md border border-white/20 bg-white/[0.08] text-sm text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className={HEADER_LABEL}>Day defined by</span>
          <select
            value={filters.anchor}
            onChange={(event) => update({ anchor: event.target.value as Anchor })}
            title="Which window the figures cover. A day anchor sets its own timezone; Custom uses the timezone selected alongside."
            className={cn(HEADER_INPUT, 'cursor-pointer')}
          >
            {ANCHOR_ORDER.map((anchor) => (
              <option key={anchor} value={anchor} className="text-app-text">
                {ANCHOR_LABEL[anchor]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          {/* Two different jobs, so the label says which one applies. For a day
              or shift anchor the window is already fixed and this only changes
              how it reads -- useful for reconciling against the Eastern-based
              legacy KPI reports. For a custom window it defines the window,
              because it is what the entered clock times are measured against. */}
          <span className={HEADER_LABEL}>
            {filters.anchor === 'custom' ? 'Times entered in' : 'Times shown in'}
          </span>
          <select
            value={filters.zone}
            onChange={(event) => update({ zone: event.target.value as DisplayZone })}
            title={
              filters.anchor === 'custom'
                ? 'The timezone the start and end times are measured in. Changes the window.'
                : 'Display only. The window is set by "Day defined by" and does not change.'
            }
            className={cn(HEADER_INPUT, 'cursor-pointer')}
          >
            {[MANILA, EASTERN].map((zone) => (
              <option key={zone} value={zone} className="text-app-text">
                {ZONE_LABEL[zone as DisplayZone]}
              </option>
            ))}
          </select>
        </label>

        {pending && (
          <Loader2
            className="w-4 h-4 mb-2.5 animate-spin text-white/50"
            aria-label="Loading"
          />
        )}
      </div>

      {/* Row 2: explicit dates, optional times, agents */}
      <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <label className="flex flex-col gap-1">
          <span className={HEADER_LABEL}>From</span>
          <input
            type="date"
            value={filters.from}
            max={filters.to}
            onChange={(event) => update({ from: event.target.value })}
            className={cn(HEADER_INPUT, '[color-scheme:dark]')}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={HEADER_LABEL}>To</span>
          <input
            type="date"
            value={filters.to}
            min={filters.from}
            onChange={(event) => update({ to: event.target.value })}
            className={cn(HEADER_INPUT, '[color-scheme:dark]')}
          />
        </label>

        {filters.anchor === 'custom' && (
          <>
            <label className="flex flex-col gap-1">
              <span className={HEADER_LABEL}>Start ({ZONE_LABEL[filters.zone]})</span>
              <input
                type="time"
                value={filters.fromTime}
                onChange={(event) => update({ fromTime: event.target.value })}
                className={cn(HEADER_INPUT, '[color-scheme:dark]')}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={HEADER_LABEL}>End ({ZONE_LABEL[filters.zone]})</span>
              <input
                type="time"
                value={filters.toTime}
                onChange={(event) => update({ toTime: event.target.value })}
                className={cn(HEADER_INPUT, '[color-scheme:dark]')}
              />
            </label>
          </>
        )}

        <div className="flex flex-col gap-1">
          <span className={HEADER_LABEL}>Agents</span>
          <AgentPicker
            options={agentOptions}
            selected={filters.agents}
            onChange={(agents) => update({ agents })}
          />
        </div>
      </div>
    </div>
  );
}
