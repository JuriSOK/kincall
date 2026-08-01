import type { FieldErrors } from "@/lib/validation/profile";

export interface SubmitContactToggleResult {
  ok: boolean;
  errors: FieldErrors;
  networkError?: string;
}

export interface SubmitContactToggleDeps {
  personId: string;
  contactId: string;
  fetchImpl?: typeof fetch;
}

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

// A lightweight Enable/Disable toggle, separate from the full contact-edit
// panel: it changes exactly `enabled`, nothing else — mirroring
// schedule-toggle-submit.ts's own reasoning exactly. Reuses the same PATCH
// route and validateUpdateContactInput as the general edit panel.
export async function submitContactToggle(
  nextEnabled: boolean,
  deps: SubmitContactToggleDeps
): Promise<SubmitContactToggleResult> {
  const fetchImpl = deps.fetchImpl ?? defaultFetch;

  let response: Response;
  try {
    response = await fetchImpl(`/api/people/${deps.personId}/contacts/${deps.contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: nextEnabled }),
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
    return { ok: false, errors: body.errors ?? { enabled: "Could not update this contact." } };
  }

  return { ok: true, errors: {} };
}
