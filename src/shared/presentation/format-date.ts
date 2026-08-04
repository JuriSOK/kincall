// A single, explicit display timezone for every date and time rendered
// anywhere in the interface.
//
// Stage D has not implemented a persisted per-person timezone yet (Stage B's
// own scope is deliberately limited to landing/dashboard/history — see
// docs/DECISION_LOG.md). Until it does, EVERY date and time shown anywhere —
// the dashboard's "recent activity", the history calendar and list, the
// event and person pages — uses this one fixed zone, chosen because the
// product's frozen scenario (PRODUCT_SPECIFICATION.md §12) and every demo
// participant are French. It is deliberately NOT the server process's
// timezone (which on Vercel is whichever region the function happens to run
// in) and NOT the visitor's browser timezone (which would make the exact
// same event render differently for two people looking at the same URL, and
// would make server-rendered output non-deterministic between the server
// and the client during hydration).
//
// STAGE D TODO: once a person's own timezone is persisted, callers that know
// which person an event belongs to should pass that person's timezone
// instead of relying on this module's fixed default.
export const DISPLAY_TIME_ZONE = "Europe/Paris";

// "en-CA" is used deliberately for the day key, not for display: its
// Gregorian output is exactly "YYYY-MM-DD", which is what makes it usable as
// a sortable, comparable grouping key. It is never shown to a user.
const DAY_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  timeZone: DISPLAY_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  timeZone: DISPLAY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  timeZone: DISPLAY_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  timeZone: DISPLAY_TIME_ZONE,
  month: "long",
  year: "numeric",
});

// "YYYY-MM-DD" in DISPLAY_TIME_ZONE — a grouping/comparison key, e.g. for
// calendar day markers and the history list's day headings. Every formatter
// in this module passes `timeZone` explicitly, so the result is identical
// regardless of the process's own default timezone (Vercel's region,
// whatever a developer's machine is set to) — see
// tests/format-date.test.ts for a regression check of exactly this.
export function formatDayKey(iso: string): string {
  return DAY_KEY_FORMATTER.format(new Date(iso));
}

// Full date and time, e.g. "30/07/2026, 12:15".
export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMATTER.format(new Date(iso));
}

// Time only, e.g. "12:15".
export function formatTime(iso: string): string {
  return TIME_FORMATTER.format(new Date(iso));
}

// A day key back into a human-readable label, e.g. "30 juillet 2026".
// Parsed at UTC noon rather than UTC midnight: midnight in DISPLAY_TIME_ZONE
// is never more than a couple of hours from UTC midnight, and formatting a
// UTC-midnight instant back through a timeZone-aware formatter can, right at
// a day boundary, resolve to the PREVIOUS local day depending on the offset.
// Noon has no such edge case for any real-world UTC offset.
export function formatDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return DAY_LABEL_FORMATTER.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

// "YYYY-MM" — the calendar's own navigation key.
export function formatMonthKey(dayKey: string): string {
  return dayKey.slice(0, 7);
}

// A month key back into a human-readable label, e.g. "juillet 2026".
export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1, 12)));
}
