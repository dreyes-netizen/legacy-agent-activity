'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Moon } from 'lucide-react';
import { CARD, CARD_PAD, INPUT, LABEL, MICRO_LABEL } from '@/components/ui/style';
import { upsertShiftAction, type ShiftFormState } from './actions';
import { EASTERN, MANILA } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { AgentOption } from '@/lib/metrics';
import type { Shift } from '@/lib/shifts';

const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 md:h-9 px-4 rounded-md bg-app-blue text-white text-md font-medium transition-colors hover:bg-app-blue/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-blue/40 focus-visible:ring-offset-2 inline-flex items-center gap-2"
    >
      {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
      {editing ? 'Save changes' : 'Add shift'}
    </button>
  );
}

export function ShiftForm({
  agents,
  editing,
  onCancelEdit,
}: {
  agents: AgentOption[];
  editing?: Shift;
  onCancelEdit?: () => void;
}) {
  const [state, formAction] = useFormState<ShiftFormState, FormData>(upsertShiftAction, {});
  const [start, setStart] = useState(editing?.startLocal ?? '21:00');
  const [end, setEnd] = useState(editing?.endLocal ?? '06:00');

  // Mirrors the rule the sync uses: end <= start means the window runs into
  // the next day, and the shift is filed under the date it STARTED.
  const crossesMidnight = end <= start;

  return (
    <form action={formAction} className={cn(CARD, CARD_PAD, 'flex flex-col gap-3')}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={cn(MICRO_LABEL, 'text-2xs')}>
          {editing ? `Edit shift — ${editing.agentName}` : 'Add a shift'}
        </h2>
        {editing && onCancelEdit && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="text-xs text-app-blue hover:underline"
          >
            Cancel
          </button>
        )}
      </div>

      {editing && <input type="hidden" name="id" value={editing.id} />}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="lg:col-span-2">
          <span className={LABEL}>Agent</span>
          <select
            name="ctmUserId"
            defaultValue={editing?.ctmUserId ?? ''}
            required
            className={cn(INPUT, 'cursor-pointer')}
          >
            <option value="" disabled>
              Select an agent
            </option>
            {agents.map((agent) => (
              <option key={agent.ctmUserId} value={agent.ctmUserId}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={LABEL}>Start</span>
          <input
            type="time"
            name="startLocal"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            required
            className={INPUT}
          />
        </label>

        <label>
          <span className={LABEL}>End</span>
          <input
            type="time"
            name="endLocal"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            required
            className={INPUT}
          />
        </label>

        <label>
          <span className={LABEL}>Times entered in</span>
          <select
            name="timezone"
            defaultValue={editing?.timezone ?? MANILA}
            className={cn(INPUT, 'cursor-pointer')}
          >
            <option value={MANILA}>Manila</option>
            <option value={EASTERN}>Eastern (US)</option>
          </select>
        </label>

        <label>
          <span className={LABEL}>Effective from</span>
          <input
            type="date"
            name="effectiveFrom"
            defaultValue={editing?.effectiveFrom ?? new Date().toISOString().slice(0, 10)}
            required
            className={INPUT}
          />
        </label>

        <label>
          <span className={LABEL}>Effective to (optional)</span>
          <input
            type="date"
            name="effectiveTo"
            defaultValue={editing?.effectiveTo ?? ''}
            className={INPUT}
          />
        </label>

        <label>
          <span className={LABEL}>Changed by</span>
          <input
            type="text"
            name="createdBy"
            defaultValue={editing?.createdBy ?? ''}
            placeholder="Your name"
            className={INPUT}
          />
        </label>
      </div>

      <fieldset>
        <legend className={LABEL}>Days (none selected = every day)</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((day) => (
            <label
              key={day.value}
              className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-border bg-white text-md cursor-pointer hover:bg-row-hover transition-colors"
            >
              <input
                type="checkbox"
                name="weekdays"
                value={day.value}
                defaultChecked={editing?.weekdays?.includes(day.value) ?? false}
                className="accent-app-blue"
              />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      {crossesMidnight && (
        <p className="flex items-start gap-1.5 text-xs text-app-blue">
          <Moon className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            This window runs past midnight, so it is filed under the date it{' '}
            <strong>starts</strong> — one row per shift, not split across two days.
          </span>
        </p>
      )}

      {state.error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-nte-red">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-safe-green">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {state.success}
        </p>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton editing={Boolean(editing)} />
        <p className="text-2xs text-muted">
          Saving queues an exact login query for past occurrences; the hourly sync drains it.
        </p>
      </div>
    </form>
  );
}
