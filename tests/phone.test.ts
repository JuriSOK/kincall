import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "@/lib/database/in-memory-repository";
import { seedRepository } from "@/lib/database/seed";
import {
  describeUnusablePhone,
  isE164,
  isReservedFictionPhone,
  maskPhone,
  RESERVED_FICTION_PHONES,
} from "@/lib/phone";

describe("isE164", () => {
  it("accepts a valid E.164 number", () => {
    expect(isE164("+33639980001")).toBe(true);
  });

  it("rejects a number containing spaces or masking characters", () => {
    expect(isE164("+33 6 39 98 00 01")).toBe(false);
    expect(isE164("+33•••••••01")).toBe(false);
  });

  it("rejects a number without a country prefix or with a leading zero", () => {
    expect(isE164("0639980001")).toBe(false);
    expect(isE164("+0639980001")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps the country prefix and the last two digits", () => {
    expect(maskPhone("+33639980001")).toBe("+33•••••••01");
  });

  it("never leaks enough digits to dial the number", () => {
    const masked = maskPhone("+33639980001");
    expect(masked).not.toContain("639980");
    expect(masked).toHaveLength("+33639980001".length);
  });

  it("masks a very short value entirely", () => {
    expect(maskPhone("+331")).toBe("••••");
  });
});

describe("isReservedFictionPhone", () => {
  it("identifies every seeded default", () => {
    for (const phone of Object.values(RESERVED_FICTION_PHONES)) {
      expect(isReservedFictionPhone(phone)).toBe(true);
    }
  });

  it("does not flag a real-looking number", () => {
    expect(isReservedFictionPhone("+33612345678")).toBe(false);
  });
});

describe("describeUnusablePhone", () => {
  it("accepts a configured, non-reserved E.164 number", () => {
    expect(describeUnusablePhone("+33612345678", "KINCALL_JULIE_PHONE")).toBeNull();
  });

  it("rejects a reserved-for-fiction number that a valid-E.164 check would miss", () => {
    expect(isE164(RESERVED_FICTION_PHONES.julie)).toBe(true);

    const problem = describeUnusablePhone(RESERVED_FICTION_PHONES.julie, "KINCALL_JULIE_PHONE");
    expect(problem).toMatch(/reserved-for-fiction/);
    expect(problem).toContain("KINCALL_JULIE_PHONE");
  });

  it("rejects a malformed number and names the variable to set", () => {
    const problem = describeUnusablePhone("+33 6 12 34 56 78", "KINCALL_MARC_PHONE");
    expect(problem).toMatch(/not a valid E.164 number/);
    expect(problem).toContain("KINCALL_MARC_PHONE");
  });

  it("always masks the number it is complaining about", () => {
    // Malformed (spaces) and reserved — the two ways a number can be unusable.
    const malformed = describeUnusablePhone("+33 6 12 34 56 78", "KINCALL_NICOLE_PHONE");
    expect(malformed).not.toBeNull();
    expect(malformed).not.toContain("612345678");

    const reserved = describeUnusablePhone(RESERVED_FICTION_PHONES.marc, "KINCALL_MARC_PHONE");
    expect(reserved).not.toBeNull();
    expect(reserved).not.toContain(RESERVED_FICTION_PHONES.marc);
  });
});

describe("seeded contact phone configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function seeded() {
    const repository = new InMemoryRepository();
    seedRepository(repository);
    return repository;
  }

  it("falls back to reserved-for-fiction numbers when nothing is configured", async () => {
    const repository = seeded();
    const contacts = await repository.getTrustedContacts("person_marie");

    expect((await repository.getPerson("person_marie"))?.phone).toBe(RESERVED_FICTION_PHONES.marie);
    expect(contacts.map((contact) => contact.phone)).toEqual([
      RESERVED_FICTION_PHONES.julie,
      RESERVED_FICTION_PHONES.marc,
      RESERVED_FICTION_PHONES.nicole,
    ]);
    // Which is exactly what must not be dialled in live mode.
    for (const contact of contacts) {
      expect(describeUnusablePhone(contact.phone)).not.toBeNull();
    }
  });

  it("uses each contact's configured number when present", async () => {
    vi.stubEnv("KINCALL_JULIE_PHONE", "+33611111111");
    vi.stubEnv("KINCALL_MARC_PHONE", "+33622222222");

    const contacts = await seeded().getTrustedContacts("person_marie");

    expect(contacts[0].phone).toBe("+33611111111");
    expect(contacts[1].phone).toBe("+33622222222");
    expect(describeUnusablePhone(contacts[0].phone)).toBeNull();
    // Nicole stays unconfigured, and stays unusable.
    expect(contacts[2].phone).toBe(RESERVED_FICTION_PHONES.nicole);
  });

  it("ignores a blank configured value rather than dialling an empty number", async () => {
    vi.stubEnv("KINCALL_JULIE_PHONE", "   ");
    const contacts = await seeded().getTrustedContacts("person_marie");
    expect(contacts[0].phone).toBe(RESERVED_FICTION_PHONES.julie);
  });
});
