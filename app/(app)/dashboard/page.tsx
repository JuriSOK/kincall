import Link from "next/link";
import { getRepository } from "@/lib/database/store";
import { describeCallReadiness, describePersonStatus } from "@/lib/orchestration/person-status";
import { detectConfigurationGaps, type ConfigurationGap } from "@/lib/dashboard/configuration-gaps";
import { groupByDay } from "@/lib/dashboard/group-by-day";
import { partitionUnresolvedEvents } from "@/lib/dashboard/partition-unresolved";
import { computeUpcomingCheckIns } from "@/lib/dashboard/upcoming-check-ins";
import { computeCheckInKpis, groupCallEventsByEvent } from "@/lib/kpi/dashboard-kpis";
import { parsePeriod, periodSince } from "@/lib/kpi/period";
import { describeAction } from "@/lib/presentation/event-summary";
import { buildHistoryEventView } from "@/lib/presentation/history-view";
import { STATUS_TONE } from "@/lib/presentation/status-tone";
import { computeNextCheckIn } from "@/lib/schedule/next-check-in";
import { formatNextCheckIn, formatOccurrence } from "@/lib/schedule/format-schedule";
import { ActivityRow } from "@/app/ui/activity-row";
import { Avatar } from "@/app/ui/avatars/avatar";
import { ButtonLink } from "@/app/ui/button";
import { KpiCard } from "@/app/ui/kpi-card";
import { PeriodSelector } from "@/app/ui/period-selector";
import { ProfileCard } from "@/app/ui/profile-card";
import { Card, EmptyState, Notice, PageHeader, PageShell } from "@/app/ui/surfaces";

// A generous but explicit bound, not an unbounded read — see
// Repository.listRecentEvents's own contract. Fine for a hackathon-scale
// dataset; a production deployment with real call volume would want this
// paginated rather than raised.
const RECENT_EVENTS_LIMIT = 500;
// How many rows the "Recent activity" section itself shows — deliberately
// smaller than the KPI window: the KPI strip should reflect the whole period,
// but a glanceable activity feed does not need hundreds of rows. The full,
// filterable list lives on /history.
const RECENT_ACTIVITY_DISPLAY_LIMIT = 20;
// How many rows "Upcoming check-ins" shows (Stage D / DEC-016) — a
// glanceable preview, not the full schedule; every profile still has its own
// computed next check-in on its person page.
const UPCOMING_CHECK_INS_LIMIT = 8;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params.period);
  const repository = getRepository();

  const people = await repository.listPeople();

  // Stage D (DEC-016): computed once for this render and threaded through
  // every schedule computation below, so "today"/"tomorrow" and every
  // occurrence agree with each other within a single page load.
  const now = new Date();

  // Per-person data needed for profile cards and configuration gaps. Bounded
  // by the number of profiles, which is small at any realistic scale for this
  // product — not worth a dedicated batch repository method the way
  // per-EVENT reads were (an event count can be large even with few people).
  const perPerson = await Promise.all(
    people.map(async (person) => {
      const [latestEvents, activeContacts] = await Promise.all([
        repository.listEvents(person.id, 1),
        repository.getActiveTrustedContacts(person.id),
      ]);
      const personReadiness = describeCallReadiness(person);
      const contactReadiness = activeContacts.map((contact) => describeCallReadiness(contact));
      const nextCheckIn = computeNextCheckIn(
        {
          timezone: person.timezone,
          preferredCallTime: person.preferredCallTime,
          checkInDays: person.checkInDays,
          scheduleState: person.scheduleState,
        },
        now
      );
      return {
        person,
        latestEvent: latestEvents[0],
        activeContacts,
        personReadiness,
        contactReadiness,
        nextCheckIn,
      };
    })
  );

  const configurationGaps: ConfigurationGap[] = perPerson.flatMap(
    ({ person, personReadiness, activeContacts, contactReadiness }) =>
      detectConfigurationGaps(person, personReadiness, activeContacts, contactReadiness)
  );

  // Schedule configuration counts (§7 of the Stage D brief) — current
  // configuration snapshots, NOT metrics over the selected KPI period, which
  // is exactly why they are rendered in their own card rather than folded
  // into the "Operational activity" strip below. Partitioned directly from
  // each person's own computeNextCheckIn `kind`, so this can never disagree
  // with what that person's own page or profile card shows: "scheduled" is
  // active-with-valid-config, "paused" is a deliberate pause, and both
  // "inactive" and "no_days_selected" mean the schedule is not fully set up.
  const activeScheduleCount = perPerson.filter((p) => p.nextCheckIn.kind === "scheduled").length;
  const pausedScheduleCount = perPerson.filter((p) => p.nextCheckIn.kind === "paused").length;
  const incompleteScheduleCount = perPerson.filter(
    (p) => p.nextCheckIn.kind === "inactive" || p.nextCheckIn.kind === "no_days_selected"
  ).length;

  // "Upcoming check-ins" (§4 of the Stage D brief) — sorted chronologically
  // and bounded, via the pure lib/dashboard/upcoming-check-ins.ts helper.
  // Paused/inactive/unconfigured profiles are excluded entirely by that
  // helper, never shown with a placeholder. Rendering this list creates
  // nothing: it is read-only, computed fresh on every request.
  const upcomingCheckIns = computeUpcomingCheckIns(
    people.map((person) => ({
      personId: person.id,
      personName: person.firstName,
      avatarKey: person.avatarKey,
      schedule: {
        timezone: person.timezone,
        preferredCallTime: person.preferredCallTime,
        checkInDays: person.checkInDays,
        scheduleState: person.scheduleState,
      },
    })),
    now,
    UPCOMING_CHECK_INS_LIMIT
  );

  // The period-bounded, cross-person read that backs both the KPI strip and
  // "Recent activity" — see Repository.listRecentEvents.
  const since = periodSince(period);
  const recentEvents = await repository.listRecentEvents({ since, limit: RECENT_EVENTS_LIMIT });
  const callEvents = await repository.listCallEventsForEvents(recentEvents.map((event) => event.id));
  const callEventsByEvent = groupCallEventsByEvent(callEvents);
  const kpis = computeCheckInKpis(recentEvents, callEventsByEvent);

  // Name + avatar for every event in the window, including a person not in
  // the active `people` list (archived) — DEC-009 requires an archived
  // person's history to keep resolving correctly, cross-person reads
  // included. Avatar rendering falls back to initials regardless, so a
  // missing/unresolvable entry never breaks anything below.
  const personById = new Map(
    people.map((person) => [person.id, { firstName: person.firstName, avatarKey: person.avatarKey }])
  );
  const missingPersonIds = [...new Set(recentEvents.map((event) => event.personId))].filter(
    (id) => !personById.has(id)
  );
  const archivedPeople = await Promise.all(missingPersonIds.map((id) => repository.getPerson(id)));
  for (const archived of archivedPeople) {
    if (archived) personById.set(archived.id, { firstName: archived.firstName, avatarKey: archived.avatarKey });
  }

  const views = recentEvents.map((event) => {
    const resolved = personById.get(event.personId);
    return buildHistoryEventView(
      event,
      resolved?.firstName ?? "Unknown profile",
      callEventsByEvent.get(event.id) ?? [],
      resolved?.avatarKey ?? null
    );
  });
  const { unresolved: unresolvedViews, rest: otherViews } = partitionUnresolvedEvents(views);
  const recentActivityGroups = groupByDay(otherViews.slice(0, RECENT_ACTIVITY_DISPLAY_LIMIT));

  return (
    <PageShell>
      <PageHeader
        title="Dashboard"
        lead="An overview of every profile KinCall checks in on."
        actions={
          <ButtonLink href="/people/new" variant="primary">
            Add a loved one
          </ButtonLink>
        }
      />

      {/* A — Needs attention now (§7A). Always first, regardless of period:
          an autonomous dead end (DEC-011) should never be hidden behind a
          "last 7 days" filter a visitor happened to leave selected. */}
      <Card title="Needs attention now">
        {unresolvedViews.length === 0 ? (
          <EmptyState title="Nothing currently needs attention.">
            Every check-in either closed normally or is still being worked through the trusted
            circle.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {unresolvedViews.map((view) => (
              <ActivityRow key={view.eventId} view={view} />
            ))}
          </div>
        )}
      </Card>

      {/* B — Configuration gaps (§7B). */}
      {configurationGaps.length > 0 ? (
        <Card title="Configuration gaps">
          <ul className="flex flex-col gap-2">
            {configurationGaps.map((gap, index) => (
              <li key={`${gap.personId}-${gap.kind}-${index}`}>
                <Notice tone="attention">
                  <a href={gap.href} className="hover:underline">
                    {gap.message}
                  </a>
                </Notice>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* C — KPI strip (§8). Count-based only; see lib/kpi/dashboard-kpis.ts
          for exactly what is and is not computed, and why. */}
      <Card
        title="Operational activity"
        description="Operational activity only — not a health assessment."
        actions={<PeriodSelector current={period} basePath="/dashboard" />}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
            label="Person answered"
            value={
              kpis.personReached.percentage === null
                ? "Not enough data"
                : `${kpis.personReached.count} (${kpis.personReached.percentage}%)`
            }
            sampleSize={kpis.personReached.total}
          />
          <KpiCard
            label="Attempts before confirmation"
            value={
              kpis.meanFamilyAttemptsBeforeConfirmation.mean === null
                ? "Not enough data"
                : kpis.meanFamilyAttemptsBeforeConfirmation.mean.toFixed(1)
            }
            sampleSize={kpis.meanFamilyAttemptsBeforeConfirmation.sampleSize}
          />
          <KpiCard
            label="No active circle"
            value={String(perPerson.filter((p) => p.activeContacts.length === 0).length)}
          />
        </div>
      </Card>

      {/* Schedule configuration (Stage D / DEC-016). Current configuration
          snapshots, not metrics over the period selected above — kept in its
          own card, visually separate from "Operational activity", so the two
          are never mistaken for the same kind of number. */}
      <Card
        title="Schedule configuration"
        description="Current configuration only — not an event-period metric."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard label="Active schedules" value={String(activeScheduleCount)} />
          <KpiCard label="Paused schedules" value={String(pausedScheduleCount)} />
          <KpiCard label="Incomplete configuration" value={String(incompleteScheduleCount)} />
        </div>
      </Card>

      {/* Upcoming check-ins (Stage D / DEC-016). A planned configuration
          preview, never a guarantee — no scheduler places these calls
          automatically, and rendering this list creates no event. */}
      <Card
        title="Upcoming check-ins"
        description="Scheduled configuration, not a guarantee — no automatic scheduler places these calls yet."
      >
        {upcomingCheckIns.length === 0 ? (
          <EmptyState title="No upcoming check-ins">
            Every profile is paused, inactive, or has no check-in days selected.
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-2">
            {upcomingCheckIns.map((item) => (
              <li key={item.personId}>
                <Link
                  href={`/people/${item.personId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-kc border border-line bg-sunken px-4 py-3 transition-colors hover:border-line-strong"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Avatar avatarKey={item.avatarKey} name={item.personName} size="sm" />
                    {item.personName}
                  </span>
                  <span className="text-xs text-subtle">
                    {formatOccurrence(item.nextOccurrenceIso, item.timezone, now)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* D — People (§7D). */}
      <Card title="People" description={`${people.length} ${people.length === 1 ? "profile" : "profiles"}`}>
        {people.length === 0 ? (
          <EmptyState
            title="No profiles yet"
            action={
              <ButtonLink href="/people/new" variant="primary" size="sm">
                Add a loved one
              </ButtonLink>
            }
          >
            Add the person you want KinCall to check in on, then build their trusted circle.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {perPerson.map(({ person, latestEvent, activeContacts, contactReadiness, nextCheckIn }) => {
              // Computed directly from the person's own true latest event —
              // NEVER looked up in `views`, which is bounded to the selected
              // KPI period and would otherwise misreport "No check-in yet"
              // for anyone whose latest check-in falls outside a short
              // period (e.g. "Last 7 days") despite one existing.
              const status = describePersonStatus(latestEvent);
              return (
                <ProfileCard
                  key={person.id}
                  personId={person.id}
                  personName={person.firstName}
                  avatarKey={person.avatarKey}
                  statusLabel={status.label}
                  statusTone={STATUS_TONE[status.tone]}
                  latestResultSummary={
                    latestEvent ? describeAction(latestEvent) : "No check-in has run yet."
                  }
                  scheduleSummary={formatNextCheckIn(nextCheckIn, person.timezone, now)}
                  circleCount={activeContacts.length}
                  circleConsentGapCount={
                    contactReadiness.filter((r) => r.kind === "consent_missing").length
                  }
                />
              );
            })}
          </div>
        )}
      </Card>

      {/* E — Recent activity (§7E). */}
      <Card title="Recent activity">
        {recentActivityGroups.length === 0 ? (
          <EmptyState title="No recent activity in this period">
            Widen the period above, or launch a check-in from a profile page.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {recentActivityGroups.map((group) => (
              <div key={group.dayKey} className="flex flex-col gap-2">
                <h4 className="text-xs font-medium uppercase tracking-wide text-subtle">
                  {group.dayKey}
                </h4>
                <div className="flex flex-col gap-2">
                  {group.items.map((view) => (
                    <ActivityRow key={view.eventId} view={view} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageShell>
  );
}
