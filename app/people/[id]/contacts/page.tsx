import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/lib/database/store";
import { describeCallReadiness } from "@/lib/orchestration/person-status";
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

  const contacts = await repository.getTrustedContacts(person.id);

  // Computed on the server: readiness depends on CALLE_MODE and the
  // environment variables, neither of which the browser can see.
  const readiness = Object.fromEntries(
    contacts.map((contact) => [contact.id, describeCallReadiness(contact)])
  );

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-8 p-8">
      <div className="flex flex-col gap-1">
        <Link href={`/people/${person.id}`} className="text-sm opacity-60 hover:underline">
          ← {person.firstName}
        </Link>
        <h1 className="text-3xl font-semibold">Trusted circle</h1>
      </div>

      <ContactManager personId={person.id} contacts={contacts} readiness={readiness} />
    </main>
  );
}
