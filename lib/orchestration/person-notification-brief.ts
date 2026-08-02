import type { FamilyStructuredResult } from "../calle/schemas";

// What KinCall tells the monitored person once the trusted-circle outcome is
// settled (docs/DECISION_LOG.md DEC-023).
//
// Pure and total: it takes already-persisted, already-validated facts and
// returns sentences. It reads no clock, no database and no environment, so a
// replaying worker produces byte-identical wording — which matters, because
// this text is what a real person hears.
//
// WHAT IT MAY NEVER SAY
//
//   * that the contact has ALREADY visited or called — the commitment is a
//     future intention KinCall recorded, never an action it observed (§7.5);
//   * that KinCall verified anything, or that the person is safe or fine;
//   * "nobody answered" on the unresolved path — contacts may well have
//     answered and declined, and saying otherwise would be false;
//   * any diagnosis, severity, or medical framing;
//   * an internal enum, field name, contact id, or phone number.
//
// It also hardcodes no situation: the optional context sentence is the same
// factual brief the Family calls used (lib/orchestration/family-context-brief.ts),
// which is the person's own reported words rather than a lookup.

export interface ConfirmedNotificationFacts {
  kind: "confirmed";
  personName: string;
  contactName: string;
  // Free text as the contact said it ("this afternoon", "17:30"), never parsed
  // into a time and never compared against a clock. Empty means not stated.
  estimatedTime: string;
  interventionType: FamilyStructuredResult["intervention_type"];
  // The contact's own persisted summary. Used only for the "other" action,
  // where there is no verb to state — never as a substitute for the outcome.
  contactSummary: string;
}

export interface UnresolvedNotificationFacts {
  kind: "unresolved";
  personName: string;
}

export type NotificationFacts = ConfirmedNotificationFacts | UnresolvedNotificationFacts;

export interface PersonNotificationBrief {
  // The outcome, in one sentence. This is the thing being communicated.
  outcome: string;
  // What the person can do next. Present only on the unresolved path, where
  // there IS something for them to do — never on the confirmed path, where
  // suggesting an action would undercut the commitment just reported.
  guidance: string | null;
  // One factual sentence recalling what this was about, appended only when a
  // specific context exists. Never invented.
  context: string | null;
  // The three above, joined — what the prompt actually renders.
  message: string;
}

// Adds "at" only in front of something that reads as a clock time ("17:30",
// "6pm", "18h00") and does not already carry its own preposition or qualifier.
// "this afternoon" and "dans l'après-midi" are already adverbial and must not
// become "at this afternoon". Grammar only — nothing here parses a time or
// reasons about when it is.
const CLOCK_LIKE = /^\d{1,2}\s*(?:[:h.]\s*\d{2})?\s*(?:am|pm)?$/i;

function withTimePreposition(estimatedTime: string): string {
  const trimmed = estimatedTime.trim();
  if (trimmed.length === 0) return "";
  return CLOCK_LIKE.test(trimmed) ? ` at ${trimmed}` : ` ${trimmed}`;
}

// The future-tense verb for each intervention type. "other" deliberately has no
// verb: KinCall was not told what the contact intends to do, so it says only
// that they can help, rather than guessing at an action.
function confirmedOutcome(facts: ConfirmedNotificationFacts): string {
  const when = withTimePreposition(facts.estimatedTime);

  switch (facts.interventionType) {
    case "visit":
      return when
        ? `${facts.contactName} confirmed that they will visit you${when}.`
        : `${facts.contactName} confirmed that they will come and see you.`;
    case "call":
      return when
        ? `${facts.contactName} confirmed that they will call you${when}.`
        : `${facts.contactName} confirmed that they will call you.`;
    case "other":
    default:
      // No stated action. The contact's own summary is the most specific true
      // thing available, and it is theirs rather than KinCall's invention.
      return facts.contactSummary.trim().length > 0
        ? `${facts.contactName} confirmed that they can help. They said: ${terminated(facts.contactSummary.trim())}`
        : `${facts.contactName} confirmed that they can help with the situation you described.`;
  }
}

function terminated(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

// `contextBrief` is the SAME sentence the Family calls carried
// (family-context-brief.ts), passed through so the person hears the situation
// described the way their contacts heard it. Optional: only appended when the
// brief is specific, because a generic fallback adds nothing here and would
// pad the message a person is listening to on the phone.
export function buildPersonNotificationBrief(
  facts: NotificationFacts,
  contextSentence: string | null
): PersonNotificationBrief {
  const context = contextSentence?.trim() ? terminated(contextSentence.trim()) : null;

  if (facts.kind === "unresolved") {
    // Deliberately "confirmed that they were available", never "nobody
    // answered": on this path some contacts may have answered and declined,
    // and some may not have answered at all. The only thing true of all of
    // them is that none committed.
    const outcome = `Nobody in your trusted circle confirmed that they were available.`;
    const guidance = `If you still need help, please contact another person you trust directly.`;
    return {
      outcome,
      guidance,
      context,
      message: [outcome, guidance, context].filter(Boolean).join(" "),
    };
  }

  const outcome = confirmedOutcome(facts);
  return {
    outcome,
    guidance: null,
    context,
    message: [outcome, context].filter(Boolean).join(" "),
  };
}
