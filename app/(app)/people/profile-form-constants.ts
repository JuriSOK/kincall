// Shared between the create form (people/new/person-form.tsx) and the edit
// form (people/[id]/edit/person-edit-form.tsx), so the two never drift apart
// on what a "conversation profile" label reads, which zones are offered, or
// how a weekday is labelled.

export const PROFILE_LABELS: Record<string, string> = {
  standard: "Standard — warm and open-ended",
  cognitive_friendly: "Cognitive-friendly — short sentences, one question at a time",
  speech_difficulty: "Speech difficulty — longer pauses, no interruptions",
};

// A small, practical set of common zones — not the full IANA database. The
// server accepts any valid IANA identifier (lib/validation/profile.ts's
// isValidTimezone), so this list is a convenience, not the whole rule.
export const COMMON_TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Berlin",
  "Europe/Rome",
  "Africa/Casablanca",
  "America/Guadeloupe",
  "Indian/Reunion",
  "Pacific/Noumea",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
] as const;

export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

// A one-line, human-readable rendering of the stored check-in days — used on
// the person page. "Every day" reads better than "Mon, Tue, Wed, Thu, Fri,
// Sat, Sun" for the common case.
export function formatCheckInDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 0) return "No days selected";
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((day) => WEEKDAYS.find((w) => w.value === day)?.label ?? String(day)).join(", ");
}

// A plain-language label for the stored schedule configuration (Stage C).
// Deliberately makes no claim about a computed next occurrence — see
// docs/DECISION_LOG.md DEC-015 and the person page's own comment.
export const SCHEDULE_STATE_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  inactive: "Inactive",
};
