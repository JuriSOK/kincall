import type { EventStatus, TransitionEvent } from "./states";

type TransitionTable = {
  [Status in EventStatus]?: Partial<Record<TransitionEvent, EventStatus>>;
};

// DEC-011: no edge in this table reaches HUMAN_REVIEW_REQUIRED any more. Every
// path that used to — a malformed result, a contact who cannot be called, an
// exhausted circle — now either continues the autonomous cascade or ends at
// ATTENTION_UNRESOLVED. The status itself is retained (states.ts) so historical
// events keep rendering; it is simply no longer reachable.
const TRANSITIONS: TransitionTable = {
  SCHEDULED: {
    COMPANION_CALL_STARTED: "CALLING_PERSON",
  },
  CALLING_PERSON: {
    COMPANION_CONVERSATION_STARTED: "CONVERSATION_IN_PROGRESS",
    COMPANION_PERSON_NO_ANSWER: "PERSON_DID_NOT_ANSWER",
    // DEC-011: the retry call could not be placed at all, so nobody has spoken
    // to the person on any attempt. Reaches the trusted circle rather than
    // leaving the event parked at CALLING_PERSON with no call in flight.
    COMPANION_RESULT_ATTENTION: "ATTENTION_REQUIRED",
  },
  PERSON_DID_NOT_ANSWER: {
    // The bounded retry (DEC-011): exactly one more check-in attempt. The bound
    // lives in decideCompanionAction (MAX_COMPANION_ATTEMPTS), not here — this
    // edge only says a retry is *possible*, and the persisted attempt number is
    // what stops it happening twice.
    COMPANION_CALL_STARTED: "CALLING_PERSON",
  },
  CONVERSATION_IN_PROGRESS: {
    COMPANION_CALL_ENDED: "ANALYSING_CONVERSATION",
  },
  ANALYSING_CONVERSATION: {
    COMPANION_RESULT_NO_ACTION: "NO_ACTION_REQUIRED",
    COMPANION_RESULT_ATTENTION: "ATTENTION_REQUIRED",
    // DEC-011: a result KinCall cannot validate degrades to the attention
    // cascade, never to a closure and never to a human-review stall. An
    // unreadable check-in is precisely when someone should look in on the person.
    COMPANION_RESULT_MALFORMED: "ATTENTION_REQUIRED",
    // DEC-003: a voicemail is only detectable from the structured result, so
    // "not reached" is reached from here, not from CALLING_PERSON.
    COMPANION_PERSON_NO_ANSWER: "PERSON_DID_NOT_ANSWER",
  },
  NO_ACTION_REQUIRED: {
    CASE_CLOSED_EVENT: "CASE_CLOSED",
  },
  ATTENTION_REQUIRED: {
    FAMILY_CALL_STARTED: "CALLING_TRUSTED_CONTACT",
    // Nobody eligible to call at all: an empty circle, or every contact skipped
    // for missing consent, archival or an unusable number. Terminal and visible,
    // rather than a wait for a human (DEC-011).
    //
    // Still reachable directly (DEC-023): this is the edge taken when the
    // informational callback is SKIPPED — an archived or no-longer-consenting
    // person must not be called, and the event must still reach its terminal
    // status rather than stalling.
    NO_CONTACTS_REMAINING: "ATTENTION_UNRESOLVED",
    PERSON_NOTIFICATION_STARTED: "NOTIFYING_PERSON",
  },
  CALLING_TRUSTED_CONTACT: {
    FAMILY_NO_ANSWER: "CONTACT_DID_NOT_ANSWER",
    FAMILY_DECLINED: "CONTACT_DECLINED",
    FAMILY_CONFIRMED: "CONTACT_CONFIRMED",
    // DEC-011: an unusable answer from this contact is not an answer. Treated
    // as "this contact did not get us anywhere", so the bounded retry and then
    // the next contact both still happen.
    FAMILY_RESULT_MALFORMED: "CONTACT_DID_NOT_ANSWER",
  },
  CONTACT_DID_NOT_ANSWER: {
    // Serves both the same-contact retry and the move to the next contact. Which
    // one it is comes from the intent's contact id and attempt number, not from
    // the edge (DEC-011).
    FAMILY_CALL_STARTED: "CALLING_TRUSTED_CONTACT",
    // Retained and still reachable: the callback-skipped path (DEC-023).
    NO_CONTACTS_REMAINING: "ATTENTION_UNRESOLVED",
    PERSON_NOTIFICATION_STARTED: "NOTIFYING_PERSON",
  },
  CONTACT_DECLINED: {
    FAMILY_CALL_STARTED: "CALLING_TRUSTED_CONTACT",
    NO_CONTACTS_REMAINING: "ATTENTION_UNRESOLVED",
    PERSON_NOTIFICATION_STARTED: "NOTIFYING_PERSON",
  },
  CONTACT_CONFIRMED: {
    // Retained and still reachable: the callback-skipped path (DEC-023).
    CASE_CLOSED_EVENT: "CASE_CLOSED",
    PERSON_NOTIFICATION_STARTED: "NOTIFYING_PERSON",
  },
  // DEC-023. The one informational callback is in flight. Both exits are
  // terminal and neither is chosen by this call: which one applies was already
  // settled by the cascade (a confirmation exists, or it does not), and is
  // re-derived from the persisted family call events — so a replaying worker
  // reaches the identical terminal status. Nothing here can start another call,
  // reopen the event, or change the accepting contact.
  NOTIFYING_PERSON: {
    CASE_CLOSED_EVENT: "CASE_CLOSED",
    NO_CONTACTS_REMAINING: "ATTENTION_UNRESOLVED",
  },
};

// All state transitions are explicit and table-driven (TECHNICAL_ARCHITECTURE.md §6):
// an event not listed for the current status is rejected rather than silently ignored.
export function nextStatus(current: EventStatus, event: TransitionEvent): EventStatus {
  const allowed = TRANSITIONS[current];
  const next = allowed?.[event];
  if (!next) {
    throw new Error(`Illegal transition: cannot apply "${event}" from state "${current}".`);
  }
  return next;
}
