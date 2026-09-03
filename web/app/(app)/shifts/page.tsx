import { PageHeader } from '@/components/layout/PageHeader';
import { CARD, CARD_PAD } from '@/components/ui/style';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Shifts — Agent Activity' };

// Placeholder. The CRUD form lands in step 6; until shifts exist, per-shift
// login time cannot be exact, so this is the screen that unlocks it.
export default function ShiftsPage() {
  return (
    <>
      <PageHeader
        label="Alliance Global Solutions"
        title="Shifts"
        subtitle="Define each agent's working window"
      />
      <div className="px-4 md:px-8 py-4 md:py-6">
        <div className={cn(CARD, CARD_PAD, 'max-w-xl')}>
          <p className="text-md text-muted">
            Shift management is not built yet. Shifts are entered in Manila time and stored
            with their timezone, so a window keeps its meaning across the November change
            when the Manila/Eastern offset moves from 12 to 13 hours.
          </p>
        </div>
      </div>
    </>
  );
}
