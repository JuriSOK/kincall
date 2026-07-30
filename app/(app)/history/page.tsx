import { getRepository } from "@/lib/database/store";
import { groupByDay } from "@/lib/dashboard/group-by-day";
import { buildMonthCalendar, shiftMonthKey } from "@/lib/history/calendar";
import { filterHistoryEvents } from "@/lib/history/filter-events";
import { parsePeriod, periodSince } from "@/lib/kpi/period";
import { buildHistoryEventView, type EventOutcomeCategory } from "@/lib/presentation/history-view";
import { formatDayKey, formatDayLabel, formatMonthKey, formatMonthLabel } from "@/lib/presentation/format-date";
import { ActivityRow } from "@/app/ui/activity-row";
import { MonthCalendar } from "@/app/ui/calendar";
import { HistoryFilters } from "@/app/ui/filters";
import { PeriodSelector } from "@/app/ui/period-selector";
import { Card, EmptyState, PageHeader, PageShell } from "@/app/ui/surfaces";

// A generous but explicit bound — see Repository.listRecentEvents's own
// contract and the dashboard page's identical note. The calendar and the
// detailed list below share ONE fetch (see `since` below), rather than each
// page section running its own unbounded query.
const HISTORY_EVENTS_LIMIT = 500;

const CATEGORY_OPTIONS: { value: EventOutcomeCategory; label: string }[] = [
  { value: "normal", label: "No attention needed" },
  { value: "cascade", label: "Trusted circle contacted" },
  { value: "unresolved", label: "Attention unresolved" },
];

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period = parsePeriod(params.period);
  const personId = firstString(params.person);
  const category = firstString(params.category) as EventOutcomeCategory | undefined;
  const from = firstString(params.from);
  const to = firstString(params.to);
  const query = firstString(params.q);

  const todayKey = formatDayKey(new Date().toISOString());
  const monthKey = firstString(params.month) ?? formatMonthKey(todayKey);
  const selectedDay = firstString(params.day);

  const repository = getRepository();
  const people = await repository.listPeople();

  // ONE bounded fetch backs both the calendar (which needs the displayed
  // month) and the detailed list (which needs the selected period) — the
  // window is widened to whichever of the two reaches further back, and each
  // section then narrows the shared result to what it actually needs.
  // buildMonthCalendar already ignores any event outside its own month, so
  // handing it the wider set is harmless.
  const periodSinceIso = periodSince(period);
  const monthStartIso = `${monthKey}-01T00:00:00.000Z`;
  const since = periodSinceIso < monthStartIso ? periodSinceIso : monthStartIso;

  const events = await repository.listRecentEvents({ since, limit: HISTORY_EVENTS_LIMIT });
  const callEvents = await repository.listCallEventsForEvents(events.map((event) => event.id));
  const callEventsByEvent = new Map<string, typeof callEvents>();
  for (const call of callEvents) {
    const list = callEventsByEvent.get(call.eventId);
    if (list) list.push(call);
    else callEventsByEvent.set(call.eventId, [call]);
  }

  // Name + avatar for every event, including a person not in the active
  // `people` list (archived) — see the dashboard page's identical comment.
  const personById = new Map(
    people.map((person) => [person.id, { firstName: person.firstName, avatarKey: person.avatarKey }])
  );
  const missingPersonIds = [...new Set(events.map((event) => event.personId))].filter(
    (id) => !personById.has(id)
  );
  const archivedPeople = await Promise.all(missingPersonIds.map((id) => repository.getPerson(id)));
  for (const archived of archivedPeople) {
    if (archived) personById.set(archived.id, { firstName: archived.firstName, avatarKey: archived.avatarKey });
  }

  const allViews = events.map((event) => {
    const resolved = personById.get(event.personId);
    return buildHistoryEventView(
      event,
      resolved?.firstName ?? "Unknown profile",
      callEventsByEvent.get(event.id) ?? [],
      resolved?.avatarKey ?? null
    );
  });

  // The calendar sees every fetched event (superset is harmless — it filters
  // to its own month internally); the detailed list is narrowed to the
  // selected period specifically, since the fetch above may reach further
  // back than the period just to cover the displayed month.
  const calendarMarkers = buildMonthCalendar(monthKey, events);
  const withinPeriod = allViews.filter((view) => view.createdAt >= periodSinceIso);
  const filtered = filterHistoryEvents(withinPeriod, {
    personId,
    category,
    from: from ?? selectedDay,
    to: to ?? selectedDay,
    query,
  });
  const groups = groupByDay(filtered);

  return (
    <PageShell>
      <PageHeader
        title="History"
        lead="Every check-in, grouped by day, with a calendar overview."
      />

      <Card
        title="Calendar"
        actions={<PeriodSelector current={period} basePath="/history" preserveParams={{ person: personId, category: category ?? undefined, month: monthKey }} />}
      >
        <MonthCalendar
          monthLabel={formatMonthLabel(monthKey)}
          markers={calendarMarkers}
          selectedDay={selectedDay}
          prevMonthHref={historyHref({ month: shiftMonthKey(monthKey, -1), person: personId, category, period })}
          nextMonthHref={historyHref({ month: shiftMonthKey(monthKey, 1), person: personId, category, period })}
          dayHref={(dayKey) =>
            historyHref({
              month: monthKey,
              day: dayKey === selectedDay ? undefined : dayKey,
              person: personId,
              category,
              period,
            })
          }
        />
        <p className="mt-3 flex flex-wrap gap-4 text-xs text-subtle">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-calm-line" /> No attention needed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-attention-line" /> Trusted circle contacted
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-unresolved-line" /> Attention unresolved
          </span>
        </p>
      </Card>

      <Card
        title="Detailed history"
        description="Operational activity only — not a health assessment."
      >
        <div className="flex flex-col gap-4">
          <HistoryFilters
            action="/history"
            people={people}
            categoryOptions={CATEGORY_OPTIONS.filter(
              (option): option is { value: Exclude<EventOutcomeCategory, null>; label: string } =>
                option.value !== null
            )}
            values={{ personId, category: category ?? undefined, from, to, query, period }}
          />

          {selectedDay ? (
            <p className="text-sm text-muted">
              Showing {formatDayLabel(selectedDay)} only —{" "}
              <a href={historyHref({ month: monthKey, person: personId, category, period })} className="text-accent hover:underline">
                clear day
              </a>
            </p>
          ) : null}

          {groups.length === 0 ? (
            <EmptyState title="No check-ins match these filters">
              Try a wider period, a different profile, or clearing the search.
            </EmptyState>
          ) : (
            groups.map((group) => (
              <div key={group.dayKey} className="flex flex-col gap-2">
                <h4 className="text-xs font-medium uppercase tracking-wide text-subtle">
                  {formatDayLabel(group.dayKey)}
                </h4>
                <div className="flex flex-col gap-2">
                  {group.items.map((view) => (
                    <ActivityRow key={view.eventId} view={view} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageShell>
  );
}

function historyHref(params: {
  month?: string;
  day?: string;
  person?: string;
  category?: EventOutcomeCategory | undefined;
  period?: string;
}): string {
  const search = new URLSearchParams();
  if (params.month) search.set("month", params.month);
  if (params.day) search.set("day", params.day);
  if (params.person) search.set("person", params.person);
  if (params.category) search.set("category", params.category);
  if (params.period) search.set("period", params.period);
  const query = search.toString();
  return query ? `/history?${query}` : "/history";
}
