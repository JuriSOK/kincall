import { describe, expect, it } from "vitest";
import {
  submitPersonEdit,
  type PersonEditValues,
} from "@/app/(app)/people/[id]/edit/person-edit-submit";

const VALID_VALUES: PersonEditValues = {
  avatarKey: "ocean",
  preferredLanguage: "fr-FR",
  timezone: "Europe/Paris",
  preferredCallTime: "09:00",
  checkInDays: [1, 2, 3, 4, 5, 6, 7],
  scheduleState: "active",
  conversationProfile: "standard",
  interests: ["gardening"],
  conversationNotes: null,
  consentStatus: "confirmed",
};

describe("submitPersonEdit — success and server rejection", () => {
  it("succeeds on a valid patch", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ personId: "person_marie" }), { status: 200 });

    const result = await submitPersonEdit(VALID_VALUES, { personId: "person_marie", fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("surfaces the server's field errors on a 400, without a networkError", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ errors: { timezone: "Must be a valid IANA timezone identifier." } }), {
        status: 400,
      });

    const result = await submitPersonEdit(VALID_VALUES, { personId: "person_marie", fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ timezone: "Must be a valid IANA timezone identifier." });
    expect(result.networkError).toBeUndefined();
  });

  it("falls back to a generic field error when the server sends no errors object", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({}), { status: 500 });
    const result = await submitPersonEdit(VALID_VALUES, { personId: "person_marie", fetchImpl });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  });
});

describe("submitPersonEdit — local validation runs before any request", () => {
  it("rejects invalid input locally, with no network call at all", async () => {
    const fetchImpl = async () => {
      throw new Error("should never be called");
    };

    const result = await submitPersonEdit(
      { ...VALID_VALUES, timezone: "not a timezone" },
      { personId: "person_marie", fetchImpl }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveProperty("timezone");
  });

  it("rejects an unrecognised avatar key locally", async () => {
    const result = await submitPersonEdit(
      { ...VALID_VALUES, avatarKey: "photo-upload-1" },
      { personId: "person_marie" }
    );
    expect(result.errors).toHaveProperty("avatarKey");
  });
});

// Regression coverage matching tests/contact-form-submit.test.ts's own: a
// thrown fetch (offline, DNS failure) must be a reported outcome, never an
// escape that leaves the caller's busy flag stuck true forever.
describe("submitPersonEdit — a thrown fetch is a reported outcome, not an escape", () => {
  it("reports a rejected request as networkError, with no field blamed for it", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };

    const result = await submitPersonEdit(VALID_VALUES, { personId: "person_marie", fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.networkError).toMatch(/could not reach the server/i);
    expect(result.errors).toEqual({});
  });

  it("entered values are never touched by this function on any failure path", async () => {
    // submitPersonEdit takes plain values, not a form — "preserving entered
    // values" is the CALLER's job (it never clears its own controlled state
    // on failure). What this function must never do is throw past a
    // rejected fetch, which is asserted above; this test documents that the
    // function has no form-mutation side effect to begin with.
    const fetchImpl = async () => {
      throw new Error("network down");
    };
    const result = await submitPersonEdit(VALID_VALUES, { personId: "person_marie", fetchImpl });
    expect(result.ok).toBe(false);
    // The caller-supplied values object is untouched.
    expect(VALID_VALUES.timezone).toBe("Europe/Paris");
  });
});
