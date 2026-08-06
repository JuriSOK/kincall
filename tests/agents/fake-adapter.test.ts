import { describe, expect, it } from "vitest";
import {
  FAKE_SCENARIOS,
  FakeCalleAdapter,
  type FakeScenarioId,
} from "@/backend/integrations/calle/fake-adapter";
import { isCompanionStructuredResult } from "@/backend/integrations/calle/schemas";
import type { TrustedContact, VulnerablePerson } from "@/shared/domain/types";

function person(overrides: Partial<VulnerablePerson> = {}): VulnerablePerson {
  return {
    id: "person_marie",
    firstName: "Marie",
    phone: "+33639980001",
    preferredLanguage: "fr-FR",
    conversationProfile: "cognitive_friendly",
    preferredCallTime: "09:00",
    interests: ["gardening", "family"],
    consentStatus: "confirmed",
    archivedAt: null,
    timezone: "Europe/Paris",
    avatarKey: null,
    conversationNotes: null,
    checkInDays: [1, 2, 3, 4, 5, 6, 7],
    scheduleState: "active",
    ...overrides,
  };
}

function contact(overrides: Partial<TrustedContact> = {}): TrustedContact {
  return {
    id: "contact_julie",
    personId: "person_marie",
    firstName: "Julie",
    phone: "+33639980002",
    relationship: "daughter",
    priority: 1,
    consentStatus: "confirmed",
    archivedAt: null,
    isPrimary: false,
    enabled: true,
    callableFrom: null,
    callableTo: null,
    timezone: null,
    maxAttempts: 2,
    ...overrides,
  };
}

describe("FakeCalleAdapter", () => {
  it("returns Marie's canned companion result", async () => {
    const adapter = new FakeCalleAdapter();
    const reference = await adapter.startCompanionCall({
      eventId: "event_001",
      person: person(),
      idempotencyKey: "event_001_companion_attempt_1",
      attemptNumber: 1,
    });
    const result = await adapter.getCallResult(reference.callId);

    expect(result.agentType).toBe("companion");
    expect(result.status).toBe("completed");
    expect(result.structuredResult).toMatchObject({
      person_reached: "yes",
      fall_mentioned: "yes",
      mobility_difficulty: "yes",
      attention_required: "yes",
      attention_reasons: ["fall", "mobility_difficulty"],
    });
  });

  it("returns Julie's no-answer result", async () => {
    const adapter = new FakeCalleAdapter();
    const reference = await adapter.startFamilyCall({
      eventId: "event_001",
      person: person(),
      contact: contact(),
      idempotencyKey: "event_001_contact_julie_attempt_1",
      informationToShare: [],
      attemptNumber: 1,
      mayLeaveVoicemail: false,
    });
    const result = await adapter.getCallResult(reference.callId);

    expect(result.structuredResult).toMatchObject({ answered: "no", intervention_type: "other", estimated_time: "" });
  });

  it("returns Marc's confirmation result", async () => {
    const adapter = new FakeCalleAdapter();
    const reference = await adapter.startFamilyCall({
      eventId: "event_001",
      person: person(),
      contact: contact({ id: "contact_marc", firstName: "Marc", relationship: "son", priority: 2 }),
      idempotencyKey: "event_001_contact_marc_attempt_1",
      informationToShare: [],
      attemptNumber: 1,
      mayLeaveVoicemail: false,
    });
    const result = await adapter.getCallResult(reference.callId);

    expect(result.structuredResult).toMatchObject({
      answered: "yes",
      can_intervene: "yes",
      estimated_time: "17:30",
    });
  });

  // Reversed deliberately. This used to throw
  // `no canned scenario for a companion call to "<id>"`, which meant a new user
  // who created their own profile could not run a fake scenario at all — the
  // scenarios were keyed to the seeded demo person. They are now keyed to the
  // SCENARIO, and apply to whichever person the event belongs to.
  it("serves a companion result for any person id, not just a seeded one", async () => {
    const adapter = new FakeCalleAdapter();
    const reference = await adapter.startCompanionCall({
      eventId: "event_001",
      person: person({ id: "person_someone_new" }),
      idempotencyKey: "key",
      attemptNumber: 1,
    });

    const result = await adapter.getCallResult(reference.callId);
    expect(result.agentType).toBe("companion");
    expect(result.status).toBe("completed");
    expect(isCompanionStructuredResult(result.structuredResult)).toBe(true);
  });

  it("names nobody in a companion result, so it fits any profile", async () => {
    for (const scenario of Object.keys(FAKE_SCENARIOS) as FakeScenarioId[]) {
      const adapter = new FakeCalleAdapter({ scenario });
      const reference = await adapter.startCompanionCall({
        eventId: "event_001",
        person: person({ id: "person_alice" }),
        idempotencyKey: "key",
        attemptNumber: 1,
      });
      const result = await adapter.getCallResult(reference.callId);
      const summary = (result.structuredResult as { neutral_summary: string }).neutral_summary;
      for (const legacyName of ["Marie", "Julie", "Marc", "Nicole"]) {
        expect(summary).not.toContain(legacyName);
      }
    }
  });
});

// The scenario list is rendered on every profile page in fake mode, and a
// scenario now runs against whichever person is selected. Naming the seeded
// demo circle in that copy told a new user the scenario was about somebody
// else's profile.
describe("scenario labels and descriptions are identity-free", () => {
  it("names no legacy demo person or contact", () => {
    for (const [id, scenario] of Object.entries(FAKE_SCENARIOS)) {
      for (const text of [scenario.label, scenario.description]) {
        for (const legacyName of ["Marie", "Julie", "Marc", "Nicole"]) {
          expect(text, `${id}: "${text}"`).not.toContain(legacyName);
        }
      }
    }
  });

  it("describes the roles generically instead", () => {
    const descriptions = Object.values(FAKE_SCENARIOS).map((s) => s.description);
    for (const description of descriptions) {
      expect(description.length).toBeGreaterThan(0);
    }
    // Every description speaks about "the monitored person"; the cascade ones
    // speak about trusted contacts by position, never by name.
    expect(descriptions.every((d) => d.includes("The monitored person"))).toBe(true);
  });

  // The ids are the stable key the demo selector, the start route and several
  // tests all agree on — genericising the copy must never rename them.
  it("keeps the stable scenario ids", () => {
    expect(Object.keys(FAKE_SCENARIOS).sort()).toEqual(
      [
        "all_contacts_unavailable",
        "explicit_help",
        "marie_baseline",
        "other_incident",
        "person_unreachable",
      ].sort()
    );
  });
});
