// Companion shape is CALL-E's flat categorical result_schema (Phase 3 DEC-002),
// not PRODUCT_SPECIFICATION.md §9.1's nested signals[] array verbatim — see
// docs/DECISION_LOG.md DEC-002 for why. Family shape still matches §9.3 verbatim.
// Hand-written guards on purpose: no zod/validation library beyond the frozen stack.
//
// DEC-011 widened the Companion result from the fall-centric v1 shape to a
// generic *operational attention* model: KinCall handles more situations than
// falls, so the extraction model reports what the person said across several
// non-medical signal families. The attention estimate itself was simplified
// before this design shipped (docs/DECISION_LOG.md DEC-011, "Priority
// removed"): an earlier four-value `attention_level` (none/attention/high/
// unknown) had "high" and "attention" always triggering the identical
// cascade — there was no behaviour a priority label ever distinguished — and
// displaying it invited a false read of "high priority" as a meaningfully
// different situation. `attention_required` is the binary this collapses to.
// It is NOT a medical severity scale and never a diagnosis.
//
// Two shapes therefore exist on purpose:
//   * current (CompanionStructuredResult) — what CALL-E returns now, validated
//     STRICTLY, because a fresh result that fails validation must degrade to an
//     attention cascade rather than to a reassuring closure.
//   * v1 (LegacyCompanionStructuredResult) — what pre-DEC-011 events already
//     have in `call_events.structured_result`. Accepted for READING only
//     (readCompanionResult), so historical events keep rendering. Never
//     produced, never accepted as a fresh result.

export type YesNoUnknown = "yes" | "no" | "unknown";

export type Confidence = "low" | "medium" | "high";

// The controlled vocabulary the extraction model may use to say *why* attention
// is warranted. A closed list, so a free-text reason can never smuggle in a
// medical interpretation, and so the interface can label each one in plain
// language without parsing prose.
export const ATTENTION_REASONS = [
  "explicit_help_request",
  "fall",
  "mobility_difficulty",
  "pain_or_injury",
  "unusual_confusion",
  "distress",
  "abnormal_conversation_end",
  "person_not_reached",
  "other_attention_signal",
] as const;

export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export interface CompanionStructuredResult {
  // Short, factual, non-interpretive summary of what was said.
  neutral_summary: string;
  // Whether a two-way conversation with the person actually happened. A
  // voicemail is a `completed` CALL-E call with no concerning signals, which
  // without this field reads identically to "the person is fine" (DEC-003).
  person_reached: YesNoUnknown;
  // Renamed from v1's `person_requests_help` (DEC-011) to say plainly that only
  // an *explicit* request counts — never one inferred from silence or hesitancy.
  explicit_help_requested: YesNoUnknown;
  fall_mentioned: YesNoUnknown;
  mobility_difficulty: YesNoUnknown;
  pain_or_injury_mentioned: YesNoUnknown;
  unusual_confusion: YesNoUnknown;
  distress_expressed: YesNoUnknown;
  // "no" means the call ended abnormally (cut off, abandoned mid-sentence,
  // the person stopped responding) — itself an attention signal.
  conversation_ended_normally: YesNoUnknown;
  // Retained from v1 (§9.1 lists it, and §12's demo turns on it). Not itself a
  // reason to contact anyone — it is context for the family call, explaining why
  // the person had not told them already.
  does_not_want_to_disturb_family: YesNoUnknown;
  // The escape hatch for situations nobody enumerated: something unusual the
  // person actually said that none of the fields above capture.
  other_attention_signal: YesNoUnknown;
  // Binary, not a priority scale (DEC-011, "Priority removed"). "unknown" is a
  // genuine third value — the model could not judge — and is treated as
  // needing attention, never as "nothing unusual" (§7.5: KinCall must not
  // assert safety on a guess).
  attention_required: YesNoUnknown;
  attention_reasons: AttentionReason[];
  confidence: Confidence;
}

// Pre-DEC-011 persisted shape. Read-only; see the file header.
export interface LegacyCompanionStructuredResult {
  conversation_summary: string;
  person_reached: YesNoUnknown;
  fall_mentioned: YesNoUnknown;
  mobility_difficulty: YesNoUnknown;
  person_requests_help: YesNoUnknown;
  person_does_not_want_to_disturb_family: YesNoUnknown;
  conversation_shorter_than_usual: YesNoUnknown;
  unusual_confusion: YesNoUnknown;
  recommended_attention_level: "low" | "medium" | "high";
}

// Categorical like the Companion shape (DEC-005): CALL-E's own result_schema
// guidance prefers string enums with an explicit `unknown` over booleans for
// decisions that may be unclear, and only `can_intervene: "yes"` may ever stop
// the cascade. `intervention_type`/`estimated_time` are total rather than
// nullable — CALL-E's result_schema has no null support, so a no-answer uses
// the "other"/"" sentinels instead of producing an invalid result.
export interface FamilyStructuredResult {
  contact_id: string;
  answered: YesNoUnknown;
  situation_understood: YesNoUnknown;
  can_intervene: YesNoUnknown;
  intervention_type: "visit" | "call" | "other";
  estimated_time: string;
  contact_next_person: YesNoUnknown;
  summary: string;
  // DEC-011. OPTIONAL on purpose, in both directions:
  //   * historical family results predate it and must stay valid;
  //   * it is a model *self-report*, not a platform confirmation — CALL-E's
  //     OpenAPI v0.2.0 exposes no voicemail detection at all (see
  //     CalleAdapter.capabilities), so KinCall only ever believes it when the
  //     adapter independently declares voicemail support.
  voicemail_left?: YesNoUnknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isYesNoUnknown(value: unknown): value is YesNoUnknown {
  return value === "yes" || value === "no" || value === "unknown";
}

function isConfidence(value: unknown): value is Confidence {
  return value === "low" || value === "medium" || value === "high";
}

function isAttentionReasonArray(value: unknown): value is AttentionReason[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => ATTENTION_REASONS.includes(entry as AttentionReason))
  );
}

// Strict v2 validation, for a FRESH CALL-E result only. A `false` here means the
// engine degrades to an attention cascade — never to a closure (DEC-011).
export function isCompanionStructuredResult(value: unknown): value is CompanionStructuredResult {
  if (!isRecord(value)) return false;
  if (typeof value.neutral_summary !== "string") return false;
  if (!isYesNoUnknown(value.person_reached)) return false;
  if (!isYesNoUnknown(value.explicit_help_requested)) return false;
  if (!isYesNoUnknown(value.fall_mentioned)) return false;
  if (!isYesNoUnknown(value.mobility_difficulty)) return false;
  if (!isYesNoUnknown(value.pain_or_injury_mentioned)) return false;
  if (!isYesNoUnknown(value.unusual_confusion)) return false;
  if (!isYesNoUnknown(value.distress_expressed)) return false;
  if (!isYesNoUnknown(value.conversation_ended_normally)) return false;
  if (!isYesNoUnknown(value.does_not_want_to_disturb_family)) return false;
  if (!isYesNoUnknown(value.other_attention_signal)) return false;
  if (!isYesNoUnknown(value.attention_required)) return false;
  if (!isAttentionReasonArray(value.attention_reasons)) return false;
  if (!isConfidence(value.confidence)) return false;
  return true;
}

export function isLegacyCompanionStructuredResult(
  value: unknown
): value is LegacyCompanionStructuredResult {
  if (!isRecord(value)) return false;
  if (typeof value.conversation_summary !== "string") return false;
  if (!isYesNoUnknown(value.person_reached)) return false;
  if (!isYesNoUnknown(value.fall_mentioned)) return false;
  if (!isYesNoUnknown(value.mobility_difficulty)) return false;
  if (!isYesNoUnknown(value.person_requests_help)) return false;
  if (!isYesNoUnknown(value.person_does_not_want_to_disturb_family)) return false;
  if (!isYesNoUnknown(value.conversation_shorter_than_usual)) return false;
  if (!isYesNoUnknown(value.unusual_confusion)) return false;
  if (
    value.recommended_attention_level !== "low" &&
    value.recommended_attention_level !== "medium" &&
    value.recommended_attention_level !== "high"
  ) {
    return false;
  }
  return true;
}

export function isFamilyStructuredResult(value: unknown): value is FamilyStructuredResult {
  if (!isRecord(value)) return false;
  if (typeof value.contact_id !== "string") return false;
  if (!isYesNoUnknown(value.answered)) return false;
  if (!isYesNoUnknown(value.situation_understood)) return false;
  if (!isYesNoUnknown(value.can_intervene)) return false;
  if (!isYesNoUnknown(value.contact_next_person)) return false;
  if (
    value.intervention_type !== "visit" &&
    value.intervention_type !== "call" &&
    value.intervention_type !== "other"
  ) {
    return false;
  }
  if (typeof value.estimated_time !== "string") return false;
  if (typeof value.summary !== "string") return false;
  // Optional (see the interface): absent is valid, but a present-and-wrong
  // value is not — a malformed field must never be read as a voicemail claim.
  if (value.voicemail_left !== undefined && !isYesNoUnknown(value.voicemail_left)) return false;
  return true;
}

export interface NormalizedCompanionResult {
  neutralSummary: string;
  personReached: YesNoUnknown;
  explicitHelpRequested: YesNoUnknown;
  fallMentioned: YesNoUnknown;
  mobilityDifficulty: YesNoUnknown;
  painOrInjuryMentioned: YesNoUnknown;
  unusualConfusion: YesNoUnknown;
  distressExpressed: YesNoUnknown;
  conversationEndedNormally: YesNoUnknown;
  doesNotWantToDisturbFamily: YesNoUnknown;
  otherAttentionSignal: YesNoUnknown;
  attentionRequired: YesNoUnknown;
  attentionReasons: AttentionReason[];
  confidence: Confidence;
}

// Near-passthrough (snake_case wire fields -> camelCase internal fields).
export function normalizeCompanionResult(
  result: CompanionStructuredResult
): NormalizedCompanionResult {
  return {
    neutralSummary: result.neutral_summary,
    personReached: result.person_reached,
    explicitHelpRequested: result.explicit_help_requested,
    fallMentioned: result.fall_mentioned,
    mobilityDifficulty: result.mobility_difficulty,
    painOrInjuryMentioned: result.pain_or_injury_mentioned,
    unusualConfusion: result.unusual_confusion,
    distressExpressed: result.distress_expressed,
    conversationEndedNormally: result.conversation_ended_normally,
    doesNotWantToDisturbFamily: result.does_not_want_to_disturb_family,
    otherAttentionSignal: result.other_attention_signal,
    attentionRequired: result.attention_required,
    attentionReasons: result.attention_reasons,
    confidence: result.confidence,
  };
}

// Maps a pre-DEC-011 persisted result onto the current internal shape, so
// historical events keep displaying. Deliberately conservative:
//   * v1's `recommended_attention_level` was a *fall-centric* low/medium/high
//     scale; the current field collapsed to a binary before it shipped
//     (DEC-011, "Priority removed"), so "low" (v1's "nothing unusual") maps to
//     "no" and medium/high both map to "yes" — the same collapse applied going
//     forward, since medium and high never triggered different behaviour either.
//   * fields v1 never collected become "unknown", never "no" — v1's silence is
//     an absence of evidence, not evidence of absence.
export function normalizeLegacyCompanionResult(
  result: LegacyCompanionStructuredResult
): NormalizedCompanionResult {
  const reasons: AttentionReason[] = [];
  if (result.person_requests_help === "yes") reasons.push("explicit_help_request");
  if (result.fall_mentioned === "yes") reasons.push("fall");
  if (result.mobility_difficulty === "yes") reasons.push("mobility_difficulty");
  if (result.unusual_confusion === "yes") reasons.push("unusual_confusion");
  if (result.person_reached === "no") reasons.push("person_not_reached");

  return {
    neutralSummary: result.conversation_summary,
    personReached: result.person_reached,
    explicitHelpRequested: result.person_requests_help,
    fallMentioned: result.fall_mentioned,
    mobilityDifficulty: result.mobility_difficulty,
    painOrInjuryMentioned: "unknown",
    unusualConfusion: result.unusual_confusion,
    distressExpressed: "unknown",
    // v1 had no notion of an abnormal ending; the closest fact it recorded was
    // an unusually short conversation, which is not the same claim, so this
    // stays "unknown" and the short-conversation fact is not silently upgraded.
    conversationEndedNormally: "unknown",
    doesNotWantToDisturbFamily: result.person_does_not_want_to_disturb_family,
    otherAttentionSignal: "unknown",
    attentionRequired: result.recommended_attention_level === "low" ? "no" : "yes",
    attentionReasons: reasons,
    confidence: "low",
  };
}

// The one reader every DISPLAY and historical path should use: accepts the
// current shape, falls back to the pre-DEC-011 shape, and returns null only
// when the value is neither. Never use this to validate a fresh CALL-E result —
// that must go through isCompanionStructuredResult, which refuses v1 outright.
export function readCompanionResult(value: unknown): NormalizedCompanionResult | null {
  if (isCompanionStructuredResult(value)) return normalizeCompanionResult(value);
  if (isLegacyCompanionStructuredResult(value)) return normalizeLegacyCompanionResult(value);
  return null;
}
