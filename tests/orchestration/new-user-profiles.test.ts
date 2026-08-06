import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "@/backend/persistence/in-memory-repository";
import { FakeCalleAdapter } from "@/backend/integrations/calle/fake-adapter";
import { startDemoEvent, type EngineDeps } from "@/backend/orchestration/engine";
import type { FakeScenarioId } from "@/backend/integrations/calle/fake-adapter";

// A completely new user's own database: no seeded demo person, no legacy ids.
// Every scenario must work against identities this project has never seen —
// previously impossible, because the fake Companion scenarios were keyed to
// `person_marie` and the Family scenarios to `contact_julie`/`contact_marc`.

async function newUserWorld(scenario?: FakeScenarioId) {
  const repository = new InMemoryRepository();

  const alice = await repository.createPerson({
    firstName: "Alice",
    phone: "+33611111111",
    preferredLanguage: "fr-FR",
    conversationProfile: "standard",
    preferredCallTime: "09:00",
    interests: [],
    consentStatus: "confirmed",
  });

  const bob = await repository.createTrustedContact(alice.id, {
    firstName: "Bob",
    phone: "+33622222222",
    relationship: "son",
    consentStatus: "confirmed",
  });
  const chloe = await repository.createTrustedContact(alice.id, {
    firstName: "Chloé",
    phone: "+33633333333",
    relationship: "daughter",
    consentStatus: "confirmed",
  });
  const david = await repository.createTrustedContact(alice.id, {
    firstName: "David",
    phone: "+33644444444",
    relationship: "neighbour",
    consentStatus: "confirmed",
  });

  const calleAdapter = new FakeCalleAdapter(scenario ? { scenario } : {});
  return { deps: { repository, calleAdapter } satisfies EngineDeps, alice, bob, chloe, david };
}

function callsOf(repository: InMemoryRepository, eventId: string) {
  return repository.listCallEvents(eventId);
}

describe("fake scenarios work for a user-created profile", () => {
  it("runs a normal check-in and closes, with no legacy id anywhere", async () => {
    const { deps, alice } = await newUserWorld("marie_baseline");
    // Every seeded id is absent from this database.
    expect(await deps.repository.getPerson("person_marie")).toBeUndefined();

    const event = await startDemoEvent(alice.id, deps);
    expect(event.personId).toBe(alice.id);
    expect(event.status).toBe("CASE_CLOSED");
  });

  it("calls the user's own contacts in their own priority order", async () => {
    const { deps, alice, bob, chloe } = await newUserWorld("marie_baseline");
    const event = await startDemoEvent(alice.id, deps);

    const family = (await callsOf(deps.repository as InMemoryRepository, event.id)).filter(
      (c) => c.agentType === "family"
    );
    // Priority 1 (Bob) is tried twice and never answers; priority 2 (Chloé)
    // confirms and stops the cascade. David is never reached.
    expect(family.map((c) => c.contactId)).toEqual([bob.id, bob.id, chloe.id]);
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(event.status).toBe("CASE_CLOSED");
  });

  it("stops the cascade on the first confirmation", async () => {
    const { deps, alice, bob } = await newUserWorld("explicit_help");
    const event = await startDemoEvent(alice.id, deps);

    const family = (await callsOf(deps.repository as InMemoryRepository, event.id)).filter(
      (c) => c.agentType === "family"
    );
    expect(family.map((c) => c.contactId)).toEqual([bob.id]);
    expect(event.status).toBe("CASE_CLOSED");
  });

  it("ends unresolved when every one of the user's contacts declines", async () => {
    const { deps, alice } = await newUserWorld("all_contacts_unavailable");
    const event = await startDemoEvent(alice.id, deps);
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
  });

  it("places exactly one callback, to the user's own person", async () => {
    const { deps, alice } = await newUserWorld("marie_baseline");
    const event = await startDemoEvent(alice.id, deps);

    const notifications = (await callsOf(deps.repository as InMemoryRepository, event.id)).filter(
      (c) => c.agentType === "person_notification"
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0].contactId).toBeNull();
    expect(event.personId).toBe(alice.id);
  });

  it("never leaks a legacy identity into the timeline", async () => {
    const { deps, alice } = await newUserWorld("marie_baseline");
    const event = await startDemoEvent(alice.id, deps);
    const messages = (await deps.repository.listTimeline(event.id)).map((e) => e.message).join(" | ");

    for (const legacy of ["Marie", "Julie", "Nicole", "person_marie", "contact_julie"]) {
      expect(messages).not.toContain(legacy);
    }
    expect(messages).toContain("Alice");
  });
});

describe("consent and eligibility still apply to a user-created circle", () => {
  it("skips an unconsented contact without calling them", async () => {
    const repository = new InMemoryRepository();
    const alice = await repository.createPerson({
      firstName: "Alice",
      phone: "+33611111111",
      preferredLanguage: "fr-FR",
      conversationProfile: "standard",
      preferredCallTime: "09:00",
      interests: [],
      consentStatus: "confirmed",
    });
    const pending = await repository.createTrustedContact(alice.id, {
      firstName: "Bob",
      phone: "+33622222222",
      relationship: "son",
      consentStatus: "pending",
    });
    const confirmed = await repository.createTrustedContact(alice.id, {
      firstName: "Chloé",
      phone: "+33633333333",
      relationship: "daughter",
      consentStatus: "confirmed",
    });

    const deps: EngineDeps = { repository, calleAdapter: new FakeCalleAdapter() };
    const event = await startDemoEvent(alice.id, deps);

    const family = (await repository.listCallEvents(event.id)).filter(
      (c) => c.agentType === "family"
    );
    expect(family.map((c) => c.contactId)).not.toContain(pending.id);
    expect(family.map((c) => c.contactId)).toContain(confirmed.id);

    const messages = (await repository.listTimeline(event.id)).map((e) => e.message).join(" | ");
    expect(messages).toContain("Skipped Bob");
  });

  it("reaches a visible unresolved outcome when the circle is empty", async () => {
    const repository = new InMemoryRepository();
    const alice = await repository.createPerson({
      firstName: "Alice",
      phone: "+33611111111",
      preferredLanguage: "fr-FR",
      conversationProfile: "standard",
      preferredCallTime: "09:00",
      interests: [],
      consentStatus: "confirmed",
    });

    const deps: EngineDeps = { repository, calleAdapter: new FakeCalleAdapter() };
    const event = await startDemoEvent(alice.id, deps);

    // No raw adapter exception: the event ends in a real, displayable state.
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    const family = (await repository.listCallEvents(event.id)).filter(
      (c) => c.agentType === "family"
    );
    expect(family).toHaveLength(0);
  });
});
