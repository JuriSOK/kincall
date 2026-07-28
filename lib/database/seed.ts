import type { InMemoryRepository } from "./in-memory-repository";

// Matches TECHNICAL_ARCHITECTURE.md §10 / PRODUCT_SPECIFICATION.md §12 ids.
// Phone numbers are masked placeholders — never real numbers (safety rule).
export function seedRepository(repository: InMemoryRepository): void {
  repository.seedPerson({
    id: "person_marie",
    firstName: "Marie",
    phone: "+33 X XX XX XX 01",
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
    phone: "+33 X XX XX XX 02",
    relationship: "daughter",
    priority: 1,
    consentStatus: "confirmed",
  });

  repository.seedContact({
    id: "contact_marc",
    personId: "person_marie",
    firstName: "Marc",
    phone: "+33 X XX XX XX 03",
    relationship: "son",
    priority: 2,
    consentStatus: "confirmed",
  });

  repository.seedContact({
    id: "contact_nicole",
    personId: "person_marie",
    firstName: "Nicole",
    phone: "+33 X XX XX XX 04",
    relationship: "trusted neighbour",
    priority: 3,
    consentStatus: "confirmed",
  });
}
