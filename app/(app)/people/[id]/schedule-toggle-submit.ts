import { validateUpdatePersonInput, type FieldErrors } from "@/shared/validation/profile";
import type { ScheduleState } from "@/shared/domain/types";

export interface SubmitScheduleToggleResult {
  ok: boolean;
  errors: FieldErrors;
  /** Same contract as person-edit-submit.ts's SubmitPersonEditResult. */
  networkError?: string;
}

export interface SubmitScheduleToggleDeps {
  personId: string;
  fetchImpl?: typeof fetch;
}

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

// Reuses the SAME PATCH route and the SAME validation
// (validateUpdatePersonInput) the full profile-edit form uses — a minimal
// one-field patch, not a second write path. Pause/Resume never touches any
// other field: it sends exactly `{ scheduleState }`, so a stale client
// re-reading this page cannot accidentally overwrite something else that
// changed underneath it.
export async function submitScheduleToggle(
  nextState: ScheduleState,
  deps: SubmitScheduleToggleDeps
): Promise<SubmitScheduleToggleResult> {
  const local = validateUpdatePersonInput({ scheduleState: nextState });
  if (!local.values) {
    return { ok: false, errors: local.errors };
  }

  const fetchImpl = deps.fetchImpl ?? defaultFetch;

  let response: Response;
  try {
    response = await fetchImpl(`/api/people/${deps.personId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(local.values),
    });
  } catch {
    return {
      ok: false,
      errors: {},
      networkError: "Could not reach the server. Check your connection and try again.",
    };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { errors?: FieldErrors };
    return {
      ok: false,
      errors: body.errors ?? { scheduleState: "Could not update the schedule state." },
    };
  }

  return { ok: true, errors: {} };
}
