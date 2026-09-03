import { PageHeader } from '@/components/layout/PageHeader';
import { getAgentOptions } from '@/lib/metrics';
import { listShifts } from '@/lib/shifts';
import { ShiftManager } from './ShiftManager';

export const metadata = { title: 'Shifts — Agent Activity' };
export const dynamic = 'force-dynamic';

export default async function ShiftsPage() {
  const [shifts, agents] = await Promise.all([listShifts(), getAgentOptions()]);

  return (
    <>
      <PageHeader
        label="Alliance Global Solutions"
        title="Shifts"
        subtitle="Define each agent's working window"
      />

      <div className="px-4 md:px-8 py-4 md:py-6 flex flex-col gap-4 md:gap-6">
        <p className="text-md text-muted max-w-3xl">
          Shifts are stored with the timezone they were entered in, so a window keeps its
          meaning across the November change when the Manila/Eastern offset moves from 12
          to 13 hours. A shift is always filed under the date it <strong>starts</strong>,
          which is what keeps an overnight window on a single row instead of splitting it
          across two days.
        </p>

        <ShiftManager shifts={shifts} agents={agents} />
      </div>
    </>
  );
}
