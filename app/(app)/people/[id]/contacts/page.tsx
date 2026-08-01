import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/lib/database/store";
import { maskPhone } from "@/lib/phone";
import { describeCallReadiness } from "@/lib/orchestration/person-status";
import { computeContactStatsByContact } from "@/lib/kpi/contact-stats";
import { formatDateTime } from "@/lib/presentation/format-date";
import { PageHeader, PageShell } from "@/app/ui/surfaces";
import { ContactManager } from "./contact-manager";

// PRODUCT_SPECIFICATION.md §13.1: "création d'un cercle de confiance" and
// "configuration de l'ordre des contacts"; §10, where the order determines
// the cascade. Stage E (docs/DECISION_LOG.md DEC-017) adds primary/enabled/
// availability/max-attempts configuration and per-contact statistics.
export default async function ContactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const person = await repository.getPerson(id);

  if (!person) {
    notFound();
  }

  // Active-only (DEC-009): management/reordering must never see or touch an
  // archived contact.
  const contacts = await repository.getActiveTrustedContacts(person.id);

  // This person's FULL event history (unbounded, like the person page's own
  // KPI panel), batched into one call-event read — the source for every
  // contact's operational statistics (Stage E, §9).
  const events = await repository.listEvents(person.id);
  const callEvents = await repository.listCallEventsForEvents(events.map((event) => event.id));
  const statsByContact = computeContactStatsByContact(callEvents);

  // Computed on the server: readiness depends on CALLE_MODE and the
  // environment variables, neither of which the browser can see.
  const readiness = Object.fromEntries(
    contacts.map((contact) => [contact.id, describeCallReadiness(contact)])
  );

  // The real phone number must never cross into a Client Component's props —
  // those get serialized into the page payload sent to the browser. Only the
  // masked form is passed to ContactManager.
  const contactSummaries = contacts.map((contact) => {
    const stats = statsByContact.get(contact.id);
    return {
      id: contact.id,
      firstName: contact.firstName,
      relationship: contact.relationship,
      priority: contact.priority,
      maskedPhone: maskPhone(contact.phone),
      consentStatus: contact.consentStatus,
      isPrimary: contact.isPrimary,
      enabled: contact.enabled,
      callableFrom: contact.callableFrom,
      callableTo: contact.callableTo,
      timezone: contact.timezone,
      maxAttempts: contact.maxAttempts,
      stats: {
        answerRate: stats?.answerRate ?? { count: 0, total: 0, percentage: null },
        acceptanceRate: stats?.acceptanceRate ?? { count: 0, total: 0, percentage: null },
        declineRate: stats?.declineRate ?? { count: 0, total: 0, percentage: null },
        meanAttemptWhenAnswering: stats?.meanAttemptWhenAnswering ?? { mean: null, sampleSize: 0 },
        latestParticipationLabel: stats?.latestParticipationIso
          ? formatDateTime(stats.latestParticipationIso)
          : null,
        confirmedInterventions: stats?.confirmedInterventions ?? 0,
      },
    };
  });

  return (
    <PageShell width="narrow">
      <div className="flex flex-col gap-4">
        <Link href={`/people/${person.id}`} className="w-fit text-sm text-muted hover:text-accent">
          ← {person.firstName}
        </Link>
        <PageHeader
          title="Trusted circle"
          lead={`The people KinCall calls when a check-in for ${person.firstName} needs attention. Each is called at most twice (fewer if configured lower), and the cascade stops as soon as someone confirms. Availability only changes the ORDER contacts are tried in — nobody is ever excluded for being outside their usual window, and the cascade never waits for one to open.`}
        />
      </div>

      <ContactManager
        personId={person.id}
        personTimezone={person.timezone}
        contacts={contactSummaries}
        readiness={readiness}
      />
    </PageShell>
  );
}
