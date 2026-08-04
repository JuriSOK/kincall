import type { TrustedContact, VulnerablePerson } from "@/shared/domain/types";

// Builds the natural-language `task` sent to CALL-E for a Family Agent call,
// per PRODUCT_SPECIFICATION.md §9.3 (direct, factual, calm, decision-oriented
// — deliberately not a long conversation), §17.2 (must identify itself as an
// automated assistant) and §17.3 (transmit only what is necessary).
//
// `informationToShare` is the complete set of facts this call may mention. It
// is chosen deterministically by the orchestrator from the validated Companion
// result — the agent must not add anything from the original conversation.
//
// The contact's phone number is never written into the task text: it belongs in
// the CALL-E request's `recipients[].phones` only (CLAUDE.md safety rules).
// The exact wording a voicemail may contain, and nothing more (DEC-011, §17.3).
// Deliberately says less than the live conversation does: a recording can be
// heard by anyone in the household, replayed later, or kept indefinitely, so it
// carries NO incident detail, NO health detail, no interpretation, not the
// vulnerable person's name, and not any other trusted contact's identity —
// "the next person in their trusted circle" names nobody.
export const VOICEMAIL_MESSAGE =
  "KinCall tried to reach you regarding a loved one. " +
  "We will now try the next person in their trusted circle. " +
  "Please consult KinCall for more information.";

export interface FamilyCallAttemptOptions {
  // 1 for the first call to this contact, 2 for the bounded retry.
  attemptNumber: number;
  // Set by the orchestrator only on the FINAL attempt AND only when the CALL-E
  // integration genuinely supports voicemail (CalleAdapter.capabilities).
  mayLeaveVoicemail: boolean;
}

export function buildFamilyTask(
  person: VulnerablePerson,
  contact: TrustedContact,
  informationToShare: string[],
  options: FamilyCallAttemptOptions = { attemptNumber: 1, mayLeaveVoicemail: false },
  // DEC-022: one already-attributed sentence describing WHY KinCall is calling,
  // built by src/backend/agents/family/context-brief.ts from the Companion
  // result's own `neutral_summary`. Optional, and an absent/blank brief renders
  // exactly the prompt this function produced before it existed — a live test
  // showed that the categorical facts alone ("asked for help") cannot express
  // WHAT the person asked for, which is the single thing a relative needs to
  // decide whether they can help.
  contextBrief?: string
): string {
  const facts =
    informationToShare.length > 0
      ? informationToShare.map((fact) => `- ${fact}`).join("\n")
      : "- no specific detail was recorded";

  const brief = contextBrief?.trim();

  // The brief is presented as the situation, and the categorical facts as the
  // signals recorded alongside it — two different kinds of statement, so the
  // agent is never left to guess which to lead with.
  const situationLines = brief
    ? [
        `Explain briefly why you are calling, using exactly this: ${brief}`,
        "Say that in your own natural words without adding, guessing at, or embellishing any detail it does not contain — in particular do not invent a cause, a diagnosis, or a level of urgency.",
        `These are the only other facts the check-in established about ${person.firstName}, and you may mention them if they are relevant:`,
      ]
    : [`Explain that you have just spoken with ${person.firstName}, and share only these facts:`];

  // Two mutually exclusive instructions, never both: either leave the fixed
  // message, or leave nothing at all. Never a paraphrase, and never the facts
  // above — those are for a live conversation only.
  const voicemailInstruction = options.mayLeaveVoicemail
    ? `If you reach voicemail or an answering machine, leave exactly this message and nothing else: "${VOICEMAIL_MESSAGE}" ` +
      "Do not mention a fall, an injury, health, or any detail of the situation, do not name the person you are calling about, and do not name anyone else in the trusted circle."
    : "If you reach voicemail or an answering machine, do not leave any message at all and end the call — KinCall will try someone else.";

  return [
    `Call ${contact.firstName}, who is the ${contact.relationship} of ${person.firstName}, on behalf of KinCall.`,
    "Introduce yourself immediately and clearly as KinCall, an automated assistant that regularly checks in on " +
      `${person.firstName} — do not claim to be a family member, a doctor, a nurse, an emergency operator or any human service.`,
    "Be brief, factual and calm. This is not a long conversation: the goal is to share the situation and find out whether they can help today.",
    ...situationLines,
    facts,
    "Report each fact as something the person said or indicated, never as a diagnosis or a certainty. " +
      `For example say "${person.firstName} told me she is having difficulty walking", not "${person.firstName} cannot walk".`,
    // Rewritten for DEC-022: the old blanket "do not repeat the rest of the
    // conversation" was written when the facts list was the only content, and
    // would have suppressed the brief itself. The boundary that actually
    // matters is unchanged — nothing beyond what is written above.
    "Beyond what is written above, do not repeat anything else from that conversation, do not speculate about causes, do not give medical advice, and do not promise that anyone will intervene.",
    "Never describe an internal field name, a code, or a data format — speak only in ordinary language.",
    // §7.5: KinCall never asserts safety, and never claims an action happened.
    `Do not say that ${person.firstName} is safe or fine, do not exaggerate how urgent this is, and do not claim that KinCall has already done anything beyond making these calls.`,
    `Then ask clearly whether they are able to check on ${person.firstName} today, for example by visiting or by calling her.`,
    "If they have not understood the situation, ask one short clarifying question and then move on — do not re-explain repeatedly.",
    "Before ending, make sure you have a clear yes or no about whether they can help today; if they stay vague or non-committal, record that as unknown rather than assuming either answer.",
    "If they can, find out what they intend to do and roughly at what time. If they cannot, ask whether you should contact the next person in the trusted circle.",
    // KinCall reaches a trusted circle, never an emergency service, and must
    // never let a relative believe otherwise (§9.4's Limite critique).
    "You are not an emergency service and KinCall does not contact emergency services. If they ask, say so plainly and tell them to contact their local emergency number themselves if they believe it is needed.",
    voicemailInstruction,
    "End the call politely as soon as you have a clear answer.",
  ].join(" ");
}

// Categorical result_schema (docs/DECISION_LOG.md DEC-005) — matches
// src/backend/integrations/calle/schemas.ts's FamilyStructuredResult field-for-field.
// Hand-written literal: CALL-E's result_schema supports no $ref and no null,
// hence the "other"/"" sentinels rather than nullable fields.
export function buildFamilyResultSchema(contactId: string) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "contact_id",
      "answered",
      "situation_understood",
      "can_intervene",
      "intervention_type",
      "estimated_time",
      "contact_next_person",
      "summary",
      "voicemail_left",
    ],
    properties: {
      contact_id: {
        type: "string",
        description:
          `Always return exactly this identifier, copied verbatim: "${contactId}". ` +
          "Never substitute the person's name, a phone number, or any other identifier.",
      },
      answered: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "Use yes only if the person themselves answered and spoke with you. Use no for voicemail, an answering machine, or no pick-up. Use unknown if you cannot tell.",
      },
      situation_understood: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "Use yes if they acknowledged understanding what you told them about the situation. Use unknown if it was not clear.",
      },
      can_intervene: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "Use yes ONLY if they clearly committed to checking on the person today. Use no if they clearly said they cannot. " +
          "Use unknown for anything vague, conditional or non-committal such as 'maybe', 'I'll try' or 'I'll see' — do not guess yes.",
      },
      intervention_type: {
        type: "string",
        enum: ["visit", "call", "other"],
        description:
          "How they said they would check in: visit if they will go in person, call if they will telephone. " +
          "Use other when no intervention applies, including when nobody answered or they declined. Never leave this empty.",
      },
      estimated_time: {
        type: "string",
        description:
          "The time they said they would check in, as they said it (for example \"17:30\" or \"this evening\"). " +
          "Return an empty string when no time is known, including when nobody answered or they declined. Never return null.",
      },
      contact_next_person: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "Use yes if they explicitly asked that someone else in the trusted circle be contacted instead. Use unknown if it did not come up.",
      },
      summary: {
        type: "string",
        description:
          "One or two neutral sentences describing what this contact said and what they agreed to do.",
      },
      voicemail_left: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "Use yes ONLY if you actually left the voicemail message you were instructed to leave. " +
          "Use no if you left no message, including when the person answered. Use unknown if you cannot tell.",
      },
    },
  } as const;
}
