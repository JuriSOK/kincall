import { describe, expect, it } from "vitest";
import {
  submitContactEdit,
  type ContactEditValues,
} from "@/app/(app)/people/[id]/contacts/contact-edit-submit";
import { submitContactToggle } from "@/app/(app)/people/[id]/contacts/contact-toggle-submit";
import { submitMakePrimary } from "@/app/(app)/people/[id]/contacts/contact-primary-submit";

const VALID_VALUES: ContactEditValues = {
  relationship: "daughter",
  enabled: true,
  callableFrom: null,
  callableTo: null,
  timezone: null,
  maxAttempts: 2,
};

describe("submitContactEdit", () => {
  it("succeeds on a valid patch", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ contactId: "contact_julie" }), { status: 200 });
    const result = await submitContactEdit(VALID_VALUES, {
      personId: "person_marie",
      contactId: "contact_julie",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects locally when the callable window is incomplete, with no network call", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error("should never be called");
    };
    const result = await submitContactEdit(
      { ...VALID_VALUES, callableFrom: "09:00", callableTo: null },
      { personId: "person_marie", contactId: "contact_julie", fetchImpl }
    );
    expect(result.ok).toBe(false);
  });

  it("surfaces the server's field errors on a 400", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ errors: { maxAttempts: "Must be 1 or 2." } }), { status: 400 });
    const result = await submitContactEdit(VALID_VALUES, {
      personId: "person_marie",
      contactId: "contact_julie",
      fetchImpl,
    });
    expect(result.errors).toEqual({ maxAttempts: "Must be 1 or 2." });
  });

  it("reports a thrown fetch as a networkError, never an escape", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };
    const result = await submitContactEdit(VALID_VALUES, {
      personId: "person_marie",
      contactId: "contact_julie",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.networkError).toMatch(/could not reach the server/i);
  });
});

describe("submitContactToggle", () => {
  it("sends exactly { enabled } and nothing else", async () => {
    let sentBody: unknown;
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const result = await submitContactToggle(false, {
      personId: "person_marie",
      contactId: "contact_julie",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(sentBody).toEqual({ enabled: false });
  });

  it("reports a network failure", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error("offline");
    };
    const result = await submitContactToggle(true, {
      personId: "person_marie",
      contactId: "contact_julie",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.networkError).toBeDefined();
  });
});

describe("submitMakePrimary", () => {
  it("POSTs to the dedicated primary route", async () => {
    let calledUrl: string | undefined;
    const fetchImpl = async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const result = await submitMakePrimary({
      personId: "person_marie",
      contactId: "contact_marc",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(calledUrl).toBe("/api/people/person_marie/contacts/contact_marc/primary");
  });

  it("surfaces a server rejection (e.g. archived contact)", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ errors: { makePrimary: "archived" } }), { status: 400 });
    const result = await submitMakePrimary({
      personId: "person_marie",
      contactId: "contact_marc",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ makePrimary: "archived" });
  });
});
