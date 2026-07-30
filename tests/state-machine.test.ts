import { describe, expect, it } from "vitest";
import {
  isCompanionStructuredResult,
  isFamilyStructuredResult,
  isLegacyCompanionStructuredResult,
  normalizeCompanionResult,
  readCompanionResult,
  type CompanionStructuredResult,
  type LegacyCompanionStructuredResult,
  type NormalizedCompanionResult,
} from "@/lib/calle/schemas";
import {
  decideCompanionAction,
  MAX_COMPANION_ATTEMPTS,
} from "@/lib/orchestration/decide-companion-action";
import { isTerminalEventStatus } from "@/lib/orchestration/states";
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

  it("still allows a retry call from PERSON_DID_NOT_ANSWER", () => {
    expect(nextStatus("PERSON_DID_NOT_ANSWER", "COMPANION_CALL_STARTED")).toBe("CALLING_PERSON");
  });

  // DEC-011: every path that used to end at HUMAN_REVIEW_REQUIRED now either
  // continues the autonomous cascade or ends at ATTENTION_UNRESOLVED.
  it("reaches ATTENTION_UNRESOLVED, not human review, when the circle is exhausted", () => {
    expect(nextStatus("ATTENTION_REQUIRED", "NO_CONTACTS_REMAINING")).toBe("ATTENTION_UNRESOLVED");
    expect(nextStatus("CONTACT_DID_NOT_ANSWER", "NO_CONTACTS_REMAINING")).toBe(
      "ATTENTION_UNRESOLVED"
    );
    expect(nextStatus("CONTACT_DECLINED", "NO_CONTACTS_REMAINING")).toBe("ATTENTION_UNRESOLVED");
  });

  it("degrades an unreadable companion result to the attention cascade", () => {
    expect(nextStatus("ANALYSING_CONVERSATION", "COMPANION_RESULT_MALFORMED")).toBe(
      "ATTENTION_REQUIRED"
    );
  });

  it("treats an unreadable family result as an unanswered call rather than ending the event", () => {
    expect(nextStatus("CALLING_TRUSTED_CONTACT", "FAMILY_RESULT_MALFORMED")).toBe(
      "CONTACT_DID_NOT_ANSWER"
    );
  });

  it("allows a second call to the same contact from CONTACT_DID_NOT_ANSWER", () => {
    // The same edge serves the bounded retry and the move to the next contact;
    // which one it is comes from the intent, not from the edge.
    expect(nextStatus("CONTACT_DID_NOT_ANSWER", "FAMILY_CALL_STARTED")).toBe(
      "CALLING_TRUSTED_CONTACT"
    );
  });

  it("no longer has ANY edge into HUMAN_REVIEW_REQUIRED", () => {
    // The status is retained for historical events, but nothing may reach it.
    const statuses = [
      "SCHEDULED",
      "CALLING_PERSON",
      "PERSON_DID_NOT_ANSWER",
      "CONVERSATION_IN_PROGRESS",
      "ANALYSING_CONVERSATION",
      "NO_ACTION_REQUIRED",
      "ATTENTION_REQUIRED",
      "CALLING_TRUSTED_CONTACT",
      "CONTACT_DID_NOT_ANSWER",
      "CONTACT_DECLINED",
      "CONTACT_CONFIRMED",
      "HUMAN_REVIEW_REQUIRED",
      "ATTENTION_UNRESOLVED",
      "CASE_CLOSED",
    ] as const;
    const events = [
      "COMPANION_CALL_STARTED",
      "COMPANION_CONVERSATION_STARTED",
      "COMPANION_PERSON_NO_ANSWER",
      "COMPANION_CALL_ENDED",
      "COMPANION_RESULT_NO_ACTION",
      "COMPANION_RESULT_ATTENTION",
      "COMPANION_RESULT_MALFORMED",
      "COMPANION_RESULT_UNCERTAIN",
      "FAMILY_CALL_STARTED",
      "FAMILY_NO_ANSWER",
      "FAMILY_DECLINED",
      "FAMILY_CONFIRMED",
      "FAMILY_RESULT_MALFORMED",
      "FAMILY_CALL_NOT_POSSIBLE",
      "NO_CONTACTS_REMAINING",
      "CASE_CLOSED_EVENT",
    ] as const;

    for (const status of statuses) {
      for (const event of events) {
        let next: string | null = null;
        try {
          next = nextStatus(status, event);
        } catch {
          continue; // illegal edge, which is fine
        }
        expect(next).not.toBe("HUMAN_REVIEW_REQUIRED");
      }
    }
  });

  it("treats ATTENTION_UNRESOLVED as terminal — no edge leaves it", () => {
    expect(() => nextStatus("ATTENTION_UNRESOLVED", "FAMILY_CALL_STARTED")).toThrow(
      /Illegal transition/
    );
    expect(() => nextStatus("ATTENTION_UNRESOLVED", "CASE_CLOSED_EVENT")).toThrow(
      /Illegal transition/
    );
    expect(isTerminalEventStatus("ATTENTION_UNRESOLVED")).toBe(true);
  });

  it("still rejects an illegal transition out of ANALYSING_CONVERSATION", () => {
    expect(() => nextStatus("ANALYSING_CONVERSATION", "FAMILY_CONFIRMED")).toThrow(
      /Illegal transition/
    );
  });
});

// Every field defaults to the "nothing to report" value, so each test states
// exactly the one signal it is about. DEC-011: the closure path requires positive
// evidence on every axis, so `conversationEndedNormally` defaults to "yes" and
// `attentionRequired` to "no" — anything less would make every test cascade.
function normalizedResult(
  overrides: Partial<NormalizedCompanionResult> = {}
): NormalizedCompanionResult {
  return {
    neutralSummary: "Marie sounded like herself.",
    personReached: "yes",
    explicitHelpRequested: "no",
    fallMentioned: "no",
    mobilityDifficulty: "no",
    painOrInjuryMentioned: "no",
    unusualConfusion: "no",
    distressExpressed: "no",
    conversationEndedNormally: "yes",
    doesNotWantToDisturbFamily: "no",
    otherAttentionSignal: "no",
    attentionRequired: "no",
    attentionReasons: [],
    confidence: "high",
    ...overrides,
  };
}

// Attempt 1 unless a test is specifically about the bounded retry.
function decide(
  overrides: Partial<NormalizedCompanionResult> = {},
  attemptNumber = 1
) {
  return decideCompanionAction(normalizedResult(overrides), { attemptNumber });
}

describe("decideCompanionAction — the binary decision (DEC-011, \"Priority removed\")", () => {
  // ── The ONLY closure path ──────────────────────────────────────────────────
  it("closes only when the person was reached, the call ended normally, and no attention signal is present", () => {
    const result = decide();
    expect(result.decision).toBe("LOG_AND_CLOSE");
  });

  it("has no priority field at all on the decision result", () => {
    // The decision is binary (DEC-011, "Priority removed"). There is no tier
    // to compute, so the result type itself carries no `priority`.
    const result = decide();
    expect(result).not.toHaveProperty("priority");
  });

  // ── The bounded retry ──────────────────────────────────────────────────────
  it("retries once when the person was not reached on the first attempt", () => {
    const result = decide({ personReached: "no" }, 1);
    expect(result.decision).toBe("RETRY_CHECK_IN");
  });

  it("contacts the trusted circle once the bounded retry is used up", () => {
    const result = decide({ personReached: "no" }, MAX_COMPANION_ATTEMPTS);
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
  });

  it("never asks for a third check-in call, whatever the attempt count", () => {
    // The bound is what stops an unbounded redial of a vulnerable person.
    for (const attempt of [MAX_COMPANION_ATTEMPTS, MAX_COMPANION_ATTEMPTS + 1, 9]) {
      expect(decide({ personReached: "no" }, attempt).decision).toBe("CONTACT_TRUSTED_PERSON");
    }
  });

  it("does not trust reported signals when the person was not reached", () => {
    // With no conversation there is nothing to read a signal from, so reachability
    // is settled before anything the model reported.
    const result = decide(
      { personReached: "no", fallMentioned: "yes", mobilityDifficulty: "yes" },
      1
    );
    expect(result.decision).toBe("RETRY_CHECK_IN");
  });

  // ── An explicit request for help overrides the model ──────────────────────
  it("contacts the trusted circle on an explicit request for help alone", () => {
    // DEC-010 regression: this signal was collected, validated and normalized
    // but read by nothing, so an explicit request for help with no other signal
    // fell through to LOG_AND_CLOSE — "nothing unusual" reported to someone who
    // asked for help.
    const result = decide({ explicitHelpRequested: "yes" });
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
  });

  it("lets an explicit request for help override a model that reported attention_required: no", () => {
    // Required regression test (DEC-011, "Priority removed"): the AI says no,
    // the person asked for help, and the deterministic rule wins regardless.
    const result = decide({ explicitHelpRequested: "yes", attentionRequired: "no" });
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(result.reason).toBe("Person explicitly asked for help.");
  });

  it("lets an explicit request for help win over the fall rules too", () => {
    const result = decide({ explicitHelpRequested: "yes", fallMentioned: "yes" });
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(result.reason).toBe("Person explicitly asked for help.");
  });

  it("does NOT escalate on a merely unknown request-for-help signal", () => {
    // "yes" means explicitly asked. Treating "unknown" as a request would page
    // the family on every ambiguous call.
    const result = decide({ explicitHelpRequested: "unknown" });
    expect(result.decision).toBe("LOG_AND_CLOSE");
  });

  // ── Any explicitly stated signal cascades — no tier distinguishes them ─────
  it.each([
    ["a fall", { fallMentioned: "yes" } as const],
    ["mobility difficulty", { mobilityDifficulty: "yes" } as const],
    ["pain or injury", { painOrInjuryMentioned: "yes" } as const],
    ["unusual confusion", { unusualConfusion: "yes" } as const],
    ["distress", { distressExpressed: "yes" } as const],
    ["an abnormal ending", { conversationEndedNormally: "no" } as const],
    ["another unusual signal", { otherAttentionSignal: "yes" } as const],
  ])("contacts the trusted circle for %s, even when attention_required is no", (_label, overrides) => {
    // attentionRequired stays "no" (the fixture default): a stated fact must
    // never be overridable by the model's own binary judgement.
    const result = decide(overrides);
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
  });

  it("cascades identically whether one stated signal is present or several", () => {
    // Fall alone and fall + mobility difficulty together used to differ in
    // priority (medium vs high). There is no such distinction any more (DEC-011,
    // "Priority removed") — both simply cascade, and the test asserts there is
    // nothing else to assert.
    const oneSignal = decide({ fallMentioned: "yes" });
    const twoSignals = decide({ fallMentioned: "yes", mobilityDifficulty: "yes" });
    expect(oneSignal.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(twoSignals.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(oneSignal).not.toHaveProperty("priority");
    expect(twoSignals).not.toHaveProperty("priority");
  });

  // ── The model's own judgement ──────────────────────────────────────────────
  it("contacts the trusted circle when attention_required is yes", () => {
    const result = decide({ attentionRequired: "yes" });
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
  });

  it("contacts the trusted circle by precaution when attention_required is unknown", () => {
    // "unknown" must never be read as "nothing unusual" (§7.5).
    const result = decide({ attentionRequired: "unknown" });
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
  });

  // ── Ambiguity never closes ────────────────────────────────────────────────
  it("does not close when reachability is unknown", () => {
    const result = decide({ personReached: "unknown" });
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(result.decision).not.toBe("LOG_AND_CLOSE");
  });

  it("does not close when it is unknown whether the call ended normally", () => {
    const result = decide({ conversationEndedNormally: "unknown" });
    expect(result.decision).toBe("CONTACT_TRUSTED_PERSON");
  });

  it("never produces REQUEST_HUMAN_REVIEW for any combination of signals", () => {
    // DEC-011: the workflow has no operational human-review dependency. This
    // sweeps every field through every value rather than trusting the branches.
    const values = ["yes", "no", "unknown"] as const;
    for (const personReached of values) {
      for (const explicitHelpRequested of values) {
        for (const conversationEndedNormally of values) {
          for (const attentionRequired of values) {
            for (const attempt of [1, 2]) {
              const result = decide(
                {
                  personReached,
                  explicitHelpRequested,
                  conversationEndedNormally,
                  attentionRequired,
                },
                attempt
              );
              expect(result.decision).not.toBe("REQUEST_HUMAN_REVIEW");
              expect(result.decision).not.toBe("ACTIVATE_CONFIGURED_ESCALATION");
              expect(result).not.toHaveProperty("priority");
            }
          }
        }
      }
    }
  });
});

const validCompanionResult: CompanionStructuredResult = {
  neutral_summary: "Marie said she fell and is finding it hard to walk.",
  person_reached: "yes",
  explicit_help_requested: "no",
  fall_mentioned: "yes",
  mobility_difficulty: "yes",
  pain_or_injury_mentioned: "no",
  unusual_confusion: "no",
  distress_expressed: "no",
  conversation_ended_normally: "yes",
  does_not_want_to_disturb_family: "yes",
  other_attention_signal: "no",
  attention_required: "yes",
  attention_reasons: ["fall", "mobility_difficulty"],
  confidence: "high",
};

// The pre-DEC-011 wire shape. Never produced any more, but every event recorded
// before DEC-011 still has one stored, and those events must keep rendering.
const legacyCompanionResult: LegacyCompanionStructuredResult = {
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
    const { neutral_summary, ...malformed } = validCompanionResult;
    void neutral_summary;
    expect(isCompanionStructuredResult(malformed)).toBe(false);
  });

  it("rejects a pre-DEC-003 result that has no person_reached field", () => {
    const { person_reached, ...malformed } = validCompanionResult;
    void person_reached;
    expect(isCompanionStructuredResult(malformed)).toBe(false);
  });

  it("rejects each new DEC-011 field being absent", () => {
    // Strictness is load-bearing: an incomplete fresh result must fail here so
    // the engine degrades to an attention cascade rather than reading a missing
    // signal as an absent one.
    for (const field of [
      "explicit_help_requested",
      "pain_or_injury_mentioned",
      "distress_expressed",
      "conversation_ended_normally",
      "other_attention_signal",
      "attention_required",
      "attention_reasons",
      "confidence",
    ] as const) {
      const { [field]: removed, ...malformed } = validCompanionResult;
      void removed;
      expect(isCompanionStructuredResult(malformed)).toBe(false);
    }
  });

  it("rejects the pre-DEC-011 legacy shape as a FRESH result", () => {
    // The legacy shape is readable (see readCompanionResult) but must never be
    // accepted as new CALL-E output, or the new signals would silently read as
    // absent rather than uncollected.
    expect(isCompanionStructuredResult(legacyCompanionResult)).toBe(false);
  });

  it("rejects an unrecognised attention_required value or reason code", () => {
    expect(
      isCompanionStructuredResult({ ...validCompanionResult, attention_required: "maybe" })
    ).toBe(false);
    expect(
      isCompanionStructuredResult({ ...validCompanionResult, attention_reasons: ["made_up"] })
    ).toBe(false);
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

  it("accepts a result with no voicemail_left field, as every pre-DEC-011 result has", () => {
    expect("voicemail_left" in validFamilyResult).toBe(false);
    expect(isFamilyStructuredResult(validFamilyResult)).toBe(true);
  });

  it("accepts a valid voicemail_left value", () => {
    expect(isFamilyStructuredResult({ ...validFamilyResult, voicemail_left: "yes" })).toBe(true);
  });

  it("rejects a present-but-invalid voicemail_left, so a malformed field is never read as a claim", () => {
    expect(isFamilyStructuredResult({ ...validFamilyResult, voicemail_left: "left" })).toBe(false);
    expect(isFamilyStructuredResult({ ...validFamilyResult, voicemail_left: true })).toBe(false);
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
      neutralSummary: "Marie said she fell and is finding it hard to walk.",
      personReached: "yes",
      explicitHelpRequested: "no",
      fallMentioned: "yes",
      mobilityDifficulty: "yes",
      painOrInjuryMentioned: "no",
      unusualConfusion: "no",
      distressExpressed: "no",
      conversationEndedNormally: "yes",
      doesNotWantToDisturbFamily: "yes",
      otherAttentionSignal: "no",
      attentionRequired: "yes",
      attentionReasons: ["fall", "mobility_difficulty"],
      confidence: "high",
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

describe("readCompanionResult — backward compatibility (DEC-011)", () => {
  it("reads the current shape", () => {
    expect(readCompanionResult(validCompanionResult)?.attentionRequired).toBe("yes");
  });

  it("reads a pre-DEC-011 stored result so historical events still render", () => {
    const normalized = readCompanionResult(legacyCompanionResult);
    expect(normalized).not.toBeNull();
    expect(normalized?.fallMentioned).toBe("yes");
    expect(normalized?.neutralSummary).toBe("Marie mentioned a fall.");
    expect(isLegacyCompanionStructuredResult(legacyCompanionResult)).toBe(true);
  });

  it("maps a legacy result's fields onto the new vocabulary without inventing evidence", () => {
    const normalized = readCompanionResult(legacyCompanionResult)!;
    // v1 never collected these, so they are "unknown" — an absence of evidence,
    // never evidence of absence.
    expect(normalized.painOrInjuryMentioned).toBe("unknown");
    expect(normalized.distressExpressed).toBe("unknown");
    expect(normalized.otherAttentionSignal).toBe("unknown");
    expect(normalized.conversationEndedNormally).toBe("unknown");
    // v1's low/medium/high fall scale collapses onto the binary field, exactly
    // as the current field collapsed it going forward (DEC-011, "Priority
    // removed"): medium and high both become "yes".
    expect(normalized.attentionRequired).toBe("yes");
    expect(normalized.attentionReasons).toEqual(["fall", "mobility_difficulty"]);
  });

  it("maps a legacy 'low' attention level to attentionRequired: no, v1's nothing-unusual value", () => {
    const normalized = readCompanionResult({
      ...legacyCompanionResult,
      fall_mentioned: "no",
      mobility_difficulty: "no",
      recommended_attention_level: "low",
    })!;
    expect(normalized.attentionRequired).toBe("no");
    expect(normalized.attentionReasons).toEqual([]);
  });

  it("returns null for something that is neither shape", () => {
    expect(readCompanionResult({ unexpected: "shape" })).toBeNull();
    expect(readCompanionResult(null)).toBeNull();
  });
});
