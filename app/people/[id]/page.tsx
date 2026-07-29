import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/lib/database/store";
import { maskPhone } from "@/lib/phone";
import type { CallReadiness } from "@/lib/orchestration/person-status";
import { describeCallReadiness, describePersonStatus } from "@/lib/orchestration/person-status";
import { DeletePersonButton } from "../delete-person-button";
import { LaunchDemoButton } from "./launch-demo-button";

const TONE_CLASSES = {
  calm: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  attention: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  unknown: "border-black/20 opacity-70 dark:border-white/20",
} as const;

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const person = await repository.getPerson(id);

  if (!person) {
    notFound();
  }

  // Active-only (DEC-009): an archived contact must disappear from this
  // display. Historical resolution (app/events/[id]/page.tsx) uses the
  // unfiltered getTrustedContacts instead.
  const [trustedCircle, events] = await Promise.all([
    repository.getActiveTrustedContacts(person.id),
    repository.listEvents(person.id, 20),
  ]);

  // §14.2's Status line, derived from the most recent event.
  const status = describePersonStatus(events[0]);
  const readiness = describeCallReadiness(person);
  const contactReadiness = trustedCircle.map((contact) => describeCallReadiness(contact));

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-8 p-8">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-60 hover:underline">
          ← Profiles
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-semibold">{person.firstName}</h1>
          <DeletePersonButton
            personId={person.id}
            personName={person.firstName}
            mode="redirect-home"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs ${TONE_CLASSES[status.tone]}`}>
            {status.label}
          </span>
          <span className="text-sm opacity-60">
            Next check-in: daily at {person.preferredCallTime}
          </span>
          <span className="font-mono text-sm opacity-50">{maskPhone(person.phone)}</span>
        </div>
      </div>

      <CallReadinessNotice readiness={readiness} subject={person.firstName} />

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Trusted circle</h2>
          <Link
            href={`/people/${person.id}/contacts`}
            className="text-sm opacity-60 hover:underline"
          >
            Configure
          </Link>
        </div>

        {trustedCircle.length === 0 ? (
          <p className="rounded-md border border-black/10 px-4 py-3 text-sm opacity-70 dark:border-white/10">
            No trusted contacts yet.{" "}
            <Link href={`/people/${person.id}/contacts`} className="underline">
              Add the first one
            </Link>{" "}
            — without one, a concerning check-in can only go to human review.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {trustedCircle.map((contact, index) => (
              <li
                key={contact.id}
                className="rounded-md border border-black/10 px-4 py-3 dark:border-white/10"
              >
                {contact.priority}. {contact.firstName} — {contact.relationship}
                <span className="ml-2 font-mono text-xs opacity-50">
                  {maskPhone(contact.phone)}
                </span>
                {contactReadiness[index].kind === "consent_missing" ||
                contactReadiness[index].kind === "phone_missing" ? (
                  <span className="block text-xs text-amber-700 dark:text-amber-400">
                    {contactReadiness[index].kind === "consent_missing"
                      ? "Consent not confirmed — skipped by the cascade."
                      : "Phone configuration missing — cannot be called in live mode."}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Calls and decisions
        </h2>
        {events.length === 0 ? (
          <p className="rounded-md border border-black/10 px-4 py-3 text-sm opacity-70 dark:border-white/10">
            No check-in has run yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-black/10 px-4 py-3 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30"
                >
                  <span className="font-mono text-sm">
                    {new Date(event.createdAt).toLocaleString([], {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                  <span className="text-sm opacity-70">
                    {describePersonStatus(event).label}
                    {event.decisionReason ? ` — ${event.decisionReason}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <LaunchDemoButton
        personId={person.id}
        // A check-in cannot be launched for someone who has not consented
        // (§17.1 / DEC-007), so the button explains itself rather than failing
        // after the click.
        blockedReason={readiness.kind === "consent_missing" ? readiness.message : undefined}
      />
    </main>
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
    <p className="rounded-md border border-amber-600/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
      {readiness.kind === "consent_missing"
        ? readiness.message
        : `Phone configuration missing for ${subject}. ${readiness.message}`}
    </p>
  );
}
