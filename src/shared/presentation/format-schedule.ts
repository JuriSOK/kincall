// Human-readable presentation for a persisted schedule configuration
// (Stage D, docs/DECISION_LOG.md DEC-016). Pure formatting only — never
// claims a computed occurrence is guaranteed to run, since no production
// scheduler exists anywhere in this codebase; every "scheduled" label is
// deliberately worded as a planned/configured fact, not a promise.
//
// The single source of truth for the weekday list and schedule-state labels
// — moved here from src/app/(app)/people/profile-form-constants.ts, which now
// only holds genuinely form-specific constants (PROFILE_LABELS,
// COMMON_TIMEZONES), so there is exactly one place that defines what a
// weekday or a schedule state means, shared by the create form, the edit
// form, the person page and the dashboard alike.
import type { NextCheckInResult } from "@/backend/scheduling/next-check-in";

export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

// A one-line, human-readable rendering of the stored check-in days — never
// the raw array (e.g. never "[1,2,3,4,5]"). "Every day" reads better than
// "Mon, Tue, Wed, Thu, Fri, Sat, Sun" for the common case.
export function formatCheckInDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 0) return "No days selected";
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((day) => WEEKDAYS.find((w) => w.value === day)?.label ?? String(day)).join(", ");
}

// A plain-language label for the stored schedule_state — never the raw
// "active"/"paused"/"inactive" value on its own without this context.
export const SCHEDULE_STATE_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  inactive: "Inactive",
};

// "YYYY-MM-DD" as seen in `timeZone`, from a UTC instant — a comparison key,
// never shown to a user. Timezone-parameterised, unlike
// src/shared/presentation/format-date.ts's fixed-Europe/Paris formatDayKey, because
// this module formats each person's OWN timezone.
function zonedDayKey(instantMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instantMs));
}

// Pure calendar-day increment on a "YYYY-MM-DD" key, anchored via
// Date.UTC/getUTC* so it never depends on the server process's own
// timezone — the same discipline next-check-in.ts's addDaysToYmd follows.
function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function zonedTimeLabel(instantMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instantMs));
}

// "Mon 3 Aug" — English weekday/month abbreviations, deliberately NOT
// French: every other label in this interface (button text, hints, field
// names) is in English, and this stays consistent with that rather than
// mixing conventions. This is unrelated to and does not change
// src/shared/presentation/format-date.ts's own fr-FR formatting of the fixed
// Europe/Paris event timestamps, which this module never touches.
function zonedDateLabel(instantMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(instantMs));
}

// "Today at 09:00 (Europe/Paris)" / "Tomorrow at 09:00 (Europe/Paris)" /
// "Mon 3 Aug at 09:00 (Europe/Paris)" — deterministic given a fixed `now`
// (never re-derives "today" from the ambient clock), and keeps the local
// time and timezone name in ONE text node so assistive technology announces
// them together rather than as two disconnected fragments.
export function formatOccurrence(occurrenceIso: string, timezone: string, now: Date): string {
  const occurrenceMs = new Date(occurrenceIso).getTime();
  const occurrenceDayKey = zonedDayKey(occurrenceMs, timezone);
  const todayKey = zonedDayKey(now.getTime(), timezone);
  const time = zonedTimeLabel(occurrenceMs, timezone);

  if (occurrenceDayKey === todayKey) {
    return `Today at ${time} (${timezone})`;
  }
  if (occurrenceDayKey === nextDayKey(todayKey)) {
    return `Tomorrow at ${time} (${timezone})`;
  }
  return `${zonedDateLabel(occurrenceMs, timezone)} at ${time} (${timezone})`;
}

// The single combined summary line used everywhere a next-check-in needs
// describing — ProfileCard, the person page's Schedule card, the
// dashboard's Upcoming check-ins section. Exhaustive over
// NextCheckInResult's `kind` (a `never`-typed default) so a newly added kind
// fails typecheck here rather than silently falling through to a stale
// fallback.
//
// "Next planned check-in", not bare "Next check-in": no production scheduler
// exists anywhere in this codebase, so the wording never implies the
// occurrence below is guaranteed to happen on its own.
export function formatNextCheckIn(result: NextCheckInResult, timezone: string, now: Date): string {
  switch (result.kind) {
    case "paused":
      return "Schedule paused";
    case "inactive":
      return "Schedule inactive";
    case "no_days_selected":
      return "No check-in days selected";
    case "scheduled":
      return `Next planned check-in: ${formatOccurrence(result.nextOccurrenceIso as string, timezone, now)}`;
    default: {
      const exhaustive: never = result.kind;
      return exhaustive;
    }
  }
}
