// Shared display tokens, ported from the AGS KPI App's components/kpi/style.ts
// so cards, inputs and numeric readouts match that app exactly. Client-safe
// (no server imports).

// ---- Card tokens -----------------------------------------------------------

/** Base card container (no padding). */
export const CARD = 'bg-white rounded-lg border border-border';
/** Standard full-card padding. */
export const CARD_PAD = 'p-4';
/** Hover lift -- only for clickable (Link or button) cards, never static ones. */
export const CARD_HOVER =
  'hover:border-app-blue/40 hover:shadow-[0_1px_3px_rgba(33,85,205,0.12)] transition duration-150';
/** Numeric readout base -- pair with a `text-[..]` size. */
export const STAT_NUM = 'font-mono font-bold leading-none tracking-tight tabular-nums';
/** Mono uppercase micro-label idiom; pair with a size. */
export const MICRO_LABEL = 'font-mono uppercase tracking-mono-widest text-muted';

// ---- Form field tokens -----------------------------------------------------
// `text-base` on mobile (16px) is deliberate -- it stops iOS Safari zooming in
// when an input is focused. Do not "tidy" it to a smaller size.

export const INPUT =
  'w-full h-11 md:h-9 rounded-md border border-border bg-white px-2.5 text-base md:text-md text-app-text ' +
  'placeholder:text-muted outline-none transition-colors duration-100 focus:border-app-blue focus:ring-1 focus:ring-app-blue/30';
export const LABEL =
  'block font-mono text-2xs tracking-mono-label uppercase text-muted mb-1';

/** Filter control sitting on the navy PageHeader rather than on white. */
export const HEADER_INPUT =
  'h-11 md:h-9 rounded-md border border-white/20 bg-white/15 px-2.5 text-base md:text-sm text-white ' +
  'outline-none transition-colors duration-100 focus:border-white/40 focus-visible:ring-2 focus-visible:ring-white/40';
export const HEADER_LABEL =
  'font-mono text-2xs tracking-mono-widest uppercase text-white/50';

// ---- Table tokens ----------------------------------------------------------

export const TABLE_HEADER =
  'sticky top-0 z-20 bg-white font-mono text-sm tracking-mono-widest uppercase text-muted ' +
  'px-2 md:px-3 py-2.5 md:py-3 whitespace-nowrap';
export const TABLE_HEADER_SHADOW = 'shadow-[0_4px_6px_-4px_rgba(0,0,0,0.08)]';
export const TABLE_ROW =
  'group border-b border-row-border hover:bg-row-hover transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-blue/40';
export const TABLE_CELL = 'px-2 md:px-3 py-2.5 md:py-3 whitespace-nowrap';
/** Numeric cell -- tabular figures so columns of durations line up. */
export const TABLE_NUM = 'font-mono text-xs tabular-nums';

// ---- Freshness tone --------------------------------------------------------
// `amber-dark` not `amber`: plain amber is ~2.5:1 on white and fails AA as
// text. The KPI app's tailwind config documents this; the stale badge is text.

export function freshnessToneClass(stale: boolean): string {
  return stale ? 'text-amber-dark' : 'text-safe-green';
}

export function freshnessBadgeClass(stale: boolean): string {
  return stale ? 'bg-amber/10 text-amber-dark' : 'bg-safe-green/10 text-safe-green';
}
