// Timezone and duration formatting.
//
// Two zones matter and they are not interchangeable:
//
//   Asia/Manila       where the team leaders reading this dashboard are. The
//                     default display zone, and the zone shift definitions are
//                     entered in.
//   America/New_York  the zone CTM reports in, and what the existing legacy
//                     KPI pipeline uses. Available as a toggle so figures can
//                     be reconciled against those reports.
//
// The offset between them is 12h from March to November and 13h outside it (ET
// has DST, Manila does not), so never hardcode it -- always convert through a
// real timezone database, which is what Intl does here.

export const MANILA = 'Asia/Manila';
export const EASTERN = 'America/New_York';

export type DisplayZone = typeof MANILA | typeof EASTERN;

export const ZONE_LABEL: Record<DisplayZone, string> = {
  [MANILA]: 'Manila',
  [EASTERN]: 'ET',
};

export function isDisplayZone(value: string | undefined): value is DisplayZone {
  return value === MANILA || value === EASTERN;
}

/** Seconds as H:MM:SS. Hours are not wrapped at 24 -- a monthly total is legitimately 160:38:10. */
export function hms(seconds: number | string | null | undefined): string {
  const total = Math.round(Number(seconds ?? 0));
  if (!Number.isFinite(total)) return '0:00:00';
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Compact duration for tight spaces: "9h 12m", "12m", "0m". */
export function hoursMinutes(seconds: number | string | null | undefined): string {
  const total = Math.round(Number(seconds ?? 0));
  if (!Number.isFinite(total) || total <= 0) return '0m';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function parts(date: Date, zone: DisplayZone, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...options }).format(date);
}

/** "2026-09-04" in the given zone. */
export function isoDateIn(date: Date, zone: DisplayZone): string {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return d;
}

/** "04 Sep, 14:25" */
export function dateTimeIn(date: Date, zone: DisplayZone): string {
  return parts(date, zone, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "14:25" */
export function timeIn(date: Date, zone: DisplayZone): string {
  return parts(date, zone, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "Thu 04 Sep 2026" */
export function longDateIn(date: Date, zone: DisplayZone): string {
  return parts(date, zone, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * "2m ago", "1h 4m ago", "just now".
 *
 * Used for the sync freshness badge, so it deliberately stays coarse: the
 * question it answers is "should I trust this screen", not "what time is it".
 */
export function relativeAge(from: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}h ${rem}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * How stale the data is allowed to get before the badge turns amber.
 *
 * The sync ticks every 5 minutes, so 15 minutes is three missed ticks -- past
 * coincidence, into "something is broken". Every failure mode of the external
 * scheduler is silent (expired token, wrong event type, workflow moved off the
 * default branch), which is exactly why the UI watches data age rather than
 * job success.
 */
export const STALE_AFTER_SECONDS = 15 * 60;

export function isStale(lastSync: Date | null, now: Date = new Date()): boolean {
  if (!lastSync) return true;
  return (now.getTime() - lastSync.getTime()) / 1000 > STALE_AFTER_SECONDS;
}
