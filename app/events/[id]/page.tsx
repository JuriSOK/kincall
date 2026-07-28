import Link from "next/link";
import { notFound } from "next/navigation";
import { isFamilyStructuredResult } from "@/lib/calle/schemas";
import type { FamilyStructuredResult } from "@/lib/calle/schemas";
import { getRepository } from "@/lib/database/store";
import type { CallEventRecord } from "@/lib/database/types";

function findConfirmation(callEvents: CallEventRecord[]): FamilyStructuredResult | null {
  for (const callEvent of callEvents) {
    if (callEvent.agentType !== "family") continue;
    if (!isFamilyStructuredResult(callEvent.structuredResult)) continue;
    if (callEvent.structuredResult.can_intervene) {
      return callEvent.structuredResult;
    }
  }
  return null;
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const event = repository.getEvent(id);

  if (!event) {
    notFound();
  }

  const person = repository.getPerson(event.personId);
  const timeline = repository.listTimeline(event.id);
  const callEvents = repository.listCallEvents(event.id);
  const confirmation = findConfirmation(callEvents);
  const companionCallEvent = callEvents.find((call) => call.agentType === "companion");

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-8 p-8">
      <div className="flex flex-col gap-1">
        <Link href={`/people/${event.personId}`} className="text-sm opacity-60 hover:underline">
          ← {person?.firstName ?? "Back"}
        </Link>
        <h1 className="text-3xl font-semibold">Event {event.id}</h1>
        <p className="text-sm opacity-60">Status: {event.status}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Timeline</h2>
        <ol className="flex flex-col gap-1 font-mono text-sm">
          {timeline.map((entry) => (
            <li key={entry.id}>
              {new Date(entry.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              — {entry.message}
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Summary</h2>
        <div className="flex flex-col gap-3 rounded-md border border-black/10 p-4 text-sm dark:border-white/10">
          <div>
            <p className="font-medium">What happened?</p>
            <p className="opacity-80">
              {companionCallEvent?.summary ?? "No summary available yet."}
            </p>
          </div>
          <div>
            <p className="font-medium">What did KinCall do?</p>
            <p className="opacity-80">
              {event.decision === "CONTACT_TRUSTED_PERSON"
                ? "KinCall contacted the trusted circle."
                : "KinCall reviewed the check-in and found nothing unusual."}
            </p>
          </div>
          <div>
            <p className="font-medium">Who is taking care of it?</p>
            <p className="opacity-80">
              {confirmation
                ? confirmation.summary
                : event.status === "HUMAN_REVIEW_REQUIRED"
                  ? "No contact confirmed yet — flagged for human review."
                  : "No intervention required."}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
