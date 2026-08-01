import { describe, expect, it } from "vitest";
import {
  CONSENT_STATUS_LABEL,
  describeConsentStatus,
  describeContactTimezone,
  describeConversationProfile,
  describeLanguage,
  humanizeCode,
} from "@/lib/presentation/labels";

describe("humanizeCode", () => {
  it("converts underscores and hyphens to spaces", () => {
    expect(humanizeCode("attention_required")).toBe("Attention required");
    expect(humanizeCode("attention-required")).toBe("Attention required");
  });

  it("capitalizes only the first word, never touching the rest", () => {
    expect(humanizeCode("some_weird_ENUM_value")).toBe("Some weird ENUM value");
  });

  it("degrades safely for an unknown historical value: never crashes, never shows raw JSON", () => {
    expect(() => humanizeCode("")).not.toThrow();
    expect(humanizeCode("")).toBe("");
    expect(() => humanizeCode("totally_unrecognized_code_2019")).not.toThrow();
    expect(humanizeCode("totally_unrecognized_code_2019")).not.toContain("{");
    expect(humanizeCode("totally_unrecognized_code_2019")).not.toContain("_");
  });

  it("collapses repeated separators without leaving stray spaces", () => {
    expect(humanizeCode("a__b--c")).toBe("A b c");
  });
});

describe("describeLanguage", () => {
  it("maps fr-FR to French", () => {
    expect(describeLanguage("fr-FR")).toBe("French");
  });

  it("disambiguates en-GB and en-US rather than both reading as bare English", () => {
    expect(describeLanguage("en-GB")).not.toBe(describeLanguage("en-US"));
    expect(describeLanguage("en-GB")).toContain("English");
    expect(describeLanguage("en-US")).toContain("English");
  });

  it("falls back to humanizeCode for an unrecognised code, never showing the raw code verbatim when it contains a separator", () => {
    expect(describeLanguage("pt-BR")).toBe("Pt BR");
    expect(describeLanguage("pt-BR")).not.toBe("pt-BR");
  });
});

describe("describeConversationProfile", () => {
  it("returns a human-readable label for every known conversation profile", () => {
    expect(describeConversationProfile("standard")).not.toBe("standard");
    expect(describeConversationProfile("cognitive_friendly")).not.toContain("_");
    expect(describeConversationProfile("speech_difficulty")).not.toContain("_");
  });

  it("degrades an unrecognised profile code safely instead of crashing", () => {
    expect(() => describeConversationProfile("future_profile_kind")).not.toThrow();
    expect(describeConversationProfile("future_profile_kind")).not.toContain("_");
  });
});

describe("describeConsentStatus / CONSENT_STATUS_LABEL", () => {
  it("maps every ConsentStatus to a capitalized, readable label", () => {
    expect(CONSENT_STATUS_LABEL.pending).toBe("Pending");
    expect(CONSENT_STATUS_LABEL.confirmed).toBe("Confirmed");
    expect(CONSENT_STATUS_LABEL.declined).toBe("Declined");
  });

  it("degrades an unrecognised/historical status via humanizeCode rather than crashing", () => {
    expect(() => describeConsentStatus("some_old_status")).not.toThrow();
    expect(describeConsentStatus("some_old_status")).toBe("Some old status");
  });
});

describe("describeContactTimezone", () => {
  it("shows 'Same as {Name}' when the contact has no explicit timezone (inherits the person's)", () => {
    expect(describeContactTimezone(null, "Marie")).toBe("Same as Marie");
    expect(describeContactTimezone(null, "Sophie")).toBe("Same as Sophie");
    expect(describeContactTimezone(null, "Leo")).toBe("Same as Leo");
  });

  it("never mentions the raw IANA zone when inheriting — no 'Inherits Europe/Paris' wording", () => {
    const result = describeContactTimezone(null, "Marie");
    expect(result).not.toMatch(/[A-Za-z]+\/[A-Za-z_]+/); // no "Region/City" IANA shape
    expect(result).not.toContain("Inherit");
  });

  it("shows the readable timezone value unchanged when the contact has an explicit one configured", () => {
    expect(describeContactTimezone("America/New_York", "Marie")).toBe("America/New_York");
  });
});
