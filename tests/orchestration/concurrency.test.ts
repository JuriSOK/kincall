import { describe, expect, it } from "vitest";
import { CallIntentIntegrityError } from "@/backend/persistence/errors";
import { InMemoryRepository, createInMemoryStore } from "@/backend/persistence/in-memory-repository";
import type { InMemoryStore } from "@/backend/persistence/in-memory-repository";
import type { Repository } from "@/backend/persistence/repository";
import { seedRepository } from "@/backend/persistence/seed";
import { FakeCalleAdapter } from "@/backend/integrations/calle/fake-adapter";
import type { CallResult, CallStatus } from "@/backend/integrations/calle/adapter";
import {
  processCompanionResult,
  processFamilyResult,
  startDemoEvent,
  type EngineDeps,
} from "@/backend/orchestration/engine";
import { RecordingCalleAdapter } from "../support/recording-adapter";
import { seedPendingCompanionCallIntent } from "../support/seed-calls";

const LEASE_SECONDS = 90;

// DEC-011 lengthened this: Julie is called twice before Marc (the bounded
// per-contact retry), and the second unanswered call leaves the fixed voicemail.
// The property under test is unchanged — every racing worker converges on ONE
// history, with no duplicated entry.
const EXPECTED_TIMELINE = [
  "Check-in call started",
  "Check-in call completed",
  "The person mentioned a fall, difficulty moving around.",
  "Calling Julie",
  "No answer from Julie (attempt 1)",
  "No voicemail attempted — one more attempt is owed",
  "Calling Julie again (attempt 2)",
  "No answer from Julie (attempt 2)",
  "Voicemail left",
  "Calling Marc",
  "Marc confirmed they could help.",
  "Visit confirmed — 17:30",
  "KinCall called Marie to share the outcome.",
  "The outcome was shared with Marie.",
  "Case closed",
];

// Two workers, two repository objects, one shared store — the shape of two
// Vercel instances handling a webhook and a poll at the same moment.
function world() {
  const store: InMemoryStore = createInMemoryStore();
  let offsetMs = 0;
  const now = () => Date.now() + offsetMs;

  const adapter = new RecordingCalleAdapter();
  const seeder = new InMemoryRepository({ store, now });
  seedRepository(seeder);

  return {
    adapter,
    open(): EngineDeps {
      return { repository: new InMemoryRepository({ store, now }), calleAdapter: adapter };
    },
    advance(seconds: number) {
      offsetMs += seconds * 1000;
    },
  };
}

async function timeline(deps: EngineDeps, eventId: string): Promise<string[]> {
  return (await deps.repository.listTimeline(eventId)).map((entry) => entry.message);
}

describe("concurrency — only one worker may process a result", () => {
  it("grants the lease to exactly one of two concurrent processFamilyResult calls", async () => {
    const w = world();
    const setup = w.open();

    // Drive to the point where Julie's result is waiting to be processed.
    const stalled = w.open();
    stalled.calleAdapter = {
      ...new FakeCalleAdapter(),
      capabilities: { voicemail: true },
      startCompanionCall: w.adapter.startCompanionCall.bind(w.adapter),
      startFamilyCall: w.adapter.startFamilyCall.bind(w.adapter),
      startPersonNotificationCall: w.adapter.startPersonNotificationCall.bind(w.adapter),
      async getCallResult(callId: string): Promise<CallResult> {
        const result = await w.adapter.getCallResult(callId);
        return result.agentType === "family"
          ? { ...result, status: "queued" as CallStatus, structuredResult: null }
          : result;
      },
    };
    const event = await startDemoEvent("person_marie", stalled);
    expect(event.status).toBe("CALLING_TRUSTED_CONTACT");

    const julie = (await setup.repository.listCallEvents(event.id)).find(
      (call) => call.contactId === "contact_julie"
    )!;

    // Now both workers see the same terminal result at the same moment.
    const a = w.open();
    const b = w.open();
    await Promise.all([
      processFamilyResult(a, event, julie.id),
      processFamilyResult(b, event, julie.id),
    ]);

    const deps = w.open();
    expect((await deps.repository.getEvent(event.id))!.status).toBe("CASE_CLOSED");
    expect(await timeline(deps, event.id)).toEqual(EXPECTED_TIMELINE);
    // One companion call + two to Julie (her bounded retry) + one to Marc +
    // one informational callback to Marie (DEC-023): the count is what proves
    // the race produced no DUPLICATE outbound call. Each attempt happens
    // exactly once, and Nicole is untouched.
    expect([...w.adapter.distinctCallIds]).toHaveLength(5);
    expect(w.adapter.contactsCalled()).toEqual([
      "contact_julie",
      "contact_julie",
      "contact_marc",
    ]);
    // Two racing workers, still exactly one callback.
    expect(w.adapter.notificationMessages()).toHaveLength(1);
  });

  it("survives a webhook and a poll racing the same companion result", async () => {
    const w = world();
    const setup = w.open();
    const { event, callEvent } = await seedPendingCompanionCallIntent(setup);
    await setup.repository.attachCalleCallId(
      callEvent.id,
      "fake_companion_person_marie_00000000-0000-0000-0000-000000000002"
    );

    const webhook = w.open();
    const poll = w.open();
    await Promise.all([
      processCompanionResult(webhook, event, callEvent.id),
      processCompanionResult(poll, event, callEvent.id),
    ]);

    const deps = w.open();
    expect((await deps.repository.getEvent(event.id))!.status).toBe("CASE_CLOSED");
    expect(await timeline(deps, event.id)).toEqual(EXPECTED_TIMELINE);
  });

  it("takes NO lease for a queued result, leaving it processable later", async () => {
    const w = world();
    const setup = w.open();
    const { event, callEvent } = await seedPendingCompanionCallIntent(setup);
    await setup.repository.attachCalleCallId(
      callEvent.id,
      "fake_companion_person_marie_00000000-0000-0000-0000-000000000003"
    );

    const queued = w.open();
    queued.calleAdapter = {
      ...queued.calleAdapter,
      async getCallResult(callId: string): Promise<CallResult> {
        return {
          callId,
          agentType: "companion",
          status: "queued",
          structuredResult: null,
          failureCode: null,
          failureMessage: null,
        };
      },
    };

    const unchanged = await processCompanionResult(queued, event, callEvent.id);
    expect(unchanged.status).toBe("CONVERSATION_IN_PROGRESS");

    // The lease was never taken, so nothing has to expire before the real
    // result can be processed.
    const inspect = w.open();
    const current = (await inspect.repository.getCallEvent(callEvent.id))!;
    expect(current.processingToken).toBeNull();
    expect(current.resultProcessedAt).toBeNull();

    const later = w.open();
    const finished = await processCompanionResult(later, event, callEvent.id);
    expect(finished.status).toBe("CASE_CLOSED");
    expect(await timeline(later, event.id)).toEqual(EXPECTED_TIMELINE);
  });
});

describe("concurrency — one intent per operation key", () => {
  it("returns the same callEvent to both of two concurrent identical commits", async () => {
    const w = world();
    const repository: Repository = w.open().repository;
    const event = await repository.createEvent("person_marie");

    const input = {
      eventId: event.id,
      operationKey: `${event.runId}:start:COMPANION_CALL_STARTED`,
      transitionEvent: "COMPANION_CALL_STARTED" as const,
      expectedFromStatus: "SCHEDULED" as const,
      status: "CALLING_PERSON" as const,
      messages: ["Check-in call started"],
      intent: {
        agentType: "companion" as const,
        contactId: null,
        attemptNumber: 1,
        idempotencyKey: `${event.runId}_companion_attempt_1`,
      },
    };

    const [first, second] = await Promise.all([
      repository.commitTransitionWithCallIntent(input),
      repository.commitTransitionWithCallIntent(input),
    ]);

    expect(first.callEvent!.id).toBe(second.callEvent!.id);
    expect([first.applied, second.applied].filter(Boolean)).toHaveLength(1);
    expect(await repository.listCallEvents(event.id)).toHaveLength(1);
    expect(await repository.listTimeline(event.id)).toHaveLength(1);
  });

  it("raises an integrity error rather than binding a second intent to one operation", async () => {
    const w = world();
    const repository = w.open().repository;
    const event = await repository.createEvent("person_marie");
    const key = "op:advance:FAMILY_CALL_STARTED";

    await repository.updateEvent(event.id, { status: "ATTENTION_REQUIRED" });
    await repository.commitTransitionWithCallIntent({
      eventId: event.id,
      operationKey: key,
      transitionEvent: "FAMILY_CALL_STARTED",
      expectedFromStatus: "ATTENTION_REQUIRED",
      status: "CALLING_TRUSTED_CONTACT",
      intent: {
        agentType: "family",
        contactId: "contact_julie",
        attemptNumber: 1,
        idempotencyKey: `${event.runId}_contact_julie_attempt_1`,
      },
    });

    // The same operation, now claiming it meant Nicole all along.
    await expect(
      repository.commitTransitionWithCallIntent({
        eventId: event.id,
        operationKey: key,
        transitionEvent: "FAMILY_CALL_STARTED",
        expectedFromStatus: "ATTENTION_REQUIRED",
        status: "CALLING_TRUSTED_CONTACT",
        intent: {
          agentType: "family",
          contactId: "contact_nicole",
          attemptNumber: 1,
          idempotencyKey: `${event.runId}_contact_nicole_attempt_1`,
        },
      })
    ).rejects.toThrow(CallIntentIntegrityError);

    const calls = await repository.listCallEvents(event.id);
    expect(calls).toHaveLength(1);
    expect(calls[0].contactId).toBe("contact_julie");
  });
});

describe("concurrency — a superseded result is retired, not re-attempted forever", () => {
  it("finalizes a stale result once and never reclaims it again", async () => {
    const w = world();
    const setup = w.open();
    const { event, callEvent } = await seedPendingCompanionCallIntent(setup);
    await setup.repository.attachCalleCallId(
      callEvent.id,
      "fake_companion_person_marie_00000000-0000-0000-0000-000000000004"
    );

    // Another worker has already carried this event to a terminal state.
    await setup.repository.updateEvent(event.id, { status: "CASE_CLOSED" });
    const closedAt = new Date().toISOString();
    await setup.repository.updateEvent(event.id, { closedAt });
    const timelineBefore = await timeline(setup, event.id);

    const stale = w.open();
    const stopped = await processCompanionResult(stale, event, callEvent.id);

    // The event is untouched: no status change, no timeline entry.
    expect(stopped.status).toBe("CASE_CLOSED");
    expect((await stale.repository.getEvent(event.id))!.closedAt).toBe(closedAt);
    expect(await timeline(stale, event.id)).toEqual(timelineBefore);

    // But the result IS retired, so it cannot be reclaimed every lease period.
    const retired = (await stale.repository.getCallEvent(callEvent.id))!;
    expect(retired.resultProcessedAt).not.toBeNull();
    expect(retired.processingToken).toBeNull();

    for (let period = 0; period < 3; period += 1) {
      w.advance(LEASE_SECONDS + 1);
      const deps = w.open();
      expect(await deps.repository.claimCallEventResult(callEvent.id, LEASE_SECONDS)).toBeNull();
      expect(await timeline(deps, event.id)).toEqual(timelineBefore);
    }
  });
});

describe("concurrency — the engine carries no state across a restart", () => {
  it("resumes a mid-cascade event through entirely fresh deps", async () => {
    const w = world();

    const stalled = w.open();
    stalled.calleAdapter = {
      ...stalled.calleAdapter,
      // `capabilities` is a prototype getter, which an object spread does not
      // copy — carried over explicitly so this stand-in is a complete adapter.
      capabilities: stalled.calleAdapter.capabilities,
      startCompanionCall: w.adapter.startCompanionCall.bind(w.adapter),
      startFamilyCall: w.adapter.startFamilyCall.bind(w.adapter),
      startPersonNotificationCall: w.adapter.startPersonNotificationCall.bind(w.adapter),
      async getCallResult(callId: string): Promise<CallResult> {
        const result = await w.adapter.getCallResult(callId);
        return result.agentType === "family"
          ? { ...result, status: "queued" as CallStatus, structuredResult: null }
          : result;
      },
    };
    const event = await startDemoEvent("person_marie", stalled);
    expect(event.status).toBe("CALLING_TRUSTED_CONTACT");

    // Everything in memory is discarded; only the store survives.
    const restarted = w.open();
    const pending = (await restarted.repository.listCallEvents(event.id)).find(
      (call) => call.resultProcessedAt === null
    )!;
    const reread = (await restarted.repository.getEvent(event.id))!;
    const finished = await processFamilyResult(restarted, reread, pending.id);

    expect(finished.status).toBe("CASE_CLOSED");
    expect(await timeline(restarted, event.id)).toEqual(EXPECTED_TIMELINE);
  });
});
