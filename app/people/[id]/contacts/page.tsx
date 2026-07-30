import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/lib/database/store";
import { maskPhone } from "@/lib/phone";
import { describeCallReadiness } from "@/lib/orchestration/person-status";
import { PageHeader, PageShell } from "@/app/ui/surfaces";
import { ContactManager } from "./contact-manager";

// PRODUCT_SPECIFICATION.md §13.1: "création d'un cercle de confiance" and
// "configuration de l'ordre des contacts"; §10, where the order determines
// the cascade.
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
  }));

  return (
    <PageShell width="narrow">
      <div className="flex flex-col gap-4">
        <Link href={`/people/${person.id}`} className="w-fit text-sm text-muted hover:text-accent">
          ← {person.firstName}
        </Link>
        <PageHeader
          title="Trusted circle"
          lead={`The people KinCall calls when a check-in for ${person.firstName} needs attention. Each is called at most twice, and the cascade stops as soon as someone confirms.`}
        />
      </div>

      <ContactManager personId={person.id} contacts={contactSummaries} readiness={readiness} />
    </PageShell>
  );
}
