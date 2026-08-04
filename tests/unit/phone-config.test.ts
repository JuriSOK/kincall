import { afterEach, describe, expect, it, vi } from "vitest";
import { phoneEnvVarFor, resolveConfiguredPhone } from "@/backend/persistence/seed";
import { isReservedFictionPhone, RESERVED_FICTION_PHONES } from "@/shared/utilities/phone";

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
  // DEC-008: for an interface-created entity the stored value is the real,
  // validated number the operator entered, not a placeholder — so with no
  // override configured, that stored value is exactly what gets used.
  it("returns the stored number when nothing is configured", () => {
    const stored = "+33698765432";
    expect(resolveConfiguredPhone("contact_sophie", stored)).toBe(stored);
  });

  it("overlays the configured number for a UI-created contact", () => {
    vi.stubEnv("KINCALL_PHONE_CONTACT_SOPHIE", "+33611111111");
    expect(resolveConfiguredPhone("contact_sophie", "+33698765432")).toBe("+33611111111");
  });

  it("ignores a blank value rather than resolving to an empty number", () => {
    vi.stubEnv("KINCALL_PHONE_CONTACT_SOPHIE", "   ");
    const stored = "+33698765432";
    expect(resolveConfiguredPhone("contact_sophie", stored)).toBe(stored);
  });

  // The four legacy demo entities are unaffected by DEC-008: their stored
  // value stays the committed reserved-fiction default (DEC-006), and a live
  // number for them only ever comes from the override.
  it("still falls back to the reserved-fiction default for a legacy demo entity", () => {
    expect(resolveConfiguredPhone("contact_julie", RESERVED_FICTION_PHONES.julie)).toBe(
      RESERVED_FICTION_PHONES.julie
    );
  });
});
