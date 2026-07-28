import { afterEach, describe, expect, it, vi } from "vitest";
import { phoneEnvVarFor, resolveConfiguredPhone } from "@/lib/database/seed";
import {
  describeUnusablePhone,
  isE164,
  isReservedFictionPhone,
  mintFictionPhone,
  RESERVED_FICTION_PHONES,
} from "@/lib/phone";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("phoneEnvVarFor", () => {
  // The four demo entities predate the derivation rule and keep their
  // published names, so existing .env.local and Vercel configuration works.
  it.each([
    ["person_marie", "KINCALL_DEMO_PHONE"],
    ["contact_julie", "KINCALL_JULIE_PHONE"],
    ["contact_marc", "KINCALL_MARC_PHONE"],
    ["contact_nicole", "KINCALL_NICOLE_PHONE"],
  ])("keeps the published name for %s", (id, expected) => {
    expect(phoneEnvVarFor(id)).toBe(expected);
  });

  // A profile created through the interface has an id nobody hardcoded. Before
  // this was a function it was a four-key map, so such a profile could never
  // have been configured for a live call at all.
  it.each([
    ["contact_sophie", "KINCALL_PHONE_CONTACT_SOPHIE"],
    ["person_jean_pierre", "KINCALL_PHONE_PERSON_JEAN_PIERRE"],
    ["contact_marie_2", "KINCALL_PHONE_CONTACT_MARIE_2"],
  ])("derives a name for %s", (id, expected) => {
    expect(phoneEnvVarFor(id)).toBe(expected);
  });
});

describe("mintFictionPhone", () => {
  it("produces a number that is valid E.164 but never dialable", () => {
    const phone = mintFictionPhone("contact_sophie");
    expect(isE164(phone)).toBe(true);
    expect(isReservedFictionPhone(phone)).toBe(true);
    expect(describeUnusablePhone(phone)).not.toBeNull();
  });

  it("is deterministic, so a profile keeps the same number", () => {
    expect(mintFictionPhone("contact_sophie")).toBe(mintFictionPhone("contact_sophie"));
  });

  it("stays clear of the four seeded demo numbers", () => {
    const seeded = new Set<string>(Object.values(RESERVED_FICTION_PHONES));
    for (const id of ["a", "b", "contact_sophie", "person_x", "contact_marie_2"]) {
      expect(seeded.has(mintFictionPhone(id))).toBe(false);
    }
  });
});

describe("isReservedFictionPhone", () => {
  it("still recognises the four seeded constants", () => {
    for (const phone of Object.values(RESERVED_FICTION_PHONES)) {
      expect(isReservedFictionPhone(phone)).toBe(true);
    }
  });

  // Range-based rather than a four-entry set, or a minted number would sail
  // past the guard and be dialled for real.
  it.each(["+33639980000", "+33639985000", "+33639989999"])("covers %s", (phone) => {
    expect(isReservedFictionPhone(phone)).toBe(true);
  });

  it.each(["+33639990000", "+33639970000", "+33612345678"])(
    "leaves %s outside the range",
    (phone) => {
      expect(isReservedFictionPhone(phone)).toBe(false);
    }
  );
});

describe("resolveConfiguredPhone", () => {
  it("returns the stored fiction number when nothing is configured", () => {
    const stored = mintFictionPhone("contact_sophie");
    expect(resolveConfiguredPhone("contact_sophie", stored)).toBe(stored);
  });

  it("overlays the configured number for a UI-created contact", () => {
    vi.stubEnv("KINCALL_PHONE_CONTACT_SOPHIE", "+33611111111");
    expect(resolveConfiguredPhone("contact_sophie", mintFictionPhone("contact_sophie"))).toBe(
      "+33611111111"
    );
  });

  it("ignores a blank value rather than resolving to an empty number", () => {
    vi.stubEnv("KINCALL_PHONE_CONTACT_SOPHIE", "   ");
    const stored = mintFictionPhone("contact_sophie");
    expect(resolveConfiguredPhone("contact_sophie", stored)).toBe(stored);
  });
});
