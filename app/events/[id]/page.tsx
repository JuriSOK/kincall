import Link from "next/link";
import { notFound } from "next/navigation";
import { isFamilyStructuredResult } from "@/lib/calle/schemas";
import type { FamilyStructuredResult } from "@/lib/calle/schemas";
import { getRepository } from "@/lib/database/store";
import type { CallEventRecord, EventRecord } from "@/lib/database/types";

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

// Keyed on status first, not decision: before a decision exists (status is
// still SCHEDULED/CALLING_PERSON/CONVERSATION_IN_PROGRESS/ANALYSING_CONVERSATION,
// or HUMAN_REVIEW_REQUIRED reached via a malformed/failed companion call)
// `event.decision` is null, and a decision-only dispatch previously fell
// through to "found nothing unusual" in exactly those cases — a false
// reassurance about a check-in that hasn't happened yet. The switch below is
// exhaustive over EventStatus so a newly added status fails typecheck here
// rather than silently reusing this fallback again.
export function describeAction(event: EventRecord): string {
  switch (event.status) {
    case "SCHEDULED":
    case "CALLING_PERSON":
    case "CONVERSATION_IN_PROGRESS":
      return "Check-in in progress.";
    case "ANALYSING_CONVERSATION":
      return "KinCall is analysing the conversation.";
    case "PERSON_DID_NOT_ANSWER":
      return "KinCall called but did not reach the person — a retry is owed.";
    case "ATTENTION_REQUIRED":
      return "KinCall detected a concerning signal — a trusted contact needs to be contacted.";
    case "CALLING_TRUSTED_CONTACT":
    case "CONTACT_DID_NOT_ANSWER":
    case "CONTACT_DECLINED":
    case "CONTACT_CONFIRMED":
      return "KinCall contacted the trusted circle.";
    case "HUMAN_REVIEW_REQUIRED":
      return event.decision === "REQUEST_HUMAN_REVIEW"
        ? "KinCall could not confirm that the check-in reached the person."
        : "Human review is required.";
    case "NO_ACTION_REQUIRED":
    case "CASE_CLOSED":
      return event.decision === "CONTACT_TRUSTED_PERSON"
        ? "KinCall contacted the trusted circle."
        : "KinCall reviewed the check-in and found nothing unusual.";
    default: {
      const exhaustive: never = event.status;
      return exhaustive;
    }
  }
}

// Same exhaustive-over-status shape as describeAction, for the same reason:
// "No intervention required." must only ever describe a closed, no-signal
// case, never an event where nothing has been decided yet.
export function describeOwnership(event: EventRecord): string {
  switch (event.status) {
    case "SCHEDULED":
    case "CALLING_PERSON":
    case "CONVERSATION_IN_PROGRESS":
    case "ANALYSING_CONVERSATION":
      return "Not yet known — the check-in hasn't finished.";
    case "PERSON_DID_NOT_ANSWER":
      return "Nobody yet — the person was not reached, so a retry is owed.";
    case "ATTENTION_REQUIRED":
      return "Not yet — a trusted contact still needs to be contacted.";
    case "CALLING_TRUSTED_CONTACT":
    case "CONTACT_DID_NOT_ANSWER":
    case "CONTACT_DECLINED":
    case "CONTACT_CONFIRMED":
      return "Not confirmed yet — KinCall is still contacting the trusted circle.";
    case "HUMAN_REVIEW_REQUIRED":
      return "No contact confirmed yet — flagged for human review.";
    case "NO_ACTION_REQUIRED":
    case "CASE_CLOSED":
      // In practice CASE_CLOSED with CONTACT_TRUSTED_PERSON always has a
      // confirmation record by the time this state is reached, so the page
      // renders confirmation.summary instead of calling this function at
      // all — this branch only guards against calling it out of that context.
      return event.decision === "CONTACT_TRUSTED_PERSON"
        ? "A trusted contact confirmed they are taking care of it."
        : "No intervention required.";
    default: {
      const exhaustive: never = event.status;
      return exhaustive;
    }
  }
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
            <p className="opacity-80">{describeAction(event)}</p>
          </div>
          <div>
            <p className="font-medium">Who is taking care of it?</p>
            <p className="opacity-80">
              {confirmation ? confirmation.summary : describeOwnership(event)}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
