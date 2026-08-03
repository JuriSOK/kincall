import type { FamilyStructuredResult } from "../calle/schemas";

// What became of a voicemail on one unanswered trusted-contact call (DEC-011).
//
// The distinction that matters is between "no message was left" and "we cannot
// establish that a message was left". CALL-E's API cannot confirm a voicemail at
// all (see LiveCalleAdapter.capabilities), so `unavailable` is the honest outcome
// in live mode, and KinCall must never render it as though a message had been
// left (§7.5).
export type VoicemailOutcome =
  // Not the final attempt to this contact, so no voicemail was even attempted —
  // one more live attempt is still owed.
  | { kind: "not_attempted" }
  // The integration cannot leave and confirm a voicemail. Recorded verbatim as
  // `voicemail_unavailable`, and no message is claimed.
  | { kind: "unavailable" }
  // The agent reported leaving the fixed privacy-preserving message, AND the
  // integration is one that can confirm it.
  | { kind: "left" }
  // Voicemail was possible and attempted, but no message was left (or the agent
  // could not tell).
  | { kind: "not_left" };

export interface VoicemailContext {
  // From CalleAdapter.capabilities.voicemail: whether this integration can BOTH
  // leave a voicemail and confirm through a structured result that it did.
  supported: boolean;
  attemptNumber: number;
  maxAttempts: number;
}

// Deliberately requires BOTH the integration's capability and the agent's own
// report before concluding a message was left. A model self-report alone is not
// evidence: the agent could claim a voicemail on a platform that cannot leave one.
export function classifyVoicemail(
  result: Pick<FamilyStructuredResult, "voicemail_left"> | null,
  context: VoicemailContext
): VoicemailOutcome {
  if (context.attemptNumber < context.maxAttempts) return { kind: "not_attempted" };
  if (!context.supported) return { kind: "unavailable" };
  return result?.voicemail_left === "yes" ? { kind: "left" } : { kind: "not_left" };
}

// The timeline wording. `voicemail_unavailable` appears verbatim so the recorded
// reason is greppable and unambiguous, rather than paraphrased into something
// that could be misread as "a message was left".
export function describeVoicemailOutcome(outcome: VoicemailOutcome): string {
  switch (outcome.kind) {
    case "not_attempted":
      return "No voicemail attempted — one more attempt is owed";
    case "unavailable":
      return "voicemail_unavailable — no message was left";
    case "left":
      return "Voicemail left";
    case "not_left":
      return "No voicemail left";
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

// Display classification from the PERSISTED result alone, for the event page,
// which has no adapter to ask about capabilities.
//
// Deliberately conservative in one direction only: it says "Left" exclusively
// when the stored result actually claims a voicemail, and otherwise says no
// message was left. It can therefore under-report the *reason* (an unsupported
// integration shows as "None left" rather than "Unavailable"), but it can never
// claim a message that was not left. The precise `voicemail_unavailable` reason
// is on the timeline, written at the time by classifyVoicemail.
export function describeVoicemailFromResult(
  result: Pick<FamilyStructuredResult, "voicemail_left"> | null,
  attemptNumber: number,
  maxAttempts: number
): string {
  if (attemptNumber < maxAttempts) return "Not attempted";
  return result?.voicemail_left === "yes" ? "Left" : "None left";
}
