import { describe, expect, it, vi } from "vitest";
import type {
  CalleAdapter,
  CallReference,
  CallResult,
  CallStatus,
  CompanionCallInput,
  FamilyCallInput,
} from "@/lib/calle/adapter";
import { FakeCalleAdapter } from "@/lib/calle/fake-adapter";
import { InMemoryRepository } from "@/lib/database/in-memory-repository";
import { seedRepository } from "@/lib/database/seed";
import {
  ensureCompanionCallStarted,
  ensureFamilyCallStarted,
  processCompanionResult,
  startDemoEvent,
  type EngineDeps,
} from "@/lib/orchestration/engine";

// A scripted adapter for scenarios FakeCalleAdapter's canned Marie/Julie/Marc
// script can't produce (malformed results, universal declines/no-answers).
class ScriptedCalleAdapter implements CalleAdapter {
  startCompanionCallSpy = vi.fn();
  startFamilyCallSpy = vi.fn();
  nextCompanionResult: unknown = null;
  nextFamilyResult: unknown = null;
  nextCompanionStatus: CallStatus = "completed";
  nextFamilyStatus: CallStatus = "completed";
  nextCompanionFailure: { code: string | null; message: string | null } = {
    code: null,
    message: null,
  };
  private counter = 0;

  async startCompanionCall(input: CompanionCallInput): Promise<CallReference> {
    this.startCompanionCallSpy(input);
    this.counter += 1;
    return { callId: `scripted_companion_${this.counter}`, idempotencyKey: input.idempotencyKey };
  }

  async startFamilyCall(input: FamilyCallInput): Promise<CallReference> {
    this.startFamilyCallSpy(input);
    this.counter += 1;
    return { callId: `scripted_family_${this.counter}`, idempotencyKey: input.idempotencyKey };
  }

  async getCallResult(callId: string): Promise<CallResult> {
    if (callId.startsWith("scripted_companion_")) {
      return {
        callId,
        agentType: "companion",
        status: this.nextCompanionStatus,
        structuredResult: this.nextCompanionResult,
        failureCode: this.nextCompanionFailure.code,
        failureMessage: this.nextCompanionFailure.message,
      };
    }
    return {
      callId,
      agentType: "family",
      status: this.nextFamilyStatus,
      structuredResult: this.nextFamilyResult,
      failureCode: null,
      failureMessage: null,
    };
  }
}

const attentionCompanionResult = {
  conversation_summary: "Marie mentioned a fall.",
  fall_mentioned: "yes",
  mobility_difficulty: "yes",
  person_requests_help: "no",
  person_does_not_want_to_disturb_family: "yes",
  conversation_shorter_than_usual: "no",
  unusual_confusion: "no",
  recommended_attention_level: "high",
};

function createDeps(calleAdapter: CalleAdapter = new FakeCalleAdapter()): EngineDeps {
  const repository = new InMemoryRepository();
  seedRepository(repository);
  return { repository, calleAdapter };
}

describe("startDemoEvent — Marie / Julie / Marc end-to-end", () => {
  it("runs the full cascade and closes the case", async () => {
    const deps = createDeps();
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
    expect(event.closedAt).not.toBeNull();

    const messages = deps.repository.listTimeline(event.id).map((entry) => entry.message);
    expect(messages).toEqual([
      "Check-in call started",
      "Check-in call completed",
      "Fall and mobility difficulty detected",
      "Calling Julie",
      "No answer",
      "Calling Marc",
      "Marc answered",
      "Visit confirmed at 17:30",
      "Case closed",
    ]);

    const callEvents = deps.repository.listCallEvents(event.id);
    expect(callEvents).toHaveLength(3);
    expect(new Set(callEvents.map((call) => call.idempotencyKey))).toEqual(
      new Set([
        `${event.id}_companion_attempt_1`,
        `${event.id}_contact_julie_attempt_1`,
        `${event.id}_contact_marc_attempt_1`,
      ])
    );
  });
});

describe("startDemoEvent — orchestration rules", () => {
  it("closes the case when the companion result has no concerning signal", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = {
      conversation_summary: "Marie is doing well.",
      fall_mentioned: "no",
      mobility_difficulty: "no",
      person_requests_help: "no",
      person_does_not_want_to_disturb_family: "no",
      conversation_shorter_than_usual: "no",
      unusual_confusion: "no",
      recommended_attention_level: "low",
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
    expect(event.decision).toBe("LOG_AND_CLOSE");
  });

  it("requests human review when no contacts remain in the cascade", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.nextFamilyResult = {
      contact_id: "unused",
      answered: false,
      situation_understood: false,
      can_intervene: false,
      intervention_type: null,
      estimated_time: null,
      contact_next_person: true,
      summary: "No answer.",
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(3);
  });

  it("routes a malformed companion result to human review", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = { unexpected: "shape" };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    expect(adapter.startCompanionCallSpy).toHaveBeenCalledTimes(1);
  });

  it("routes a malformed family result to human review", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.nextFamilyResult = { unexpected: "shape" };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
  });
});

describe("idempotency", () => {
  it("does not start a second companion call for a duplicate retry with the same key", async () => {
    const adapter = new ScriptedCalleAdapter();
    const deps = createDeps(adapter);
    const event = deps.repository.createEvent("person_marie");
    const idempotencyKey = `${event.id}_companion_attempt_1`;

    const first = await ensureCompanionCallStarted(deps, event.id, "person_marie", idempotencyKey);
    const second = await ensureCompanionCallStarted(deps, event.id, "person_marie", idempotencyKey);

    expect(second.id).toBe(first.id);
    expect(adapter.startCompanionCallSpy).toHaveBeenCalledTimes(1);
  });

  it("does not start a second family call for a duplicate retry with the same key", async () => {
    const adapter = new ScriptedCalleAdapter();
    const deps = createDeps(adapter);
    const event = deps.repository.createEvent("person_marie");
    const julie = deps.repository.getTrustedContacts("person_marie")[0];
    const idempotencyKey = `${event.id}_${julie.id}_attempt_1`;

    const first = await ensureFamilyCallStarted(
      deps,
      event.id,
      "person_marie",
      julie,
      idempotencyKey
    );
    const second = await ensureFamilyCallStarted(
      deps,
      event.id,
      "person_marie",
      julie,
      idempotencyKey
    );

    expect(second.id).toBe(first.id);
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(1);
  });

  it("does not apply a duplicate transition when a companion result is processed twice", async () => {
    const deps = createDeps();
    const event = deps.repository.createEvent("person_marie");
    deps.repository.updateEvent(event.id, { status: "CALLING_PERSON" });
    deps.repository.updateEvent(event.id, { status: "CONVERSATION_IN_PROGRESS" });

    const idempotencyKey = `${event.id}_companion_attempt_1`;
    const callEvent = await ensureCompanionCallStarted(
      deps,
      event.id,
      "person_marie",
      idempotencyKey
    );

    const current = deps.repository.getEvent(event.id)!;
    const first = await processCompanionResult(deps, current, callEvent.id);
    const timelineAfterFirst = deps.repository.listTimeline(event.id);

    const second = await processCompanionResult(deps, first, callEvent.id);
    const timelineAfterSecond = deps.repository.listTimeline(event.id);

    expect(second.status).toBe(first.status);
    expect(second.decision).toBe(first.decision);
    expect(timelineAfterSecond).toEqual(timelineAfterFirst);
  });
});

describe("processCompanionResult — call lifecycle (live-mode async statuses)", () => {
  it("leaves the event unchanged while the call is still queued/in_progress", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionStatus = "in_progress";

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CONVERSATION_IN_PROGRESS");
    const callEvent = deps.repository.listCallEvents(event.id)[0];
    expect(callEvent.resultProcessedAt).toBeNull();
  });

  it("processes the result once it becomes available on a later call (webhook/poll arrives later)", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionStatus = "in_progress";

    const deps = createDeps(adapter);
    const pending = await startDemoEvent("person_marie", deps);
    expect(pending.status).toBe("CONVERSATION_IN_PROGRESS");

    adapter.nextCompanionStatus = "completed";
    adapter.nextCompanionResult = attentionCompanionResult;

    const callEvent = deps.repository.listCallEvents(pending.id)[0];
    const resumed = await processCompanionResult(deps, pending, callEvent.id);

    expect(resumed.status).toBe("ATTENTION_REQUIRED");
  });

  it("routes a failed call to human review with the failure reason surfaced", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionStatus = "failed";
    adapter.nextCompanionFailure = {
      code: "invalid_phone",
      message: "The recipient phone number was invalid.",
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    const messages = deps.repository.listTimeline(event.id).map((entry) => entry.message);
    expect(messages.some((message) => message.includes("The recipient phone number was invalid."))).toBe(
      true
    );
  });
});
