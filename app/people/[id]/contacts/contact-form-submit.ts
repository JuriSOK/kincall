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
  // Optional: defaults to defaultFetch below. If you DO supply one, it must
  // be a plain wrapper function — never the bare `fetch`/`window.fetch`
  // reference itself. Native fetch is a "legacy platform object" method:
  // browsers require it to be invoked with the global object as `this`, and
  // capturing the reference and calling it any other way — as a property on
  // this deps object (`deps.fetchImpl(...)`), a destructured local, or
  // anything else that detaches it from that receiver — throws
  // `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation.`
  // Node's fetch does not enforce this, which is exactly why the bug this
  // fixes passed every test yet broke in every real browser.
  fetchImpl?: typeof fetch;
}

// The safe default. This arrow function's body performs its OWN fresh, direct
// call to the literal `fetch` identifier every time it runs, so native
// fetch's receiver requirement is satisfied regardless of how THIS wrapper
// itself was invoked. Reassigning `deps.fetchImpl = fetch` directly instead of
// going through a wrapper like this one is exactly the mistake to never repeat.
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

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

  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  const response = await fetchImpl(`/api/people/${deps.personId}/contacts`, {
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
