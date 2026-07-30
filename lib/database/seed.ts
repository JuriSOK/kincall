import { RESERVED_FICTION_PHONES } from "../phone";
import type { InMemoryRepository } from "./in-memory-repository";

// Live mode dials these people for real, so every number must belong to a
// consenting test participant and is never hardcoded here — each comes from
// its own environment variable. The reserved-for-fiction fallback keeps fake
// mode working with no configuration at all; LiveCalleAdapter refuses to dial
// those numbers, so an unset variable fails loudly instead of calling a
// stranger (see lib/phone.ts, docs/DECISION_LOG.md DEC-005).
function configuredPhone(envVar: string, fictionFallback: string): string {
  const configured = process.env[envVar]?.trim();
  return configured && configured.length > 0 ? configured : fictionFallback;
}

// Which environment variable configures a given entity's live phone number.
//
// A function rather than a lookup table, because a profile created through the
// interface has an id nobody hardcoded: it must still be configurable, or it
// could never place a live call at all. The four seeded ids keep their
// published names so existing .env.local and Vercel configuration keeps working.
export function phoneEnvVarFor(entityId: string): string {
  return (
    LEGACY_PHONE_ENV_VARS[entityId] ??
    `KINCALL_PHONE_${entityId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`
  );
}

// Applied when READING a persisted person or contact. An environment variable
// always wins when set — which is the ONLY way the four legacy demo entities
// are ever configured for a live call, since their stored value is always a
// committed reserved-for-fiction default (DEC-006). For an entity created
// through the interface, the stored value is instead the real, validated
// E.164 number the operator entered (DEC-008), and that is what this falls
// back to when no override is set.
export function resolveConfiguredPhone(entityId: string, storedPhone: string): string {
  return configuredPhone(phoneEnvVarFor(entityId), storedPhone);
}

// Matches TECHNICAL_ARCHITECTURE.md §10 / PRODUCT_SPECIFICATION.md §12 ids.
export function seedRepository(repository: InMemoryRepository): void {
  repository.seedPerson({
    id: "person_marie",
    firstName: "Marie",
    phone: configuredPhone("KINCALL_DEMO_PHONE", RESERVED_FICTION_PHONES.marie),
    preferredLanguage: "fr-FR",
    conversationProfile: "cognitive_friendly",
    preferredCallTime: "09:00",
    interests: ["gardening", "family"],
    consentStatus: "confirmed",
    archivedAt: null,
    // Stage C (DEC-015) — matches migration 0010's column defaults exactly.
    timezone: "Europe/Paris",
    avatarKey: "sunrise",
    conversationNotes: null,
    checkInDays: [1, 2, 3, 4, 5, 6, 7],
    scheduleState: "active",
  });

  repository.seedContact({
    id: "contact_julie",
    personId: "person_marie",
    firstName: "Julie",
    phone: configuredPhone("KINCALL_JULIE_PHONE", RESERVED_FICTION_PHONES.julie),
    relationship: "daughter",
    priority: 1,
    consentStatus: "confirmed",
    archivedAt: null,
  });

  repository.seedContact({
    id: "contact_marc",
    personId: "person_marie",
    firstName: "Marc",
    phone: configuredPhone("KINCALL_MARC_PHONE", RESERVED_FICTION_PHONES.marc),
    relationship: "son",
    priority: 2,
    consentStatus: "confirmed",
    archivedAt: null,
  });

  repository.seedContact({
    id: "contact_nicole",
    personId: "person_marie",
    firstName: "Nicole",
    phone: configuredPhone("KINCALL_NICOLE_PHONE", RESERVED_FICTION_PHONES.nicole),
    relationship: "trusted neighbour",
    priority: 3,
    consentStatus: "confirmed",
    archivedAt: null,
  });
}

// The four demo entities predate phoneEnvVarFor's derivation rule and keep
// their published variable names, so no existing configuration breaks.
const LEGACY_PHONE_ENV_VARS: Record<string, string> = {
  person_marie: "KINCALL_DEMO_PHONE",
  contact_julie: "KINCALL_JULIE_PHONE",
  contact_marc: "KINCALL_MARC_PHONE",
  contact_nicole: "KINCALL_NICOLE_PHONE",
};
