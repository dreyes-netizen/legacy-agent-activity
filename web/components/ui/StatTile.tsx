import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CARD, CARD_PAD, STAT_NUM } from './style';

export function StatTile({
  label,
  value,
  tone = 'text-app-text',
  sub,
  icon,
}: {
  label: string;
  value: string;
  tone?: string;
  sub?: ReactNode;
  /** Optional leading glyph shown before the label. */
  icon?: ReactNode;
}) {
  return (
    <div className={cn(CARD, CARD_PAD)}>
      <p className={cn(STAT_NUM, 'text-2xl', tone)}>{value}</p>
      <p className="flex items-center gap-1.5 text-xs text-muted mt-1.5">
        {icon}
        {label}
      </p>
      {sub && <p className="text-2xs text-muted mt-0.5">{sub}</p>}
    </div>
  );
}
