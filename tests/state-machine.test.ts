import { describe, expect, it } from "vitest";
import {
  isCompanionStructuredResult,
  isFamilyStructuredResult,
  normalizeCompanionResult,
  type CompanionStructuredResult,
} from "@/lib/calle/schemas";
import { decideCompanionAction } from "@/lib/orchestration/decide-companion-action";
import { nextStatus } from "@/lib/orchestration/transitions";

describe("transitions", () => {
  it("applies an allowed transition", () => {
    expect(nextStatus("SCHEDULED", "COMPANION_CALL_STARTED")).toBe("CALLING_PERSON");
  });

  it("rejects an illegal transition", () => {
    expect(() => nextStatus("SCHEDULED", "FAMILY_CONFIRMED")).toThrow(/Illegal transition/);
  });
});

function normalizedResult(overrides: Partial<Parameters<typeof decideCompanionAction>[0]> = {}) {
  return {
    fallMentioned: "no" as const,
    mobilityDifficulty: "no" as const,
    personRequestsHelp: "no" as const,
    doesNotWantToDisturbFamily: "no" as const,
    conversationShorterThanUsual: "no" as const,
    unusualConfusion: "no" as const,
    attentionLevel: "low" as const,
    ...overrides,
  };
}

describe("decideCompanionAction", () => {
  it("closes when no unusual signal is detected", () => {
    const result = decideCompanionAction(normalizedResult());
    expect(result.decision).toBe("LOG_AND_CLOSE");
  });

  it("contacts a trusted person at high priority when fall and mobility difficulty are both present", () => {
    const result = decideCompanionAction(
      normalizedResult({
        fallMentioned: "yes",
        mobilityDifficulty: "yes",
        doesNotWantToDisturbFamily: "yes",
        attentionLevel: "high",
      })
    );
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(result.priority).toBe("high");
  });

  it("contacts a trusted person at medium priority when a fall is mentioned without mobility difficulty", () => {
    const result = decideCompanionAction(
      normalizedResult({ fallMentioned: "yes", attentionLevel: "medium" })
    );
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(result.priority).toBe("medium");
  });
});

const validCompanionResult: CompanionStructuredResult = {
  conversation_summary: "Marie mentioned a fall.",
  fall_mentioned: "yes",
  mobility_difficulty: "yes",
  person_requests_help: "no",
  person_does_not_want_to_disturb_family: "yes",
  conversation_shorter_than_usual: "no",
  unusual_confusion: "no",
  recommended_attention_level: "high",
};

describe("isCompanionStructuredResult", () => {
  it("accepts a well-formed result", () => {
    expect(isCompanionStructuredResult(validCompanionResult)).toBe(true);
  });

  it("rejects a result missing a required field", () => {
    const { conversation_summary, ...malformed } = validCompanionResult;
    void conversation_summary;
    expect(isCompanionStructuredResult(malformed)).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isCompanionStructuredResult("not an object")).toBe(false);
    expect(isCompanionStructuredResult(null)).toBe(false);
  });
});

describe("isFamilyStructuredResult", () => {
  const validFamilyResult = {
    contact_id: "contact_julie",
    answered: false,
    situation_understood: false,
    can_intervene: false,
    intervention_type: null,
    estimated_time: null,
    contact_next_person: true,
    summary: "No answer.",
  };

  it("accepts a well-formed result", () => {
    expect(isFamilyStructuredResult(validFamilyResult)).toBe(true);
  });

  it("rejects a result with the wrong type for a field", () => {
    expect(isFamilyStructuredResult({ ...validFamilyResult, answered: "yes" })).toBe(false);
  });
});

describe("normalizeCompanionResult", () => {
  it("carries every wire field through, renamed to camelCase", () => {
    const normalized = normalizeCompanionResult(validCompanionResult);
    expect(normalized).toEqual({
      fallMentioned: "yes",
      mobilityDifficulty: "yes",
      personRequestsHelp: "no",
      doesNotWantToDisturbFamily: "yes",
      conversationShorterThanUsual: "no",
      unusualConfusion: "no",
      attentionLevel: "high",
    });
  });

  it("passes through an unknown value rather than defaulting it", () => {
    const normalized = normalizeCompanionResult({
      ...validCompanionResult,
      fall_mentioned: "unknown",
      mobility_difficulty: "unknown",
    });
    expect(normalized.fallMentioned).toBe("unknown");
    expect(normalized.mobilityDifficulty).toBe("unknown");
  });
});
