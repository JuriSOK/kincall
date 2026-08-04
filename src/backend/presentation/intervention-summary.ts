import type { FamilyStructuredResult } from "@/backend/integrations/calle/schemas";
import type { CallEventRecord, EventRecord, TrustedContact } from "@/shared/domain/types";
import { findConfirmation } from "./event-summary";

// Stage F (docs/DECISION_LOG.md DEC-019): the ONE place a confirmed
// trusted-contact intervention is turned into display text. Every screen that
// mentions an intervention — the event page's card, the dashboard's recent
// activity, the person page's latest event, the history list — reads from
// this module, so the same event can never be described two different ways.
//
// This is presentation of ALREADY PERSISTED data. It computes nothing new,
// writes nothing, and adds no workflow state: a confirmation still ends the
// event at CASE_CLOSED exactly as DEC-005/DEC-011 left it. In particular this
// module NEVER claims the intervention actually happened — KinCall records a
// commitment somebody made on a call and has no way to observe what followed
// (see VERIFICATION_DISCLAIMER, which every caller must render alongside the
// card).
//
// Route components must never interpret a raw FamilyStructuredResult
// themselves; that is exactly what this module exists to prevent.

// Fixed, non-negotiable, and returned on every confirmed summary — never
// conditional, never abbreviated by a caller. §7.5/§17.6: KinCall must not
// assert that anyone is safe or that anything was done.
export const VERIFICATION_DISCLAIMER =
  "KinCall recorded this commitment but has not verified that the action took place.";

// Which display-relevant facts a historical result simply did not carry, so
// the interface can be honest about a gap instead of inventing a value for
// it. Deliberately human-readable: these strings are shown, not switched on.
export type MissingInterventionField =
  | "the planned action"
  | "an estimated time"
  | "the accepting contact's record";

export interface InterventionSummary {
  // ── Who accepted ────────────────────────────────────────────────────────
  // Always a safe display name: the stored first name when the contact record
  // still resolves, otherwise neutral wording. NEVER a phone number and never
  // an internal contact id (a contact id is not a name — showing one would
  // leak an internal identifier into a family member's view).
  contactName: string;
  // False when the contact record could not be resolved at all. The summary is
  // still valid — KinCall genuinely recorded a confirmed call — but nothing
  // about who accepted can be shown beyond neutral wording.
  contactKnown: boolean;
  // The stored free-text relationship ("daughter", "son"), when the contact
  // record resolves and carries one. Null otherwise — never guessed.
  relationship: string | null;
  // A single-letter fallback mark for a contact, since trusted contacts have
  // no avatar system (only vulnerable_people do, per DEC-015) and Stage F adds
  // no migration to give them one. Purely decorative: the name is always
  // rendered as text beside it, so callers hide this from assistive
  // technology rather than announcing a letter twice.
  initials: string;
  // A neutral note when the accepting contact has since been disabled or
  // archived — historical resolution keeps working (DEC-009), and the note
  // explains the state without implying anything about the intervention
  // itself. Null when the contact is still an ordinary active contact.
  contactStateNote: string | null;

  // ── What they committed to ──────────────────────────────────────────────
  // Plain language, never a raw enum: "Will visit", "Will call", or the
  // neutral "Confirmed they would help" when the type is `other` or absent.
  action: string;
  // False when the stored type was `other` or missing, i.e. when `action`
  // above is the neutral fallback rather than a specific commitment.
  actionKnown: boolean;
  // The stored free text, with a preposition added only where grammar needs
  // one ("17:30" -> "at 17:30"); null when none was supplied. Never parsed
  // into a timestamp, never turned into an appointment — see
  // withTimePreposition below.
  estimatedTimeText: string | null;

  // ── Ready-to-render sentences ───────────────────────────────────────────
  // One line, for a dashboard row or a person page: "Marc will visit at 17:30."
  concise: string;
  // A fuller sentence for the event page's own card, including the
  // relationship when one is known.
  detailed: string;
  // What the contact actually said, verbatim from the persisted result. May be
  // an empty string on a sparse historical record; callers check before
  // rendering a "what they said" line.
  contactSummary: string;

  disclaimer: typeof VERIFICATION_DISCLAIMER;
  // Empty when the record carried everything. Non-empty lists exactly which
  // facts are absent, so the interface can say so plainly.
  missingFields: MissingInterventionField[];
}

// Clock-like openings that read wrong without "at": "17:30", "5pm", "18h00".
// Deliberately a GRAMMAR test, not a parse — nothing is converted to a Date,
// no timestamp is stored, and no lateness is ever computed from it. A string
// this does not match is rendered exactly as supplied.
const CLOCK_LIKE = /^\d{1,2}\s*(?::\d{2}|h\d{0,2}|\s*[ap]\.?m\.?)/i;

// Openings that already carry their own preposition or qualifier, in either
// of the languages CALL-E may answer in. Prefixing "at" here would produce
// "at around 6pm" / "at vers 18h00" — see src/backend/orchestration/engine.ts's own
// note about estimated_time being verbatim model wording.
const ALREADY_PREPOSITIONED =
  /^(at|around|about|by|before|after|within|in|this|tomorrow|tonight|later|vers|avant|apr[èe]s|dans|d'ici|ce|cette|demain)\b/i;

// Adds a preposition only when the free text needs one to read as a sentence.
// The stored value's own meaning is never altered, reordered or reinterpreted.
export function withTimePreposition(estimatedTime: string): string {
  const trimmed = estimatedTime.trim();
  if (trimmed.length === 0) return "";
  if (ALREADY_PREPOSITIONED.test(trimmed)) return trimmed;
  if (CLOCK_LIKE.test(trimmed)) return `at ${trimmed}`;
  // Anything else — an unusual historical value, a phrase in another shape —
  // is shown exactly as stored rather than guessed at.
  return trimmed;
}

// "Will visit" / "Will call" / neutral. `other` deliberately does NOT try to
// derive a verb from the free-text summary: inferring "visit" from prose is
// exactly the kind of guess that would put a promise in someone's mouth. The
// persisted summary is surfaced separately (contactSummary) so the detail is
// still available without being turned into a claim.
function describeAction(result: FamilyStructuredResult): { action: string; known: boolean } {
  switch (result.intervention_type) {
    case "visit":
      return { action: "Will visit", known: true };
    case "call":
      return { action: "Will call", known: true };
    // `other` is the schema's sentinel, also used by a no-answer result
    // (src/backend/integrations/calle/fake-adapter.ts's noAnswer) — it carries no commitment of its
    // own, so it reads as the neutral fallback.
    case "other":
    default:
      return { action: "Confirmed they would help", known: false };
  }
}

// The verb phrase used inside a one-line sentence ("Marc will visit at
// 17:30."), as opposed to the standalone label above ("Will visit").
function sentenceVerb(result: FamilyStructuredResult): string {
  switch (result.intervention_type) {
    case "visit":
      return "will visit";
    case "call":
      return "will call";
    case "other":
    default:
      return "confirmed they would help";
  }
}

// The reported-speech form, for the event page's fuller sentence ("… told
// KinCall they would visit at 17:30."). Kept as its own mapping rather than
// derived from sentenceVerb by string surgery: rewriting "confirmed they
// would help" into reported speech that way produced "they confirmed they
// would help", which reads as a doubled clause.
function reportedVerb(result: FamilyStructuredResult): string {
  switch (result.intervention_type) {
    case "visit":
      return "would visit";
    case "call":
      return "would call";
    case "other":
    default:
      return "would help";
  }
}

function initialOf(name: string): string {
  const first = name.trim().slice(0, 1).toUpperCase();
  return first.length > 0 ? first : "?";
}

function describeContactState(contact: TrustedContact): string | null {
  // Archived is checked first: archiving also clears `enabled` (DEC-017), so
  // an archived contact would otherwise match both branches and be described
  // by the weaker of the two.
  if (contact.archivedAt !== null) {
    return "This contact has since been removed from the trusted circle.";
  }
  if (!contact.enabled) {
    return "This contact is currently paused in the trusted circle.";
  }
  return null;
}

// Builds the display model for an event's confirmed intervention, or null
// when this event has no valid confirmation.
//
// Returning `null` — rather than a model carrying a `confirmed: false` flag —
// is deliberate and is the safety property this module is built around
// (§5 of the Stage F brief): a caller structurally CANNOT render a
// confirmed-intervention card for an unconfirmed event, because there is no
// model to render. A boolean field would rely on every call site remembering
// to check it. This mirrors findConfirmation's own `Confirmation | null`.
//
// Validity comes entirely from findConfirmation, which requires a FAMILY call
// whose persisted structured result parses AND says `can_intervene === "yes"`.
// So none of the following produce a summary: a CASE_CLOSED event with no
// cascade, a contact who merely answered, a contact record merely existing, an
// `intervention_type` present without confirmation, or a normally-ended
// companion call. ATTENTION_UNRESOLVED cannot produce one either — the
// cascade only reaches it when nobody confirmed.
export function buildInterventionSummary(
  _event: EventRecord,
  callEvents: CallEventRecord[],
  contacts: TrustedContact[]
): InterventionSummary | null {
  const confirmation = findConfirmation(callEvents, contacts);
  if (!confirmation) return null;

  const { contact, result } = confirmation;
  const missingFields: MissingInterventionField[] = [];

  const contactKnown = contact !== undefined;
  const contactName = contact?.firstName ?? "A trusted contact";
  if (!contactKnown) missingFields.push("the accepting contact's record");

  const relationship =
    contact && contact.relationship.trim().length > 0 ? contact.relationship.trim() : null;

  const { action, known: actionKnown } = describeAction(result);
  if (!actionKnown) missingFields.push("the planned action");

  const estimatedTimeText =
    result.estimated_time.trim().length > 0 ? withTimePreposition(result.estimated_time) : null;
  if (estimatedTimeText === null) missingFields.push("an estimated time");

  const timeSuffix = estimatedTimeText === null ? "" : ` ${estimatedTimeText}`;

  const concise = `${contactName} ${sentenceVerb(result)}${timeSuffix}.`;

  const who = relationship === null ? contactName : `${contactName} (${relationship})`;
  const detailed = `${who} told KinCall they ${reportedVerb(result)}${timeSuffix}.`;

  return {
    contactName,
    contactKnown,
    relationship,
    initials: contactKnown ? initialOf(contactName) : "?",
    contactStateNote: contact ? describeContactState(contact) : null,
    action,
    actionKnown,
    estimatedTimeText,
    concise,
    detailed,
    contactSummary: result.summary,
    disclaimer: VERIFICATION_DISCLAIMER,
    missingFields,
  };
}
