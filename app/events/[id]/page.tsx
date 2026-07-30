import Link from "next/link";
import { notFound } from "next/navigation";
import { isFamilyStructuredResult, readCompanionResult } from "@/lib/calle/schemas";
import type {
  AttentionReason,
  Confidence,
  FamilyStructuredResult,
  NormalizedCompanionResult,
} from "@/lib/calle/schemas";
import { getRepository } from "@/lib/database/store";
import type { CallEventRecord, EventRecord, TrustedContact } from "@/lib/database/types";
import { MAX_CONTACT_ATTEMPTS } from "@/lib/orchestration/engine";
import { MAX_COMPANION_ATTEMPTS } from "@/lib/orchestration/decide-companion-action";
import type { EventStatus } from "@/lib/orchestration/states";
import type { StatusTone } from "@/lib/orchestration/person-status";
import { describePersonStatus } from "@/lib/orchestration/person-status";
import { describeVoicemailFromResult } from "@/lib/orchestration/voicemail";
import { Badge, Card, PageHeader, PageShell } from "@/app/ui/surfaces";
import type { Tone } from "@/app/ui/tone";
import { EventPollIndicator } from "./event-poll-indicator";
import { SafetyNotice } from "./safety-notice";

// Same mapping as the person page: describePersonStatus's operational tone onto
// the design system's. "unknown" is neutral — neither reassuring nor worrying.
const STATUS_TONE: Record<StatusTone, Tone> = {
  calm: "calm",
  attention: "attention",
  unresolved: "unresolved",
  unknown: "neutral",
};

export interface Confirmation {
  contact: TrustedContact | undefined;
  result: FamilyStructuredResult;
}

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

// The binary operational outcome, derived from what KinCall actually DID —
// never from the model's own attention_required, which is an input to the
// decision, not the decision itself. This is not a medical or severity
// judgement, only which of the two things KinCall's cascade did.
export function describeAttentionOutcome(event: EventRecord): string | null {
  if (event.status === "ATTENTION_UNRESOLVED") return "Attention unresolved";
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

function describeAttentionReason(reason: AttentionReason): string {
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

function describeConfidence(confidence: Confidence): string {
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
    case "ATTENTION_UNRESOLVED":
      return "Unresolved — nobody could be reached";
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
    // help. Stated plainly, with no suggestion that KinCall is still working on it.
    case "ATTENTION_UNRESOLVED":
      return "KinCall contacted everyone it could in the trusted circle. Nobody was able to confirm they would check in.";
    case "HUMAN_REVIEW_REQUIRED":
      return "Human review is required.";
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
      return "Nobody. KinCall has finished trying and no trusted contact confirmed they would check in.";
    case "HUMAN_REVIEW_REQUIRED":
      return "No contact confirmed yet — flagged for human review.";
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
function describeFamilyAttempt(
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
    voicemail: describeVoicemailFromResult(
      result,
      callEvent.attemptNumber,
      MAX_CONTACT_ATTEMPTS
    ),
  };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const event = await repository.getEvent(id);

  if (!event) {
    notFound();
  }

  const [person, timeline, callEvents, contacts] = await Promise.all([
    repository.getPerson(event.personId),
    repository.listTimeline(event.id),
    repository.listCallEvents(event.id),
    // Unfiltered on purpose (DEC-009): a contact archived after the fact must
    // still resolve to a name for the calls that were actually placed.
    repository.getTrustedContacts(event.personId),
  ]);

  const confirmation = findConfirmation(callEvents, contacts);
  const companionCalls = callEvents.filter((call) => call.agentType === "companion");
  const familyCalls = callEvents.filter((call) => call.agentType === "family");

  // The LAST companion call: after a bounded retry there are two, and the
  // decision came from the most recent one. readCompanionResult accepts the
  // pre-DEC-011 shape too, so historical events still render.
  const attention = readCompanionResult(
    companionCalls[companionCalls.length - 1]?.structuredResult
  );

  const actionDescription = confirmation
    ? describeFamilyCascade(callEvents, contacts, confirmation)
    : describeAction(event);

  // Contacts the cascade never called at all. Reported separately from the
  // timeline's own per-skip entries, which record the reason at the time.
  const calledContactIds = new Set(familyCalls.map((call) => call.contactId));
  const neverCalled = contacts.filter(
    (contact) => !calledContactIds.has(contact.id) && contact.archivedAt === null
  );

  const status = describePersonStatus(event);

  return (
    <PageShell width="narrow">
      <div className="flex flex-col gap-4">
        <Link
          href={`/people/${event.personId}`}
          className="w-fit text-sm text-muted hover:text-accent"
        >
          ← {person?.firstName ?? "Back"}
        </Link>
        <PageHeader title={`Check-in ${event.id}`} />
        <div className="flex flex-wrap items-center gap-3">
          {/* The outcome badge carries the one tone that distinguishes
              ATTENTION_UNRESOLVED from every other state (DEC-011). */}
          <Badge tone={STATUS_TONE[status.tone]}>{status.label}</Badge>
          <span className="flex items-center gap-2 text-sm text-muted">
            {describeWorkflowStep(event.status)}
            <EventPollIndicator eventId={event.id} status={event.status} />
          </span>
        </div>
      </div>

      <SafetyNotice />

      {/* Summary first: this is what a family member actually came to read. The
          per-call detail below is the evidence for it. */}
      <Card title="Summary">
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="font-medium">What happened?</dt>
            <dd className="text-muted">
              {companionCalls[companionCalls.length - 1]?.summary ?? "No summary available yet."}
            </dd>
          </div>
          <div>
            <dt className="font-medium">What did KinCall do?</dt>
            <dd className="text-muted">{actionDescription}</dd>
          </div>
          <div>
            <dt className="font-medium">Who is taking care of it?</dt>
            <dd className="text-muted">
              {confirmation ? confirmation.result.summary : describeOwnership(event)}
            </dd>
          </div>
        </dl>
      </Card>

      {attention ? (
        <Card title="What the check-in found">
          <div className="flex flex-col gap-3 text-sm">
            {describeAttentionOutcome(event) ? (
              <div>
                <p className="font-medium">Attention</p>
                <p className="text-muted">{describeAttentionOutcome(event)}</p>
                {/* §9.4's Limite critique: a binary operational outcome, never a
                    medical or severity judgement. KinCall does not diagnose. */}
                <p className="mt-1 text-xs text-subtle">
                  This is an operational outcome — whether KinCall closed the check-in or contacted
                  the trusted circle — not a medical assessment or a severity level.
                </p>
              </div>
            ) : null}
            {attention.attentionReasons.length > 0 ? (
              <div>
                <p className="font-medium">Why</p>
                <ul className="list-inside list-disc text-muted">
                  {attention.attentionReasons.map((reason) => (
                    <li key={reason}>{describeAttentionReason(reason)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="font-medium">What was said</p>
              <p className="text-muted">{attention.neutralSummary || "No summary available."}</p>
            </div>
            <div>
              <p className="font-medium">Reporting confidence</p>
              <p className="text-muted">{describeConfidence(attention.confidence)}</p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card
        title={`Check-in calls to ${person?.firstName ?? "the person"}`}
        description={
          companionCalls.length === 0
            ? "No check-in call has been placed yet."
            : `${companionCalls.length} of at most ${MAX_COMPANION_ATTEMPTS} attempts placed.`
        }
      >
        <ol className="flex flex-col gap-1 text-sm text-muted">
          {companionCalls.map((call) => {
            const result = readCompanionResult(call.structuredResult);
            return (
              <li key={call.id}>
                Attempt {call.attemptNumber}:{" "}
                {call.resultProcessedAt === null
                  ? "in progress"
                  : result === null
                    ? "result could not be read"
                    : result.personReached === "yes"
                      ? "spoke with them"
                      : result.personReached === "no"
                        ? "did not reach them"
                        : "could not confirm who answered"}
              </li>
            );
          })}
        </ol>
      </Card>

      {familyCalls.length > 0 || neverCalled.length > 0 ? (
        <Card title="Trusted-circle calls">
          <div className="flex flex-col gap-3 text-sm">
            {familyCalls.length > 0 ? (
              <ol className="flex flex-col gap-2">
                {familyCalls.map((call) => {
                  const line = describeFamilyAttempt(call, contacts);
                  return (
                    <li
                      key={call.id}
                      className="flex flex-col rounded-kc border border-line bg-sunken px-3 py-2"
                    >
                      <span className="font-medium">
                        {line.name} — {line.attempt}
                      </span>
                      <span className="text-muted">{line.outcome}</span>
                      <span className="text-xs text-subtle">Voicemail: {line.voicemail}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-muted">No trusted contact has been called.</p>
            )}

            {neverCalled.length > 0 ? (
              <div>
                <p className="font-medium">Not called</p>
                <ul className="list-inside list-disc text-muted">
                  {neverCalled.map((contact) => (
                    <li key={contact.id}>{contact.firstName}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-subtle">
                  The timeline below records why each of these was skipped, where one was skipped.
                </p>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card title="Timeline">
        <ol className="flex flex-col">
          {timeline.map((entry) => (
            <li
              key={entry.id}
              className="flex gap-3 border-l-2 border-l-line py-1.5 pl-3 text-sm"
            >
              <span className="font-mono text-xs text-subtle">
                {new Date(entry.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span>{entry.message}</span>
            </li>
          ))}
        </ol>
      </Card>
    </PageShell>
  );
}

// Re-exported for tests and for anything that needs the same normalized view of a
// companion result the page renders.
export type { NormalizedCompanionResult };
