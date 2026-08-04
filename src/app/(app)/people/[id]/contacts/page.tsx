import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/backend/persistence/store";
import { maskPhone } from "@/shared/utilities/phone";
import { describeCallReadiness } from "@/backend/presentation/person-status";
import { PageHeader, PageShell } from "@/frontend/design-system/surfaces";
import { ContactManager } from "./contact-manager";

// PRODUCT_SPECIFICATION.md §13.1: "création d'un cercle de confiance" and
// "configuration de l'ordre des contacts"; §10, where the order determines
// the cascade. Stage E (docs/DECISION_LOG.md DEC-017) adds primary/enabled/
// availability/max-attempts configuration. UI/UX cleanup pass: the default
// card no longer shows per-contact statistics, so this page no longer fetches
// this person's call-event history just to compute them — see
// contact-manager.tsx's own note; src/backend/kpi/contact-stats.ts is unused here but
// otherwise untouched.
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

  // Computed on the server: readiness depends on CALLE_MODE and the
  // environment variables, neither of which the browser can see.
  const readiness = Object.fromEntries(
    contacts.map((contact) => [contact.id, describeCallReadiness(contact)])
  );

  // The real phone number must never cross into a Client Component's props —
  // those get serialized into the page payload sent to the browser. Only the
  // masked form is passed to ContactManager.
  const contactSummaries = contacts.map((contact) => ({
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
  }));

  return (
    <PageShell width="narrow">
      <div className="flex flex-col gap-4">
        <Link href={`/people/${person.id}`} className="w-fit text-sm text-muted hover:text-accent">
          ← {person.firstName}
        </Link>
        <PageHeader title="Trusted circle" />
      </div>

      <ContactManager
        personId={person.id}
        personName={person.firstName}
        contacts={contactSummaries}
        readiness={readiness}
      />
    </PageShell>
  );
}
