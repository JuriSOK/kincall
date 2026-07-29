import { describe, expect, it } from "vitest";
import {
  containsPhoneLikeSequence,
  slugify,
  validateContactInput,
  validateOrderedIds,
  validatePersonInput,
} from "@/lib/validation/profile";

function person(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Sophie",
    phone: "+33698765432",
    preferredLanguage: "fr-FR",
    conversationProfile: "standard",
    preferredCallTime: "09:00",
    interests: ["gardening"],
    consentStatus: "confirmed",
    ...overrides,
  };
}

describe("validatePersonInput", () => {
  it("accepts a complete profile", () => {
    const { values, errors } = validatePersonInput(person());
    expect(errors).toEqual({});
    expect(values).toEqual({
      firstName: "Sophie",
      phone: "+33698765432",
      preferredLanguage: "fr-FR",
      conversationProfile: "standard",
      preferredCallTime: "09:00",
      interests: ["gardening"],
      consentStatus: "confirmed",
    });
  });

  // DEC-008: phone is required, validated, and stored — a real, non-fiction
  // E.164 number is now the sanctioned way to configure a live number.
  it("requires a phone number", () => {
    expect(validatePersonInput(person({ phone: undefined })).errors).toHaveProperty("phone");
    expect(validatePersonInput(person({ phone: "" })).errors).toHaveProperty("phone");
    expect(validatePersonInput(person({ phone: "   " })).errors).toHaveProperty("phone");
  });

  it("rejects a non-E.164 phone number", () => {
    expect(validatePersonInput(person({ phone: "0612345678" })).errors).toHaveProperty("phone");
    expect(validatePersonInput(person({ phone: "not a number" })).errors).toHaveProperty("phone");
  });

  // A real participant cannot be given a number LiveCalleAdapter already
  // refuses to dial.
  it("rejects a reserved-for-fiction phone number", () => {
    expect(validatePersonInput(person({ phone: "+33639980050" })).errors).toHaveProperty("phone");
  });

  it("normalizes common formatting before validating and storing", () => {
    expect(validatePersonInput(person({ phone: "+33 6 98 76 54 32" })).values?.phone).toBe(
      "+33698765432"
    );
    expect(validatePersonInput(person({ phone: "+33.69.87.65.432" })).values?.phone).toBe(
      "+33698765432"
    );
    expect(validatePersonInput(person({ phone: "+33-69-87-65-432" })).values?.phone).toBe(
      "+33698765432"
    );
  });

  it("never echoes the submitted value back in the error message", () => {
    const { errors } = validatePersonInput(person({ phone: "not-a-real-number-12345" }));
    expect(errors.phone).not.toContain("not-a-real-number-12345");
  });

  it("defaults consent to pending when it is not supplied", () => {
    const { values } = validatePersonInput(person({ consentStatus: undefined }));
    expect(values?.consentStatus).toBe("pending");
  });

  it("trims the first name and requires it", () => {
    expect(validatePersonInput(person({ firstName: "  Sophie  " })).values?.firstName).toBe(
      "Sophie"
    );
    expect(validatePersonInput(person({ firstName: "   " })).errors.firstName).toBeDefined();
    expect(validatePersonInput(person({ firstName: "x".repeat(51) })).errors.firstName).toBeDefined();
  });

  it("rejects an unknown conversation profile rather than silently falling back", () => {
    // guidanceForProfile() returns the standard script for anything unknown,
    // so an invented profile would look accepted and behave as standard.
    expect(validatePersonInput(person({ conversationProfile: "made_up" })).errors)
      .toHaveProperty("conversationProfile");
    expect(validatePersonInput(person({ conversationProfile: "cognitive_friendly" })).errors)
      .toEqual({});
  });

  it("rejects a locale the live adapter could not derive a region from", () => {
    expect(validatePersonInput(person({ preferredLanguage: "fr" })).errors)
      .toHaveProperty("preferredLanguage");
  });

  it.each(["9:00", "24:00", "09:60", "0900", "morning"])(
    "rejects %s as a check-in time",
    (preferredCallTime) => {
      expect(validatePersonInput(person({ preferredCallTime })).errors)
        .toHaveProperty("preferredCallTime");
    }
  );

  it("accepts midnight and the last minute of the day", () => {
    expect(validatePersonInput(person({ preferredCallTime: "00:00" })).errors).toEqual({});
    expect(validatePersonInput(person({ preferredCallTime: "23:59" })).errors).toEqual({});
  });

  it("drops empty interest rows and caps the list", () => {
    expect(validatePersonInput(person({ interests: ["gardening", "", "  "] })).values?.interests)
      .toEqual(["gardening"]);
    expect(validatePersonInput(person({ interests: Array(11).fill("x") })).errors)
      .toHaveProperty("interests");
    expect(validatePersonInput(person({ interests: ["x".repeat(31)] })).errors)
      .toHaveProperty("interests");
  });

  // DEC-006 keeps real numbers out of storage. Interests are spoken aloud by
  // the Companion Agent and are the obvious place to smuggle one in.
  it("rejects a phone number hidden in interests", () => {
    expect(validatePersonInput(person({ interests: ["call me on 06 12 34 56 78"] })).errors)
      .toHaveProperty("interests");
  });

  it("rejects a phone number hidden in the first name", () => {
    expect(validatePersonInput(person({ firstName: "+33612345678" })).errors)
      .toHaveProperty("firstName");
  });
});

describe("validateContactInput", () => {
  it("accepts a complete contact", () => {
    const { values, errors } = validateContactInput({
      firstName: "Marc",
      phone: "+33698765432",
      relationship: "son",
      consentStatus: "confirmed",
    });
    expect(errors).toEqual({});
    expect(values).toEqual({
      firstName: "Marc",
      phone: "+33698765432",
      relationship: "son",
      consentStatus: "confirmed",
    });
  });

  it("requires a phone number", () => {
    expect(
      validateContactInput({ firstName: "Marc", relationship: "son" }).errors
    ).toHaveProperty("phone");
  });

  it("rejects a reserved-for-fiction phone number", () => {
    expect(
      validateContactInput({
        firstName: "Marc",
        phone: "+33639980050",
        relationship: "son",
      }).errors
    ).toHaveProperty("phone");
  });

  it("rejects a phone number hidden in the relationship", () => {
    expect(
      validateContactInput({
        firstName: "Marc",
        phone: "+33698765432",
        relationship: "son 0612345678",
      }).errors
    ).toHaveProperty("relationship");
  });

  it("requires a relationship", () => {
    expect(
      validateContactInput({ firstName: "Marc", phone: "+33698765432", relationship: "" }).errors
    ).toHaveProperty("relationship");
  });
});

describe("containsPhoneLikeSequence", () => {
  it.each([
    "+33612345678",
    "0612345678",
    "06 12 34 56 78",
    "06.12.34.56.78",
    "(06) 12-34-56-78",
  ])("flags %s", (value) => {
    expect(containsPhoneLikeSequence(value)).toBe(true);
  });

  it.each(["gardening", "family", "Marie 2", "walks at 09:00", "born 1943"])(
    "leaves %s alone",
    (value) => {
      expect(containsPhoneLikeSequence(value)).toBe(false);
    }
  );
});

describe("validateOrderedIds", () => {
  it("accepts a list of distinct ids", () => {
    expect(validateOrderedIds(["a", "b"]).values).toEqual(["a", "b"]);
  });

  it("accepts an empty list", () => {
    expect(validateOrderedIds([]).values).toEqual([]);
  });

  it("rejects duplicates", () => {
    expect(validateOrderedIds(["a", "a"]).errors).toHaveProperty("orderedIds");
  });

  it("rejects a non-list and non-strings", () => {
    expect(validateOrderedIds("a").errors).toHaveProperty("orderedIds");
    expect(validateOrderedIds([1, 2]).errors).toHaveProperty("orderedIds");
  });
});

describe("slugify", () => {
  it.each([
    ["Marie", "marie"],
    ["Jean-Pierre", "jean_pierre"],
    ["Chloé", "chloe"],
    ["  Anne Marie  ", "anne_marie"],
    ["Ægir", "gir"],
  ])("turns %s into %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("falls back rather than producing an empty id", () => {
    expect(slugify("!!!")).toBe("profile");
  });
});
