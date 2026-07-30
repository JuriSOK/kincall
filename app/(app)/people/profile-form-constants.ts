// Shared between the create form (people/new/person-form.tsx) and the edit
// form (people/[id]/edit/person-edit-form.tsx), so the two never drift apart
// on what a "conversation profile" label reads or which timezones are
// offered.
//
// The weekday list, day/state formatting (WEEKDAYS, formatCheckInDays,
// SCHEDULE_STATE_LABEL) moved to lib/schedule/format-schedule.ts in Stage D:
// those are schedule DOMAIN presentation, needed by the dashboard and person
// page too, not merely form-specific constants — see that module for the
// single source of truth.

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
