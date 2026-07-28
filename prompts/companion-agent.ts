import type { VulnerablePerson } from "@/lib/database/types";

const COGNITIVE_FRIENDLY_GUIDANCE =
  "The person may have mild cognitive difficulties. Use short sentences, ask one question at a time, allow repetition, and never say things like \"don't you remember\".";

const SPEECH_DIFFICULTY_GUIDANCE =
  "The person may have difficulty speaking. Leave longer pauses, do not interrupt, and confirm what you understood before moving on.";

const STANDARD_GUIDANCE =
  "Keep the conversation warm and open-ended, referencing what they told you last time where relevant.";

function guidanceForProfile(conversationProfile: string): string {
  if (conversationProfile === "cognitive_friendly") return COGNITIVE_FRIENDLY_GUIDANCE;
  if (conversationProfile === "speech_difficulty") return SPEECH_DIFFICULTY_GUIDANCE;
  return STANDARD_GUIDANCE;
}

// Builds the natural-language `task` sent to CALL-E for a Companion check-in
// call, per PRODUCT_SPECIFICATION.md §9.1 (behavior) and §7.2 (familiar
// presence), and §17.2 (must identify itself as an automated assistant).
export function buildCompanionTask(person: VulnerablePerson): string {
  const interestsLine =
    person.interests.length > 0
      ? ` They have previously mentioned interest in: ${person.interests.join(", ")}.`
      : "";

  return [
    `Call ${person.firstName} for a regular, friendly check-in on behalf of KinCall.`,
    "Introduce yourself clearly as KinCall, an automated assistant — do not claim to be a family member, a doctor, a nurse, or a human operator.",
    `Start the conversation naturally rather than as a checklist of questions.${interestsLine}`,
    guidanceForProfile(person.conversationProfile),
    "Listen for whether they mention a recent fall, an injury, or difficulty moving around, and whether they would rather not disturb their family with what they've told you.",
    `If you reach voicemail, an answering machine, or anyone other than ${person.firstName}, leave a short message saying KinCall called for a check-in and will try again — do not ask any wellbeing questions and do not leave any detail about their situation.`,
    "Do not diagnose any condition and do not give medical advice.",
    "End the call calmly once you have a clear sense of how they are doing.",
  ].join(" ");
}

// Flat categorical result_schema (docs/DECISION_LOG.md DEC-002) — matches
// lib/calle/schemas.ts's CompanionStructuredResult field-for-field.
// Hand-written literal: CALL-E's result_schema does not support $ref.
export const companionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "conversation_summary",
    "person_reached",
    "fall_mentioned",
    "mobility_difficulty",
    "person_requests_help",
    "person_does_not_want_to_disturb_family",
    "conversation_shorter_than_usual",
    "unusual_confusion",
    "recommended_attention_level",
  ],
  properties: {
    conversation_summary: {
      type: "string",
      description: "One or two sentence neutral summary of what was discussed.",
    },
    person_reached: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes only if you had a two-way conversation with the person themselves. Use no if you reached voicemail, an answering machine, or somebody other than the person. Use unknown if you cannot tell whether the person themselves was on the line.",
    },
    fall_mentioned: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes only if the person explicitly described a fall. Use unknown if the evidence is unclear.",
    },
    mobility_difficulty: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Use yes if the person described difficulty walking or moving today.",
    },
    person_requests_help: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes if the person explicitly asked for help or for someone to be contacted.",
    },
    person_does_not_want_to_disturb_family: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes if the person said or implied they did not want to bother their family.",
    },
    conversation_shorter_than_usual: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Use yes if this conversation was notably shorter than a typical check-in.",
    },
    unusual_confusion: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes if the person seemed unusually confused or disoriented compared to a typical call.",
    },
    recommended_attention_level: {
      type: "string",
      enum: ["low", "medium", "high"],
      description:
        "Use high when a fall and mobility difficulty are both present, medium for a fall mentioned alone, low otherwise.",
    },
  },
} as const;
