// Shared between the create form (people/new/person-form.tsx) and the edit
// form (people/[id]/edit/person-edit-form.tsx), so the two never drift apart
// on which timezones are offered.
//
// The weekday list, day/state formatting (WEEKDAYS, formatCheckInDays,
// SCHEDULE_STATE_LABEL) moved to shared/presentation/format-schedule.ts in Stage D,
// and the conversation-profile/language display labels (formerly
// PROFILE_LABELS here) moved to shared/presentation/labels.ts in the UI/UX
// cleanup pass — both are presentation DOMAIN concerns needed by read-only
// pages too, not merely these two forms. See those modules for the single
// source of truth.

// A small, practical set of common zones — not the full IANA database. The
// server accepts any valid IANA identifier (shared/validation/profile.ts's
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
