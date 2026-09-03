import { EASTERN, type DisplayZone } from '@/lib/time';
import { addDays, todayIn, type Filters } from '@/lib/filters';

export type PresetId = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth';

export const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7d' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
];

function monthBounds(isoDate: string, monthsBack: number): { from: string; to: string } {
  const [year, month] = isoDate.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 - monthsBack, 1));
  const end = new Date(Date.UTC(year, month - monthsBack, 0)); // day 0 = last of previous
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * Presets resolve against the zone the dates are read in, so "Today" means the
 * team leader's today (Manila) unless the Eastern-day anchor is selected. The
 * two differ for half of every day, which is exactly the confusion this
 * dashboard exists to remove -- so it must not be papered over here.
 */
export function applyPreset(filters: Filters, preset: PresetId): Partial<Filters> {
  const zone: DisplayZone = filters.anchor === 'et-day' ? EASTERN : filters.zone;
  const today = todayIn(zone);

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'thisMonth': {
      const { from } = monthBounds(today, 0);
      // Capped at today: a range running to the end of the month would show
      // days that have not happened yet as zeroes.
      return { from, to: today };
    }
    case 'lastMonth':
      return monthBounds(today, 1);
    default:
      return {};
  }
}
