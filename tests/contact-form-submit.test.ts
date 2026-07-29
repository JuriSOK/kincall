import { describe, expect, it, vi } from "vitest";
import {
  submitContactForm,
  type ResettableForm,
} from "@/app/people/[id]/contacts/contact-form-submit";

function fakeForm(): ResettableForm & { reset: ReturnType<typeof vi.fn> } {
  return { reset: vi.fn() };
}

const VALID_FIELDS = {
  firstName: "Marc",
  phone: "+33698765432",
  relationship: "son",
  consentStatus: "confirmed",
};

// Regression coverage for the bug where `formEvent.currentTarget.reset()` was
// called AFTER `await fetch(...)`. A SyntheticEvent's currentTarget can already
// be null by the time an async handler resumes, so that line could throw and
// leave the form in a broken state. The fix makes the form a plain parameter,
// captured by the caller before any await, so submitContactForm itself has no
// way to touch a stale event field at all.
describe("submitContactForm — regression: form reference must survive the await", () => {
  it("resets the captured form on success", async () => {
    const form = fakeForm();
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ contactId: "contact_marc" }), { status: 201 })
    );

    const result = await submitContactForm(form, VALID_FIELDS, {
      personId: "person_marie",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(form.reset).toHaveBeenCalledTimes(1);
  });

  it("does not reset the form on a server rejection, and surfaces its errors", async () => {
    const form = fakeForm();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: { relationship: "This field is required." } }), {
          status: 400,
        })
    );

    const result = await submitContactForm(
      form,
      { ...VALID_FIELDS, relationship: "" },
      { personId: "person_marie", fetchImpl }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ relationship: "This field is required." });
    // Rejected requests preserve the entered values: nothing resets the form.
    expect(form.reset).not.toHaveBeenCalled();
  });

  it("rejects invalid input locally, with no network call and no reset", async () => {
    const form = fakeForm();
    const fetchImpl = vi.fn();

    const result = await submitContactForm(
      form,
      { ...VALID_FIELDS, phone: "" },
      { personId: "person_marie", fetchImpl }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveProperty("phone");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(form.reset).not.toHaveBeenCalled();
  });

  it("succeeds even after the caller's own event reference has been nulled out", async () => {
    // Simulates the exact regression: something else (React) nulls
    // formEvent.currentTarget while the request is in flight. Since this
    // function only ever touches the captured `form` parameter, that has no
    // effect on it — which is the whole point of the fix.
    const capturedForm = fakeForm();
    let eventCurrentTarget: ResettableForm | null = capturedForm;

    const fetchImpl = vi.fn(async () => {
      // The moment the real bug would bite: currentTarget goes null mid-await.
      eventCurrentTarget = null;
      return new Response(JSON.stringify({}), { status: 201 });
    });

    const result = await submitContactForm(capturedForm, VALID_FIELDS, {
      personId: "person_marie",
      fetchImpl,
    });

    expect(eventCurrentTarget).toBeNull();
    expect(result.ok).toBe(true);
    expect(capturedForm.reset).toHaveBeenCalledTimes(1);
  });
});

// Regression coverage for "TypeError: Failed to execute 'fetch' on 'Window':
// Illegal invocation". A real browser's native fetch is a "legacy platform
// object" method: it only works when invoked with the global object as its
// receiver, and throws for any other receiver. Node's own fetch does not
// enforce this at all, which is exactly why the original bug — assigning the
// bare `fetch` reference to `fetchImpl` and later invoking it as
// `deps.fetchImpl(...)` (a property/method call, receiver = deps) — passed
// every existing test yet broke in every real browser.
//
// Node cannot reproduce the browser's exact internal receiver-brand check, but
// it CAN faithfully reproduce the one distinction that actually matters here:
// a property/method call (`obj.fn()`) supplies `obj` as `this`, while a call
// through a plain top-level reference — a bare call, or a call made from
// inside a wrapper function's own body — supplies `undefined` as `this` in
// strict mode. That is the exact difference between the buggy call style and
// the fixed one, so this fixture requires `this === undefined` to succeed and
// throws for anything else, exactly mirroring how a real detached native
// fetch would reject the property-call form and accept the direct form.
function nativeLikeFetch(): typeof fetch {
  const impl = function (this: unknown) {
    if (this !== undefined) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(
      new Response(JSON.stringify({ contactId: "contact_marc" }), { status: 201 })
    );
  };
  return impl as unknown as typeof fetch;
}

describe("submitContactForm — regression: native fetch must never be passed unbound", () => {
  it("reproduces the bug: invoking the raw reference as obj.fetchImpl(...) throws", () => {
    // Standalone proof of the root cause, independent of submitContactForm:
    // this is exactly the call shape the original code used
    // (`deps.fetchImpl(...)`), and it detaches the reference from the plain
    // top-level call native fetch requires.
    const holder = { fetchImpl: nativeLikeFetch() };
    expect(() => holder.fetchImpl("/x")).toThrow("Illegal invocation");
  });

  it("submitContactForm itself never re-detaches a caller-supplied fetchImpl", async () => {
    const form = fakeForm();
    // The exact raw, receiver-sensitive reference the original bug passed as
    // fetchImpl directly — submitContactForm must invoke it as a plain
    // top-level reference internally, never as `deps.fetchImpl(...)`.
    const fetchImpl = nativeLikeFetch();

    const result = await submitContactForm(form, VALID_FIELDS, {
      personId: "person_marie",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(form.reset).toHaveBeenCalledTimes(1);
  });

  it("the recommended wrapper survives detachment even when passed through another layer", async () => {
    const form = fakeForm();
    const native = nativeLikeFetch();
    // The wrapper's body performs a fresh, direct reference to `native` — the
    // pattern the task's requirements prescribe — so it stays safe regardless
    // of how the wrapper itself gets invoked.
    const fetchImpl: typeof fetch = (input, init) => native(input, init);

    const result = await submitContactForm(form, VALID_FIELDS, {
      personId: "person_marie",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(form.reset).toHaveBeenCalledTimes(1);
  });

  it("is safe by default: omitting fetchImpl entirely still succeeds against a receiver-sensitive global fetch", async () => {
    const form = fakeForm();
    // Replaces the actual global fetch with the receiver-checking fixture, so
    // this proves submitContactForm's OWN internal default (defaultFetch)
    // never calls it in a detached way either — not just that a
    // caller-supplied wrapper can be made safe.
    vi.stubGlobal("fetch", nativeLikeFetch());

    try {
      const result = await submitContactForm(form, VALID_FIELDS, { personId: "person_marie" });
      expect(result.ok).toBe(true);
      expect(form.reset).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
