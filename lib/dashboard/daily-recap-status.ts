import type { EventRecord } from "../database/types";
import { describeAction } from "../presentation/event-summary";
import { describePersonStatus, type StatusTone } from "../orchestration/person-status";

export interface DailyRecapStatus {
  label: string;
  tone: StatusTone;
  summary: string;
  // The event actually behind `label`/`summary`, when one happened today —
  // null otherwise, so a caller can still link to it / read its
  // decisionReason without recomputing which event was "today's".
  todaysEvent: EventRecord | null;
}

// "en-CA" gives an unambiguous YYYY-MM-DD part order — never shown to a
// user, just a comparable key — the same trick
// lib/presentation/format-date.ts's formatDayKey and
// lib/schedule/next-check-in.ts's ymdInZone already use. Kept local rather
// than shared with either: format-date.ts's formatDayKey is deliberately
// fixed to DISPLAY_TIME_ZONE (a documented, separate concern — see that
// module's own comment), and next-check-in.ts's version returns a
// structured Ymd for calendar arithmetic this module doesn't need.
function dayKeyInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// The dashboard Daily recap's own status — distinct from
// describePersonStatus, which answers "what happened at the most recent
// check-in, ever" (correct for the person page and profile cards, which are
// meant to show history). The Daily recap instead answers "has this person
// been checked on TODAY, in their own persisted timezone" — a value that
// must reset at that person's local midnight regardless of how well
// yesterday went. A rolling 24-hour window was deliberately rejected: it
// would let an event from 11pm yesterday still read as "checked in" at
// 10am today, which is exactly the false reassurance this exists to
// prevent.
//
// `events` need not be sorted or pre-filtered to "recent" — every event
// whose local day (in `timezone`) matches today's local day is considered,
// and the most recent of those wins, so a caller can safely pass a small
// bounded lookback (a handful of a person's latest events) in any order.
export function computeDailyRecapStatus(
  events: EventRecord[],
  timezone: string,
  now: Date
): DailyRecapStatus {
  const todayKey = dayKeyInZone(now.toISOString(), timezone);

  const latestToday = events.reduce<EventRecord | null>((latest, event) => {
    if (dayKeyInZone(event.createdAt, timezone) !== todayKey) return latest;
    if (!latest || event.createdAt > latest.createdAt) return event;
    return latest;
  }, null);

  if (!latestToday) {
    return {
      label: "Not checked in yet",
      tone: "unknown",
      summary: "Not checked in yet today.",
      todaysEvent: null,
    };
  }

  const status = describePersonStatus(latestToday);
  return {
    label: status.label,
    tone: status.tone,
    summary: describeAction(latestToday),
    todaysEvent: latestToday,
  };
}
