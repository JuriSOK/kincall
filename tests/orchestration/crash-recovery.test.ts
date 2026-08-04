import { describe, expect, it } from "vitest";
import { InMemoryRepository, createInMemoryStore } from "@/backend/persistence/in-memory-repository";
import type { InMemoryStore } from "@/backend/persistence/in-memory-repository";
import type { Repository } from "@/backend/persistence/repository";
import { seedRepository } from "@/backend/persistence/seed";
import {
  placeCallForIntent,
  processCompanionResult,
  processFamilyResult,
  startDemoEvent,
  type EngineDeps,
} from "@/backend/orchestration/engine";
import { crashingAfterRepository, crashingRepository, InjectedCrash } from "../support/crashing-repository";
import { RecordingCalleAdapter } from "../support/recording-adapter";

const LEASE_SECONDS = 90;

// The convergence target: whatever is killed and replayed, the event must end up
// with exactly this timeline. DEC-011 lengthened it — Julie is now called twice
// before Marc, because every contact gets one bounded retry, and the second
// unanswered call leaves the fixed privacy-preserving voicemail. The property
// under test is unchanged: every crash point converges on ONE history, with no
// duplicated entry and no skipped contact.
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
  "KinCall called Marie to share Marc's commitment.",
  "The follow-up message was delivered.",
  "Case closed",
];

// One shared store standing in for the durable database, plus a controllable
// clock so an expired lease can be reclaimed without waiting 90 real seconds.
function world() {
  const store: InMemoryStore = createInMemoryStore();
  let offsetMs = 0;
  const now = () => Date.now() + offsetMs;

  const adapter = new RecordingCalleAdapter();
  const seeder = new InMemoryRepository({ store, now });
  seedRepository(seeder);

  return {
    store,
    adapter,
    // Each call is a "fresh process": new repository object, same data.
    open(wrap: (r: Repository) => Repository = (r) => r): EngineDeps {
      return { repository: wrap(new InMemoryRepository({ store, now })), calleAdapter: adapter };
    },
    advance(seconds: number) {
      offsetMs += seconds * 1000;
    },
  };
}

async function timeline(deps: EngineDeps, eventId: string): Promise<string[]> {
  return (await deps.repository.listTimeline(eventId)).map((entry) => entry.message);
}

describe("crash recovery — the lease is never consumed by a crash", () => {
  it("1. a crash immediately after acquiring the lease leaves the result reclaimable", async () => {
    const w = world();

    // Crash on the first transition, i.e. right after the lease is taken.
    const crashed = w.open((r) => crashingRepository(r, { method: "commitTransition" }));
    await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

    const inspect = w.open();
    const event = (await inspect.repository.listPeople(), (await inspect.repository.getEvent("event_001"))!);
    const companion = (await inspect.repository.listCallEvents(event.id))[0];

    // The crashed worker never set resultProcessedAt — that is the whole point.
    expect(companion.resultProcessedAt).toBeNull();

    // processCompanionResult releases the lease on the way out, so the result
    // is immediately reclaimable rather than stuck for a full lease period.
    const resumed = w.open();
    const finished = await processCompanionResult(resumed, event, companion.id);

    expect(finished.status).toBe("CASE_CLOSED");
    expect(await timeline(resumed, event.id)).toEqual(EXPECTED_TIMELINE);
  });

  it("2. a crash after one transition replays it as a no-op and completes", async () => {
    const w = world();

    // Let the companion leg finish, then die partway through the family leg:
    // after the 6th transition commit ("No answer" is written, Marc is not yet called).
    const crashed = w.open((r) => crashingRepository(r, { method: "commitTransition", after: 5 }));
    await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

    const inspect = w.open();
    const event = (await inspect.repository.getEvent("event_001"))!;
    const pending = (await inspect.repository.listCallEvents(event.id)).find(
      (call) => call.resultProcessedAt === null
    )!;

    w.advance(LEASE_SECONDS + 1);
    const resumed = w.open();
    const finished =
      pending.agentType === "companion"
        ? await processCompanionResult(resumed, event, pending.id)
        : await processFamilyResult(resumed, event, pending.id);

    expect(finished.status).toBe("CASE_CLOSED");
    // Exactly one of each entry: replayed transitions no-op on their key.
    expect(await timeline(resumed, event.id)).toEqual(EXPECTED_TIMELINE);
  });
});

describe("crash recovery — call intent is persisted before CALL-E", () => {
  it("3. a Companion call accepted before calle_call_id is persisted is recovered on the same key", async () => {
    const w = world();

    // Crash after the adapter returned but before attachCalleCallId lands.
    const crashed = w.open((r) => crashingRepository(r, { method: "attachCalleCallId" }));
    await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

    const inspect = w.open();
    const event = (await inspect.repository.getEvent("event_001"))!;
    const intent = (await inspect.repository.listCallEvents(event.id))[0];

    // The intent survives, marked as not-yet-placed.
    expect(intent.status).toBe("starting");
    expect(intent.calleCallId).toBeNull();
    expect(w.adapter.startCompanionCallSpy).toHaveBeenCalledTimes(1);

    const resumed = w.open();
    const finished = await processCompanionResult(resumed, event, intent.id);

    expect(finished.status).toBe("CASE_CLOSED");
    // The request was repeated under the same key, so CALL-E returned the same
    // call rather than placing a second one.
    expect(w.adapter.startCompanionCallSpy).toHaveBeenCalledTimes(2);
    expect(
      [...w.adapter.distinctCallIds].filter((id) => id.startsWith("fake_companion_"))
    ).toHaveLength(1);
    expect(await timeline(resumed, event.id)).toEqual(EXPECTED_TIMELINE);
  });

  it("4. a Family call accepted before calle_call_id is persisted is recovered, and Nicole is never called", async () => {
    const w = world();

    // The companion attach and both of Julie's succeed; Marc's is the one that
    // dies. DEC-011 moved Marc from the 2nd attach to the 4th by adding Julie's
    // bounded retry (companion, julie#1, julie#2, marc).
    const crashed = w.open((r) => crashingRepository(r, { method: "attachCalleCallId", after: 3 }));
    await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

    const inspect = w.open();
    const event = (await inspect.repository.getEvent("event_001"))!;
    const marcIntent = (await inspect.repository.listCallEvents(event.id)).find(
      (call) => call.contactId === "contact_marc"
    )!;
    expect(marcIntent.calleCallId).toBeNull();

    w.advance(LEASE_SECONDS + 1);
    const resumed = w.open();
    const finished = await processFamilyResult(resumed, event, marcIntent.id);

    expect(finished.status).toBe("CASE_CLOSED");
    expect([...w.adapter.distinctCallIds].filter((id) => id.includes("contact_marc"))).toHaveLength(1);
    expect(w.adapter.contactsCalled()).not.toContain("contact_nicole");
    expect(await timeline(resumed, event.id)).toEqual(EXPECTED_TIMELINE);
  });

  it("5. a webhook arriving inside that window adopts the call id and processes normally", async () => {
    const w = world();

    const crashed = w.open((r) => crashingRepository(r, { method: "attachCalleCallId" }));
    await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

    const inspect = w.open();
    const event = (await inspect.repository.getEvent("event_001"))!;
    const intent = (await inspect.repository.listCallEvents(event.id))[0];

    // The webhook route locates the row by KinCall's own idempotency key — the
    // row exists precisely because the intent was written before the request.
    const located = await inspect.repository.findCallEventByIdempotencyKey(intent.idempotencyKey);
    expect(located?.id).toBe(intent.id);
    expect(located?.calleCallId).toBeNull();

    // Adoption: what the route does instead of rejecting on a null mismatch.
    const adopted = await inspect.repository.attachCalleCallId(
      located!.id,
      "fake_companion_person_marie_00000000-0000-0000-0000-000000000001"
    );
    expect(adopted.calleCallId).not.toBeNull();
    expect(adopted.status).toBe("in_progress");

    const finished = await processCompanionResult(inspect, event, adopted.id);
    expect(finished.status).toBe("CASE_CLOSED");
  });

  it("6. a restart before the adapter is reached recovers the intent without a duplicate call", async () => {
    const w = world();

    // Die after the intent is committed, before placeCallForIntent runs.
    const crashed = w.open((r) =>
      crashingAfterRepository(r, { method: "commitTransitionWithCallIntent" })
    );
    await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

    const inspect = w.open();
    const event = (await inspect.repository.getEvent("event_001"))!;
    const intents = await inspect.repository.listCallEvents(event.id);

    expect(intents).toHaveLength(1);
    expect(intents[0].status).toBe("starting");
    expect(w.adapter.startCompanionCallSpy).toHaveBeenCalledTimes(0);

    const resumed = w.open();
    await placeCallForIntent(resumed, intents[0]);

    expect(w.adapter.startCompanionCallSpy).toHaveBeenCalledTimes(1);
    expect(await resumed.repository.listCallEvents(event.id)).toHaveLength(1);
  });
});

describe("crash recovery — a replay never calls the wrong person", () => {
  it("7. a crash after the next call started, before the trigger was finalized, recovers Marc rather than skipping to Nicole", async () => {
    const w = world();

    // Die immediately after Marc's intent is committed. Julie's result is
    // therefore still unfinalized while Marc's row already exists — the exact
    // window in which "who has not been called yet" would answer "Nicole".
    // The 4th intent is Marc's, after companion, julie#1 and julie#2: it is
    // committed, and the process then dies before the trigger is finalized.
    const crashed = w.open((r) =>
      crashingAfterRepository(r, { method: "commitTransitionWithCallIntent", after: 3 })
    );
    await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

    const inspect = w.open();
    const event = (await inspect.repository.getEvent("event_001"))!;
    // Julie's LAST attempt is the trigger whose result was never finalized.
    const julieCalls = (await inspect.repository.listCallEvents(event.id)).filter(
      (call) => call.contactId === "contact_julie"
    );
    const julie = julieCalls[julieCalls.length - 1];
    const marc = (await inspect.repository.listCallEvents(event.id)).find(
      (call) => call.contactId === "contact_marc"
    )!;

    expect(julie.resultProcessedAt).toBeNull();
    expect(marc).toBeDefined();

    w.advance(LEASE_SECONDS + 1);
    const resumed = w.open();
    const finished = await processFamilyResult(resumed, event, julie.id);

    expect(finished.status).toBe("CASE_CLOSED");
    expect(w.adapter.contactsCalled()).not.toContain("contact_nicole");
    expect(
      (await resumed.repository.listCallEvents(event.id)).some(
        (call) => call.contactId === "contact_nicole"
      )
    ).toBe(false);
    expect(await timeline(resumed, event.id)).toEqual(EXPECTED_TIMELINE);
  });

  it("8. a stale worker's finalize is refused after another worker reclaimed and completed", async () => {
    const w = world();
    const a = w.open();

    const event = await a.repository.createEvent("person_marie");
    const started = await a.repository.commitTransitionWithCallIntent({
      eventId: event.id,
      operationKey: `${event.runId}:start:COMPANION_CALL_STARTED`,
      transitionEvent: "COMPANION_CALL_STARTED",
      expectedFromStatus: "SCHEDULED",
      status: "CALLING_PERSON",
      intent: {
        agentType: "companion",
        contactId: null,
        attemptNumber: 1,
        idempotencyKey: `${event.runId}_companion_attempt_1`,
      },
    });
    const callEvent = await a.repository.attachCalleCallId(started.callEvent!.id, "calle_x");

    const staleLease = await a.repository.claimCallEventResult(callEvent.id, LEASE_SECONDS);
    w.advance(LEASE_SECONDS + 1);

    const b = w.open();
    const freshLease = await b.repository.claimCallEventResult(callEvent.id, LEASE_SECONDS);
    expect(freshLease!.token).not.toBe(staleLease!.token);

    await b.repository.finalizeCallEventResult(callEvent.id, freshLease!.token, {
      status: "completed",
      summary: "worker B",
      structuredResult: { winner: "b" },
      endedAt: new Date().toISOString(),
    });

    const refused = await a.repository.finalizeCallEventResult(callEvent.id, staleLease!.token, {
      status: "completed",
      summary: "worker A",
      structuredResult: { winner: "a" },
      endedAt: new Date().toISOString(),
    });

    expect(refused).toBeNull();
    const current = await b.repository.getCallEvent(callEvent.id);
    expect(current?.summary).toBe("worker B");
    expect(current?.structuredResult).toEqual({ winner: "b" });
  });

  it("9. an expired Julie worker resuming after the case closed never calls Nicole", async () => {
    const w = world();

    // Worker A dies holding Julie's result, on the FAMILY_NO_ANSWER commit.
    const crashedA = w.open((r) => crashingRepository(r, { method: "commitTransition", after: 3 }));
    await expect(startDemoEvent("person_marie", crashedA)).rejects.toThrow(InjectedCrash);

    const inspect = w.open();
    const event = (await inspect.repository.getEvent("event_001"))!;
    const julie = (await inspect.repository.listCallEvents(event.id)).find(
      (call) => call.contactId === "contact_julie"
    )!;

    // Worker B reclaims the stale lease and drives the case to a close.
    w.advance(LEASE_SECONDS + 1);
    const b = w.open();
    const closed = await processFamilyResult(b, event, julie.id);
    expect(closed.status).toBe("CASE_CLOSED");

    const timelineAfterB = await timeline(b, event.id);
    const closedAtAfterB = (await b.repository.getEvent(event.id))!.closedAt;
    const familyCallsBefore = w.adapter.contactsCalled().length;

    // Worker A now wakes up and re-drives the very same result.
    w.advance(LEASE_SECONDS + 1);
    const a = w.open();
    const late = await processFamilyResult(a, event, julie.id);

    // Nothing moved, and nobody else was called.
    expect(late.status).toBe("CASE_CLOSED");
    expect((await a.repository.getEvent(event.id))!.closedAt).toBe(closedAtAfterB);
    expect(await timeline(a, event.id)).toEqual(timelineAfterB);
    expect(await timeline(a, event.id)).toEqual(EXPECTED_TIMELINE);
    expect(w.adapter.contactsCalled()).toHaveLength(familyCallsBefore);
    expect(w.adapter.contactsCalled()).not.toContain("contact_nicole");
    expect(
      (await a.repository.listCallEvents(event.id)).some(
        (call) => call.contactId === "contact_nicole"
      )
    ).toBe(false);
  });
});

// Drives an event to a terminal state the way repeated polling would: resume
// whatever is pending, after the crashed worker's lease has expired.
async function pollToCompletion(w: ReturnType<typeof world>, eventId: string): Promise<EngineDeps> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    w.advance(LEASE_SECONDS + 1);
    const deps = w.open();
    const current = (await deps.repository.getEvent(eventId))!;
    if (current.status === "CASE_CLOSED" || current.status === "HUMAN_REVIEW_REQUIRED") break;

    const pending = (await deps.repository.listCallEvents(eventId)).find(
      (call) => call.resultProcessedAt === null
    );
    if (!pending) break;

    if (pending.agentType === "companion") {
      await processCompanionResult(deps, current, pending.id);
    } else {
      await processFamilyResult(deps, current, pending.id);
    }
  }
  return w.open();
}

describe("crash recovery — the full injection matrix", () => {
  // Points that model a process being KILLED: the write in flight is lost and
  // the exception escapes, because none of them sits inside DEC-005's
  // "could not start the call" safety net.
  const killPoints: Array<{ method: Parameters<typeof crashingRepository>[1]["method"]; after: number }> = [
    { method: "commitTransitionWithCallIntent", after: 1 },
    { method: "commitTransitionWithCallIntent", after: 2 },
    { method: "attachCalleCallId", after: 0 },
    { method: "commitTransition", after: 0 },
    { method: "commitTransition", after: 1 },
    { method: "commitTransition", after: 2 },
    { method: "commitTransition", after: 3 },
    { method: "commitTransition", after: 4 },
    { method: "commitTransition", after: 5 },
    { method: "finalizeCallEventResult", after: 0 },
    { method: "finalizeCallEventResult", after: 1 },
  ];

  it.each(killPoints)(
    "converges on the same timeline after a crash at $method #$after",
    async ({ method, after }) => {
      const w = world();

      const crashed = w.open((r) => crashingRepository(r, { method, after }));
      await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

      const deps = await pollToCompletion(w, "event_001");

      expect((await deps.repository.getEvent("event_001"))!.status).toBe("CASE_CLOSED");
      expect(await timeline(deps, "event_001")).toEqual(EXPECTED_TIMELINE);
      // No duplicate outbound call, whichever point the crash happened at.
      // One companion call + two to Julie (the bounded retry) + one to Marc +
      // one informational callback to Marie. The count is what proves no crash
      // produced a DUPLICATE outbound call; DEC-011 raised it from 3 to 4 by
      // adding the per-contact retry, and DEC-023 to 5 by adding the callback.
      expect([...w.adapter.distinctCallIds]).toHaveLength(5);
      expect(w.adapter.contactsCalled()).not.toContain("contact_nicole");
      // DEC-023's central crash-safety property: however the worker died and
      // replayed, the person was called back exactly once — never twice, and
      // never not at all.
      expect(w.adapter.notificationMessages()).toHaveLength(1);
    }
  );

  // DEC-005 escalated a CALL-E refusal to human review, because nobody is being
  // rung and the event must not stall invisibly. DEC-011 keeps the "must not
  // stall" half and drops the human dependency: the refusal gets the same bounded
  // retry as a no-answer, then the cascade moves on, then the event ends visibly
  // unresolved. One bad number still cannot strand the vulnerable person.
  it("retries and continues past a CALL-E refusal, ending visibly unresolved", async () => {
    const w = world();
    const deps = w.open();
    // EVERY family call is refused outright, so the cascade runs out of people.
    deps.calleAdapter.startFamilyCall = async () => {
      throw new Error("network unreachable");
    };

    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    expect(event.status).not.toBe("HUMAN_REVIEW_REQUIRED");
    const messages = await timeline(deps, event.id);
    expect(messages).toContain("Could not start the call to Julie — network unreachable");
    expect(messages).toContain("No trusted contact confirmed they could help.");
    // Everyone was genuinely attempted rather than the cascade stopping at Julie.
    expect(
      (await deps.repository.listCallEvents(event.id)).some(
        (call) => call.contactId === "contact_nicole"
      )
    ).toBe(true);
  });

  // The mirror image: CALL-E ACCEPTED the call, and only the recording failed.
  // A live call is ringing, so this must NOT be escalated — the event has to
  // stay in a state its eventual result can still be applied from.
  it("does not escalate to human review when the call was placed but not recorded", async () => {
    const w = world();

    const crashed = w.open((r) => crashingRepository(r, { method: "attachCalleCallId", after: 1 }));
    await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

    const deps = w.open();
    const event = (await deps.repository.getEvent("event_001"))!;

    expect(event.status).not.toBe("HUMAN_REVIEW_REQUIRED");
    expect(event.status).toBe("CALLING_TRUSTED_CONTACT");

    // And the result is still recoverable, which escalation would have prevented.
    const finished = await pollToCompletion(w, event.id);
    expect((await finished.repository.getEvent(event.id))!.status).toBe("CASE_CLOSED");
    expect(await timeline(finished, event.id)).toEqual(EXPECTED_TIMELINE);
  });
});

describe("crash recovery — the earliest kill point", () => {
  it("persists nothing but the event row when the very first transition is lost", async () => {
    const w = world();

    const crashed = w.open((r) =>
      crashingRepository(r, { method: "commitTransitionWithCallIntent" })
    );
    await expect(startDemoEvent("person_marie", crashed)).rejects.toThrow(InjectedCrash);

    const deps = w.open();
    const event = (await deps.repository.getEvent("event_001"))!;

    // Nothing was promised: no intent, no timeline, no call. Not a stuck
    // cascade — the launch simply failed and can be retried, which is the
    // whole point of writing the transition and its intent together.
    expect(event.status).toBe("SCHEDULED");
    expect(await deps.repository.listCallEvents(event.id)).toHaveLength(0);
    expect(await deps.repository.listTimeline(event.id)).toHaveLength(0);
    expect(w.adapter.startCompanionCallSpy).toHaveBeenCalledTimes(0);
  });
});
