import { validateUpdatePersonInput, type FieldErrors } from "@/lib/validation/profile";

export interface SubmitPersonEditResult {
  ok: boolean;
  errors: FieldErrors;
  /**
   * Set when the request never produced a usable response at all — offline,
   * DNS failure, a connection dropped mid-flight. Deliberately separate from
   * `errors`: a network failure belongs to no field. Callers render this on
   * its own, alongside the entered values, which are never cleared on any
   * failure path — only a genuine save success leaves this page at all.
   */
  networkError?: string;
}

export interface SubmitPersonEditDeps {
  personId: string;
  // See tests/contact-form-submit.test.ts's identical note: must be a plain
  // wrapper, never the bare `fetch`/`window.fetch` reference itself, or a
  // real browser throws "Illegal invocation" the moment it is invoked as
  // `deps.fetchImpl(...)`.
  fetchImpl?: typeof fetch;
}

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

// PersonEditValues mirrors the fields person-edit-form.tsx's <form> actually
// submits — a partial patch, but every key is always present in that form's
// own payload (a native <select>/<input> always has SOME value), so this
// type is not itself partial. What IS partial is what reaches the server:
// validateUpdatePersonInput only forwards fields that were genuinely present
// in the submitted body, exactly like the route handler's own validation.
export interface PersonEditValues {
  avatarKey: string | null;
  preferredLanguage: string;
  timezone: string;
  preferredCallTime: string;
  checkInDays: number[];
  scheduleState: string;
  conversationProfile: string;
  interests: string[];
  conversationNotes: string | null;
  consentStatus: string;
}

// Extracted out of the React event handler for the same reason
// submitContactForm was: unit-testable in Node, and the network-failure
// handling is structural rather than a convention to remember in every form.
export async function submitPersonEdit(
  values: PersonEditValues,
  deps: SubmitPersonEditDeps
): Promise<SubmitPersonEditResult> {
  const local = validateUpdatePersonInput(values);
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
    return { ok: false, errors: body.errors ?? { avatarKey: "Could not save these changes." } };
  }

  return { ok: true, errors: {} };
}
