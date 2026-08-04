import { describe, expect, it } from "vitest";
import { buildFamilyContextBrief } from "@/backend/agents/family/context-brief";
import { normalizeCompanionResult, normalizeLegacyCompanionResult } from "@/backend/integrations/calle/schemas";
import type {
  CompanionStructuredResult,
  LegacyCompanionStructuredResult,
} from "@/backend/integrations/calle/schemas";

// DEC-022. The bug this guards against: a live test where the person asked for
// help completing an administrative document and every trusted contact was told
// only that she "asked for help". The fix must generalise from the Companion
// result's own free-text summary — never from a list of known situations.

function companion(overrides: Partial<CompanionStructuredResult> = {}): CompanionStructuredResult {
  return {
    neutral_summary: "Claire said she is well and had a quiet morning.",
    person_reached: "yes",
    explicit_help_requested: "no",
    fall_mentioned: "no",
    mobility_difficulty: "no",
    pain_or_injury_mentioned: "no",
    unusual_confusion: "no",
    distress_expressed: "no",
    conversation_ended_normally: "yes",
    does_not_want_to_disturb_family: "no",
    other_attention_signal: "no",
    attention_required: "no",
    attention_reasons: [],
    confidence: "high",
    ...overrides,
  };
}

function brief(overrides: Partial<CompanionStructuredResult> = {}, name = "Claire") {
  return buildFamilyContextBrief(normalizeCompanionResult(companion(overrides)), name);
}

describe("buildFamilyContextBrief — generalises from the Companion summary", () => {
  // The exact live-test failure, now covered.
  it("carries an administrative-help context through verbatim", () => {
    const result = brief({
      neutral_summary:
        "Claire said she would like help completing an administrative document.",
      explicit_help_requested: "yes",
      attention_required: "no",
      attention_reasons: ["explicit_help_request"],
    });

    expect(result.source).toBe("companion_summary");
    expect(result.specific).toBe(true);
    expect(result.sentence).toContain("administrative document");
    // Not the generic fallback the old cascade effectively produced.
    expect(result.sentence).not.toBe(
      "Claire asked KinCall to contact someone in their trusted circle for help."
    );
  });

  it("carries a mobility context through the same single path", () => {
    const result = brief({
      neutral_summary: "Claire said she is finding it difficult to walk today.",
      mobility_difficulty: "yes",
      attention_required: "yes",
      attention_reasons: ["mobility_difficulty"],
    });

    expect(result.sentence).toContain("difficult to walk");
    expect(result.source).toBe("companion_summary");
  });

  // The generalisation proof: a situation nobody wrote code for.
  it.each([
    ["a broken boiler", "Claire said her boiler has stopped working and the flat is cold."],
    ["a lost house key", "Claire said she cannot find her house keys and is locked out."],
    ["a pet emergency", "Claire said her cat has been unwell since yesterday."],
    ["a delivery problem", "Claire said a parcel she needs did not arrive."],
  ])("carries a previously unseen context (%s) with no code change", (_label, summary) => {
    const result = brief({
      neutral_summary: summary,
      explicit_help_requested: "yes",
      attention_required: "yes",
      attention_reasons: ["explicit_help_request"],
    });

    expect(result.source).toBe("companion_summary");
    expect(result.specific).toBe(true);
    // The distinctive words of the situation survive — proof the sentence is
    // the person's own reported words, not a lookup.
    expect(result.sentence).toContain(summary.replace(/^Claire said /, "").replace(/\.$/, ""));
  });

  it("carries several attention signals without dropping the narrative context", () => {
    const result = brief({
      neutral_summary:
        "Claire said she slipped in the kitchen this morning and her hip is sore.",
      fall_mentioned: "yes",
      pain_or_injury_mentioned: "yes",
      mobility_difficulty: "yes",
      attention_required: "yes",
      attention_reasons: ["fall", "pain_or_injury", "mobility_difficulty"],
    });

    expect(result.sentence).toContain("slipped in the kitchen");
    expect(result.sentence).toContain("hip is sore");
    expect(result.source).toBe("companion_summary");
  });
});

describe("buildFamilyContextBrief — safe degradation", () => {
  it("falls back to a generic explicit-help sentence when the summary is empty", () => {
    const result = brief({
      neutral_summary: "",
      explicit_help_requested: "yes",
      attention_required: "yes",
      attention_reasons: ["explicit_help_request"],
    });

    expect(result.source).toBe("explicit_help");
    expect(result.specific).toBe(false);
    expect(result.sentence).toBe(
      "Claire asked KinCall to contact someone in their trusted circle for help."
    );
  });

  it("treats a whitespace-only or stub summary as absent rather than context", () => {
    for (const stub of ["   ", "n/a", "-", "ok"]) {
      const result = brief({ neutral_summary: stub, explicit_help_requested: "yes" });
      expect(result.source).toBe("explicit_help");
    }
  });

  it("never lets a serialized object reach a phone call", () => {
    const result = brief({
      neutral_summary: '{"fall_mentioned":"yes","confidence":"high"}',
      explicit_help_requested: "yes",
    });

    expect(result.sentence).not.toContain("{");
    expect(result.sentence).not.toContain("fall_mentioned");
    expect(result.source).toBe("explicit_help");
  });

  it("reports a not-reached check-in plainly, and never an unheard help request", () => {
    const result = brief({
      neutral_summary: "The call reached voicemail rather than a conversation.",
      person_reached: "no",
      // Deliberately contradictory: a result claiming a help request that
      // nobody was there to make. Not-reached must win.
      explicit_help_requested: "yes",
      attention_required: "unknown",
      attention_reasons: ["person_not_reached"],
    });

    expect(result.source).toBe("not_reached");
    expect(result.sentence).toBe(
      "KinCall could not reach Claire during the scheduled check-in."
    );
    expect(result.sentence).not.toMatch(/asked/i);
  });

  it("gives a safe generic sentence when nothing specific is known at all", () => {
    const result = brief({ neutral_summary: "", explicit_help_requested: "no" });
    expect(result.specific).toBe(false);
    expect(result.sentence).toContain("no further detail was recorded");
  });

  it("says the check-in could not be completed when the result is unreadable", () => {
    const result = buildFamilyContextBrief(null, "Claire");
    expect(result.source).toBe("unavailable");
    expect(result.specific).toBe(false);
    expect(result.sentence).toContain("could not complete a check-in");
  });

  it("reads a historical pre-DEC-011 result through its own summary field", () => {
    const legacy: LegacyCompanionStructuredResult = {
      conversation_summary: "Marie said her shoulder has been hurting since she knocked it.",
      person_reached: "yes",
      fall_mentioned: "no",
      mobility_difficulty: "no",
      person_requests_help: "no",
      person_does_not_want_to_disturb_family: "yes",
      conversation_shorter_than_usual: "no",
      unusual_confusion: "no",
      recommended_attention_level: "medium",
    };

    const result = buildFamilyContextBrief(normalizeLegacyCompanionResult(legacy), "Marie");
    expect(result.source).toBe("companion_summary");
    expect(result.sentence).toContain("shoulder has been hurting");
  });
});

describe("buildFamilyContextBrief — attribution and safety", () => {
  it("attributes an unattributed summary to the check-in", () => {
    const result = brief({ neutral_summary: "the kitchen tap has been leaking all week." });
    expect(result.sentence).toBe(
      "Claire told KinCall that the kitchen tap has been leaking all week."
    );
  });

  it("does not double-attribute a summary that already names the person", () => {
    const result = brief({ neutral_summary: "Claire said the kitchen tap has been leaking." });
    expect(result.sentence).toBe("Claire said the kitchen tap has been leaking.");
    expect(result.sentence).not.toContain("Claire told KinCall that Claire");
  });

  it("terminates the sentence even when the summary does not", () => {
    const result = brief({ neutral_summary: "Claire said the lift in her building is broken" });
    expect(result.sentence.endsWith(".")).toBe(true);
  });

  it("uses the person's real name rather than a placeholder", () => {
    for (const name of ["Henri", "Sophie"]) {
      const result = brief({ neutral_summary: "", explicit_help_requested: "yes" }, name);
      expect(result.sentence).toContain(name);
    }
  });

  it("never emits a raw enum code or an internal field name", () => {
    const result = brief({
      neutral_summary: "Claire said she needs a hand with some paperwork.",
      explicit_help_requested: "yes",
      attention_required: "yes",
      attention_reasons: ["explicit_help_request", "other_attention_signal"],
    });

    for (const forbidden of [
      "explicit_help_request",
      "other_attention_signal",
      "attention_required",
      "neutral_summary",
      "person_reached",
      "yes",
      "unknown",
    ]) {
      expect(result.sentence).not.toContain(forbidden);
    }
  });
});
