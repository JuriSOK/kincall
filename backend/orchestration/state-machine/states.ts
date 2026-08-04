export type EventStatus =
  | "SCHEDULED"
  | "CALLING_PERSON"
  | "PERSON_DID_NOT_ANSWER"
  | "CONVERSATION_IN_PROGRESS"
  | "ANALYSING_CONVERSATION"
  | "NO_ACTION_REQUIRED"
  | "ATTENTION_REQUIRED"
  | "CALLING_TRUSTED_CONTACT"
  | "CONTACT_DID_NOT_ANSWER"
  | "CONTACT_DECLINED"
  | "CONTACT_CONFIRMED"
  // DEC-023. The trusted-circle outcome is settled — a contact confirmed, or
  // the circle was exhausted — and KinCall is placing the ONE informational
  // call back to the monitored person to tell them which it was. Deliberately
  // its own status rather than an overload of an existing one: at
  // CONTACT_CONFIRMED the outcome is known but the person has not been told,
  // and those are different facts. Never terminal, and never a decision point:
  // whatever this call does, the event proceeds to the terminal status the
  // cascade had already earned.
  | "NOTIFYING_PERSON"
  // Retained for backward compatibility ONLY (DEC-011). No transition produces
  // this any more: KinCall's workflow must never stall waiting for a human
  // operator. Historical events stored with it must stay readable and
  // displayable, so the value cannot be deleted — see ATTENTION_UNRESOLVED for
  // what new events reach instead.
  | "HUMAN_REVIEW_REQUIRED"
  // DEC-011. The autonomous terminal outcome: KinCall detected, or could not
  // rule out, a need for attention, and no trusted contact accepted or could be
  // reached. Distinct from CASE_CLOSED (somebody is taking care of it) and from
  // HUMAN_REVIEW_REQUIRED (which meant "KinCall is waiting for a human"). This
  // waits for nobody — it is a finished event with an unresolved outcome, kept
  // visible so a human can act on their own initiative.
  | "ATTENTION_UNRESOLVED"
  | "CASE_CLOSED";

export type OrchestrationDecision =
  | "NO_ACTION"
  | "LOG_AND_CLOSE"
  | "RETRY_CHECK_IN"
  | "CONTACT_TRUSTED_PERSON"
  | "CONTACT_NEXT_TRUSTED_PERSON"
  // No longer produced by decideCompanionAction (DEC-011): the workflow has no
  // operational human-review dependency. Retained so historical events whose
  // `decision` column holds it still type-check and still render.
  | "REQUEST_HUMAN_REVIEW"
  // Declared in PRODUCT_SPECIFICATION.md §9.2 but deliberately never produced:
  // §9.4's configured-escalation procedures need escalation rules that do not
  // exist in §16's data model (see DEC-010, DEC-011).
  | "ACTIVATE_CONFIGURED_ESCALATION";

// A finished event: nothing further will happen to it on its own. DEC-009 uses
// this to refuse archiving someone mid-check-in, and the engine uses it to
// refuse calling one more person on top of an already-finished event.
//
// ATTENTION_UNRESOLVED is terminal (DEC-011) — the autonomous cascade has run
// out of eligible contacts, and nothing will resume it. HUMAN_REVIEW_REQUIRED
// stays listed for the historical events that still carry it.
export function isTerminalEventStatus(status: EventStatus): boolean {
  return (
    status === "CASE_CLOSED" ||
    status === "ATTENTION_UNRESOLVED" ||
    status === "HUMAN_REVIEW_REQUIRED"
  );
}

export type TransitionEvent =
  | "COMPANION_CALL_STARTED"
  | "COMPANION_CONVERSATION_STARTED"
  | "COMPANION_PERSON_NO_ANSWER"
  | "COMPANION_CALL_ENDED"
  | "COMPANION_RESULT_NO_ACTION"
  | "COMPANION_RESULT_ATTENTION"
  // Still produced, but its destination changed in DEC-011: a companion result
  // KinCall cannot validate now degrades to the attention cascade instead of to
  // human review. The literal is kept so the operation ledger stays a faithful
  // audit trail of *why* an event took that edge.
  | "COMPANION_RESULT_MALFORMED"
  // No longer produced (DEC-011); retained for historical ledger rows.
  | "COMPANION_RESULT_UNCERTAIN"
  | "FAMILY_CALL_STARTED"
  | "FAMILY_NO_ANSWER"
  | "FAMILY_DECLINED"
  | "FAMILY_CONFIRMED"
  // Same as COMPANION_RESULT_MALFORMED: still produced, now continues the
  // cascade rather than ending the event.
  | "FAMILY_RESULT_MALFORMED"
  // No longer produced (DEC-011): a contact who cannot lawfully or technically
  // be called is now SKIPPED and the cascade continues, rather than the whole
  // event stopping. Retained for historical ledger rows.
  | "FAMILY_CALL_NOT_POSSIBLE"
  | "NO_CONTACTS_REMAINING"
  // DEC-023. Starts the single informational callback to the monitored person,
  // from whichever settled trusted-circle outcome the cascade reached.
  //
  // There is deliberately NO matching "notification ended" event: the callback
  // is finished with however it goes (delivered, unanswered, or failed — it is
  // never retried), and the terminal status that follows is the one the CASCADE
  // already earned, not one this call decides. So NOTIFYING_PERSON exits
  // through the SAME two terminal events the cascade would have used without
  // it — CASE_CLOSED_EVENT and NO_CONTACTS_REMAINING — which keeps the ledger
  // honest about why the event ended.
  | "PERSON_NOTIFICATION_STARTED"
  | "CASE_CLOSED_EVENT";
