import type { VulnerablePerson } from "@/shared/domain/types";

// The informational callback to the monitored person, after the trusted-circle
// outcome is settled (docs/DECISION_LOG.md DEC-023).
//
// This call ASKS NOTHING and DECIDES NOTHING. It exists so the person is not
// left wondering what happened after KinCall said it would try their circle.
// The whole message is composed upstream by
// backend/agents/notification/message.ts from persisted, validated
// facts, and passed here already written — the agent's job is to say it
// naturally, once, and hang up.
//
// Deliberately NOT a check-in: it must never collect a wellbeing signal, never
// produce an attention decision, and never lead anywhere. Whatever happens on
// this call, the event proceeds to the terminal status the cascade already
// earned.

export function buildPersonNotificationTask(
  person: VulnerablePerson,
  // The full message, already composed and already safe. Passed as one string
  // rather than as facts so there is exactly one place that decides wording,
  // and so the agent has nothing to assemble or infer.
  message: string
): string {
  return [
    `Call ${person.firstName} on behalf of KinCall to pass on one piece of news. This is not a check-in: you are not asking how they are.`,
    "Introduce yourself immediately and clearly as KinCall, an automated assistant — do not claim to be a family member, a doctor, a nurse, an emergency operator or any human service.",
    `Say that you are calling to let them know what happened after your earlier call, then tell them exactly this: ${message}`,
    "Say it once, in your own natural words, without adding, guessing at or embellishing any detail it does not contain.",
    // The single most important boundary on this call: a recorded intention is
    // not a completed action (§7.5).
    "Do not say that anything has already been done, do not say the matter is resolved, and do not say they are safe or fine.",
    "Do not diagnose anything, do not say how serious anything is, and do not give medical or treatment advice.",
    "If they ask a question, answer only from what you have just told them. If you do not know, say plainly that you do not have that detail — never guess, and never invent a name, a time or a reason.",
    // KinCall is finished with this event after this call, and must not imply
    // otherwise: there is no retry, no further cascade and no scheduled
    // follow-up (DEC-023).
    "Do not promise that anything further will happen, do not offer to call anyone else, and do not ask them to wait for KinCall to try again.",
    "You are not an emergency service and KinCall does not contact emergency services. If they ask, say so plainly and tell them to contact their local emergency number themselves if they believe it is needed.",
    "Never describe an internal field name, a code, or a data format — speak only in ordinary language.",
    // Same bounded-ending rule the Companion prompt gained after a live test
    // saw an introduction repeated into a voicemail (DEC-022).
    "Say the message once. Do not repeat it, and do not start the call again from the beginning.",
    `If nobody replies to you — silence, a recorded greeting, or only your own voice — say at most one short closing line and end the call. Do not keep talking and do not wait for a reply that is not coming.`,
    "End the call politely as soon as the message has been given.",
  ].join(" ");
}

// A minimal result: the ONLY thing KinCall wants back is whether the message
// actually reached the person. Nothing here can change the accepting contact,
// the decision, the cascade outcome or the terminal status — those were all
// settled before this call was placed, and DEC-023 forbids this call from
// touching any of them.
//
// Both fields are total (no nulls, no optionals) for the same reason DEC-005
// made the Family schema total: a call that reached voicemail must still
// produce a schema-valid result rather than a malformed one.
export function buildPersonNotificationResultSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["person_reached", "message_delivered", "summary"],
    properties: {
      person_reached: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "Use yes only if you actually spoke with the person themselves. Use no if you reached voicemail, an answering machine, or somebody else. Use unknown if you cannot tell who was on the line.",
      },
      message_delivered: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "Use yes ONLY if you said the whole message to the person themselves. Use no if you did not get to say it. Use unknown if you are not sure it was heard.",
      },
      summary: {
        type: "string",
        description:
          "One neutral sentence describing how the call went. Do not repeat the message back, and do not add anything the person did not say.",
      },
    },
  } as const;
}
