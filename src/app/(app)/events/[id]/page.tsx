import Link from "next/link";
import { notFound } from "next/navigation";
import { isFamilyStructuredResult, readCompanionResult } from "@/backend/integrations/calle/schemas";
import { getRepository } from "@/backend/persistence/store";
import { MAX_COMPANION_ATTEMPTS } from "@/backend/orchestration/decision-tree";
import { describePersonStatus } from "@/backend/presentation/person-status";
import {
  describeAction,
  describeAttentionOutcome,
  describeAttentionReason,
  describeConfidence,
  describeFamilyAttempt,
  describeFamilyCascade,
  describeOwnership,
  describeNotificationDelivery,
  describeWorkflowStep,
  findConfirmation,
} from "@/backend/presentation/event-summary";
import { buildInterventionSummary } from "@/backend/presentation/intervention-summary";
import { formatTime } from "@/shared/presentation/format-date";
import { STATUS_TONE } from "@/backend/presentation/status-tone";
import { InterventionCard } from "@/frontend/components/intervention-card";
import { Badge, Card, PageHeader, PageShell } from "@/frontend/design-system/surfaces";
import { EventPollIndicator } from "./event-poll-indicator";
import { SafetyNotice } from "./safety-notice";

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
  // Stage F (DEC-019). Null unless a family call's PERSISTED result actually
  // says can_intervene === "yes", so the card below is structurally
  // unreachable for a CASE_CLOSED event with no cascade, for an event where a
  // contact merely answered, and for ATTENTION_UNRESOLVED.
  const intervention = buildInterventionSummary(event, callEvents, contacts);
  const companionCalls = callEvents.filter((call) => call.agentType === "companion");
  const familyCalls = callEvents.filter((call) => call.agentType === "family");
  // DEC-023. At most one, enforced by the operation ledger and by migration
  // 0014's partial unique index.
  const notificationCall = callEvents.find(
    (call) => call.agentType === "person_notification"
  );
  const notificationDelivery = notificationCall
    ? describeNotificationDelivery(notificationCall, person?.firstName ?? "them")
    : null;

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

      {/* Stage F (DEC-019): the single most important thing a family member
          came to read, so it sits directly under the outcome and above the
          evidence. Rendered only when a confirmation genuinely exists — see
          buildInterventionSummary. */}
      {intervention ? <InterventionCard summary={intervention} /> : null}

      {/* Summary next: this is what a family member actually came to read. The
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
            {/* DEC-023 revision: the question itself changes when nobody
                confirmed. Asking "who is taking care of it?" and answering "no
                one" reads as a system that lost track; naming the outcome is
                honest and calmer. */}
            <dt className="font-medium">
              {intervention ? "Who is taking care of it?" : "No one confirmed they could help"}
            </dt>
            {/* The intervention model's own sentence, not the raw CALL-E free
                text — that is shown verbatim inside the card above, under
                "What they said", where it is clearly attributed. */}
            <dd className="text-muted">
              {intervention ? intervention.detailed : describeOwnership(event)}
            </dd>
          </div>
          {/* Delivery of the follow-up call, kept on its own line and never
              merged into the outcome above: a callback that did not connect
              changes nothing about who committed to help. */}
          {notificationDelivery ? (
            <div>
              <dt className="font-medium">Did KinCall share the outcome?</dt>
              <dd>
                <Badge tone={notificationDelivery.tone}>{notificationDelivery.label}</Badge>
              </dd>
            </div>
          ) : null}
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

      {/* DEC-023. Deliberately LAST before the timeline and deliberately plain:
          it sits below the outcome badge, the intervention card and the
          trusted-circle detail, because who is helping matters more than
          whether the courtesy call connected. Never a KPI, never a warning
          tone — a callback that did not connect changes nothing about the
          outcome above it. */}
      {notificationCall ? (
        <Card title={`Follow-up call to ${person?.firstName ?? "the person"}`}>
          <p className="text-sm text-muted">
            {notificationDelivery?.state === "in_progress"
              ? `KinCall is calling ${person?.firstName ?? "them"} back to share the outcome.`
              : notificationDelivery?.state === "delivered"
                ? `KinCall called back and passed on the outcome to ${person?.firstName ?? "them"}.`
                : "KinCall called back, but could not confirm that the outcome was delivered. The outcome above is unaffected."}
          </p>
        </Card>
      ) : null}

      <Card title="Timeline">
        <ol className="flex flex-col">
          {timeline.map((entry) => (
            <li
              key={entry.id}
              className="flex gap-3 border-l-2 border-l-line py-1.5 pl-3 text-sm"
            >
              <span className="font-mono text-xs text-subtle">{formatTime(entry.createdAt)}</span>
              <span>{entry.message}</span>
            </li>
          ))}
        </ol>
      </Card>
    </PageShell>
  );
}
