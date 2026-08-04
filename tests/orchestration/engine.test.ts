import { describe, expect, it, vi } from "vitest";
import type {
  CalleAdapter,
  CallReference,
  CallResult,
  CallStatus,
  CompanionCallInput,
  FamilyCallInput,
  PersonNotificationCallInput,
} from "@/backend/integrations/calle/adapter";
import { FakeCalleAdapter } from "@/backend/integrations/calle/fake-adapter";
import { InMemoryRepository } from "@/backend/persistence/in-memory-repository";
import type { CompanionStructuredResult, FamilyStructuredResult } from "@/backend/integrations/calle/schemas";
import { seedRepository } from "@/backend/persistence/seed";
import {
  seedPendingCompanionCallIntent,
  seedPendingFamilyCallIntent,
} from "../support/seed-calls";
import { MAX_COMPANION_ATTEMPTS } from "@/backend/orchestration/decision-tree";
import {
  MAX_CONTACT_ATTEMPTS,
  placeCallForIntent,
  processCompanionResult,
  processFamilyResult,
  startDemoEvent,
  type EngineDeps,
} from "@/backend/orchestration/engine";

// A scripted adapter for scenarios FakeCalleAdapter's canned Marie/Julie/Marc
// script can't produce (malformed results, universal declines/no-answers).
class ScriptedCalleAdapter implements CalleAdapter {
  // Voicemail is treated as supported unless a test overrides it, so the
  // voicemail-unsupported fallback is exercised explicitly where it matters.
  capabilities = { voicemail: true };

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

  // DEC-023. The informational callback. Delivered by default; a test that
  // cares about a failed or unanswered callback overrides nextNotification.
  startPersonNotificationCallSpy = vi.fn();
  nextNotification: unknown = {
    person_reached: "yes",
    message_delivered: "yes",
    summary: "Message passed on.",
  };
  nextNotificationStatus: CallStatus = "completed";

  async startPersonNotificationCall(
    input: PersonNotificationCallInput
  ): Promise<CallReference> {
    this.startPersonNotificationCallSpy(input);
    this.counter += 1;
    return {
      callId: `scripted_notification_${this.counter}`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  async getCallResult(callId: string): Promise<CallResult> {
    if (callId.startsWith("scripted_notification_")) {
      return {
        callId,
        agentType: "person_notification",
        status: this.nextNotificationStatus,
        structuredResult: this.nextNotification,
        failureCode: null,
        failureMessage: null,
      };
    }
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

// A well-formed v2 result with nothing to report. Individual tests override just
// the one field they are about (DEC-011).
function companionResult(overrides: Partial<CompanionStructuredResult> = {}) {
  return {
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
    ...overrides,
  } satisfies CompanionStructuredResult;
}

const attentionCompanionResult = companionResult({
  neutral_summary: "Marie mentioned a fall.",
  fall_mentioned: "yes",
  mobility_difficulty: "yes",
  does_not_want_to_disturb_family: "yes",
  attention_required: "yes",
  attention_reasons: ["fall", "mobility_difficulty"],
});

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

function createDeps(
  calleAdapter: CalleAdapter = new FakeCalleAdapter()
): EngineDeps & { repository: InMemoryRepository } {
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

    // DEC-011 updated this timeline deliberately: Julie is now called TWICE
    // before Marc, because every contact gets one bounded retry, and the second
    // unanswered call leaves the fixed privacy-preserving voicemail. The
    // outcome is unchanged — Marc still confirms and the case still closes.
    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages).toEqual([
      "Check-in call started",
      "Check-in call completed",
      "The person mentioned a fall, difficulty moving around.",
      "Calling Julie",
      "No answer from Julie (attempt 1)",
      "No voicemail attempted — one more attempt is owed",
      "Calling Julie again (attempt 2)",
      "No answer from Julie (attempt 2)",
      // marie_baseline declares voicemail support, so the second unanswered
      // call leaves the fixed privacy-preserving message.
      "Voicemail left",
      "Calling Marc",
      "Marc confirmed they could help.",
      "Visit confirmed — 17:30",
      "KinCall called Marie to share Marc's commitment.",
      "The follow-up message was delivered.",
      "Case closed",
    ]);

    // DEC-023 adds a fifth call: the single informational callback to Marie,
    // placed after Marc confirms and BEFORE the case closes. The four cascade
    // calls, their order and their idempotency keys are unchanged.
    const callEvents = await deps.repository.listCallEvents(event.id);
    expect(callEvents).toHaveLength(5);
    expect(new Set(callEvents.map((call) => call.idempotencyKey))).toEqual(
      new Set([
        `${event.runId}_companion_attempt_1`,
        `${event.runId}_contact_julie_attempt_1`,
        `${event.runId}_contact_julie_attempt_2`,
        `${event.runId}_contact_marc_attempt_1`,
        `${event.runId}_person_notification`,
      ])
    );

    // Exactly one, never retried.
    expect(callEvents.filter((call) => call.agentType === "person_notification")).toHaveLength(1);
  });

  it("calls Julie twice before Marc, and Marc remains the accepting contact", async () => {
    const deps = createDeps();
    const event = await startDemoEvent("person_marie", deps);

    const familyCalls = (await deps.repository.listCallEvents(event.id)).filter(
      (call) => call.agentType === "family"
    );
    expect(
      familyCalls.map((call) => `${call.contactId}#${call.attemptNumber}`)
    ).toEqual(["contact_julie#1", "contact_julie#2", "contact_marc#1"]);

    expect(event.status).toBe("CASE_CLOSED");
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    // Nicole is never called: the cascade stops on the first confirmation.
    expect(familyCalls.some((call) => call.contactId === "contact_nicole")).toBe(false);
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

    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages).toContain("Visit confirmed — vers 18h00");
    expect(messages.some((message) => message.includes("at vers"))).toBe(false);
  });
});

describe("startDemoEvent — orchestration rules", () => {
  it("closes the case when the companion result has no concerning signal", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = companionResult({
      neutral_summary: "Marie is doing well.",
    });

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
    expect(event.decision).toBe("LOG_AND_CLOSE");
  });

  it("retries the person autonomously, then cascades, when the call reached voicemail", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = companionResult({
      neutral_summary: "The call reached voicemail rather than a live conversation.",
      person_reached: "no",
      attention_required: "unknown",
      attention_reasons: ["person_not_reached"],
    });

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // DEC-011: the retry is placed by KinCall itself, and after the second
    // unanswered attempt the trusted circle is contacted. The event never
    // waits for a human, and never closes as "nothing unusual".
    expect(adapter.startCompanionCallSpy).toHaveBeenCalledTimes(2);
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalled();

    const companionCalls = (await deps.repository.listCallEvents(event.id)).filter(
      (call) => call.agentType === "companion"
    );
    expect(companionCalls.map((call) => call.attemptNumber)).toEqual([1, 2]);

    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages).toContain("Marie was not reached (attempt 1)");
    expect(messages).toContain("Calling Marie again (attempt 2)");
    expect(messages).not.toContain("No attention signal detected");
  });

  it("never places a third check-in call, however many times the person does not answer", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = companionResult({
      person_reached: "no",
      attention_required: "unknown",
      attention_reasons: ["person_not_reached"],
    });

    const deps = createDeps(adapter);
    await startDemoEvent("person_marie", deps);

    // The bound, not a coincidence of the script: MAX_COMPANION_ATTEMPTS is what
    // stops KinCall redialling a vulnerable person forever.
    expect(adapter.startCompanionCallSpy).toHaveBeenCalledTimes(MAX_COMPANION_ATTEMPTS);
  });

  it("contacts the trusted circle — never human review — when reachability is unknown", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = companionResult({
      neutral_summary: "It was unclear who was on the line.",
      person_reached: "unknown",
    });

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // DEC-011: ambiguity reaches a person, not a waiting human.
    expect(event.status).not.toBe("HUMAN_REVIEW_REQUIRED");
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalled();
  });

  it("still escalates when reachability is unknown but concerning signals were reported", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = { ...attentionCompanionResult, person_reached: "unknown" };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    // The cascade was entered rather than the event being downgraded to a
    // reachability review — that is what unknown reachability must not do.
    expect(adapter.startFamilyCallSpy).toHaveBeenCalled();
    expect((await deps.repository.listTimeline(event.id)).map((entry) => entry.message)).toContain(
      "The person mentioned a fall, difficulty moving around."
    );
  });

  it("degrades a result missing person_reached to the attention cascade, not a closure", async () => {
    const adapter = new ScriptedCalleAdapter();
    const { person_reached, ...withoutPersonReached } = attentionCompanionResult;
    void person_reached;
    adapter.nextCompanionResult = withoutPersonReached;

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // DEC-011: an unvalidatable check-in is exactly when someone should look in
    // on the person, so it reaches the circle instead of a waiting human.
    expect(event.status).not.toBe("HUMAN_REVIEW_REQUIRED");
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalled();
  });

  it("ends at ATTENTION_UNRESOLVED when every contact is tried twice and nobody helps", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie"),
      contact_marc: familyResult("contact_marc"),
      contact_nicole: familyResult("contact_nicole"),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // Three contacts × the bounded retry, then a terminal, visible outcome that
    // waits for nobody (DEC-011).
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(3 * MAX_CONTACT_ATTEMPTS);
    expect(event.closedAt).toBeNull();

    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages).toContain("No trusted contact confirmed they could help.");
  });

  it("keeps ATTENTION_UNRESOLVED terminal — the whole attempt history is preserved", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie"),
      contact_marc: familyResult("contact_marc"),
      contact_nicole: familyResult("contact_nicole"),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);
    expect(event.status).toBe("ATTENTION_UNRESOLVED");

    const calls = await deps.repository.listCallEvents(event.id);
    expect(
      calls
        .filter((call) => call.agentType === "family")
        .map((call) => `${call.contactId}#${call.attemptNumber}`)
    ).toEqual([
      "contact_julie#1",
      "contact_julie#2",
      "contact_marc#1",
      "contact_marc#2",
      "contact_nicole#1",
      "contact_nicole#2",
    ]);

    // Re-driving the last result changes nothing: the event is finished.
    const last = calls[calls.length - 1];
    const again = await processFamilyResult(deps, event, last.id);
    expect(again.status).toBe("ATTENTION_UNRESOLVED");
  });

  it("degrades a malformed companion result to the attention cascade", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = { unexpected: "shape" };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).not.toBe("HUMAN_REVIEW_REQUIRED");
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(adapter.startCompanionCallSpy).toHaveBeenCalledTimes(1);
    expect(adapter.startFamilyCallSpy).toHaveBeenCalled();

    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages).toContain(
      "Check-in result could not be validated — contacting the trusted circle"
    );
  });

  it("tells the Family Agent nothing it cannot substantiate when the check-in was unreadable", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = { unexpected: "shape" };
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", { answered: "yes", can_intervene: "yes" }),
    };

    const deps = createDeps(adapter);
    await startDemoEvent("person_marie", deps);

    const [callInput] = adapter.startFamilyCallSpy.mock.calls[0] as [FamilyCallInput];
    // No invented signal: only the honest fact that the check-in did not succeed.
    expect(callInput.informationToShare).toEqual(["could not be checked in on successfully"]);
  });

  it("treats a malformed family result as an unanswered call and continues the cascade", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.nextFamilyResult = { unexpected: "shape" };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // DEC-011: an unusable answer is not an answer, and not a reason to abandon
    // the vulnerable person. Every contact is still tried, twice.
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(3 * MAX_CONTACT_ATTEMPTS);
  });
});

// DEC-010: person_requests_help was collected, validated and normalized since
// DEC-002 but decideCompanionAction never read it, so an explicit request for
// help with no fall and no mobility difficulty fell through to LOG_AND_CLOSE.
// This is a decision-rule correction, not a new feature: CONTACT_TRUSTED_PERSON
// is the existing trusted-circle cascade, and no path here ever reaches an
// emergency service.
describe("startDemoEvent — explicit request for help (DEC-010)", () => {
  // No fall, no mobility difficulty, and the model reported no attention
  // required at all. Deliberately attention_required: "no" — proves the
  // explicit-help rule
  // overrides the model's own binary judgement, not merely agrees with it
  // (Regression test: explicit help must override an AI attention_required:
  // no — see docs/DECISION_LOG.md DEC-011, "Priority removed".)
  const helpOnlyCompanionResult = companionResult({
    neutral_summary: "Marie asked KinCall to have someone call her.",
    explicit_help_requested: "yes",
    attention_required: "no",
    attention_reasons: ["explicit_help_request"],
  });

  it("runs the full trusted-circle cascade and closes at high priority on a help-only signal", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = helpOnlyCompanionResult;
    // Same Julie-no-answer/Marc-confirms script as the Marie end-to-end test —
    // proves the ordinary cascade mechanics are completely unaffected by which
    // decision rule triggered ATTENTION_REQUIRED.
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie"),
      contact_marc: familyResult("contact_marc", {
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "17:30",
      }),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
    // events.priority does not exist any more (DEC-012); the decision is the
    // only outcome to assert, even though the explicit-help rule is what
    // triggered the cascade here.
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    // Julie twice (bounded retry), then Marc.
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(MAX_CONTACT_ATTEMPTS + 1);

    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages).toContain("Case closed");
  });

  it("tells the Family Agent explicitly that the person asked for help", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = helpOnlyCompanionResult;
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", {
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "09:00",
      }),
    };

    const deps = createDeps(adapter);
    await startDemoEvent("person_marie", deps);

    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(1);
    const [callInput] = adapter.startFamilyCallSpy.mock.calls[0] as [FamilyCallInput];
    expect(callInput.informationToShare).toContain("asked for help");
  });

  it("contacts the trusted circle for unusual confusion alone", async () => {
    // DEC-010 routed confusion to human review. DEC-011 supersedes that: with no
    // operational human-review path, an unusual-confusion signal reaches the
    // trusted circle like every other stated signal.
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = companionResult({
      neutral_summary: "Marie seemed more muddled than usual.",
      unusual_confusion: "yes",
      attention_required: "yes",
      attention_reasons: ["unusual_confusion"],
    });
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", { answered: "yes", can_intervene: "yes" }),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(event.status).not.toBe("HUMAN_REVIEW_REQUIRED");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalled();
    const [callInput] = adapter.startFamilyCallSpy.mock.calls[0] as [FamilyCallInput];
    expect(callInput.informationToShare).toContain("seemed more confused than usual");
  });

  it.each([
    ["pain or injury without a fall", { pain_or_injury_mentioned: "yes" } as const, "mentioned pain or an injury"],
    ["distress without a fall", { distress_expressed: "yes" } as const, "expressed distress"],
    ["an abnormal conversation ending", { conversation_ended_normally: "no" } as const, "ended the check-in call unexpectedly"],
    ["another unusual event", { other_attention_signal: "yes" } as const, "described another unusual situation"],
  ])("contacts the trusted circle for %s, and says so accurately", async (_label, overrides, fact) => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = companionResult({
      ...overrides,
      attention_required: "yes",
    });
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", { answered: "yes", can_intervene: "yes" }),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    const [callInput] = adapter.startFamilyCallSpy.mock.calls[0] as [FamilyCallInput];
    expect(callInput.informationToShare).toContain(fact);
  });

  it("does not auto-escalate to the trusted circle when the help-request signal is only 'unknown'", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = companionResult({
      ...helpOnlyCompanionResult,
      explicit_help_requested: "unknown",
      attention_required: "no",
      attention_reasons: [],
    });

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.decision).not.toBe("CONTACT_TRUSTED_PERSON");
    expect(event.status).toBe("CASE_CLOSED");
    expect(event.decision).toBe("LOG_AND_CLOSE");
    expect(adapter.startFamilyCallSpy).not.toHaveBeenCalled();
  });

  it("still enforces consent: a help-triggered cascade escalates on an unconsented contact exactly as any other cascade does", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = helpOnlyCompanionResult;

    const deps = createDeps(adapter);
    const julie = (await deps.repository.getTrustedContacts("person_marie"))[0];
    deps.repository.seedContact({ ...julie, consentStatus: "pending" });

    const event = await startDemoEvent("person_marie", deps);

    // DEC-007's consent rule is unchanged and still absolute: Julie is NEVER
    // dialled. What DEC-011 changed is what happens next — the cascade skips her
    // and calls the next eligible contact, instead of the whole event stopping,
    // so an unconsented first contact can no longer strand the vulnerable person.
    const called = adapter.startFamilyCallSpy.mock.calls.map(
      ([input]) => (input as FamilyCallInput).contact.id
    );
    expect(called).not.toContain("contact_julie");
    expect(called[0]).toBe("contact_marc");

    // The skip is recorded with its reason rather than passing silently.
    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(
      messages.some(
        (message) => message.includes("Skipped Julie") && message.includes("§17.1")
      )
    ).toBe(true);
  });

  it("ends at ATTENTION_UNRESOLVED — never a silent close — when nobody in the circle has consented", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = helpOnlyCompanionResult;

    const deps = createDeps(adapter);
    for (const contact of await deps.repository.getTrustedContacts("person_marie")) {
      deps.repository.seedContact({ ...contact, consentStatus: "pending" });
    }

    const event = await startDemoEvent("person_marie", deps);

    // Not one call is placed, and the event does not close as though nothing
    // were wrong: it ends visibly unresolved.
    expect(adapter.startFamilyCallSpy).not.toHaveBeenCalled();
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    expect(event.closedAt).toBeNull();
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
    expect(await deps.repository.listCallEvents(event.id)).toHaveLength(2);

    const familyCall = (await deps.repository.listCallEvents(event.id)).find(
      (call) => call.agentType === "family"
    );
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

    const julieCall = (await deps.repository.listCallEvents(pending.id)).find(
      (call) => call.agentType === "family"
    );
    const resumed = await processFamilyResult(deps, pending, julieCall!.id);

    expect(resumed.status).toBe("CASE_CLOSED");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(MAX_CONTACT_ATTEMPTS + 1);
    expect((await deps.repository.listTimeline(resumed.id)).map((entry) => entry.message)).toEqual([
      "Check-in call started",
      "Check-in call completed",
      "The person mentioned a fall, difficulty moving around.",
      "Calling Julie",
      "No answer from Julie (attempt 1)",
      "No voicemail attempted — one more attempt is owed",
      "Calling Julie again (attempt 2)",
      "No answer from Julie (attempt 2)",
      // This scripted result does not claim a voicemail, so KinCall does not
      // claim one either — a model self-report is the only evidence there is.
      "No voicemail left",
      "Calling Marc",
      "Marc confirmed they could help.",
      "Visit confirmed — 17:30",
      "KinCall called Marie to share Marc's commitment.",
      "The follow-up message was delivered.",
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
    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
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

    // DEC-011: a technical failure gets the same bounded retry as a no-answer,
    // so all three contacts are attempted twice, then the event ends visibly
    // unresolved — never a silent stop and never a wait for a human.
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(3 * MAX_CONTACT_ATTEMPTS);
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages).toContain("Could not reach Julie — Invalid recipient number.");
    expect(messages).toContain("No trusted contact confirmed they could help.");
  });

  it("disregards a result naming the wrong contact, and continues the cascade without acting on it", async () => {
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

    // The confirmation the model claimed for Marc is NEVER acted on: the case
    // does not close, because KinCall called Julie and cannot trust a result that
    // names somebody else (CLAUDE.md — a model must never select who is called).
    expect(event.status).not.toBe("CASE_CLOSED");
    expect(event.closedAt).toBeNull();
    // DEC-011: the cascade still continues past it rather than the event ending,
    // and this contact is NOT redialled on the strength of an untrustworthy result.
    const called = adapter.startFamilyCallSpy.mock.calls.map(
      ([input]) => (input as FamilyCallInput).contact.id
    );
    expect(called.filter((id) => id === "contact_julie")).toHaveLength(1);
    expect((await deps.repository.listTimeline(event.id)).map((entry) => entry.message)).toContain(
      "The result of the call to Julie identified a different contact — disregarded"
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
    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages).not.toContain("Human review required — malformed family result");
    expect(messages).toContain("Intervention confirmed");
  });

  it("shares only the signals the companion result actually established", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = companionResult({
      ...attentionCompanionResult,
      mobility_difficulty: "no",
      does_not_want_to_disturb_family: "no",
    });
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
  it("skips a contact whose live number is unconfigured, without calling CALL-E", async () => {
    vi.stubEnv("CALLE_MODE", "live");
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;

    // Seeded contacts keep their reserved-for-fiction defaults here, which is
    // exactly the "you forgot to set KINCALL_JULIE_PHONE" situation.
    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // Every contact has the same unconfigured-number problem here, so all three
    // are skipped and the event ends visibly unresolved rather than waiting for
    // a human (DEC-011).
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    expect(adapter.startFamilyCallSpy).not.toHaveBeenCalled();

    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    // No misleading "Calling Julie" for a call that never happened.
    expect(messages).not.toContain("Calling Julie");
    expect(messages.some((message) => message.includes("Skipped Julie"))).toBe(true);
    expect(messages.some((message) => message.includes("KINCALL_JULIE_PHONE"))).toBe(true);
    // The number itself is never written to the timeline (CLAUDE.md: mask phone
    // numbers in public output).
    expect(messages.some((message) => message.includes("+33639980002"))).toBe(false);

    vi.unstubAllEnvs();
  });

  it("calls the next eligible contact when only one live number is unconfigured", async () => {
    vi.stubEnv("CALLE_MODE", "live");
    vi.stubEnv("KINCALL_MARC_PHONE", "+33600000002");
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.familyResultsByContact = {
      contact_marc: familyResult("contact_marc", { answered: "yes", can_intervene: "yes" }),
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // Julie has no configured number and is skipped; Marc does and is called.
    const called = adapter.startFamilyCallSpy.mock.calls.map(
      ([input]) => (input as FamilyCallInput).contact.id
    );
    expect(called).toEqual(["contact_marc"]);
    expect(event.status).toBe("CASE_CLOSED");

    vi.unstubAllEnvs();
  });

  it("still runs the cascade in fake mode with reserved numbers", async () => {
    const deps = createDeps();
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
  });

  it("retries then continues the cascade when starting a call throws unexpectedly", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionResult = attentionCompanionResult;
    adapter.startFamilyCallSpy.mockImplementation(() => {
      throw new Error("network unreachable");
    });

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // DEC-011: the same bounded retry policy, then the next contact, then a
    // visible terminal outcome. One broken network path must not strand anyone.
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages).toContain("Could not start the call to Julie — network unreachable");
    expect(messages).toContain("No trusted contact confirmed they could help.");
  });
});

describe("idempotency", () => {
  it("derives different companion idempotency keys across two repository lifetimes even though their sequential event ids collide (DEC-004)", async () => {
    // Each InMemoryRepository stands in for one process lifetime: its
    // eventSequence always restarts at 0, so both produce "event_001". If the
    // idempotency key were still derived from that id, both "restarts" would
    // reuse the exact same CALL-E idempotency key for a different request —
    // the observed `idempotency_conflict` bug.
    const before = new InMemoryRepository();
    const beforeEvent = await before.createEvent("person_marie");

    const after = new InMemoryRepository();
    const afterEvent = await after.createEvent("person_marie");

    expect(beforeEvent.id).toBe(afterEvent.id);
    expect(beforeEvent.runId).not.toBe(afterEvent.runId);

    const keyBefore = `${beforeEvent.runId}_companion_attempt_1`;
    const keyAfter = `${afterEvent.runId}_companion_attempt_1`;
    expect(keyBefore).not.toBe(keyAfter);
  });

  it("does not start a second companion call when the intent is driven twice", async () => {
    const adapter = new ScriptedCalleAdapter();
    const deps = createDeps(adapter);
    const { callEvent } = await seedPendingCompanionCallIntent(deps);

    // placeCallForIntent is the only path to the adapter, and it returns
    // immediately once the call id is attached.
    const first = await placeCallForIntent(deps, callEvent);
    const second = await placeCallForIntent(deps, first);

    expect(second.id).toBe(first.id);
    expect(second.calleCallId).toBe(first.calleCallId);
    expect(adapter.startCompanionCallSpy).toHaveBeenCalledTimes(1);
  });

  it("does not start a second family call when the intent is driven twice", async () => {
    const adapter = new ScriptedCalleAdapter();
    const deps = createDeps(adapter);
    const julie = (await deps.repository.getTrustedContacts("person_marie"))[0];
    const { callEvent } = await seedPendingFamilyCallIntent(deps, julie.id);

    const first = await placeCallForIntent(deps, callEvent);
    const second = await placeCallForIntent(deps, first);

    expect(second.id).toBe(first.id);
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(1);
  });

  it("does not apply a duplicate transition when a companion result is processed twice", async () => {
    const deps = createDeps();
    const { event, callEvent: intent } = await seedPendingCompanionCallIntent(deps);

    const callEvent = await placeCallForIntent(deps, intent);

    const current = (await deps.repository.getEvent(event.id))!;
    const first = await processCompanionResult(deps, current, callEvent.id);
    const timelineAfterFirst = await deps.repository.listTimeline(event.id);

    const second = await processCompanionResult(deps, first, callEvent.id);
    const timelineAfterSecond = await deps.repository.listTimeline(event.id);

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
    const callEvent = (await deps.repository.listCallEvents(event.id))[0];
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

    const callEvent = (await deps.repository.listCallEvents(pending.id))[0];
    const resumed = await processCompanionResult(deps, pending, callEvent.id);

    // A concerning companion result immediately starts the first family call.
    expect(resumed.status).toBe("CALLING_TRUSTED_CONTACT");
    expect(adapter.startFamilyCallSpy).toHaveBeenCalledTimes(1);
    expect((await deps.repository.listTimeline(pending.id)).map((entry) => entry.message)).toContain(
      "The person mentioned a fall, difficulty moving around."
    );
  });

  it("cascades — never stalls — when the check-in call is canceled", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionStatus = "canceled";

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    // DEC-011: a check-in that failed technically is not evidence anyone is
    // fine, so it reaches the trusted circle rather than a waiting human.
    expect(event.status).not.toBe("HUMAN_REVIEW_REQUIRED");
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    const callEvent = (await deps.repository.listCallEvents(event.id))[0];
    expect(callEvent.resultProcessedAt).not.toBeNull();
    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages.some((message) => message.includes("call canceled"))).toBe(true);
  });

  it("cascades with the failure reason surfaced when the check-in call fails", async () => {
    const adapter = new ScriptedCalleAdapter();
    adapter.nextCompanionStatus = "failed";
    adapter.nextCompanionFailure = {
      code: "invalid_phone",
      message: "The recipient phone number was invalid.",
    };

    const deps = createDeps(adapter);
    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).not.toBe("HUMAN_REVIEW_REQUIRED");
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    expect(messages.some((message) => message.includes("The recipient phone number was invalid."))).toBe(
      true
    );
  });
});
