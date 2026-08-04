// Central presentation helpers for turning stored codes into human-readable
// text (UI/UX cleanup pass, docs/DECISION_LOG.md's latest entry). Every place
// that would otherwise render a raw language tag, enum value, or
// snake_case/kebab-case identifier reads from here, so a code is never
// exposed to a user and the mapping can never drift between two pages that
// happen to display the same field.
//
// `CONVERSATION_PROFILE_LABELS` moved here from
// src/app/(app)/people/profile-form-constants.ts, where it originated as a
// form-only constant — it is genuinely a presentation concern needed by the
// read-only profile page too, not merely the create/edit forms, matching how
// WEEKDAYS/SCHEDULE_STATE_LABEL were already centralised in
// src/shared/presentation/format-schedule.ts.

import type { ConsentStatus } from "@/shared/domain/types";

// The last line of defence for a value that matches none of the known maps
// below — most likely a historical record predating a label, or a malformed
// one. Converts machine-shaped text into something a person can read without
// ever throwing: "trusted_neighbour" -> "Trusted neighbour",
// "cognitive-friendly" -> "Cognitive friendly". Never returns raw JSON —
// callers only ever pass a string here, never an object.
export function humanizeCode(value: string): string {
  const words = value.trim().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return value;
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(" ");
}

// PREFERRED_LANGUAGES in src/shared/validation/profile.ts. English display names
// throughout — the interface's own language is English (§3 of the brief), so
// "French" rather than "Français". en-GB/en-US are disambiguated with a
// region qualifier rather than both reading as bare "English", which would
// make them indistinguishable in a select list.
export const LANGUAGE_LABELS: Record<string, string> = {
  "fr-FR": "French",
  "en-GB": "English (UK)",
  "en-US": "English (US)",
  "es-ES": "Spanish",
  "de-DE": "German",
};

export function describeLanguage(code: string): string {
  return LANGUAGE_LABELS[code] ?? humanizeCode(code);
}

// CONVERSATION_PROFILES in src/shared/validation/profile.ts — the profiles
// src/backend/agents/companion/prompt.ts actually implements guidance for.
export const CONVERSATION_PROFILE_LABELS: Record<string, string> = {
  standard: "Standard — warm and open-ended",
  cognitive_friendly: "Cognitive-friendly — short sentences, one question at a time",
  speech_difficulty: "Speech difficulty — longer pauses, no interruptions",
};

export function describeConversationProfile(code: string): string {
  return CONVERSATION_PROFILE_LABELS[code] ?? humanizeCode(code);
}

// ConsentStatus is a closed, exhaustively-known union (DEC-007/DEC-008), so
// this is a plain total record rather than a describe*() wrapper — there is
// no "unknown historical value" case a database CHECK constraint would ever
// let through. Kept as a Record (not a function) so a caller can also use it
// directly as a lookup where convenient, matching SCHEDULE_STATE_LABEL's own
// shape in src/shared/presentation/format-schedule.ts.
export const CONSENT_STATUS_LABEL: Record<ConsentStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  declined: "Declined",
};

export function describeConsentStatus(status: string): string {
  return CONSENT_STATUS_LABEL[status as ConsentStatus] ?? humanizeCode(status);
}

// UX correction pass: a trusted contact with no explicit timezone inherits
// the monitored person's own (TrustedContact.timezone === null — the stored
// inheritance rule itself is unchanged). Naming that inheritance as "Same as
// Marie" is more legible than raw IANA-inheritance wording ("Inherits
// Europe/Paris") and needs no timezone knowledge to read at a glance.
// Centralised here — rather than built inline wherever a contact's timezone
// is shown — so a second call site can never phrase the same fact
// differently.
export function describeContactTimezone(
  contactTimezone: string | null,
  personName: string
): string {
  return contactTimezone ?? `Same as ${personName}`;
}
