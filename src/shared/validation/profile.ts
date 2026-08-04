import { isE164, isReservedFictionPhone } from "@/shared/utilities/phone";
import { AVATAR_KEYS, isAvatarKey, type AvatarKey } from "@/shared/utilities/avatars";
import type { ConsentStatus, ScheduleState } from "@/shared/domain/types";
import type { UpdatePersonInput, UpdateTrustedContactInput } from "@/backend/persistence/repository";

// Pure, framework-free validation shared by the route handlers and the client
// forms, so the server never trusts what the browser sent. Returns field-keyed
// errors rather than throwing: a form needs every problem at once, not the first.

export type FieldErrors = Record<string, string>;

export interface ValidationResult<T> {
  values?: T;
  errors: FieldErrors;
}

// The profiles src/backend/agents/companion/prompt.ts actually understands
// (guidanceForProfile). Not an invented list — adding one here without adding
// its guidance there would silently fall back to the standard script.
export const CONVERSATION_PROFILES = [
  "standard",
  "cognitive_friendly",
  "speech_difficulty",
] as const;
export type ConversationProfile = (typeof CONVERSATION_PROFILES)[number];

// LiveCalleAdapter derives CALL-E's `region` by splitting the locale on "-"
// and requiring a two-letter region, so anything else would silently lose it.
export const PREFERRED_LANGUAGES = ["fr-FR", "en-GB", "en-US", "es-ES", "de-DE"] as const;
export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[number];

export const CONSENT_STATUSES: ConsentStatus[] = ["pending", "confirmed", "declined"];

// Stored configuration only (Stage C, DEC-015) — nothing currently executes a
// schedule based on this value; Stage D would be what reads it.
export const SCHEDULE_STATES: ScheduleState[] = ["active", "paused", "inactive"];

// ISO weekdays: 1 (Monday) through 7 (Sunday), matching migration 0010's own
// `check_in_days <@ array[1..7]` constraint — kept as one literal set here so
// the two can never silently disagree about what a valid day is.
const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const CALL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// The standard way to validate an IANA timezone identifier without a fixed
// list to keep in sync: the constructor throws RangeError for anything the
// runtime's ICU data does not recognise as a real zone.
function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// A run of digits long enough to be a phone number, ignoring the spaces,
// dots, dashes and parentheses people write them with.
//
// DEC-006 keeps real numbers out of the database entirely. Interests and
// relationship are free text that the agents speak aloud, and they are the one
// place a real number could be smuggled in — so the guarantee is enforced here
// rather than left to rely on the phone column alone.
const PHONE_LIKE = /(?:\+?\d[\s.\-()]*){7,}/;

export function containsPhoneLikeSequence(value: string): boolean {
  return PHONE_LIKE.test(value);
}

function text(
  raw: unknown,
  field: string,
  { min, max, errors }: { min: number; max: number; errors: FieldErrors }
): string | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    errors[field] = "This field is required.";
    return undefined;
  }
  const value = raw.trim();
  if (value.length < min || value.length > max) {
    errors[field] = `Must be between ${min} and ${max} characters.`;
    return undefined;
  }
  if (containsPhoneLikeSequence(value)) {
    errors[field] =
      "Remove the phone number. Live numbers are configured through server environment variables, never stored here.";
    return undefined;
  }
  return value;
}

// Accepts the common ways people type a number (spaces, dots, dashes,
// parentheses) and normalises to the canonical, separator-free form isE164
// and maskPhone both expect — so a stored phone is always in that one shape,
// never a formatting variant of it.
function normalizePhone(raw: string): string {
  return raw.trim().replace(/[\s.\-()]/g, "");
}

// Required, validated E.164, and never a reserved-for-fiction number (DEC-008):
// a real participant cannot be given a number that LiveCalleAdapter refuses to
// dial, and accepting one here would silently defeat the whole guard.
//
// The error messages never repeat the submitted value — only the shape that
// is required — so an invalid phone number is never echoed back into any
// string this module produces.
function phone(raw: unknown, field: string, errors: FieldErrors): string | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    errors[field] = "This field is required.";
    return undefined;
  }
  const value = normalizePhone(raw);
  if (!isE164(value)) {
    errors[field] = "Must be a valid E.164 number, for example +33612345678.";
    return undefined;
  }
  if (isReservedFictionPhone(value)) {
    errors[field] =
      "This number is reserved for fiction testing and cannot belong to a real participant.";
    return undefined;
  }
  return value;
}

function oneOf<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
  errors: FieldErrors
): T | undefined {
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    errors[field] = `Must be one of: ${allowed.join(", ")}.`;
    return undefined;
  }
  return raw as T;
}

// Empty/absent means "use the initials fallback" (src/frontend/components/avatars/avatar.tsx),
// which is a valid, deliberate choice — not an error. An unrecognised key IS
// an error: reaching AVATAR_KEYS is the only way a stored value can ever
// resolve to a real graphic (src/shared/utilities/avatars.ts is the single source of truth
// both this validator and the UI registry import).
function avatarKeyField(raw: unknown, field: string, errors: FieldErrors): AvatarKey | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !isAvatarKey(raw)) {
    errors[field] = `Must be one of: ${AVATAR_KEYS.join(", ")}.`;
    return undefined;
  }
  return raw;
}

function timezoneField(raw: unknown, field: string, errors: FieldErrors): string | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0 || !isValidTimezone(raw.trim())) {
    errors[field] = "Must be a valid IANA timezone identifier, for example Europe/Paris.";
    return undefined;
  }
  return raw.trim();
}

// Ordinary conversation preferences/habits only (DEC-015) — empty/absent is
// valid (means "none entered"). The one mechanical guarantee this validator
// CAN make is the same one already applied to `interests`: no phone-like
// digit run. It cannot and does not claim to detect medical or diagnostic
// content — see docs/DECISION_LOG.md DEC-015 for why that boundary is drawn
// here rather than pretended away.
function conversationNotesField(
  raw: unknown,
  field: string,
  errors: FieldErrors
): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    errors[field] = "Must be text.";
    return undefined;
  }
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > 280) {
    errors[field] = "Must be 280 characters or fewer.";
    return undefined;
  }
  if (containsPhoneLikeSequence(value)) {
    errors[field] =
      "Remove the phone number. Live numbers are configured through server environment variables, never stored here.";
    return undefined;
  }
  return value;
}

// At least one day, each an ISO weekday (1=Monday..7=Sunday), no duplicates —
// matching migration 0010's own `check_in_days <@ array[1..7]` constraint.
function checkInDaysField(raw: unknown, field: string, errors: FieldErrors): number[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors[field] = "Select at least one day.";
    return undefined;
  }
  const days = raw.map((entry) => (typeof entry === "string" ? Number(entry) : entry));
  if (days.some((day) => typeof day !== "number" || !ISO_WEEKDAYS.includes(day as 1))) {
    errors[field] = "Each day must be a weekday number from 1 (Monday) to 7 (Sunday).";
    return undefined;
  }
  if (new Set(days).size !== days.length) {
    errors[field] = "The same day appears more than once.";
    return undefined;
  }
  return [...days].sort((a, b) => a - b);
}

export interface PersonInput {
  firstName: string;
  phone: string;
  preferredLanguage: string;
  conversationProfile: string;
  preferredCallTime: string;
  interests: string[];
  consentStatus: ConsentStatus;
  // Stage C (DEC-015). Each has a default applied when the field is entirely
  // absent from the submitted body, so a caller that predates these fields
  // (an old form render, a stale client) still creates a valid profile.
  timezone: string;
  avatarKey: string | null;
  conversationNotes: string | null;
  checkInDays: number[];
  scheduleState: ScheduleState;
}

// DEC-008: a validated, real E.164 number is required and stored directly —
// masked wherever it is displayed, and never logged unmasked. An environment
// variable can still override it per entity (phoneEnvVarFor), which is how the
// four legacy demo entities keep working without ever storing a real number.
export function validatePersonInput(raw: unknown): ValidationResult<PersonInput> {
  const errors: FieldErrors = {};
  const body = (raw ?? {}) as Record<string, unknown>;

  const firstName = text(body.firstName, "firstName", { min: 1, max: 50, errors });
  const phoneNumber = phone(body.phone, "phone", errors);
  const preferredLanguage = oneOf(
    body.preferredLanguage,
    "preferredLanguage",
    PREFERRED_LANGUAGES,
    errors
  );
  const conversationProfile = oneOf(
    body.conversationProfile,
    "conversationProfile",
    CONVERSATION_PROFILES,
    errors
  );

  let preferredCallTime: string | undefined;
  if (typeof body.preferredCallTime !== "string" || !CALL_TIME_PATTERN.test(body.preferredCallTime)) {
    errors.preferredCallTime = "Must be a 24-hour time, for example 09:00.";
  } else {
    preferredCallTime = body.preferredCallTime;
  }

  const interests = validateInterests(body.interests, errors);
  const consentStatus = oneOf(
    body.consentStatus ?? "pending",
    "consentStatus",
    CONSENT_STATUSES,
    errors
  );

  const timezone =
    body.timezone === undefined
      ? "Europe/Paris"
      : timezoneField(body.timezone, "timezone", errors);
  const avatarKey = avatarKeyField(body.avatarKey, "avatarKey", errors);
  const conversationNotes = conversationNotesField(
    body.conversationNotes,
    "conversationNotes",
    errors
  );
  const checkInDays =
    body.checkInDays === undefined
      ? ([1, 2, 3, 4, 5, 6, 7] as number[])
      : checkInDaysField(body.checkInDays, "checkInDays", errors);
  const scheduleState =
    body.scheduleState === undefined
      ? "active"
      : oneOf(body.scheduleState, "scheduleState", SCHEDULE_STATES, errors);

  if (
    Object.keys(errors).length > 0 ||
    !firstName ||
    !phoneNumber ||
    !preferredLanguage ||
    !conversationProfile ||
    !preferredCallTime ||
    !interests ||
    !consentStatus ||
    timezone === undefined ||
    avatarKey === undefined ||
    conversationNotes === undefined ||
    !checkInDays ||
    !scheduleState
  ) {
    return { errors };
  }

  return {
    errors,
    values: {
      firstName,
      phone: phoneNumber,
      timezone,
      avatarKey,
      conversationNotes,
      checkInDays,
      scheduleState,
      preferredLanguage,
      conversationProfile,
      preferredCallTime,
      interests,
      consentStatus,
    },
  };
}

// Stage C's edit route (§3, §5 of the brief): a PARTIAL patch, so — unlike
// validatePersonInput above — an absent key means "leave this field exactly
// as it is", not "apply a default". Every field is therefore validated only
// when its key is actually present in the submitted body (`"key" in body`,
// not merely `!== undefined`, so an explicit `null` on a nullable field —
// avatarKey, conversationNotes — is still recognised as present and is
// applied, e.g. to deliberately clear a note).
//
// Deliberately excludes firstName and phone — see UpdatePersonInput's own
// comment in src/backend/persistence/repository.ts for why.
export function validateUpdatePersonInput(raw: unknown): ValidationResult<UpdatePersonInput> {
  const errors: FieldErrors = {};
  const body = (raw ?? {}) as Record<string, unknown>;
  const values: UpdatePersonInput = {};

  if ("preferredLanguage" in body) {
    const value = oneOf(body.preferredLanguage, "preferredLanguage", PREFERRED_LANGUAGES, errors);
    if (value !== undefined) values.preferredLanguage = value;
  }
  if ("conversationProfile" in body) {
    const value = oneOf(body.conversationProfile, "conversationProfile", CONVERSATION_PROFILES, errors);
    if (value !== undefined) values.conversationProfile = value;
  }
  if ("preferredCallTime" in body) {
    if (typeof body.preferredCallTime !== "string" || !CALL_TIME_PATTERN.test(body.preferredCallTime)) {
      errors.preferredCallTime = "Must be a 24-hour time, for example 09:00.";
    } else {
      values.preferredCallTime = body.preferredCallTime;
    }
  }
  if ("interests" in body) {
    const value = validateInterests(body.interests, errors);
    if (value !== undefined) values.interests = value;
  }
  if ("consentStatus" in body) {
    const value = oneOf(body.consentStatus, "consentStatus", CONSENT_STATUSES, errors);
    if (value !== undefined) values.consentStatus = value;
  }
  if ("timezone" in body) {
    const value = timezoneField(body.timezone, "timezone", errors);
    if (value !== undefined) values.timezone = value;
  }
  if ("avatarKey" in body) {
    const value = avatarKeyField(body.avatarKey, "avatarKey", errors);
    if (value !== undefined) values.avatarKey = value;
  }
  if ("conversationNotes" in body) {
    const value = conversationNotesField(body.conversationNotes, "conversationNotes", errors);
    if (value !== undefined) values.conversationNotes = value;
  }
  if ("checkInDays" in body) {
    const value = checkInDaysField(body.checkInDays, "checkInDays", errors);
    if (value !== undefined) values.checkInDays = value;
  }
  if ("scheduleState" in body) {
    const value = oneOf(body.scheduleState, "scheduleState", SCHEDULE_STATES, errors);
    if (value !== undefined) values.scheduleState = value;
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return { errors, values };
}

function validateInterests(raw: unknown, errors: FieldErrors): string[] | undefined {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.interests = "Must be a list.";
    return undefined;
  }
  if (raw.length > 10) {
    errors.interests = "At most 10 interests.";
    return undefined;
  }

  const values: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      errors.interests = "Each interest must be text.";
      return undefined;
    }
    const value = entry.trim();
    if (value.length === 0) continue; // an empty row in the form is simply dropped
    if (value.length > 30) {
      errors.interests = "Each interest must be 30 characters or fewer.";
      return undefined;
    }
    if (containsPhoneLikeSequence(value)) {
      errors.interests =
        "Remove the phone number. Live numbers are configured through server environment variables, never stored here.";
      return undefined;
    }
    values.push(value);
  }
  return values;
}

export interface ContactInput {
  firstName: string;
  phone: string;
  relationship: string;
  consentStatus: ConsentStatus;
}

export function validateContactInput(raw: unknown): ValidationResult<ContactInput> {
  const errors: FieldErrors = {};
  const body = (raw ?? {}) as Record<string, unknown>;

  const firstName = text(body.firstName, "firstName", { min: 1, max: 50, errors });
  const phoneNumber = phone(body.phone, "phone", errors);
  const relationship = text(body.relationship, "relationship", { min: 1, max: 40, errors });
  const consentStatus = oneOf(
    body.consentStatus ?? "pending",
    "consentStatus",
    CONSENT_STATUSES,
    errors
  );

  if (
    Object.keys(errors).length > 0 ||
    !firstName ||
    !phoneNumber ||
    !relationship ||
    !consentStatus
  ) {
    return { errors };
  }
  return { errors, values: { firstName, phone: phoneNumber, relationship, consentStatus } };
}

// Same nullable-or-valid-IANA-identifier rule as the person's own timezone,
// but null is a legitimate, deliberate value here — "inherit the person's
// timezone" (Stage E, DEC-017) — never an error.
function nullableTimezoneField(
  raw: unknown,
  field: string,
  errors: FieldErrors
): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  return timezoneField(raw, field, errors);
}

// 1 or 2 only — CLAUDE.md / DEC-017: configuration may LOWER how many times a
// contact is tried below the engine's global bound, never raise it. Rejected
// here so a value outside that range can never even be stored; the engine
// still re-clamps at cascade time regardless (min(maxAttempts, 2)) as a
// second, independent line of defence.
function maxAttemptsField(raw: unknown, field: string, errors: FieldErrors): number | undefined {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (value !== 1 && value !== 2) {
    errors[field] = "Must be 1 or 2.";
    return undefined;
  }
  return value;
}

// Stage E (DEC-017), the trusted-circle counterpart to
// validateUpdatePersonInput: a PARTIAL patch where an absent key means "leave
// this field exactly as it is". `isPrimary` is deliberately never accepted
// here — see UpdateTrustedContactInput's own comment for why (primary status
// changes only through setPrimaryContact, atomically).
//
// callableFrom/callableTo are validated as a PAIR: if either key is present in
// the submitted body, BOTH must be present and both must be valid "HH:MM"
// times (migration 0011's own "reject only one side of an incomplete window"
// rule) — this validator has no access to whatever is currently stored, so it
// cannot safely reconcile a single supplied side against it; the caller (the
// edit form) always submits the whole window together.
export function validateUpdateContactInput(raw: unknown): ValidationResult<UpdateTrustedContactInput> {
  const errors: FieldErrors = {};
  const body = (raw ?? {}) as Record<string, unknown>;
  const values: UpdateTrustedContactInput = {};

  if ("relationship" in body) {
    const value = text(body.relationship, "relationship", { min: 1, max: 40, errors });
    if (value !== undefined) values.relationship = value;
  }
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      errors.enabled = "Must be true or false.";
    } else {
      values.enabled = body.enabled;
    }
  }
  if ("callableFrom" in body || "callableTo" in body) {
    const bothNull = body.callableFrom === null && body.callableTo === null;
    if (bothNull) {
      values.callableFrom = null;
      values.callableTo = null;
    } else if (
      typeof body.callableFrom !== "string" ||
      typeof body.callableTo !== "string" ||
      !CALL_TIME_PATTERN.test(body.callableFrom) ||
      !CALL_TIME_PATTERN.test(body.callableTo)
    ) {
      errors.callableFrom =
        "Set both a start and an end time (each a 24-hour time, e.g. 09:00), or clear both to mean always available.";
    } else {
      values.callableFrom = body.callableFrom;
      values.callableTo = body.callableTo;
    }
  }
  if ("timezone" in body) {
    const value = nullableTimezoneField(body.timezone, "timezone", errors);
    if (value !== undefined) values.timezone = value;
  }
  if ("maxAttempts" in body) {
    const value = maxAttemptsField(body.maxAttempts, "maxAttempts", errors);
    if (value !== undefined) values.maxAttempts = value;
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return { errors, values };
}

export function validateOrderedIds(raw: unknown): ValidationResult<string[]> {
  const errors: FieldErrors = {};
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    errors.orderedIds = "Must be a list of contact ids.";
    return { errors };
  }
  const ids = raw as string[];
  if (new Set(ids).size !== ids.length) {
    errors.orderedIds = "The same contact appears more than once.";
    return { errors };
  }
  return { errors, values: ids };
}

// Slug for a human-readable id (person_marie, contact_julie), matching the
// convention the seeded rows already use. Collisions are resolved by the
// repository, which retries with a numeric suffix.
export function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug.length > 0 ? slug.slice(0, 40) : "profile";
}
