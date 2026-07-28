import { notFound } from "next/navigation";
import { getRepository } from "@/lib/database/store";
import { LaunchDemoButton } from "./launch-demo-button";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const person = repository.getPerson(id);

  if (!person) {
    notFound();
  }

  const trustedCircle = repository.getTrustedContacts(person.id);

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-8 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{person.firstName}</h1>
        <p className="text-sm opacity-60">Next check-in: daily at {person.preferredCallTime}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Trusted circle</h2>
        <ol className="flex flex-col gap-2">
          {trustedCircle.map((contact) => (
            <li
              key={contact.id}
              className="rounded-md border border-black/10 px-4 py-3 dark:border-white/10"
            >
              {contact.priority}. {contact.firstName} — {contact.relationship}
            </li>
          ))}
        </ol>
      </section>

      <LaunchDemoButton personId={person.id} />
    </main>
  );
}
