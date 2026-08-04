import { describe, expect, it } from "vitest";
import {
  containsPhoneLikeSequence,
  slugify,
  validateContactInput,
  validateOrderedIds,
  validatePersonInput,
  validateUpdatePersonInput,
} from "@/shared/validation/profile";
import { AVATAR_KEYS } from "@/shared/utilities/avatars";

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
      // Stage C (DEC-015) defaults, applied when the field is entirely
      // absent from the submitted body — see the dedicated describe block
      // below for the fields' own validation rules.
      timezone: "Europe/Paris",
      avatarKey: null,
      conversationNotes: null,
      checkInDays: [1, 2, 3, 4, 5, 6, 7],
      scheduleState: "active",
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

  // Stage C (DEC-015): avatar, timezone, check-in days, schedule state and
  // conversation notes. Every one defaults when entirely absent from the
  // submitted body (create semantics) — see validateUpdatePersonInput below
  // for the different, partial-patch semantics the edit route uses instead.
  describe("Stage C fields", () => {
    it("defaults avatarKey to null when omitted, empty, or explicitly null", () => {
      expect(validatePersonInput(person({ avatarKey: undefined })).values?.avatarKey).toBeNull();
      expect(validatePersonInput(person({ avatarKey: "" })).values?.avatarKey).toBeNull();
      expect(validatePersonInput(person({ avatarKey: null })).values?.avatarKey).toBeNull();
    });

    it("accepts every registered avatar key", () => {
      for (const key of AVATAR_KEYS) {
        const { values, errors } = validatePersonInput(person({ avatarKey: key }));
        expect(errors, key).toEqual({});
        expect(values?.avatarKey).toBe(key);
      }
    });

    it("rejects an avatar key that is not in the registry", () => {
      expect(validatePersonInput(person({ avatarKey: "photo-upload-1" })).errors).toHaveProperty(
        "avatarKey"
      );
    });

    it("defaults timezone to Europe/Paris when omitted", () => {
      expect(validatePersonInput(person({ timezone: undefined })).values?.timezone).toBe(
        "Europe/Paris"
      );
    });

    it("accepts any valid IANA timezone identifier", () => {
      expect(validatePersonInput(person({ timezone: "America/New_York" })).values?.timezone).toBe(
        "America/New_York"
      );
      expect(validatePersonInput(person({ timezone: "Pacific/Noumea" })).values?.timezone).toBe(
        "Pacific/Noumea"
      );
    });

    it("rejects a timezone the runtime does not recognise", () => {
      expect(validatePersonInput(person({ timezone: "Mars/Olympus_Mons" })).errors).toHaveProperty(
        "timezone"
      );
      expect(validatePersonInput(person({ timezone: "not a timezone" })).errors).toHaveProperty(
        "timezone"
      );
    });

    it("defaults checkInDays to every day when omitted", () => {
      expect(validatePersonInput(person({ checkInDays: undefined })).values?.checkInDays).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
    });

    it("rejects a weekday outside 1-7", () => {
      expect(validatePersonInput(person({ checkInDays: [0, 1] })).errors).toHaveProperty(
        "checkInDays"
      );
      expect(validatePersonInput(person({ checkInDays: [1, 8] })).errors).toHaveProperty(
        "checkInDays"
      );
    });

    it("rejects a duplicate weekday", () => {
      expect(validatePersonInput(person({ checkInDays: [1, 3, 3] })).errors).toHaveProperty(
        "checkInDays"
      );
    });

    it("rejects an empty checkInDays list", () => {
      expect(validatePersonInput(person({ checkInDays: [] })).errors).toHaveProperty("checkInDays");
    });

    it("sorts checkInDays regardless of submitted order", () => {
      expect(validatePersonInput(person({ checkInDays: [5, 1, 3] })).values?.checkInDays).toEqual([
        1, 3, 5,
      ]);
    });

    it("defaults scheduleState to active when omitted", () => {
      expect(validatePersonInput(person({ scheduleState: undefined })).values?.scheduleState).toBe(
        "active"
      );
    });

    it("accepts every valid schedule state and rejects anything else", () => {
      for (const state of ["active", "paused", "inactive"] as const) {
        expect(validatePersonInput(person({ scheduleState: state })).values?.scheduleState).toBe(
          state
        );
      }
      expect(validatePersonInput(person({ scheduleState: "sleeping" })).errors).toHaveProperty(
        "scheduleState"
      );
    });

    it("defaults conversationNotes to null when omitted, empty, or explicitly null", () => {
      expect(
        validatePersonInput(person({ conversationNotes: undefined })).values?.conversationNotes
      ).toBeNull();
      expect(validatePersonInput(person({ conversationNotes: "   " })).values?.conversationNotes)
        .toBeNull();
      expect(validatePersonInput(person({ conversationNotes: null })).values?.conversationNotes)
        .toBeNull();
    });

    it("rejects a phone number hidden in conversationNotes", () => {
      expect(
        validatePersonInput(person({ conversationNotes: "Call her daughter on 06 12 34 56 78" }))
          .errors
      ).toHaveProperty("conversationNotes");
    });

    it("rejects conversationNotes over 280 characters", () => {
      expect(
        validatePersonInput(person({ conversationNotes: "x".repeat(281) })).errors
      ).toHaveProperty("conversationNotes");
    });

    it("accepts ordinary conversationNotes describing habits or preferences", () => {
      const { values, errors } = validatePersonInput(
        person({ conversationNotes: "Enjoys talking about her garden and grandchildren." })
      );
      expect(errors).toEqual({});
      expect(values?.conversationNotes).toBe(
        "Enjoys talking about her garden and grandchildren."
      );
    });
  });
});

describe("validateUpdatePersonInput", () => {
  it("includes only the fields present in the submitted body", () => {
    const { values, errors } = validateUpdatePersonInput({ avatarKey: "ocean" });
    expect(errors).toEqual({});
    expect(values).toEqual({ avatarKey: "ocean" });
  });

  it("preserves everything else by omitting it — never defaults an absent field", () => {
    const { values } = validateUpdatePersonInput({ timezone: "Europe/London" });
    expect(values).toEqual({ timezone: "Europe/London" });
    expect(values).not.toHaveProperty("checkInDays");
    expect(values).not.toHaveProperty("scheduleState");
  });

  it("an explicit null on a nullable field is applied (clears it), not ignored", () => {
    const { values, errors } = validateUpdatePersonInput({
      avatarKey: null,
      conversationNotes: null,
    });
    expect(errors).toEqual({});
    expect(values).toEqual({ avatarKey: null, conversationNotes: null });
  });

  it("validates every present field with the same rules as creation", () => {
    expect(validateUpdatePersonInput({ avatarKey: "not-a-real-key" }).errors).toHaveProperty(
      "avatarKey"
    );
    expect(validateUpdatePersonInput({ timezone: "not a timezone" }).errors).toHaveProperty(
      "timezone"
    );
    expect(validateUpdatePersonInput({ checkInDays: [1, 1] }).errors).toHaveProperty("checkInDays");
    expect(validateUpdatePersonInput({ scheduleState: "sleeping" }).errors).toHaveProperty(
      "scheduleState"
    );
    expect(validateUpdatePersonInput({ preferredCallTime: "9am" }).errors).toHaveProperty(
      "preferredCallTime"
    );
  });

  it("never accepts firstName or phone — they are not part of UpdatePersonInput", () => {
    // Even if a caller (a stale client, a tampered request) sends them, they
    // are silently ignored rather than applied — validateUpdatePersonInput
    // only ever reads the keys UpdatePersonInput declares.
    const { values, errors } = validateUpdatePersonInput({
      firstName: "Someone Else",
      phone: "+33600000000",
      timezone: "UTC",
    });
    expect(errors).toEqual({});
    expect(values).toEqual({ timezone: "UTC" });
  });

  it("accepts an entirely empty patch", () => {
    expect(validateUpdatePersonInput({})).toEqual({ errors: {}, values: {} });
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
