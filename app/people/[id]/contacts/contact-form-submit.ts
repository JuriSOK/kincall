import { validateContactInput, type FieldErrors } from "@/lib/validation/profile";

// The entire surface the submit logic is allowed to touch on the form — a
// real HTMLFormElement satisfies this, and so does a plain test double.
export interface ResettableForm {
  reset(): void;
}

export interface SubmitContactResult {
  ok: boolean;
  errors: FieldErrors;
}

export interface SubmitContactDeps {
  personId: string;
  fetchImpl: typeof fetch;
}

export interface ContactFieldValues {
  firstName: string;
  phone: string;
  relationship: string;
  consentStatus: string;
}

// Extracted out of the React event handler so the fix is structural rather
// than a convention to remember, and so it is unit-testable in Node.
//
// The bug this replaces: `formEvent.currentTarget.reset()`, called after an
// `await fetch(...)`. React nulls a SyntheticEvent's fields once the handler
// yields to the event loop, so `currentTarget` can already be null by the time
// execution resumes — `.reset()` on it then throws. The fix is that `form` is
// a PARAMETER here, which the caller must capture (`formEvent.currentTarget`)
// BEFORE the first `await`; this function never reads anything off an event,
// so there is nothing for it to dereference after it goes stale.
//
// `form.reset()` is called only on the success path, so a rejected request —
// whether from local validation or the server — always leaves the entered
// values exactly as the user left them.
export async function submitContactForm(
  form: ResettableForm,
  fieldValues: ContactFieldValues,
  deps: SubmitContactDeps
): Promise<SubmitContactResult> {
  const local = validateContactInput(fieldValues);
  if (!local.values) {
    return { ok: false, errors: local.errors };
  }

  const response = await deps.fetchImpl(`/api/people/${deps.personId}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(local.values),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { errors?: FieldErrors };
    return { ok: false, errors: body.errors ?? { firstName: "Could not add this contact." } };
  }

  form.reset();
  return { ok: true, errors: {} };
}
