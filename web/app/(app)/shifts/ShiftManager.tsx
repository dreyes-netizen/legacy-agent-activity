'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Moon, Pencil, Trash2 } from 'lucide-react';
import {
  CARD,
  MICRO_LABEL,
  TABLE_CELL,
  TABLE_HEADER,
  TABLE_HEADER_SHADOW,
  TABLE_NUM,
  TABLE_ROW,
} from '@/components/ui/style';
import { ShiftForm } from './ShiftForm';
import { deleteShiftAction, type ShiftFormState } from './actions';
import { ZONE_LABEL, type DisplayZone } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { AgentOption } from '@/lib/metrics';
import type { Shift } from '@/lib/shifts';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function zoneLabel(timezone: string): string {
  return ZONE_LABEL[timezone as DisplayZone] ?? timezone;
}

function DeleteButton({ shift }: { shift: Shift }) {
  const [state, formAction] = useFormState<ShiftFormState, FormData>(deleteShiftAction, {});
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // Deleting a shift changes what every figure anchored to it means, so
        // it asks first rather than being a one-click action.
        if (
          !window.confirm(
            `Delete ${shift.agentName}'s ${shift.startLocal}–${shift.endLocal} shift? Figures anchored to it will fall back to calendar days.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={shift.id} />
      <button
        type="submit"
        aria-label={`Delete ${shift.agentName}'s shift`}
        className="p-1.5 rounded-md text-muted hover:text-nte-red hover:bg-nte-red/10 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {state.error && <span className="sr-only">{state.error}</span>}
    </form>
  );
}

export function ShiftManager({
  shifts,
  agents,
}: {
  shifts: Shift[];
  agents: AgentOption[];
}) {
  const [editing, setEditing] = useState<Shift | undefined>(undefined);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* key forces a fresh form (and fresh default values) when the target changes */}
      <ShiftForm
        key={editing?.id ?? 'new'}
        agents={agents}
        editing={editing}
        onCancelEdit={() => setEditing(undefined)}
      />

      <div className={cn(CARD, 'overflow-hidden')}>
        <div className="px-4 py-3 border-b border-border">
          <h2 className={cn(MICRO_LABEL, 'text-2xs')}>
            Defined shifts ({shifts.length})
          </h2>
        </div>

        {shifts.length === 0 ? (
          <p className="px-4 py-8 text-center text-md text-muted">
            No shifts defined yet. Until at least one exists, the Overview&apos;s
            &ldquo;Shift&rdquo; day anchor has nothing to work with.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={cn(TABLE_HEADER, TABLE_HEADER_SHADOW, 'text-left')}>
                    Agent
                  </th>
                  <th scope="col" className={cn(TABLE_HEADER, TABLE_HEADER_SHADOW, 'text-left')}>
                    Window
                  </th>
                  <th scope="col" className={cn(TABLE_HEADER, TABLE_HEADER_SHADOW, 'text-left')}>
                    Days
                  </th>
                  <th scope="col" className={cn(TABLE_HEADER, TABLE_HEADER_SHADOW, 'text-left')}>
                    Effective
                  </th>
                  <th scope="col" className={cn(TABLE_HEADER, TABLE_HEADER_SHADOW, 'text-left')}>
                    Changed by
                  </th>
                  <th scope="col" className={cn(TABLE_HEADER, TABLE_HEADER_SHADOW, 'text-right')}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift, index) => (
                  <tr
                    key={shift.id}
                    className={cn(TABLE_ROW, index % 2 === 1 && 'bg-row-alt')}
                  >
                    <td className={cn(TABLE_CELL, 'font-medium text-md')}>
                      {shift.agentName}
                    </td>
                    <td className={cn(TABLE_CELL, TABLE_NUM)}>
                      <span className="inline-flex items-center gap-1.5">
                        {shift.startLocal}–{shift.endLocal}
                        <span className="text-2xs text-muted uppercase">
                          {zoneLabel(shift.timezone)}
                        </span>
                        {shift.crossesMidnight && (
                          <Moon
                            className="w-3 h-3 text-app-blue"
                            aria-label="crosses midnight"
                          />
                        )}
                      </span>
                    </td>
                    <td className={cn(TABLE_CELL, 'text-md')}>
                      {shift.weekdays === null
                        ? 'Every day'
                        : shift.weekdays.map((day) => DAY_LABELS[day]).join(', ')}
                    </td>
                    <td className={cn(TABLE_CELL, TABLE_NUM)}>
                      {shift.effectiveFrom}
                      {shift.effectiveTo ? ` → ${shift.effectiveTo}` : ' →'}
                    </td>
                    <td className={cn(TABLE_CELL, 'text-md text-muted')}>
                      {shift.createdBy ?? '—'}
                    </td>
                    <td className={cn(TABLE_CELL, 'text-right')}>
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(shift)}
                          aria-label={`Edit ${shift.agentName}'s shift`}
                          className="p-1.5 rounded-md text-muted hover:text-app-blue hover:bg-row-hover transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <DeleteButton shift={shift} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
