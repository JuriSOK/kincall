import Link from "next/link";
import { getRepository } from "@/backend/persistence/store";
import { describeCallReadiness, describePersonStatus } from "@/backend/presentation/person-status";
import { computeDailyRecapStatus } from "@/backend/dashboard/daily-recap-status";
import { detectConfigurationGaps, type ConfigurationGap } from "@/backend/dashboard/configuration-gaps";
import { groupByDay } from "@/backend/dashboard/group-by-day";
import { computeUpcomingCheckIns } from "@/backend/dashboard/upcoming-check-ins";
import { computeCheckInKpis, groupCallEventsByEvent } from "@/backend/kpi/dashboard-kpis";
import { parsePeriod, periodSince } from "@/backend/kpi/period";
import { describeAction } from "@/backend/presentation/event-summary";
import { buildHistoryEventView } from "@/backend/presentation/history-view";
import { displayAverage, displayCount, displayRate } from "@/backend/presentation/kpi-display";
import { formatTime } from "@/shared/presentation/format-date";
import { STATUS_TONE } from "@/backend/presentation/status-tone";
import { computeNextCheckIn } from "@/backend/scheduling/next-check-in";
import { formatNextCheckIn, formatOccurrence } from "@/shared/presentation/format-schedule";
import { ActivityPersonFilter } from "@/frontend/components/activity-person-filter";
import { ActivityRow } from "@/frontend/components/activity-row";
import { Avatar } from "@/frontend/components/avatars/avatar";
import { ButtonLink } from "@/frontend/design-system/button";
import { DailyRecapRow, type DailyRecapItem } from "@/frontend/components/daily-recap";
import { KpiCard } from "@/frontend/components/kpi-card";
import { PeriodSelector } from "@/frontend/components/period-selector";
import { ProfileCard } from "@/frontend/components/profile-card";
import { Card, EmptyState, Notice, PageHeader, PageShell } from "@/frontend/design-system/surfaces";

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
// How far back the Daily recap looks per person to find "today's" check-in
// (§1 of the UX correction brief). More than 1: a person can be checked in
// on more than once in a day (e.g. a manual re-launch), and the row must
// reflect the LATEST of those, not just whichever the repository happens to
// return first. Still a small, explicit bound — never an unbounded read.
const DAILY_RECAP_EVENT_LOOKBACK = 10;

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params.period);
  // UI/UX pass: narrows the "Operational activity" KPI strip only — every
  // other dashboard section (recent activity, the daily recap, people)
  // keeps showing every person, unaffected by this filter. Absent means the
  // existing "all people" behaviour, unchanged.
  const activityPersonId = firstString(params.person);
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
        repository.listEvents(person.id, DAILY_RECAP_EVENT_LOOKBACK),
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
        // The single most recent event ever — correct for the "People"
        // profile cards below, which intentionally show history rather than
        // resetting daily. The Daily recap uses the full `latestEvents`
        // lookback instead; see computeDailyRecapStatus.
        latestEvent: latestEvents[0],
        latestEvents,
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

  // "Upcoming check-ins" (§4 of the Stage D brief) — sorted chronologically
  // and bounded, via the pure src/backend/dashboard/upcoming-check-ins.ts helper.
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
  // UI/UX pass: "Operational activity" narrows to one person when selected —
  // every other section below (recent activity, the daily recap, people)
  // keeps reading the full, unfiltered `recentEvents`/`callEventsByEvent`.
  const kpiEvents = activityPersonId
    ? recentEvents.filter((event) => event.personId === activityPersonId)
    : recentEvents;
  const kpis = computeCheckInKpis(kpiEvents, callEventsByEvent);

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

  // Built from the circles perPerson already loaded, so the intervention line
  // below costs no additional query.
  const contactsByPerson = new Map(
    perPerson.map(({ person, activeContacts }) => [person.id, activeContacts])
  );

  const views = recentEvents.map((event) => {
    const resolved = personById.get(event.personId);
    return buildHistoryEventView(
      event,
      resolved?.firstName ?? "Unknown profile",
      callEventsByEvent.get(event.id) ?? [],
      resolved?.avatarKey ?? null,
      // Stage F (DEC-019): resolves the accepting contact's name for the
      // intervention line. Reuses the circle `perPerson` already fetched
      // above — no extra query. An archived person's events resolve to no
      // contacts here, and the line is simply omitted rather than guessed.
      contactsByPerson.get(event.personId) ?? []
    );
  });
  // UI/UX pass: shows every event again, unresolved included — the previous
  // exclusion existed only to avoid double-showing an unresolved event
  // against the old "Needs attention now" list. The Daily Recap block below
  // is a per-person status summary, not a per-event list, so that
  // double-display concern no longer applies.
  const recentActivityGroups = groupByDay(views.slice(0, RECENT_ACTIVITY_DISPLAY_LIMIT));

  // UI/UX pass: "Daily recap" replaces the old alert-only "Needs attention
  // now" block — one row per person, always (not only those needing
  // attention), so the section reads as an overview of the day rather than a
  // warning list. Detail is not removed, only moved one click away: each row
  // expands (native <details>, see src/frontend/components/daily-recap.tsx) to the event's own
  // decision reason and a link to the full event page. Unresolved cases still
  // sort first and keep their own distinct badge tone (DEC-011) — the
  // reframing changes how this reads, not whether an unresolved case is easy
  // to find.
  //
  // UX correction pass (§1): each row's status now comes from
  // computeDailyRecapStatus, not describePersonStatus(latestEvent) directly —
  // the latter answers "what happened most recently, ever" and would let a
  // calm result from yesterday keep reading as calm all day today. The
  // recap must instead reset to "Not checked in yet" at each person's own
  // local midnight, using their persisted timezone — never a rolling
  // 24-hour window, never the server's or browser's zone.
  const RECAP_TONE_PRIORITY: Record<string, number> = { unresolved: 0, attention: 1, unknown: 2, calm: 3 };
  const dailyRecapItems: DailyRecapItem[] = [...perPerson]
    .sort(
      (a, b) =>
        (RECAP_TONE_PRIORITY[computeDailyRecapStatus(a.latestEvents, a.person.timezone, now).tone] ?? 4) -
        (RECAP_TONE_PRIORITY[computeDailyRecapStatus(b.latestEvents, b.person.timezone, now).tone] ?? 4)
    )
    .map(({ person, latestEvents }) => {
      const daily = computeDailyRecapStatus(latestEvents, person.timezone, now);
      const event = daily.todaysEvent;
      return {
        personId: person.id,
        personName: person.firstName,
        avatarKey: person.avatarKey,
        statusLabel: daily.label,
        statusTone: STATUS_TONE[daily.tone],
        summary: daily.summary,
        // `event` is always today's own event by construction, so this is
        // always "Today, HH:MM" — never a past date, which would contradict
        // the daily-reset guarantee above.
        timeLabel: event ? `Today, ${formatTime(event.createdAt)}` : null,
        decisionReason: event?.decisionReason ?? null,
        eventHref: event ? `/events/${event.id}` : null,
        profileHref: `/people/${person.id}`,
      };
    });

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

      {/* A — Daily recap (UI/UX pass, replacing "Needs attention now"). Always
          first, regardless of period: this is deliberately NOT limited to the
          selected KPI window — "the day at a glance" should not depend on a
          filter a visitor happened to leave set. Every person gets a row;
          unresolved cases sort first and keep their own distinct tone, so
          nothing DEC-011 requires stays visible is lost — only the framing
          changed, from an alert list to a recap everyone appears in. */}
      <Card title="Daily recap">
        {dailyRecapItems.length === 0 ? (
          <EmptyState title="No profiles yet">
            Add a loved one to see their daily recap here.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {dailyRecapItems.map((item) => (
              <DailyRecapRow key={item.personId} item={item} />
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
                {/* Stage E (DEC-017): "no_primary_contact" is an informational
                    suggestion, never a blocking error — rendered in the
                    neutral tone, unlike every other configuration gap here. */}
                <Notice tone={gap.severity === "informational" ? "neutral" : "attention"}>
                  <a href={gap.href} className="hover:underline">
                    {gap.message}
                  </a>
                </Notice>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* C — KPI strip (§8). Count-based only; see src/backend/kpi/dashboard-kpis.ts
          for exactly what is and is not computed, and why. */}
      <Card
        title="Operational activity"
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <ActivityPersonFilter
              action="/dashboard"
              people={people}
              selectedPersonId={activityPersonId}
              preserveParams={{ period }}
            />
            <PeriodSelector
              current={period}
              basePath="/dashboard"
              preserveParams={{ person: activityPersonId }}
            />
          </div>
        }
      >
        {/* Six metrics, so a 3-column grid divides evenly at every breakpoint —
            the previous 4-column layout left a single orphaned card on its own
            row once "No active circle" was removed. That metric was a
            CONFIGURATION fact, not operational activity, and it is already
            reported (per person, with a link to fix it) by the Configuration
            gaps card above; showing it here duplicated it in a place where it
            could not be acted on. `detectConfigurationGaps` itself is
            unchanged. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard label="Check-ins" value={displayCount(kpis.totalCheckIns).text} />
          <KpiCard label="Normal" value={displayRate(kpis.normalCheckIns).text} />
          <KpiCard label="Reached the circle" value={displayRate(kpis.cascadesTriggered).text} />
          <KpiCard
            label="No confirmed support"
            value={displayCount(kpis.attentionUnresolvedCount).text}
          />
          <KpiCard label="Person answered" value={displayRate(kpis.personReached).text} />
          <KpiCard
            label="Attempts before confirmation"
            value={displayAverage(kpis.meanFamilyAttemptsBeforeConfirmation).text}
          />
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
          <EmptyState title="No recent activity in this period" />
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
