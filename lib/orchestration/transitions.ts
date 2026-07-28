import type { EventStatus, TransitionEvent } from "./states";

type TransitionTable = {
  [Status in EventStatus]?: Partial<Record<TransitionEvent, EventStatus>>;
};

const TRANSITIONS: TransitionTable = {
  SCHEDULED: {
    COMPANION_CALL_STARTED: "CALLING_PERSON",
  },
  CALLING_PERSON: {
    COMPANION_CONVERSATION_STARTED: "CONVERSATION_IN_PROGRESS",
    COMPANION_PERSON_NO_ANSWER: "PERSON_DID_NOT_ANSWER",
  },
  PERSON_DID_NOT_ANSWER: {
    COMPANION_CALL_STARTED: "CALLING_PERSON",
  },
  CONVERSATION_IN_PROGRESS: {
    COMPANION_CALL_ENDED: "ANALYSING_CONVERSATION",
  },
  ANALYSING_CONVERSATION: {
    COMPANION_RESULT_NO_ACTION: "NO_ACTION_REQUIRED",
    COMPANION_RESULT_ATTENTION: "ATTENTION_REQUIRED",
    COMPANION_RESULT_MALFORMED: "HUMAN_REVIEW_REQUIRED",
    // DEC-003: a voicemail is only detectable from the structured result, so
    // "not reached" is reached from here, not from CALLING_PERSON.
    COMPANION_PERSON_NO_ANSWER: "PERSON_DID_NOT_ANSWER",
    COMPANION_RESULT_UNCERTAIN: "HUMAN_REVIEW_REQUIRED",
  },
  NO_ACTION_REQUIRED: {
    CASE_CLOSED_EVENT: "CASE_CLOSED",
  },
  ATTENTION_REQUIRED: {
    FAMILY_CALL_STARTED: "CALLING_TRUSTED_CONTACT",
    // DEC-005: the contact's number is unusable (missing/invalid/reserved
    // config), so no call can even be attempted. Reaching human review from
    // here keeps the event from stalling at ATTENTION_REQUIRED with nothing
    // in flight, and no misleading "Calling X" entry is ever written.
    FAMILY_CALL_NOT_POSSIBLE: "HUMAN_REVIEW_REQUIRED",
  },
  CALLING_TRUSTED_CONTACT: {
    FAMILY_NO_ANSWER: "CONTACT_DID_NOT_ANSWER",
    FAMILY_DECLINED: "CONTACT_DECLINED",
    FAMILY_CONFIRMED: "CONTACT_CONFIRMED",
    FAMILY_RESULT_MALFORMED: "HUMAN_REVIEW_REQUIRED",
  },
  CONTACT_DID_NOT_ANSWER: {
    FAMILY_CALL_STARTED: "CALLING_TRUSTED_CONTACT",
    NO_CONTACTS_REMAINING: "HUMAN_REVIEW_REQUIRED",
    FAMILY_CALL_NOT_POSSIBLE: "HUMAN_REVIEW_REQUIRED",
  },
  CONTACT_DECLINED: {
    FAMILY_CALL_STARTED: "CALLING_TRUSTED_CONTACT",
    NO_CONTACTS_REMAINING: "HUMAN_REVIEW_REQUIRED",
    FAMILY_CALL_NOT_POSSIBLE: "HUMAN_REVIEW_REQUIRED",
  },
  CONTACT_CONFIRMED: {
    CASE_CLOSED_EVENT: "CASE_CLOSED",
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
