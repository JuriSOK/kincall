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
  });

  repository.seedContact({
    id: "contact_julie",
    personId: "person_marie",
    firstName: "Julie",
    phone: configuredPhone("KINCALL_JULIE_PHONE", RESERVED_FICTION_PHONES.julie),
    relationship: "daughter",
    priority: 1,
    consentStatus: "confirmed",
  });

  repository.seedContact({
    id: "contact_marc",
    personId: "person_marie",
    firstName: "Marc",
    phone: configuredPhone("KINCALL_MARC_PHONE", RESERVED_FICTION_PHONES.marc),
    relationship: "son",
    priority: 2,
    consentStatus: "confirmed",
  });

  repository.seedContact({
    id: "contact_nicole",
    personId: "person_marie",
    firstName: "Nicole",
    phone: configuredPhone("KINCALL_NICOLE_PHONE", RESERVED_FICTION_PHONES.nicole),
    relationship: "trusted neighbour",
    priority: 3,
    consentStatus: "confirmed",
  });
}

// Which environment variable configures a given contact's live phone number.
// Used to make the "you forgot to configure this contact" error actionable.
export const CONTACT_PHONE_ENV_VARS: Record<string, string> = {
  person_marie: "KINCALL_DEMO_PHONE",
  contact_julie: "KINCALL_JULIE_PHONE",
  contact_marc: "KINCALL_MARC_PHONE",
  contact_nicole: "KINCALL_NICOLE_PHONE",
};
