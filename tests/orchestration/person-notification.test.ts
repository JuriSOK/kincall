import { describe, expect, it } from "vitest";
import { FakeCalleAdapter, type FakeScenarioId } from "@/backend/integrations/calle/fake-adapter";
import { InMemoryRepository } from "@/backend/persistence/in-memory-repository";
import { seedRepository } from "@/backend/persistence/seed";
import {
  processPersonNotificationResult,
  startDemoEvent,
  type EngineDeps,
} from "@/backend/orchestration/engine";
import { RecordingCalleAdapter } from "../support/recording-adapter";

// DEC-023, end to end through the real engine: after the trusted-circle outcome
// is settled, KinCall places EXACTLY ONE informational call back to the
// monitored person, before the terminal transition — and whatever that call
// does, the cascade's own outcome is untouched.

function deps(options: { scenario?: FakeScenarioId } = {}) {
  const repository = new InMemoryRepository();
  seedRepository(repository);
  return { repository, calleAdapter: new RecordingCalleAdapter(options) };
}

async function timeline(d: EngineDeps, eventId: string): Promise<string[]> {
  return (await d.repository.listTimeline(eventId)).map((entry) => entry.message);
}

describe("the callback happens exactly once, on both settled outcomes", () => {
  it("calls the person back after a contact confirms, then closes", async () => {
    const d = deps();
    const event = await startDemoEvent("person_marie", d);
    const adapter = d.calleAdapter as RecordingCalleAdapter;

    expect(event.status).toBe("CASE_CLOSED");
    expect(adapter.notificationMessages()).toHaveLength(1);
    expect(adapter.notificationMessages()[0]).toContain("Marc confirmed");
    expect(adapter.notificationMessages()[0]).toContain("will visit");

    const messages = await timeline(d, event.id);
    expect(messages).toContain("KinCall called Marie to share Marc's commitment.");
    expect(messages).toContain("The follow-up message was delivered.");
    // The callback precedes the terminal entry — never after it.
    expect(messages.indexOf("KinCall called Marie to share Marc's commitment.")).toBeLessThan(
      messages.indexOf("Case closed")
    );
  });

  it("calls the person back when the circle is exhausted, then ends unresolved", async () => {
    const d = deps({ scenario: "all_contacts_unavailable" });
    const event = await startDemoEvent("person_marie", d);
    const adapter = d.calleAdapter as RecordingCalleAdapter;

    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    expect(adapter.notificationMessages()).toHaveLength(1);

    const message = adapter.notificationMessages()[0];
    expect(message).toContain("Nobody in your trusted circle confirmed that they were available.");
    expect(message).toContain("contact another person you trust directly");
    // Some of them answered and declined, so this must never claim otherwise.
    expect(message).not.toMatch(/nobody answered|no answer/i);

    const messages = await timeline(d, event.id);
    expect(messages).toContain(
      "KinCall called Marie to explain that no support was confirmed."
    );
  });

  it("places NO callback for a normal close with no cascade", async () => {
    const d = deps();
    // A companion result with nothing to report closes at LOG_AND_CLOSE without
    // ever contacting the circle — and so has nothing to call back about.
    const repository = new InMemoryRepository();
    seedRepository(repository);
    const adapter = new RecordingCalleAdapter();
    const quiet: EngineDeps = {
      repository,
      calleAdapter: {
        ...adapter,
        capabilities: adapter.capabilities,
        startCompanionCall: adapter.startCompanionCall.bind(adapter),
        startFamilyCall: adapter.startFamilyCall.bind(adapter),
        startPersonNotificationCall: adapter.startPersonNotificationCall.bind(adapter),
        async getCallResult(callId: string) {
          const result = await adapter.getCallResult(callId);
          if (result.agentType !== "companion") return result;
          return {
            ...result,
            structuredResult: {
              neutral_summary: "Marie sounded like herself.",
              person_reached: "yes",
              explicit_help_requested: "no",
              fall_mentioned: "no",
              mobility_difficulty: "no",
              pain_or_injury_mentioned: "no",
              unusual_confusion: "no",
              distress_expressed: "no",
              conversation_ended_normally: "yes",
              does_not_want_to_disturb_family: "no",
              other_attention_signal: "no",
              attention_required: "no",
              attention_reasons: [],
              confidence: "high",
            },
          };
        },
      },
    };

    const event = await startDemoEvent("person_marie", quiet);

    expect(event.status).toBe("CASE_CLOSED");
    expect(event.decision).toBe("LOG_AND_CLOSE");
    expect(adapter.startPersonNotificationCallSpy).not.toHaveBeenCalled();
    const calls = await repository.listCallEvents(event.id);
    expect(calls.filter((call) => call.agentType === "person_notification")).toHaveLength(0);
  });
});

describe("the callback never changes the trusted-circle outcome", () => {
  it("still closes the case when the callback is not answered", async () => {
    const repository = new InMemoryRepository();
    seedRepository(repository);
    const inner = new FakeCalleAdapter();
    const d: EngineDeps = {
      repository,
      calleAdapter: {
        capabilities: inner.capabilities,
        startCompanionCall: inner.startCompanionCall.bind(inner),
        startFamilyCall: inner.startFamilyCall.bind(inner),
        startPersonNotificationCall: inner.startPersonNotificationCall.bind(inner),
        async getCallResult(callId: string) {
          const result = await inner.getCallResult(callId);
          if (result.agentType !== "person_notification") return result;
          return {
            ...result,
            structuredResult: {
              person_reached: "no",
              message_delivered: "no",
              summary: "The call was not answered.",
            },
          };
        },
      },
    };

    const event = await startDemoEvent("person_marie", d);

    // The cascade outcome is preserved exactly.
    expect(event.status).toBe("CASE_CLOSED");
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(event.closedAt).not.toBeNull();

    const messages = await timeline(d, event.id);
    // Never claims a delivery that was not reported.
    expect(messages).toContain(
      "KinCall could not confirm that the follow-up message was delivered."
    );
    expect(messages).not.toContain("The follow-up message was delivered.");
    // And never retried.
    const calls = await repository.listCallEvents(event.id);
    expect(calls.filter((call) => call.agentType === "person_notification")).toHaveLength(1);
  });

  it("still ends unresolved when the callback fails technically", async () => {
    const repository = new InMemoryRepository();
    seedRepository(repository);
    const inner = new FakeCalleAdapter({ scenario: "all_contacts_unavailable" });
    const d: EngineDeps = {
      repository,
      calleAdapter: {
        capabilities: inner.capabilities,
        startCompanionCall: inner.startCompanionCall.bind(inner),
        startFamilyCall: inner.startFamilyCall.bind(inner),
        startPersonNotificationCall: inner.startPersonNotificationCall.bind(inner),
        async getCallResult(callId: string) {
          const result = await inner.getCallResult(callId);
          if (result.agentType !== "person_notification") return result;
          return {
            ...result,
            status: "failed" as const,
            structuredResult: null,
            failureCode: "carrier_error",
            failureMessage: "Simulated failure.",
          };
        },
      },
    };

    const event = await startDemoEvent("person_marie", d);

    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    const messages = await timeline(d, event.id);
    expect(messages).toContain(
      "KinCall could not confirm that the follow-up message was delivered."
    );
    const calls = await repository.listCallEvents(event.id);
    expect(calls.filter((call) => call.agentType === "person_notification")).toHaveLength(1);
  });

  it("still closes when the callback returns an unreadable result", async () => {
    const repository = new InMemoryRepository();
    seedRepository(repository);
    const inner = new FakeCalleAdapter();
    const d: EngineDeps = {
      repository,
      calleAdapter: {
        capabilities: inner.capabilities,
        startCompanionCall: inner.startCompanionCall.bind(inner),
        startFamilyCall: inner.startFamilyCall.bind(inner),
        startPersonNotificationCall: inner.startPersonNotificationCall.bind(inner),
        async getCallResult(callId: string) {
          const result = await inner.getCallResult(callId);
          if (result.agentType !== "person_notification") return result;
          return { ...result, structuredResult: { nonsense: true } };
        },
      },
    };

    const event = await startDemoEvent("person_marie", d);
    expect(event.status).toBe("CASE_CLOSED");
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
  });
});

describe("the callback is skipped, not forced, when it must not be placed", () => {
  it("skips it for an archived profile and still reaches the terminal status", async () => {
    const repository = new InMemoryRepository();
    seedRepository(repository);
    const inner = new FakeCalleAdapter();

    // Archived the moment the family leg is under way — i.e. between the circle
    // finishing and the callback being placed, which is exactly the window
    // DEC-023's re-read guards.
    let archived = false;
    // A Proxy rather than a spread: spreading a class instance drops every
    // prototype method, and the engine needs the whole Repository surface.
    const guardedRepository = new Proxy(repository, {
      get(target, prop, receiver) {
        if (prop === "getPerson") {
          return async (id: string) => {
            const person = await target.getPerson(id);
            if (!person) return person;
            return archived ? { ...person, archivedAt: new Date().toISOString() } : person;
          };
        }
        if (prop === "listCallEvents") {
          return async (eventId: string) => {
            const calls = await target.listCallEvents(eventId);
            if (calls.some((call) => call.agentType === "family")) archived = true;
            return calls;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const d: EngineDeps = {
      repository: guardedRepository,
      calleAdapter: {
        capabilities: inner.capabilities,
        startCompanionCall: inner.startCompanionCall.bind(inner),
        startFamilyCall: inner.startFamilyCall.bind(inner),
        async startPersonNotificationCall() {
          throw new Error("must not call an archived profile");
        },
        getCallResult: inner.getCallResult.bind(inner),
      },
    };

    const event = await startDemoEvent("person_marie", d);

    // The cascade outcome still stands, and the skip is recorded factually.
    expect(event.status).toBe("CASE_CLOSED");
    const messages = await timeline(d, event.id);
    expect(messages.some((m) => m.includes("the profile has been removed"))).toBe(true);
    const calls = await repository.listCallEvents(event.id);
    expect(calls.filter((call) => call.agentType === "person_notification")).toHaveLength(0);
  });

  it("skips it when consent is no longer confirmed", async () => {
    const repository = new InMemoryRepository();
    seedRepository(repository);
    const inner = new FakeCalleAdapter();

    let withdrawn = false;
    const guardedRepository = new Proxy(repository, {
      get(target, prop, receiver) {
        if (prop === "getPerson") {
          return async (id: string) => {
            const person = await target.getPerson(id);
            if (!person) return person;
            return withdrawn ? { ...person, consentStatus: "declined" as const } : person;
          };
        }
        if (prop === "listCallEvents") {
          return async (eventId: string) => {
            const calls = await target.listCallEvents(eventId);
            if (calls.some((call) => call.agentType === "family")) withdrawn = true;
            return calls;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const d: EngineDeps = {
      repository: guardedRepository,
      calleAdapter: {
        capabilities: inner.capabilities,
        startCompanionCall: inner.startCompanionCall.bind(inner),
        startFamilyCall: inner.startFamilyCall.bind(inner),
        async startPersonNotificationCall() {
          throw new Error("must not call without confirmed consent");
        },
        getCallResult: inner.getCallResult.bind(inner),
      },
    };

    const event = await startDemoEvent("person_marie", d);

    expect(event.status).toBe("CASE_CLOSED");
    const messages = await timeline(d, event.id);
    expect(messages.some((m) => m.includes("consent is no longer confirmed"))).toBe(true);
  });
});

describe("idempotency and recovery", () => {
  it("a duplicate poll of the same callback creates no second call", async () => {
    const d = deps();
    const event = await startDemoEvent("person_marie", d);
    const adapter = d.calleAdapter as RecordingCalleAdapter;

    const notification = (await d.repository.listCallEvents(event.id)).find(
      (call) => call.agentType === "person_notification"
    )!;

    // Re-drive the already-processed result, twice, exactly as a duplicate
    // webhook or a repeated poll would.
    const again = await processPersonNotificationResult(d, event, notification.id);
    const andAgain = await processPersonNotificationResult(d, event, notification.id);

    expect(again.status).toBe("CASE_CLOSED");
    expect(andAgain.status).toBe("CASE_CLOSED");
    expect(adapter.notificationMessages()).toHaveLength(1);

    // And no duplicated timeline entry.
    const messages = await timeline(d, event.id);
    expect(messages.filter((m) => m === "The follow-up message was delivered.")).toHaveLength(1);
    expect(messages.filter((m) => m === "Case closed")).toHaveLength(1);
  });

  it("uses a stable idempotency key derived from the durable runId", async () => {
    const d = deps();
    const event = await startDemoEvent("person_marie", d);

    const notification = (await d.repository.listCallEvents(event.id)).find(
      (call) => call.agentType === "person_notification"
    )!;
    expect(notification.idempotencyKey).toBe(`${event.runId}_person_notification`);
    // One attempt, always. There is no attempt 2.
    expect(notification.attemptNumber).toBe(1);
  });

  it("never creates a second event and never carries a contact id", async () => {
    const d = deps();
    const event = await startDemoEvent("person_marie", d);

    const events = await d.repository.listEvents("person_marie");
    expect(events).toHaveLength(1);

    const notification = (await d.repository.listCallEvents(event.id)).find(
      (call) => call.agentType === "person_notification"
    )!;
    // It is placed to the monitored person, never to a contact.
    expect(notification.contactId).toBeNull();
  });
});

describe("no raw internals reach the message", () => {
  it("never contains a phone number, an enum value, or JSON", async () => {
    const d = deps();
    await startDemoEvent("person_marie", d);
    const adapter = d.calleAdapter as RecordingCalleAdapter;
    const message = adapter.notificationMessages()[0];

    expect(message).not.toMatch(/\+\d{6,}/);
    for (const forbidden of ["contact_marc", "can_intervene", "intervention_type", "{", "}"]) {
      expect(message).not.toContain(forbidden);
    }
  });
});
