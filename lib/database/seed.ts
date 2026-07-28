import type { InMemoryRepository } from "./in-memory-repository";

// French numbers reserved for fiction (ARCEP 06 39 98 00 00 – 06 39 98 99 99).
// Valid E.164 so the live-mode format guard behaves realistically, but never
// routable to a real subscriber.
const RESERVED_FICTION_PHONES = {
  marie: "+33639980001",
  julie: "+33639980002",
  marc: "+33639980003",
  nicole: "+33639980004",
} as const;

// Live mode dials the vulnerable person for real, so that number must belong
// to a consenting test participant and is never hardcoded here — it comes from
// KINCALL_DEMO_PHONE. Trusted contacts keep reserved numbers: the live Family
// cascade is Phase 4 and places no calls yet.
function companionPhone(): string {
  const configured = process.env.KINCALL_DEMO_PHONE?.trim();
  return configured && configured.length > 0 ? configured : RESERVED_FICTION_PHONES.marie;
}

// Matches TECHNICAL_ARCHITECTURE.md §10 / PRODUCT_SPECIFICATION.md §12 ids.
export function seedRepository(repository: InMemoryRepository): void {
  repository.seedPerson({
    id: "person_marie",
    firstName: "Marie",
    phone: companionPhone(),
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
    phone: RESERVED_FICTION_PHONES.julie,
    relationship: "daughter",
    priority: 1,
    consentStatus: "confirmed",
  });

  repository.seedContact({
    id: "contact_marc",
    personId: "person_marie",
    firstName: "Marc",
    phone: RESERVED_FICTION_PHONES.marc,
    relationship: "son",
    priority: 2,
    consentStatus: "confirmed",
  });

  repository.seedContact({
    id: "contact_nicole",
    personId: "person_marie",
    firstName: "Nicole",
    phone: RESERVED_FICTION_PHONES.nicole,
    relationship: "trusted neighbour",
    priority: 3,
    consentStatus: "confirmed",
  });
}
