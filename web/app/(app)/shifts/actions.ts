'use server';

import { revalidatePath } from 'next/cache';
import {
  deleteShift,
  saveShift,
  validateShift,
  type ShiftInput,
} from '@/lib/shifts';
import { MANILA } from '@/lib/time';

export interface ShiftFormState {
  error?: string;
  success?: string;
}

function readWeekdays(form: FormData): number[] | null {
  const values = form
    .getAll('weekdays')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  // Empty selection means "every day", stored as NULL, not as an empty array --
  // an empty array would match nothing.
  return values.length === 0 || values.length === 7 ? null : values;
}

export async function upsertShiftAction(
  _previous: ShiftFormState,
  form: FormData,
): Promise<ShiftFormState> {
  const rawId = form.get('id');
  const id = rawId ? Number(rawId) : undefined;

  const input: ShiftInput = {
    ctmUserId: String(form.get('ctmUserId') ?? ''),
    startLocal: String(form.get('startLocal') ?? ''),
    endLocal: String(form.get('endLocal') ?? ''),
    timezone: String(form.get('timezone') ?? MANILA),
    weekdays: readWeekdays(form),
    effectiveFrom: String(form.get('effectiveFrom') ?? ''),
    effectiveTo: (form.get('effectiveTo') as string) || null,
    // Self-declared, because the app has one shared password and so cannot
    // identify who is signed in. Not real accountability -- but enough to
    // reconstruct who changed a shift, which matters because editing a shift
    // changes what an agent's login figure means.
    createdBy: (form.get('createdBy') as string)?.trim() || null,
  };

  const problem = validateShift(input);
  if (problem) return { error: problem };

  try {
    const { queued } = await saveShift(input, id);
    revalidatePath('/shifts');
    revalidatePath('/');
    return {
      success:
        queued > 0
          ? `Shift saved. ${queued} past occurrence${queued === 1 ? '' : 's'} queued for an exact login query.`
          : 'Shift saved.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save the shift.';
    // The CHECK constraint on shifts.timezone rejects a zone Postgres cannot
    // resolve, which is the most likely failure here.
    return { error: message.includes('shifts_timezone_valid') ? 'Unknown timezone.' : message };
  }
}

export async function deleteShiftAction(
  _previous: ShiftFormState,
  form: FormData,
): Promise<ShiftFormState> {
  const id = Number(form.get('id'));
  if (!Number.isInteger(id)) return { error: 'Invalid shift.' };
  try {
    await deleteShift(id);
    revalidatePath('/shifts');
    revalidatePath('/');
    return { success: 'Shift deleted.' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not delete the shift.',
    };
  }
}
