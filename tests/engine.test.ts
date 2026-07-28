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
import type { FamilyStructuredResult } from "@/lib/calle/schemas";
import { seedRepository } from "@/lib/database/seed";
import {
  ensureCompanionCallStarted,
  ensureFamilyCallStarted,
  processCompanionResult,
  processFamilyResult,
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
  nextFamilyFailure: { code: string | null; message: string | null } = {
    code: null,
    message: null,
  };
  // Per-contact overrides, keyed by contact id; falls back to nextFamilyResult.
  familyResultsByContact: Record<string, unknown> = {};
  private counter = 0;

  async startCompanionCall(input: CompanionCallInput): Promise<CallReference> {
    this.startCompanionCallSpy(input);
    this.counter += 1;
    return { callId: `scripted_companion_${this.counter}`, idempotencyKey: input.idempotencyKey };
  }

  async startFamilyCall(input: FamilyCallInput): Promise<CallReference> {
    this.startFamilyCallSpy(input);
    this.counter += 1;
    // Contact id is encoded in the callId so getCallResult can serve a
    // per-contact scripted result, the way a real cascade differs per person.
    return {
      callId: `scripted_family_${input.contact.id}_${this.counter}`,
      idempotencyKey: input.idempotencyKey,
    };
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
    const contactId = Object.keys(this.familyResultsByContact).find((id) =>
      callId.startsWith(`scripted_family_${id}_`)
    );
    return {
      callId,
      agentType: "family",
      status: this.nextFamilyStatus,
      structuredResult: contactId
        ? this.familyResultsByContact[contactId]
        : this.nextFamilyResult,
      failureCode: this.nextFamilyFailure.code,
      failureMessage: this.nextFamilyFailure.message,
    };
  }
}

const attentionCompanionResult = {
  conversation_summary: "Marie mentioned a fall.",
  person_reached: "yes",
  fall_mentioned: "yes",
  mobility_difficulty: "yes",
  person_requests_help: "no",
  person_does_not_want_to_disturb_family: "yes",
  conversation_shorter_than_usual: "no",
  unusual_confusion: "no",
  recommended_attention_level: "high",
};

function familyResult(
  contactId: string,
  overrides: Partial<FamilyStructuredResult> = {}
): FamilyStructuredResult {
  return {
    contact_id: contactId,
    answered: "no",
    situation_understood: "unknown",
    can_intervene: "no",
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: "No answer.",
    ...overrides,
  };
}

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
      "Visit confirmed — 17:30",
      "Case closed",
    ]);

    const callEvents = deps.repository.listCallEvents(event.id);
    expect(callEvents).toHaveLength(3);
    expect(new Set(callEvents.map((call) => call.idempotencyKey))).toEqual(
      new Set([
        `${event.runId}_companion_attempt_1`,
        `${event.runId}_contact_julie_attempt_1`,
        `${event.runId}_contact_marc_attempt_1`,
      ])
    );
  });
});

describe("confirmed-visit timeline wording", () => {
  it("uses neutral punctuation instead of 'at', which can collide with a preposition already in the free text", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", {
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        // Free text is never parsed or translated — "at vers 18h00" would
        // read wrong if the code still hardcoded the word "at".
        estimated_time: "vers 18h00",
      }),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    const messages = deps.repository.listTimeline(event.id).map((entry) => entry.message);
    expect(messages).toContain("Visit confirmed — vers 18h00");
    expect(messages.some((message) => message.includes("at vers"))).toBe(false);
  });
});

describe("startDemoEvent — orchestration rules", () => {
  it("closes the case when the companion result has no concerning signal", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = {
      conversation_summary: "Marie is doing well.",
      person_reached: "yes",
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

  it("does not close the case when the call reached voicemail instead of the person", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = {
      conversation_summary: "The call reached voicemail rather than a live conversation.",
      person_reached: "no",
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

    expect(event.status).toBe("PERSON_DID_NOT_ANSWER");
    expect(event.decision).toBe("RETRY_CHECK_IN");
    expect(event.closedAt).toBeNull();
    expect(adapter.startFamilyCallSpy).not.toHaveBeenCalled();

    const messages = deps.repository.listTimeline(event.id).map((entry) => entry.message);
    expect(messages).toEqual([
      "Check-in call started",
      "Check-in call completed",
      "Marie was not reached — no check-in conversation took place",
    ]);
    expect(messages).not.toContain("No concerning signal detected");
    expect(messages).not.toContain("Case closed");
  });

  it("requests human review when reachability is unknown and no signal was detected", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = {
      conversation_summary: "It was unclear who was on the line.",
      person_reached: "unknown",
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

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    expect(event.decision).toBe("REQUEST_HUMAN_REVIEW");
    expect(event.closedAt).toBeNull();
  });

  it("still escalates when reachability is unknown but concerning signals were reported", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = { ...attentionCompanionResult, person_reached: "unknown" };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(event.priority).toBe("high");
    // The cascade was entered rather than the event being downgraded to a
    // reachability review — that is what unknown reachability must not do.
    expect(adapter.startFamilyCallSpy).toHaveBeenCalled();
    expect(deps.repository.listTimeline(event.id).map((entry) => entry.message)).toContain(
      "Fall and mobility difficulty detected"
    );
  });

  it("routes a result missing person_reached to human review", async () => {
    const adapter = new ScriptedCalleAdapter();
    const { person_reached, ...withoutPersonReached } = attentionCompanionResult;
    void person_reached;
    adapter.nextCompanionResult = withoutPersonReached;

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
  });

  it("requests human review when no contacts remain in the cascade", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie"),
      contact_marc: familyResult("contact_marc"),
      contact_nicole: familyResult("contact_nicole"),
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

describe("family cascade — live-shaped async behaviour", () => {
  it("stops after starting contact #1 while the call is still queued", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.nextFamilyStatus = "queued";

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CALLING_TRUSTED_CONTACT");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(1);
    expect(deps.repository.listCallEvents(event.id)).toHaveLength(2);

    const familyCall = deps.repository
      .listCallEvents(event.id)
      .find((call) => call.agentType === "family");
    expect(familyCall?.resultProcessedAt).toBeNull();
  });

  it("resumes and calls contact #2 when contact #1's result arrives later", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.nextFamilyStatus = "queued";

    const deps = createDeps(adapter);
    const pending = await startDemoEvent("person_marie", deps);
    expect(pending.status).toBe("CALLING_TRUSTED_CONTACT");

    // The webhook arrives: Julie did not answer, Marc confirms.
    adapter.nextFamilyStatus = "completed";
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie"),
      contact_marc: familyResult("contact_marc", {
        answered: "yes",
        situation_understood: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "17:30",
        contact_next_person: "no",
        summary: "Marc will visit.",
      }),
    };

    const julieCall = deps.repository
      .listCallEvents(pending.id)
      .find((call) => call.agentType === "family");
    const resumed = await processFamilyResult(deps, pending, julieCall!.id);

    expect(resumed.status).toBe("CASE_CLOSED");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(2);
    expect(deps.repository.listTimeline(resumed.id).map((entry) => entry.message)).toEqual([
      "Check-in call started",
      "Check-in call completed",
      "Fall and mobility difficulty detected",
      "Calling Julie",
      "No answer",
      "Calling Marc",
      "Marc answered",
      "Visit confirmed — 17:30",
      "Case closed",
    ]);
  });

  it("stops immediately after a confirmation and never calls the third contact", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", {
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "18:00",
      }),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(1);
    const called = adapter.startFamilyCallSpy.mock.calls.map(
      ([input]) => (input as FamilyCallInput).contact.id
    );
    expect(called).toEqual(["contact_julie"]);
  });

  it("does not treat a non-committal answer as a confirmation", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", {
        answered: "yes",
        can_intervene: "unknown",
        summary: "Julie said she would see.",
      }),
      contact_marc: familyResult("contact_marc", {
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "17:30",
      }),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // Julie is recorded as declined, not confirmed, and Marc is still called.
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(2);
    expect(event.status).toBe("CASE_CLOSED");
    const messages = deps.repository.listTimeline(event.id).map((entry) => entry.message);
    expect(messages).toContain("Julie declined");
    expect(messages).toContain("Calling Marc");
  });

  it("continues the cascade when a family call fails outright", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.nextFamilyStatus = "failed";
    adapter.nextFamilyFailure = { code: "invalid_phone", message: "Invalid recipient number." };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // All three contacts attempted, then human review — never a silent stop.
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(3);
    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    const messages = deps.repository.listTimeline(event.id).map((entry) => entry.message);
    expect(messages).toContain("Could not reach Julie — Invalid recipient number.");
    expect(messages).toContain("Human review required — no contacts remaining");
  });

  it("routes a result naming the wrong contact to human review without calling anyone else", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.familyResultsByContact = {
      // The model claims this is Marc's result, but KinCall called Julie.
      contact_julie: familyResult("contact_marc", {
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "17:30",
      }),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    expect(event.closedAt).toBeNull();
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(1);
    expect(deps.repository.listTimeline(event.id).map((entry) => entry.message)).toContain(
      "Human review required — family result identified the wrong contact"
    );
  });

  it("treats a no-answer's sentinel values as a valid result, not a malformed one", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.familyResultsByContact = {
      // intervention_type "other" + estimated_time "" — the DEC-005 sentinels.
      contact_julie: familyResult("contact_julie"),
      contact_marc: familyResult("contact_marc", {
        answered: "yes",
        can_intervene: "yes",
        // Confirmed but no time given: falls back to the generic wording.
        intervention_type: "other",
        estimated_time: "",
      }),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
    const messages = deps.repository.listTimeline(event.id).map((entry) => entry.message);
    expect(messages).not.toContain("Human review required — malformed family result");
    expect(messages).toContain("Intervention confirmed");
  });

  it("shares only the signals the companion result actually established", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = {
      ...attentionCompanionResult,
      mobility_difficulty: "no",
      person_does_not_want_to_disturb_family: "no",
    };
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", { answered: "yes", can_intervene: "yes" }),
    };

    const deps = createDeps(adapter);
    await startDemoEvent("person_marie", deps);

    const [input] = adapter.startFamilyCallSpy.mock.calls[0] as [FamilyCallInput];
    expect(input.informationToShare).toEqual(["mentioned a fall"]);
    expect(input.informationToShare).not.toContain("described difficulty moving around");
  });
});

describe("family cascade — unusable contact phone numbers", () => {
  it("routes to human review without calling CALL-E when a live number is unconfigured", async () => {
    vi.stubEnv("CALLE_MODE", "live");
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;

    // Seeded contacts keep their reserved-for-fiction defaults here, which is
    // exactly the "you forgot to set KINCALL_JULIE_PHONE" situation.
    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    expect(adapter.startFamilyCallSpy).not.toHaveBeenCalled();

    const messages = deps.repository.listTimeline(event.id).map((entry) => entry.message);
    // No misleading "Calling Julie" for a call that never happened.
    expect(messages).not.toContain("Calling Julie");
    expect(messages.some((message) => message.includes("KINCALL_JULIE_PHONE"))).toBe(true);
    expect(messages.some((message) => message.includes("+33639980002"))).toBe(false);

    vi.unstubAllEnvs();
  });

  it("still runs the cascade in fake mode with reserved numbers", async () => {
    const deps = createDeps();
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
  });

  it("routes to human review when starting the call throws unexpectedly", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.startFamilyCallSpy.mockImplementation(() => {
      throw new Error("network unreachable");
    });

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    expect(deps.repository.listTimeline(event.id).map((entry) => entry.message)).toContain(
      "Human review required — could not start the call to Julie (network unreachable)"
    );
  });
});

describe("idempotency", () => {
  it("derives different companion idempotency keys across two repository lifetimes even though their sequential event ids collide (DEC-004)", () => {
    // Each InMemoryRepository stands in for one process lifetime: its
    // eventSequence always restarts at 0, so both produce "event_001". If the
    // idempotency key were still derived from that id, both "restarts" would
    // reuse the exact same CALL-E idempotency key for a different request —
    // the observed `idempotency_conflict` bug.
    const before = new InMemoryRepository();
    const beforeEvent = before.createEvent("person_marie");

    const after = new InMemoryRepository();
    const afterEvent = after.createEvent("person_marie");

    expect(beforeEvent.id).toBe(afterEvent.id);
    expect(beforeEvent.runId).not.toBe(afterEvent.runId);

    const keyBefore = `${beforeEvent.runId}_companion_attempt_1`;
    const keyAfter = `${afterEvent.runId}_companion_attempt_1`;
    expect(keyBefore).not.toBe(keyAfter);
  });

  it("does not start a second companion call for a duplicate retry with the same key", async () => {
    const adapter = new ScriptedCalleAdapter();
    const deps = createDeps(adapter);
    const event = deps.repository.createEvent("person_marie");
    const idempotencyKey = `${event.runId}_companion_attempt_1`;

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
    const idempotencyKey = `${event.runId}_${julie.id}_attempt_1`;

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

    const idempotencyKey = `${event.runId}_companion_attempt_1`;
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
    // The family calls stay queued, so the cascade starts but does not finish.
    adapter.nextFamilyStatus = "queued";

    const callEvent = deps.repository.listCallEvents(pending.id)[0];
    const resumed = await processCompanionResult(deps, pending, callEvent.id);

    // A concerning companion result immediately starts the first family call.
    expect(resumed.status).toBe("CALLING_TRUSTED_CONTACT");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(1);
    expect(deps.repository.listTimeline(pending.id).map((entry) => entry.message)).toContain(
      "Fall and mobility difficulty detected"
    );
  });

  it("routes a canceled call to human review", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionStatus = "canceled";

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("HUMAN_REVIEW_REQUIRED");
    const callEvent = deps.repository.listCallEvents(event.id)[0];
    expect(callEvent.resultProcessedAt).not.toBeNull();
    const messages = deps.repository.listTimeline(event.id).map((entry) => entry.message);
    expect(messages.some((message) => message.includes("call canceled"))).toBe(true);
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
