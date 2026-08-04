import { isFamilyStructuredResult } from "@/backend/integrations/calle/schemas";
import type { AttentionReason, Confidence, FamilyStructuredResult } from "@/backend/integrations/calle/schemas";
import type { CallEventRecord, EventRecord, TrustedContact } from "@/shared/domain/types";
import { MAX_CONTACT_ATTEMPTS } from "@/backend/orchestration/engine";
import type { EventStatus } from "@/backend/orchestration/state-machine/states";
import type { Tone } from "@/shared/presentation/tone";
import { describeVoicemailFromResult } from "@/backend/orchestration/cascade/voicemail";

// Presentation helpers for an event's outcome, moved here from
// app/events/[id]/page.tsx (a Next.js route file) so they can be reused by
// the dashboard and history pages (Stage B) without importing a route module,
// and so their tests import from a plain library module rather than from
// Next's route-file machinery.
//
// ── Human-readable labels ─────────────────────────────────────────────────────
// No raw enum value is ever rendered where a label exists (DEC-011). Each switch
// is exhaustive with a `never`-typed default, so adding a state or a reason code
// fails typecheck here rather than leaking `ATTENTION_UNRESOLVED` into the UI.
//
// event.priority does not exist any more — the column was dropped entirely
// (docs/DECISION_LOG.md DEC-012). High and medium priority never triggered
// different cascade behaviour, so a label with no behavioural consequence
// was never worth keeping, and the operational outcome below never depended
// on it in the first place.

export interface Confirmation {
  contact: TrustedContact | undefined;
  result: FamilyStructuredResult;
}

// The binary operational outcome, derived from what KinCall actually DID —
// never from the model's own attention_required, which is an input to the
// decision, not the decision itself. This is not a medical or severity
// judgement, only which of the two things KinCall's cascade did.
export function describeAttentionOutcome(event: EventRecord): string | null {
  if (event.status === "ATTENTION_UNRESOLVED") return "The trusted circle could not take over";
  if (event.decision === "CONTACT_TRUSTED_PERSON") return "Trusted circle contacted";
  if (event.decision === "LOG_AND_CLOSE" || event.decision === "NO_ACTION") {
    return "No attention needed";
  }
  // A decision not yet made (still checking in, or the person is being
  // retried) or one only a historical event could hold. The workflow-step line
  // above already describes those cases; this section simply has nothing more
  // to add yet.
  return null;
}

export function describeAttentionReason(reason: AttentionReason): string {
  switch (reason) {
    case "explicit_help_request":
      return "Asked for help";
    case "fall":
      return "Mentioned a fall";
    case "mobility_difficulty":
      return "Difficulty moving around";
    case "pain_or_injury":
      return "Mentioned pain or an injury";
    case "unusual_confusion":
      return "Seemed unusually confused";
    case "distress":
      return "Expressed distress";
    case "abnormal_conversation_end":
      return "Call ended unexpectedly";
    case "person_not_reached":
      return "Could not be reached";
    case "other_attention_signal":
      return "Another unusual situation";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function describeConfidence(confidence: Confidence): string {
  switch (confidence) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default: {
      const exhaustive: never = confidence;
      return exhaustive;
    }
  }
}

// The current workflow step, in plain language.
export function describeWorkflowStep(status: EventStatus): string {
  switch (status) {
    case "SCHEDULED":
      return "Check-in scheduled";
    case "CALLING_PERSON":
      return "Calling the person";
    case "CONVERSATION_IN_PROGRESS":
      return "Conversation in progress";
    case "ANALYSING_CONVERSATION":
      return "Analysing the conversation";
    case "PERSON_DID_NOT_ANSWER":
      return "The person did not answer";
    case "ATTENTION_REQUIRED":
      return "Contacting the trusted circle";
    case "CALLING_TRUSTED_CONTACT":
      return "Calling a trusted contact";
    case "CONTACT_DID_NOT_ANSWER":
      return "A trusted contact did not answer";
    case "CONTACT_DECLINED":
      return "A trusted contact could not help";
    case "CONTACT_CONFIRMED":
      return "A trusted contact confirmed";
    case "NO_ACTION_REQUIRED":
      return "No action required";
    case "NOTIFYING_PERSON":
      return "Calling back with the outcome";
    case "ATTENTION_UNRESOLVED":
      return "No confirmed support";
    // DEC-011: no new event reaches this. Historical events still do.
    case "HUMAN_REVIEW_REQUIRED":
      return "Human review required";
    case "CASE_CLOSED":
      return "Closed";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

// Finds the family call that actually confirmed an intervention, if any.
//
// `can_intervene` is compared to the literal "yes", never used as a truthiness
// check: it became a "yes"/"no"/"unknown" enum in DEC-005, and every one of those
// is a non-empty string, so a truthiness check matched EVERY family result and
// returned whoever was called first rather than whoever actually confirmed.
//
// The contact is resolved exclusively via `callEvent.contactId` — the id KinCall
// itself selected when it placed that call — never via
// `structuredResult.contact_id`, which is model-returned and untrusted (the same
// rule the engine's own cascade enforces per DEC-005).
export function findConfirmation(
  callEvents: CallEventRecord[],
  contacts: TrustedContact[]
): Confirmation | null {
  const confirmedCall = callEvents.find(
    (callEvent) =>
      callEvent.agentType === "family" &&
      isFamilyStructuredResult(callEvent.structuredResult) &&
      callEvent.structuredResult.can_intervene === "yes"
  );
  if (!confirmedCall || !isFamilyStructuredResult(confirmedCall.structuredResult)) {
    return null;
  }

  return {
    contact: contacts.find((candidate) => candidate.id === confirmedCall.contactId),
    result: confirmedCall.structuredResult,
  };
}

// Narrates the cascade that led to a confirmed intervention: who (if anyone) was
// tried, and how many times, before the contact who helped. Built from the family
// CallEventRecords in call order, not from the confirmed result's own text.
export function describeFamilyCascade(
  callEvents: CallEventRecord[],
  contacts: TrustedContact[],
  confirmation: Confirmation
): string {
  const confirmedName = confirmation.contact?.firstName ?? "a trusted contact";

  const priorAttempts = callEvents.filter(
    (callEvent) =>
      callEvent.agentType === "family" &&
      isFamilyStructuredResult(callEvent.structuredResult) &&
      callEvent.structuredResult.can_intervene !== "yes"
  );

  if (priorAttempts.length === 0) {
    return `KinCall contacted ${confirmedName}, who confirmed they would help.`;
  }

  // Grouped by contact, so two unanswered calls to Julie read as "Julie did not
  // answer twice" rather than as two separate people (DEC-011).
  const byContact = new Map<string, { name: string; answered: boolean; attempts: number }>();
  for (const callEvent of priorAttempts) {
    const contact = contacts.find((candidate) => candidate.id === callEvent.contactId);
    const name = contact?.firstName ?? "a trusted contact";
    const result = callEvent.structuredResult as FamilyStructuredResult;
    const existing = byContact.get(callEvent.contactId ?? name);
    byContact.set(callEvent.contactId ?? name, {
      name,
      answered: (existing?.answered ?? false) || result.answered === "yes",
      attempts: (existing?.attempts ?? 0) + 1,
    });
  }

  const clauses = [...byContact.values()].map(({ name, answered, attempts }) => {
    if (answered) return `${name} declined`;
    return attempts > 1 ? `${name} did not answer ${attempts} times` : `${name} did not answer`;
  });

  return `${clauses.join(", ")}, so KinCall contacted ${confirmedName}.`;
}

// Keyed on status first, not decision: before a decision exists (status is still
// SCHEDULED/CALLING_PERSON/CONVERSATION_IN_PROGRESS/ANALYSING_CONVERSATION)
// `event.decision` is null, and a decision-only dispatch previously fell through
// to "found nothing unusual" in exactly those cases — a false reassurance about a
// check-in that had not happened yet. Exhaustive over EventStatus so a newly
// added status fails typecheck here rather than silently reusing a fallback.
export function describeAction(event: EventRecord): string {
  switch (event.status) {
    case "SCHEDULED":
    case "CALLING_PERSON":
    case "CONVERSATION_IN_PROGRESS":
      return "Check-in in progress.";
    case "ANALYSING_CONVERSATION":
      return "KinCall is analysing the conversation.";
    case "PERSON_DID_NOT_ANSWER":
      return "KinCall called but did not reach the person, and is trying again.";
    case "ATTENTION_REQUIRED":
      return "KinCall detected a signal needing attention — a trusted contact needs to be contacted.";
    case "CALLING_TRUSTED_CONTACT":
    case "CONTACT_DID_NOT_ANSWER":
    case "CONTACT_DECLINED":
    case "CONTACT_CONFIRMED":
      return "KinCall contacted the trusted circle.";
    // DEC-011's autonomous dead end: everybody eligible was tried, nobody could
    // help — whether because they did not answer or because they answered and
    // declined. Stated plainly, with no suggestion that KinCall is still
    // working on it, and never implying every contact simply failed to answer.
    case "ATTENTION_UNRESOLVED":
      return "KinCall contacted the trusted circle, but nobody confirmed they could help.";
    case "HUMAN_REVIEW_REQUIRED":
      return "Human review is required.";
    // DEC-023. The outcome is already decided; this call only reports it.
    case "NOTIFYING_PERSON":
      return "KinCall is calling back to share the outcome.";
    case "NO_ACTION_REQUIRED":
    case "CASE_CLOSED":
      // The specific "Julie did not answer, so KinCall contacted Marc" narrative
      // is filled in by the caller when a confirmation exists (describeAction
      // does not have the call-event history to build it).
      return event.decision === "CONTACT_TRUSTED_PERSON"
        ? "KinCall contacted the trusted circle."
        : "KinCall reviewed the check-in and found no attention signal.";
    default: {
      const exhaustive: never = event.status;
      return exhaustive;
    }
  }
}

// Same exhaustive-over-status shape as describeAction, for the same reason: "No
// intervention required." must only ever describe a closed, no-signal case, never
// an event where nothing has been decided yet.
export function describeOwnership(event: EventRecord): string {
  switch (event.status) {
    case "SCHEDULED":
    case "CALLING_PERSON":
    case "CONVERSATION_IN_PROGRESS":
    case "ANALYSING_CONVERSATION":
      return "Not yet known — the check-in hasn't finished.";
    case "PERSON_DID_NOT_ANSWER":
      return "Nobody yet — the person was not reached, and KinCall is trying again.";
    case "ATTENTION_REQUIRED":
      return "Not yet — a trusted contact still needs to be contacted.";
    case "CALLING_TRUSTED_CONTACT":
    case "CONTACT_DID_NOT_ANSWER":
    case "CONTACT_DECLINED":
    case "CONTACT_CONFIRMED":
      return "Not confirmed yet — KinCall is still contacting the trusted circle.";
    case "ATTENTION_UNRESOLVED":
      return "No one — KinCall contacted the trusted circle, but nobody confirmed they could help.";
    case "HUMAN_REVIEW_REQUIRED":
      return "No contact confirmed yet — flagged for human review.";
    case "NOTIFYING_PERSON":
      // Only ever reached with NO confirmation: buildInterventionSummary is
      // driven by the same persisted family results, so the confirmed path
      // always has a summary and the page renders that instead of calling this.
      // Saying "KinCall is calling back" here was what made the callback look
      // like the intervention itself (DEC-023 revision).
      return "No one — KinCall contacted the trusted circle, but nobody confirmed they could help.";
    case "NO_ACTION_REQUIRED":
    case "CASE_CLOSED":
      // In practice CASE_CLOSED with CONTACT_TRUSTED_PERSON always has a
      // confirmation record by the time this state is reached, so the page renders
      // confirmation.result.summary instead of calling this function at all — this
      // branch only guards against calling it out of that context.
      return event.decision === "CONTACT_TRUSTED_PERSON"
        ? "A trusted contact confirmed they are taking care of it."
        : "No intervention required.";
    default: {
      const exhaustive: never = event.status;
      return exhaustive;
    }
  }
}

// One line per trusted-contact call, in the order they were placed.
export function describeFamilyAttempt(
  callEvent: CallEventRecord,
  contacts: TrustedContact[]
): { name: string; attempt: string; outcome: string; voicemail: string } {
  const contact = contacts.find((candidate) => candidate.id === callEvent.contactId);
  const name = contact?.firstName ?? callEvent.contactId ?? "a trusted contact";
  const attempt = `Attempt ${callEvent.attemptNumber} of ${MAX_CONTACT_ATTEMPTS}`;
  const result = isFamilyStructuredResult(callEvent.structuredResult)
    ? callEvent.structuredResult
    : null;

  if (!result) {
    return {
      name,
      attempt,
      outcome:
        callEvent.resultProcessedAt === null ? "Call in progress" : "Result could not be read",
      voicemail: "—",
    };
  }

  const outcome =
    result.can_intervene === "yes"
      ? "Confirmed they would check in"
      : result.answered === "yes"
        ? "Answered but could not help"
        : "No answer";

  return {
    name,
    attempt,
    outcome,
    voicemail: describeVoicemailFromResult(result, callEvent.attemptNumber, MAX_CONTACT_ATTEMPTS),
  };
}

// DEC-023. One plain sentence about the informational callback to the monitored
// person, for the event page's secondary card.
//
// Never claims a delivery that was not reported: a no-answer, a technical
// failure and an unreadable result all read as "could not confirm", because
// from the person's point of view KinCall genuinely cannot tell them apart.
// Never implies the callback changed anything — it cannot.
export type NotificationDeliveryState = "in_progress" | "delivered" | "unconfirmed";

export interface NotificationDeliveryView {
  state: NotificationDeliveryState;
  label: string;
  // Never "calm" unless delivery was actually confirmed — a green treatment
  // here would claim the person heard the message.
  tone: Tone;
}

// The delivery status of the informational callback, kept STRICTLY separate
// from the workflow outcome (DEC-023 revision).
//
// "Case closed" means KinCall's workflow finished; it must never imply the
// person answered the callback. Those are two different facts and the event
// page shows them on two different lines.
//
// VOICEMAIL. CALL-E exposes no reliable answering-machine detection, so an
// unanswered callback and a voicemail are indistinguishable here. Nothing in
// this function may label either one: a provider call that merely completed is
// NOT delivery. Only the validated result's own `message_delivered === "yes"`
// earns the delivered wording; everything else — no answer, voicemail, a
// technical failure, an unreadable result — reads as "could not confirm".
export function describeNotificationDelivery(
  callEvent: CallEventRecord,
  personName: string
): NotificationDeliveryView {
  if (callEvent.resultProcessedAt === null) {
    return {
      state: "in_progress",
      label: "Calling back to share the outcome…",
      tone: "neutral",
    };
  }

  const result = callEvent.structuredResult;
  const delivered = isRecord(result) && result.message_delivered === "yes";

  return delivered
    ? { state: "delivered", label: `Outcome shared with ${personName}`, tone: "calm" }
    : {
        state: "unconfirmed",
        label: "KinCall could not confirm that the outcome was delivered",
        tone: "neutral",
      };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
