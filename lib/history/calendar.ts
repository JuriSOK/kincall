import { categorizeEventOutcome } from "@/lib/presentation/history-view";
import { formatDayKey } from "@/lib/presentation/format-date";
import type { EventRecord } from "@/lib/database/types";

export interface CalendarDayMarker {
  dayKey: string;
  dayOfMonth: number;
  hasNormal: boolean;
  hasCascade: boolean;
  hasUnresolved: boolean;
  // True when at least one event fell on this day, whichever category(ies).
  hasEvents: boolean;
}

function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// Builds one marker per calendar day of `monthKey` ("YYYY-MM"), in day order,
// so the UI can render a full grid (including empty days) without doing any
// date arithmetic of its own. `events` need only be pre-filtered to (at most)
// this month — passing a larger set is harmless, since days outside the
// month are never emitted here.
//
// Neutral categories only (§9): no medical-severity colour scale. An event
// with no decision yet (categorizeEventOutcome returns null — still mid
// check-in) contributes to `hasEvents` for the day-detail view, but not to
// any of the three category flags, since it has no established outcome yet.
export function buildMonthCalendar(
  monthKey: string,
  events: Pick<EventRecord, "status" | "decision" | "createdAt">[]
): CalendarDayMarker[] {
  const [year, month] = monthKey.split("-").map(Number);
  const total = daysInMonth(year, month);

  const byDay = new Map<string, { normal: boolean; cascade: boolean; unresolved: boolean; any: boolean }>();
  for (const event of events) {
    const dayKey = formatDayKey(event.createdAt);
    if (!dayKey.startsWith(monthKey)) continue; // outside the requested month

    const bucket = byDay.get(dayKey) ?? {
      normal: false,
      cascade: false,
      unresolved: false,
      any: false,
    };
    bucket.any = true;
    const category = categorizeEventOutcome(event as EventRecord);
    if (category === "normal") bucket.normal = true;
    if (category === "cascade") bucket.cascade = true;
    if (category === "unresolved") bucket.unresolved = true;
    byDay.set(dayKey, bucket);
  }

  return Array.from({ length: total }, (_, index) => {
    const dayOfMonth = index + 1;
    const dayKey = `${monthKey}-${String(dayOfMonth).padStart(2, "0")}`;
    const bucket = byDay.get(dayKey);
    return {
      dayKey,
      dayOfMonth,
      hasNormal: bucket?.normal ?? false,
      hasCascade: bucket?.cascade ?? false,
      hasUnresolved: bucket?.unresolved ?? false,
      hasEvents: bucket?.any ?? false,
    };
  });
}

// The previous/next month key, for calendar navigation links.
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
