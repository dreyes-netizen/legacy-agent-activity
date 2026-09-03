// Filter parsing and window resolution.
//
// The filter state lives entirely in the URL so a view can be linked to
// someone, and so the back button behaves.
import { EASTERN, MANILA, type DisplayZone, isDisplayZone } from './time';

/**
 * How the selected dates are turned into an absolute window.
 *
 * This is the filter that answers the original night-shift problem, so it is
 * explicit rather than an assumption buried in the query:
 *
 *   et-day    whole America/New_York calendar days. Matches CTM and the
 *             existing legacy KPI reports.
 *   mnl-day   whole Asia/Manila calendar days. What a Manila team leader
 *             means by "yesterday".
 *   shift     each agent's own defined shift windows. The only anchoring that
 *             keeps every agent's working period on one row, because the two
 *             clusters here cross midnight in different timezones.
 *   custom    explicit start/end clock times, may cross midnight.
 */
export type Anchor = 'et-day' | 'mnl-day' | 'shift' | 'custom';

const ANCHORS: Anchor[] = ['et-day', 'mnl-day', 'shift', 'custom'];

export const ANCHOR_LABEL: Record<Anchor, string> = {
  'mnl-day': 'Manila day',
  'et-day': 'Eastern day',
  shift: 'Shift',
  custom: 'Custom time',
};

export interface Filters {
  from: string; // YYYY-MM-DD, in the anchor's zone
  to: string;
  anchor: Anchor;
  /** Only meaningful for anchor 'custom'. */
  fromTime: string; // HH:MM
  toTime: string;
  /** Empty = all agents. */
  agents: string[];
  zone: DisplayZone;
}

export interface RawFilterParams {
  from?: string;
  to?: string;
  anchor?: string;
  fromTime?: string;
  toTime?: string;
  agents?: string;
  tz?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Today's date in a zone, as YYYY-MM-DD. */
export function todayIn(zone: DisplayZone, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  // Parsed as UTC midnight and shifted in whole days, so this is pure calendar
  // arithmetic with no timezone or DST involvement.
  const [y, m, d] = isoDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

export function parseFilters(params: RawFilterParams, now: Date = new Date()): Filters {
  const zone = isDisplayZone(params.tz) ? params.tz : MANILA;
  const anchor = ANCHORS.includes(params.anchor as Anchor)
    ? (params.anchor as Anchor)
    : 'mnl-day';

  // Default to the last 7 days in whichever zone the dates are read in, so a
  // first visit shows something useful rather than an empty range.
  const anchorZone: DisplayZone = anchor === 'et-day' ? EASTERN : zone;
  const today = todayIn(anchorZone, now);
  const from = params.from && DATE_RE.test(params.from) ? params.from : addDays(today, -6);
  const to = params.to && DATE_RE.test(params.to) ? params.to : today;

  return {
    // Tolerate a reversed range rather than returning nothing.
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    anchor,
    fromTime: params.fromTime && TIME_RE.test(params.fromTime) ? params.fromTime : '00:00',
    toTime: params.toTime && TIME_RE.test(params.toTime) ? params.toTime : '00:00',
    agents: (params.agents ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    zone,
  };
}

export function serializeFilters(filters: Filters): string {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', filters.to);
  params.set('anchor', filters.anchor);
  if (filters.anchor === 'custom') {
    params.set('fromTime', filters.fromTime);
    params.set('toTime', filters.toTime);
  }
  if (filters.agents.length > 0) params.set('agents', filters.agents.join(','));
  if (filters.zone !== MANILA) params.set('tz', filters.zone);
  return params.toString();
}

/**
 * The local clock bounds and the zone they should be interpreted in.
 *
 * Deliberately returns strings rather than Date objects: converting a local
 * wall-clock time to an instant is done by Postgres (`AT TIME ZONE`), which
 * has the real IANA database, instead of by hand in JavaScript.
 */
export interface LocalBounds {
  startLocal: string; // 'YYYY-MM-DD HH:MM:SS'
  endLocal: string;
  zone: DisplayZone;
}

export function localBounds(filters: Filters): LocalBounds {
  if (filters.anchor === 'custom') {
    // toTime <= fromTime means the window crosses midnight, so the end lands
    // on the day after `to` -- the same rule shift windows use.
    const crossesMidnight = filters.toTime <= filters.fromTime;
    const endDate = crossesMidnight ? addDays(filters.to, 1) : filters.to;
    return {
      startLocal: `${filters.from} ${filters.fromTime}:00`,
      endLocal: `${endDate} ${filters.toTime}:00`,
      zone: filters.zone,
    };
  }

  const zone: DisplayZone = filters.anchor === 'et-day' ? EASTERN : filters.zone;
  return {
    startLocal: `${filters.from} 00:00:00`,
    // Exclusive upper bound expressed as the next day's midnight, which avoids
    // the 23:59:59 gap that silently drops the final second of a day.
    endLocal: `${addDays(filters.to, 1)} 00:00:00`,
    zone,
  };
}

export function describeRange(filters: Filters): string {
  const sameDay = filters.from === filters.to;
  if (filters.anchor === 'custom') {
    return sameDay
      ? `${filters.from}, ${filters.fromTime}–${filters.toTime}`
      : `${filters.from} – ${filters.to}, ${filters.fromTime}–${filters.toTime}`;
  }
  return sameDay ? filters.from : `${filters.from} – ${filters.to}`;
}
