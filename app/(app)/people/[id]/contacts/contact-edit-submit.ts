import { validateUpdateContactInput, type FieldErrors } from "@/lib/validation/profile";

export interface ContactEditValues {
  relationship: string;
  enabled: boolean;
  callableFrom: string | null;
  callableTo: string | null;
  timezone: string | null;
  maxAttempts: number;
}

export interface SubmitContactEditResult {
  ok: boolean;
  errors: FieldErrors;
  networkError?: string;
}

export interface SubmitContactEditDeps {
  personId: string;
  contactId: string;
  fetchImpl?: typeof fetch;
}

// Same safe-default pattern as every other submit* helper in this codebase
// (contact-form-submit.ts, schedule-toggle-submit.ts): a fresh direct call to
// the literal `fetch` identifier, so native fetch's receiver requirement is
// satisfied regardless of how this wrapper itself was invoked.
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

// Reuses the SAME PATCH route and the SAME validation
// (validateUpdateContactInput) the general contact-edit panel and the
// enable/disable and callable-window controls all go through — never a
// second write path for trusted-contact fields.
export async function submitContactEdit(
  values: ContactEditValues,
  deps: SubmitContactEditDeps
): Promise<SubmitContactEditResult> {
  const local = validateUpdateContactInput(values);
  if (!local.values) {
    return { ok: false, errors: local.errors };
  }

  const fetchImpl = deps.fetchImpl ?? defaultFetch;

  let response: Response;
  try {
    response = await fetchImpl(`/api/people/${deps.personId}/contacts/${deps.contactId}`, {
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
    return { ok: false, errors: body.errors ?? { relationship: "Could not save these changes." } };
  }

  return { ok: true, errors: {} };
}
