import Link from "next/link";
import { notFound } from "next/navigation";
import { listDemoScenarios } from "@/lib/calle/demo-scenarios";
import { getRepository } from "@/lib/database/store";
import { maskPhone } from "@/lib/phone";
import type { CallReadiness } from "@/lib/orchestration/person-status";
import { describeCallReadiness, describePersonStatus } from "@/lib/orchestration/person-status";
import { computeCheckInKpis, groupCallEventsByEvent } from "@/lib/kpi/dashboard-kpis";
import { parseProfilePeriod, profilePeriodSince } from "@/lib/kpi/period";
import { buildInterventionSummary } from "@/lib/presentation/intervention-summary";
import { computeNextCheckIn } from "@/lib/schedule/next-check-in";
import { formatCheckInDays, formatNextCheckIn, SCHEDULE_STATE_LABEL } from "@/lib/schedule/format-schedule";
import { formatDateTime } from "@/lib/presentation/format-date";
import {
  describeConsentStatus,
  describeConversationProfile,
  describeLanguage,
} from "@/lib/presentation/labels";
import { STATUS_TONE } from "@/lib/presentation/status-tone";
import { Avatar } from "@/app/ui/avatars/avatar";
import { ButtonLink } from "@/app/ui/button";
import { KpiCard } from "@/app/ui/kpi-card";
import { ProfilePeriodSelector } from "@/app/ui/profile-period-selector";
import { Badge, Card, DetailRow, EmptyState, Notice, PageHeader, PageShell } from "@/app/ui/surfaces";
import { DeletePersonButton } from "../delete-person-button";
import { LaunchDemoButton } from "./launch-demo-button";
import { ScheduleToggleButton } from "./schedule-toggle-button";

// How many rows the "Calls and decisions" list itself shows — within the
// already period-filtered set, so a wide period on a long history still
// shows only the most recent slice.
const EVENT_HISTORY_DISPLAY_LIMIT = 20;

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const { id } = await params;
  const { period: periodParam } = await searchParams;
  const period = parseProfilePeriod(periodParam);
  const repository = getRepository();
  const person = await repository.getPerson(id);

  if (!person) {
    notFound();
  }

  // Active-only (DEC-009) for the circle DISPLAY: an archived contact must
  // disappear from it. `historicalContacts` is the unfiltered list, used only
  // to resolve the accepting contact's name on a past event — a contact
  // archived after the fact must still resolve there (the same rule
  // app/(app)/events/[id]/page.tsx follows).
  const [trustedCircle, historicalContacts, events] = await Promise.all([
    repository.getActiveTrustedContacts(person.id),
    repository.getTrustedContacts(person.id),
    repository.listEvents(person.id),
  ]);

  // Person-specific Stage-B KPI: the same computeCheckInKpis the dashboard
  // uses. UI/UX cleanup pass: Activity and Calls-and-decisions share one
  // `?period=` window, filtered in memory over the already-fetched (and
  // already person-bounded) `events` list — no new database read is
  // introduced. `events` itself (unfiltered) is kept around only to tell
  // "never had a check-in" apart from "none in this period".
  const periodSinceIso = profilePeriodSince(period);
  const periodEvents = events.filter((event) => event.createdAt >= periodSinceIso);
  const callEvents = await repository.listCallEventsForEvents(events.map((event) => event.id));
  const callEventsByEvent = groupCallEventsByEvent(callEvents);
  const kpis = computeCheckInKpis(periodEvents, callEventsByEvent);

  // Stage D: the deterministic next-check-in calculation (DEC-016) — stored
  // configuration only, never a claim that a scheduler will actually place
  // this call. `now` is computed once, server-side, for this render; nothing
  // here writes anything or creates any event.
  const now = new Date();
  const nextCheckIn = computeNextCheckIn(
    {
      timezone: person.timezone,
      preferredCallTime: person.preferredCallTime,
      checkInDays: person.checkInDays,
      scheduleState: person.scheduleState,
    },
    now
  );

  // Fake-mode demo scenarios (DEC-011). Undefined in live mode, which is what
  // keeps the selector out of the interface entirely rather than merely disabled.
  const demoScenarios = listDemoScenarios();

  // §14.2's Status line, derived from the most recent event.
  const status = describePersonStatus(events[0]);
  const readiness = describeCallReadiness(person);
  const contactReadiness = trustedCircle.map((contact) => describeCallReadiness(contact));

  // Stage E (DEC-017): a circle-health summary — computed here, once, from
  // the same active circle everything else on this page already reads.
  // "No primary contact" is shown as an informational fact, never an error:
  // primary status is a visual indicator only and is never required for the
  // cascade to work.
  const primaryContact = trustedCircle.find((contact) => contact.isPrimary);
  const disabledCount = trustedCircle.filter((contact) => !contact.enabled).length;
  const consentMissingCount = trustedCircle.filter(
    (contact) => contact.consentStatus !== "confirmed"
  ).length;
  const eligibleCount = trustedCircle.filter(
    (contact) => contact.enabled && contact.consentStatus === "confirmed"
  ).length;

  return (
    <PageShell width="narrow">
      <div className="flex flex-col gap-4">
        <Link href="/dashboard" className="w-fit text-sm text-muted hover:text-accent">
          ← Dashboard
        </Link>

        <PageHeader
          title={person.firstName}
          actions={
            <>
              <ButtonLink href={`/people/${person.id}/edit`} size="sm">
                Edit profile
              </ButtonLink>
              <DeletePersonButton
                personId={person.id}
                personName={person.firstName}
                mode="redirect-dashboard"
              />
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <Avatar avatarKey={person.avatarKey} name={person.firstName} size="lg" />
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={STATUS_TONE[status.tone]}>{status.label}</Badge>
            <Badge tone={person.consentStatus === "confirmed" ? "calm" : "attention"}>
              Consent: {describeConsentStatus(person.consentStatus)}
            </Badge>
            <span className="font-mono text-sm text-subtle">{maskPhone(person.phone)}</span>
          </div>
        </div>
      </div>

      <CallReadinessNotice readiness={readiness} subject={person.firstName} />

      <Card title="Profile">
        <dl className="flex flex-col divide-y divide-line">
          <DetailRow label="Language">{describeLanguage(person.preferredLanguage)}</DetailRow>
          <DetailRow label="Conversation profile">
            {describeConversationProfile(person.conversationProfile)}
          </DetailRow>
          <DetailRow label="Interests">
            {person.interests.length > 0 ? person.interests.join(", ") : "None entered"}
          </DetailRow>
          {person.conversationNotes ? (
            <DetailRow label="Conversation notes">{person.conversationNotes}</DetailRow>
          ) : null}
        </dl>
      </Card>

      {/* Stage D (DEC-016): everything about WHEN KinCall checks in, together
          — configuration, the computed next planned occurrence, and the one
          real trigger this product has (Call now / Launch demo). */}
      <Card
        title="Schedule"
        actions={
          <ScheduleToggleButton
            personId={person.id}
            personName={person.firstName}
            scheduleState={person.scheduleState}
          />
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              tone={
                person.scheduleState === "active"
                  ? "calm"
                  : person.scheduleState === "paused"
                    ? "attention"
                    : "neutral"
              }
            >
              {SCHEDULE_STATE_LABEL[person.scheduleState] ?? person.scheduleState}
            </Badge>
            {/* Timezone and local time announced together in one text node,
                not as disconnected fragments — lib/schedule/format-schedule.ts's
                own doc comment explains why. */}
            <p className="text-sm font-medium">
              {formatNextCheckIn(nextCheckIn, person.timezone, now)}
            </p>
          </div>

          <dl className="flex flex-col divide-y divide-line">
            <DetailRow label="Timezone">{person.timezone}</DetailRow>
            <DetailRow label="Preferred check-in time">{person.preferredCallTime}</DetailRow>
            <DetailRow label="Check-in days">{formatCheckInDays(person.checkInDays)}</DetailRow>
          </dl>

          <p className="text-xs text-subtle">
            Stored configuration only — no production scheduler places this call
            automatically yet. Use Launch demo below to check in now.
          </p>

          <LaunchDemoButton
            personId={person.id}
            // A check-in cannot be launched for someone who has not consented
            // (§17.1 / DEC-007), so the button explains itself rather than
            // failing after the click.
            blockedReason={readiness.kind === "consent_missing" ? readiness.message : undefined}
            // Fake mode only (DEC-011): in live mode this is undefined, so no
            // selector is rendered and no scenario is ever sent.
            scenarios={demoScenarios}
          />
        </div>
      </Card>

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
          <div className="flex flex-col gap-3">
            {/* Stage E (DEC-017): a concise circle-health summary — primary
                contact, how many would actually be tried, and how many are
                sitting out (disabled or missing consent) — before the full
                per-contact list below. */}
            <p className="text-sm text-muted">
              {primaryContact ? (
                <>
                  Primary contact: <span className="font-medium text-ink">{primaryContact.firstName}</span>.{" "}
                </>
              ) : (
                "No primary contact set. "
              )}
              {eligibleCount} of {trustedCircle.length} would be tried
              {disabledCount + consentMissingCount > 0
                ? ` (${[
                    disabledCount > 0 ? `${disabledCount} disabled` : null,
                    consentMissingCount > 0 ? `${consentMissingCount} missing consent` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")})`
                : ""}
              .
            </p>

            <ol className="flex flex-col gap-2">
              {trustedCircle.map((contact, index) => (
                <li
                  key={contact.id}
                  className="rounded-kc border border-line bg-sunken px-4 py-3"
                >
                  <span className="text-sm">
                    <span className="text-subtle">{contact.priority}.</span>{" "}
                    <span className="font-medium">{contact.firstName}</span>
                    {contact.isPrimary ? (
                      <span className="ml-2">
                        <Badge tone="calm">Primary</Badge>
                      </span>
                    ) : null}
                    {!contact.enabled ? (
                      <span className="ml-2">
                        <Badge tone="neutral">Disabled</Badge>
                      </span>
                    ) : null}
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
          </div>
        )}
      </Card>

      <Card
        title="Activity"
        actions={
          <ProfilePeriodSelector
            current={period}
            basePath={`/people/${person.id}`}
          />
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard label="Check-ins" value={String(kpis.totalCheckIns)} />
          <KpiCard
            label="Normal"
            value={
              kpis.normalCheckIns.percentage === null
                ? "Not enough data"
                : `${kpis.normalCheckIns.count} (${kpis.normalCheckIns.percentage}%)`
            }
            sampleSize={kpis.normalCheckIns.total}
          />
          <KpiCard
            label="Reached the circle"
            value={
              kpis.cascadesTriggered.percentage === null
                ? "Not enough data"
                : `${kpis.cascadesTriggered.count} (${kpis.cascadesTriggered.percentage}%)`
            }
            sampleSize={kpis.cascadesTriggered.total}
          />
          <KpiCard label="Unresolved" value={String(kpis.attentionUnresolvedCount)} />
          <KpiCard
            label="Answered"
            value={
              kpis.personReached.percentage === null
                ? "Not enough data"
                : `${kpis.personReached.count} (${kpis.personReached.percentage}%)`
            }
            sampleSize={kpis.personReached.total}
          />
        </div>
      </Card>

      <Card
        title="Calls and decisions"
        actions={
          <ProfilePeriodSelector
            current={period}
            basePath={`/people/${person.id}`}
          />
        }
      >
        {events.length === 0 ? (
          <EmptyState title="No check-in has run yet">
            Launch one above to see the full sequence of calls and decisions.
          </EmptyState>
        ) : periodEvents.length === 0 ? (
          <EmptyState title="No check-ins in this period" />
        ) : (
          <ol className="flex flex-col gap-2">
            {periodEvents.slice(0, EVENT_HISTORY_DISPLAY_LIMIT).map((event) => {
              const eventStatus = describePersonStatus(event);
              // Stage F (DEC-019): the same one-line sentence the event page's
              // card leads with, so this list and that page never describe the
              // same intervention differently. Null — and therefore absent —
              // whenever no trusted contact actually confirmed. The full card,
              // the timeline and the per-call detail stay on the event page.
              const intervention = buildInterventionSummary(
                event,
                callEventsByEvent.get(event.id) ?? [],
                historicalContacts
              );
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
                      {intervention ? (
                        <span className="font-medium text-calm-ink">{intervention.concise}</span>
                      ) : event.decisionReason ? (
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
