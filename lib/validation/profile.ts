import type { ConsentStatus } from "../database/types";

// Pure, framework-free validation shared by the route handlers and the client
// forms, so the server never trusts what the browser sent. Returns field-keyed
// errors rather than throwing: a form needs every problem at once, not the first.

export type FieldErrors = Record<string, string>;

export interface ValidationResult<T> {
  values?: T;
  errors: FieldErrors;
}

// The profiles prompts/companion-agent.ts actually understands
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

const CALL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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

export interface PersonInput {
  firstName: string;
  preferredLanguage: string;
  conversationProfile: string;
  preferredCallTime: string;
  interests: string[];
  consentStatus: ConsentStatus;
}

// `phone` is deliberately absent from the input type: it is minted by the
// repository, so a real number cannot reach the database even by mistake.
export function validatePersonInput(raw: unknown): ValidationResult<PersonInput> {
  const errors: FieldErrors = {};
  const body = (raw ?? {}) as Record<string, unknown>;

  const firstName = text(body.firstName, "firstName", { min: 1, max: 50, errors });
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

  if (
    Object.keys(errors).length > 0 ||
    !firstName ||
    !preferredLanguage ||
    !conversationProfile ||
    !preferredCallTime ||
    !interests ||
    !consentStatus
  ) {
    return { errors };
  }

  return {
    errors,
    values: {
      firstName,
      preferredLanguage,
      conversationProfile,
      preferredCallTime,
      interests,
      consentStatus,
    },
  };
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
  relationship: string;
  consentStatus: ConsentStatus;
}

export function validateContactInput(raw: unknown): ValidationResult<ContactInput> {
  const errors: FieldErrors = {};
  const body = (raw ?? {}) as Record<string, unknown>;

  const firstName = text(body.firstName, "firstName", { min: 1, max: 50, errors });
  const relationship = text(body.relationship, "relationship", { min: 1, max: 40, errors });
  const consentStatus = oneOf(
    body.consentStatus ?? "pending",
    "consentStatus",
    CONSENT_STATUSES,
    errors
  );

  if (Object.keys(errors).length > 0 || !firstName || !relationship || !consentStatus) {
    return { errors };
  }
  return { errors, values: { firstName, relationship, consentStatus } };
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
