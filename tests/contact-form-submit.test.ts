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
