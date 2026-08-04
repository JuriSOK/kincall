import type { FieldErrors } from "@/shared/validation/profile";

export interface SubmitMakePrimaryResult {
  ok: boolean;
  errors: FieldErrors;
  networkError?: string;
}

export interface SubmitMakePrimaryDeps {
  personId: string;
  contactId: string;
  fetchImpl?: typeof fetch;
}

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

// The ONLY client-side path that changes isPrimary — POSTs to the dedicated
// .../primary route (Repository.setPrimaryContact), which atomically clears
// any previous primary. Never sent through the general contact-edit PATCH.
export async function submitMakePrimary(deps: SubmitMakePrimaryDeps): Promise<SubmitMakePrimaryResult> {
  const fetchImpl = deps.fetchImpl ?? defaultFetch;

  let response: Response;
  try {
    response = await fetchImpl(
      `/api/people/${deps.personId}/contacts/${deps.contactId}/primary`,
      { method: "POST" }
    );
  } catch {
    return {
      ok: false,
      errors: {},
      networkError: "Could not reach the server. Check your connection and try again.",
    };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { errors?: FieldErrors };
    return { ok: false, errors: body.errors ?? { makePrimary: "Could not set this contact primary." } };
  }

  return { ok: true, errors: {} };
}
