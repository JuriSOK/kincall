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

  it("reaches PERSON_DID_NOT_ANSWER from the analysis step (DEC-003 voicemail path)", () => {
    expect(nextStatus("ANALYSING_CONVERSATION", "COMPANION_PERSON_NO_ANSWER")).toBe(
      "PERSON_DID_NOT_ANSWER"
    );
  });

  it("reaches HUMAN_REVIEW_REQUIRED when reachability is uncertain", () => {
    expect(nextStatus("ANALYSING_CONVERSATION", "COMPANION_RESULT_UNCERTAIN")).toBe(
      "HUMAN_REVIEW_REQUIRED"
    );
  });

  it("still allows a retry call from PERSON_DID_NOT_ANSWER", () => {
    expect(nextStatus("PERSON_DID_NOT_ANSWER", "COMPANION_CALL_STARTED")).toBe("CALLING_PERSON");
  });

  it("reaches HUMAN_REVIEW_REQUIRED when a contact cannot be called at all", () => {
    expect(nextStatus("ATTENTION_REQUIRED", "FAMILY_CALL_NOT_POSSIBLE")).toBe(
      "HUMAN_REVIEW_REQUIRED"
    );
    expect(nextStatus("CONTACT_DID_NOT_ANSWER", "FAMILY_CALL_NOT_POSSIBLE")).toBe(
      "HUMAN_REVIEW_REQUIRED"
    );
    expect(nextStatus("CONTACT_DECLINED", "FAMILY_CALL_NOT_POSSIBLE")).toBe(
      "HUMAN_REVIEW_REQUIRED"
    );
  });

  it("still rejects an illegal transition out of ANALYSING_CONVERSATION", () => {
    expect(() => nextStatus("ANALYSING_CONVERSATION", "FAMILY_CONFIRMED")).toThrow(
      /Illegal transition/
    );
  });
});

function normalizedResult(overrides: Partial<Parameters<typeof decideCompanionAction>[0]> = {}) {
  return {
    personReached: "yes" as const,
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
  it("closes when the person was reached and no unusual signal is detected", () => {
    const result = decideCompanionAction(normalizedResult());
    expect(result.decision).toBe("LOG_AND_CLOSE");
  });

  it("asks for a retry rather than closing when the person was not reached", () => {
    const result = decideCompanionAction(normalizedResult({ personReached: "no" }));
    expect(result.decision).toBe("RETRY_CHECK_IN");
  });

  it("does not trust reported signals when the person was not reached", () => {
    const result = decideCompanionAction(
      normalizedResult({ personReached: "no", fallMentioned: "yes", mobilityDifficulty: "yes" })
    );
    expect(result.decision).toBe("RETRY_CHECK_IN");
  });

  it("requests human review when reachability is unknown and nothing was detected", () => {
    const result = decideCompanionAction(normalizedResult({ personReached: "unknown" }));
    expect(result.decision).toBe("REQUEST_HUMAN_REVIEW");
  });

  it("lets concerning signals win over unknown reachability", () => {
    const result = decideCompanionAction(
      normalizedResult({
        personReached: "unknown",
        fallMentioned: "yes",
        mobilityDifficulty: "yes",
      })
    );
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(result.priority).toBe("high");
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
  person_reached: "yes",
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

  it("rejects a pre-DEC-003 result that has no person_reached field", () => {
    const { person_reached, ...malformed } = validCompanionResult;
    void person_reached;
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
    answered: "no",
    situation_understood: "unknown",
    can_intervene: "no",
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: "No answer.",
  };

  it("accepts a well-formed categorical result", () => {
    expect(isFamilyStructuredResult(validFamilyResult)).toBe(true);
  });

  it("accepts the no-answer sentinels rather than judging them malformed", () => {
    expect(
      isFamilyStructuredResult({
        ...validFamilyResult,
        intervention_type: "other",
        estimated_time: "",
      })
    ).toBe(true);
  });

  it("rejects the pre-DEC-005 boolean shape", () => {
    expect(isFamilyStructuredResult({ ...validFamilyResult, answered: false })).toBe(false);
    expect(isFamilyStructuredResult({ ...validFamilyResult, can_intervene: true })).toBe(false);
  });

  it("rejects nulls where CALL-E can only send a sentinel", () => {
    expect(isFamilyStructuredResult({ ...validFamilyResult, intervention_type: null })).toBe(false);
    expect(isFamilyStructuredResult({ ...validFamilyResult, estimated_time: null })).toBe(false);
  });

  it("rejects an unrecognised enum value", () => {
    expect(isFamilyStructuredResult({ ...validFamilyResult, answered: "maybe" })).toBe(false);
  });
});

describe("normalizeCompanionResult", () => {
  it("carries every wire field through, renamed to camelCase", () => {
    const normalized = normalizeCompanionResult(validCompanionResult);
    expect(normalized).toEqual({
      personReached: "yes",
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
