// Companion shape is CALL-E's flat categorical result_schema (Phase 3 DEC-002),
// not PRODUCT_SPECIFICATION.md §9.1's nested signals[] array verbatim — see
// docs/DECISION_LOG.md DEC-002 for why. Family shape still matches §9.3 verbatim.
// Hand-written guards on purpose: no zod/validation library beyond the frozen stack.

export type YesNoUnknown = "yes" | "no" | "unknown";
export type AttentionLevel = "low" | "medium" | "high";

export interface CompanionStructuredResult {
  conversation_summary: string;
  fall_mentioned: YesNoUnknown;
  mobility_difficulty: YesNoUnknown;
  person_requests_help: YesNoUnknown;
  person_does_not_want_to_disturb_family: YesNoUnknown;
  conversation_shorter_than_usual: YesNoUnknown;
  unusual_confusion: YesNoUnknown;
  recommended_attention_level: AttentionLevel;
}

export interface FamilyStructuredResult {
  contact_id: string;
  answered: boolean;
  situation_understood: boolean;
  can_intervene: boolean;
  intervention_type: "visit" | "call" | "other" | null;
  estimated_time: string | null;
  contact_next_person: boolean;
  summary: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isYesNoUnknown(value: unknown): value is YesNoUnknown {
  return value === "yes" || value === "no" || value === "unknown";
}

export function isCompanionStructuredResult(value: unknown): value is CompanionStructuredResult {
  if (!isRecord(value)) return false;
  if (typeof value.conversation_summary !== "string") return false;
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
  if (typeof value.answered !== "boolean") return false;
  if (typeof value.situation_understood !== "boolean") return false;
  if (typeof value.can_intervene !== "boolean") return false;
  if (
    value.intervention_type !== null &&
    value.intervention_type !== "visit" &&
    value.intervention_type !== "call" &&
    value.intervention_type !== "other"
  ) {
    return false;
  }
  if (value.estimated_time !== null && typeof value.estimated_time !== "string") return false;
  if (typeof value.contact_next_person !== "boolean") return false;
  if (typeof value.summary !== "string") return false;
  return true;
}

export interface NormalizedCompanionResult {
  fallMentioned: YesNoUnknown;
  mobilityDifficulty: YesNoUnknown;
  personRequestsHelp: YesNoUnknown;
  doesNotWantToDisturbFamily: YesNoUnknown;
  conversationShorterThanUsual: YesNoUnknown;
  unusualConfusion: YesNoUnknown;
  attentionLevel: AttentionLevel;
}

// Near-passthrough (snake_case wire fields -> camelCase internal fields).
// Carries every field through even though decideCompanionAction only
// branches on fallMentioned/mobilityDifficulty today — nothing is silently
// discarded at this layer.
export function normalizeCompanionResult(
  result: CompanionStructuredResult
): NormalizedCompanionResult {
  return {
    fallMentioned: result.fall_mentioned,
    mobilityDifficulty: result.mobility_difficulty,
    personRequestsHelp: result.person_requests_help,
    doesNotWantToDisturbFamily: result.person_does_not_want_to_disturb_family,
    conversationShorterThanUsual: result.conversation_shorter_than_usual,
    unusualConfusion: result.unusual_confusion,
    attentionLevel: result.recommended_attention_level,
  };
}
