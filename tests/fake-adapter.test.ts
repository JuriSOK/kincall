import { describe, expect, it } from "vitest";
import { FakeCalleAdapter } from "@/lib/calle/fake-adapter";
import type { VulnerablePerson } from "@/lib/database/types";

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
    });
    const result = await adapter.getCallResult(reference.callId);

    expect(result.agentType).toBe("companion");
    expect(result.status).toBe("completed");
    expect(result.structuredResult).toMatchObject({
      person_reached: "yes",
      fall_mentioned: "yes",
      mobility_difficulty: "yes",
      recommended_attention_level: "high",
    });
  });

  it("returns Julie's no-answer result", async () => {
    const adapter = new FakeCalleAdapter();
    const reference = await adapter.startFamilyCall({
      personId: "person_marie",
      contactId: "contact_julie",
      idempotencyKey: "event_001_contact_julie_attempt_1",
      informationToShare: [],
    });
    const result = await adapter.getCallResult(reference.callId);

    expect(result.structuredResult).toMatchObject({ answered: false });
  });

  it("returns Marc's confirmation result", async () => {
    const adapter = new FakeCalleAdapter();
    const reference = await adapter.startFamilyCall({
      personId: "person_marie",
      contactId: "contact_marc",
      idempotencyKey: "event_001_contact_marc_attempt_1",
      informationToShare: [],
    });
    const result = await adapter.getCallResult(reference.callId);

    expect(result.structuredResult).toMatchObject({
      answered: true,
      can_intervene: true,
      estimated_time: "17:30",
    });
  });

  it("throws for an unknown subject id", async () => {
    const adapter = new FakeCalleAdapter();
    const reference = await adapter.startCompanionCall({
      eventId: "event_001",
      person: person({ id: "person_unknown" }),
      idempotencyKey: "key",
    });
    await expect(adapter.getCallResult(reference.callId)).rejects.toThrow(/no canned scenario/);
  });
});
