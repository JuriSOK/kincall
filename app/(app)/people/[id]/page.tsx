import Link from "next/link";
import { notFound } from "next/navigation";
import { listDemoScenarios } from "@/lib/calle/demo-scenarios";
import { getRepository } from "@/lib/database/store";
import { maskPhone } from "@/lib/phone";
import type { CallReadiness } from "@/lib/orchestration/person-status";
import { describeCallReadiness, describePersonStatus } from "@/lib/orchestration/person-status";
import { formatDateTime } from "@/lib/presentation/format-date";
import { STATUS_TONE } from "@/lib/presentation/status-tone";
import { SafetyNotice } from "@/app/(app)/events/[id]/safety-notice";
import { ButtonLink } from "@/app/ui/button";
import { Badge, Card, EmptyState, Notice, PageHeader, PageShell } from "@/app/ui/surfaces";
import { DeletePersonButton } from "../delete-person-button";
import { LaunchDemoButton } from "./launch-demo-button";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const person = await repository.getPerson(id);

  if (!person) {
    notFound();
  }

  // Active-only (DEC-009): an archived contact must disappear from this
  // display. Historical resolution (app/(app)/events/[id]/page.tsx) uses the
  // unfiltered getTrustedContacts instead.
  const [trustedCircle, events] = await Promise.all([
    repository.getActiveTrustedContacts(person.id),
    repository.listEvents(person.id, 20),
  ]);

  // Fake-mode demo scenarios (DEC-011). Undefined in live mode, which is what
  // keeps the selector out of the interface entirely rather than merely disabled.
  const demoScenarios = listDemoScenarios();

  // §14.2's Status line, derived from the most recent event.
  const status = describePersonStatus(events[0]);
  const readiness = describeCallReadiness(person);
  const contactReadiness = trustedCircle.map((contact) => describeCallReadiness(contact));

  return (
    <PageShell width="narrow">
      <div className="flex flex-col gap-4">
        <Link href="/dashboard" className="w-fit text-sm text-muted hover:text-accent">
          ← Dashboard
        </Link>

        <PageHeader
          title={person.firstName}
          actions={
            <DeletePersonButton
              personId={person.id}
              personName={person.firstName}
              mode="redirect-dashboard"
            />
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={STATUS_TONE[status.tone]}>{status.label}</Badge>
          {/* "Preferred", not "Next": no schedule has been computed yet (Stage
              D). Claiming a computed next occurrence here would be a fact this
              page cannot back up. */}
          <span className="text-sm text-muted">
            Preferred check-in time: daily at {person.preferredCallTime}
          </span>
          <span className="font-mono text-sm text-subtle">{maskPhone(person.phone)}</span>
        </div>
      </div>

      <SafetyNotice />
      <CallReadinessNotice readiness={readiness} subject={person.firstName} />

      <Card
        title="Trusted circle"
        description="Called in this order, stopping as soon as someone confirms."
        actions={
          <ButtonLink href={`/people/${person.id}/contacts`} size="sm">
            Configure
          </ButtonLink>
        }
      >
        {trustedCircle.length === 0 ? (
          <EmptyState
            title="No trusted contacts yet"
            action={
              <ButtonLink href={`/people/${person.id}/contacts`} variant="primary" size="sm">
                Add the first one
              </ButtonLink>
            }
          >
            Without one, KinCall has nobody to call when a check-in needs attention, and the event
            can only end unresolved.
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-2">
            {trustedCircle.map((contact, index) => (
              <li
                key={contact.id}
                className="rounded-kc border border-line bg-sunken px-4 py-3"
              >
                <span className="text-sm">
                  <span className="text-subtle">{contact.priority}.</span>{" "}
                  <span className="font-medium">{contact.firstName}</span>
                  <span className="text-muted"> — {contact.relationship}</span>
                </span>
                <span className="ml-2 font-mono text-xs text-subtle">
                  {maskPhone(contact.phone)}
                </span>
                {contactReadiness[index].kind === "consent_missing" ||
                contactReadiness[index].kind === "phone_missing" ? (
                  <span className="mt-1 block text-xs text-attention-ink">
                    {contactReadiness[index].kind === "consent_missing"
                      ? "Consent not confirmed — skipped by the cascade."
                      : "Phone configuration missing — cannot be called in live mode."}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Calls and decisions">
        {events.length === 0 ? (
          <EmptyState title="No check-in has run yet">
            Launch one below to see the full sequence of calls and decisions.
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-2">
            {events.map((event) => {
              const eventStatus = describePersonStatus(event);
              return (
                <li key={event.id}>
                  <Link
                    href={`/events/${event.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-kc border border-line bg-sunken px-4 py-3 transition-colors hover:border-line-strong"
                  >
                    <span className="font-mono text-xs text-subtle">
                      {formatDateTime(event.createdAt)}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={STATUS_TONE[eventStatus.tone]}>{eventStatus.label}</Badge>
                      {event.decisionReason ? (
                        <span className="text-muted">{event.decisionReason}</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Card title="Run a check-in">
        <LaunchDemoButton
          personId={person.id}
          // A check-in cannot be launched for someone who has not consented
          // (§17.1 / DEC-007), so the button explains itself rather than failing
          // after the click.
          blockedReason={readiness.kind === "consent_missing" ? readiness.message : undefined}
          // Fake mode only (DEC-011): in live mode this is undefined, so no selector
          // is rendered and no scenario is ever sent.
          scenarios={demoScenarios}
        />
      </Card>
    </PageShell>
  );
}

function CallReadinessNotice({
  readiness,
  subject,
}: {
  readiness: CallReadiness;
  subject: string;
}) {
  if (readiness.kind === "ready" || readiness.kind === "fake_mode") return null;

  return (
    <Notice tone="attention">
      {readiness.kind === "consent_missing"
        ? readiness.message
        : `Phone configuration missing for ${subject}. ${readiness.message}`}
    </Notice>
  );
}
