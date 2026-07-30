import type { VulnerablePerson } from "@/lib/database/types";
import { ATTENTION_REASONS } from "@/lib/calle/schemas";

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
//
// DEC-011 broadened this from listening for falls specifically to listening for
// any non-medical signal that somebody should check in, and added a short set of
// NEUTRAL clarification questions. Deliberately not a symptom questionnaire:
// every question is about what the person wants and what happened, never about
// symptoms, severity or a condition, because KinCall must never diagnose or
// triage (CLAUDE.md safety rules, §9.1's "il ne peut pas poser un diagnostic").
export function buildCompanionTask(person: VulnerablePerson): string {
  const interestsLine =
    person.interests.length > 0
      ? ` They have previously mentioned interest in: ${person.interests.join(", ")}.`
      : "";

  return [
    `Call ${person.firstName} for a regular, friendly check-in on behalf of KinCall.`,
    "Introduce yourself clearly as KinCall, an automated assistant — do not claim to be a family member, a doctor, a nurse, an emergency operator or a human service.",
    `Start the conversation naturally rather than as a checklist of questions.${interestsLine}`,
    guidanceForProfile(person.conversationProfile),
    // §7.1: the conversation comes before the questionnaire. The signals below
    // are what to LISTEN for, not a script to read out.
    "Listen for anything suggesting someone close to them should check in today: a fall, pain or an injury, difficulty moving around, confusion, distress or worry, or any other unusual event they describe.",
    "If something unclear comes up, you may ask a few short, neutral clarification questions, one at a time — for example whether something unusual happened, whether they can move around as they normally do, whether anyone is with them right now, and whether they would like you to let someone in their trusted circle know.",
    "Do not ask about symptoms, do not ask them to rate anything, and do not work through a medical checklist. You are finding out what they said happened and what they want, nothing more.",
    "Do not diagnose any condition, do not assess how serious anything is, and do not give medical or treatment advice.",
    // §17.2 + the standing safety boundary: KinCall reaches a trusted circle,
    // never an emergency service, and must never imply otherwise.
    "You are not an emergency service and you must never say or imply that you will contact one. If they may be in immediate danger, tell them plainly to contact their local emergency number themselves, or to ask someone with them to do it.",
    "Never promise that a specific person will visit or call — you can only say that KinCall will try to let their trusted circle know.",
    `If you reach voicemail, an answering machine, or anyone other than ${person.firstName}, leave a short message saying KinCall called for a check-in and will try again — do not ask any wellbeing questions and do not leave any detail about their situation.`,
    "End the call calmly once you have a clear sense of how they are doing.",
  ].join(" ");
}

// Flat categorical result_schema (docs/DECISION_LOG.md DEC-002, widened by
// DEC-011) — matches lib/calle/schemas.ts's CompanionStructuredResult
// field-for-field. Hand-written literal: CALL-E's result_schema has no $ref.
export const companionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "neutral_summary",
    "person_reached",
    "explicit_help_requested",
    "fall_mentioned",
    "mobility_difficulty",
    "pain_or_injury_mentioned",
    "unusual_confusion",
    "distress_expressed",
    "conversation_ended_normally",
    "does_not_want_to_disturb_family",
    "other_attention_signal",
    "attention_required",
    "attention_reasons",
    "confidence",
  ],
  properties: {
    neutral_summary: {
      type: "string",
      description:
        "One or two neutral sentences describing what the person actually said. " +
        "Report it as something they said or indicated, never as a diagnosis, a cause or a certainty.",
    },
    person_reached: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes only if you had a two-way conversation with the person themselves. Use no if you reached voicemail, an answering machine, or somebody other than the person. Use unknown if you cannot tell whether the person themselves was on the line.",
    },
    explicit_help_requested: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes ONLY if the person explicitly asked for help, or explicitly asked that someone be contacted. " +
        "Never infer this from hesitancy, silence or worry — if they did not actually ask, this is no.",
    },
    fall_mentioned: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes only if the person described a fall. Use unknown if the evidence is unclear.",
    },
    mobility_difficulty: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Use yes if the person described difficulty walking or moving around today.",
    },
    pain_or_injury_mentioned: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes if the person said they are in pain or described an injury. " +
        "Report only that they said it — do not judge how severe it is and do not name a condition.",
    },
    unusual_confusion: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes if the person seemed unusually confused or disoriented compared to a typical call.",
    },
    distress_expressed: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes if the person expressed distress, fear, or that they are struggling or not coping. " +
        "This is about what they expressed, not a judgement about their mental health.",
    },
    conversation_ended_normally: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes if the call ended calmly and normally. Use no if it was cut off, abandoned mid-sentence, or the person stopped responding. Use unknown if you cannot tell.",
    },
    does_not_want_to_disturb_family: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes if the person said or implied they did not want to bother their family.",
    },
    other_attention_signal: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Use yes if the person described some other unusual event or situation that suggests someone should check in, which none of the fields above cover.",
    },
    attention_required: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description:
        "Whether someone in their trusted circle should check in on them — NOT a medical assessment and NOT a severity rating, just an operational yes or no. " +
        "Use no only if nothing came up suggesting anyone should check in. " +
        "Use yes if anything did, however minor it seemed. " +
        "Use unknown if you genuinely cannot judge.",
    },
    attention_reasons: {
      type: "array",
      description:
        "Why attention is warranted, using only these codes. Return an empty array when attention_required is no.",
      items: { type: "string", enum: [...ATTENTION_REASONS] },
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description:
        "How confident you are in this report overall. Use low if the line was poor or the person was hard to follow.",
    },
  },
} as const;
