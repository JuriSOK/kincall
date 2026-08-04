import { describe, expect, it, vi } from "vitest";
import type { CalleAdapter, CallResult, FamilyCallInput } from "@/backend/integrations/calle/adapter";
import { getCalleAdapter } from "@/backend/integrations/calle/adapter";
import { listDemoScenarios } from "@/backend/integrations/calle/demo-scenarios";
import {
  FAKE_SCENARIOS,
  FakeCalleAdapter,
  isFakeScenarioId,
  type FakeScenarioId,
} from "@/backend/integrations/calle/fake-adapter";
import { readCompanionResult } from "@/backend/integrations/calle/schemas";
import {
  createInMemoryStore,
  InMemoryRepository,
  type InMemoryStore,
} from "@/backend/persistence/in-memory-repository";
import type { Repository } from "@/backend/persistence/repository";
import { seedRepository } from "@/backend/persistence/seed";
import { MAX_COMPANION_ATTEMPTS } from "@/backend/orchestration/decision-tree";
import {
  MAX_CONTACT_ATTEMPTS,
  processCompanionResult,
  processFamilyResult,
  selectCascadeTarget,
  startDemoEvent,
  type EngineDeps,
} from "@/backend/orchestration/engine";
import type { TrustedContact } from "@/shared/domain/types";
import { VOICEMAIL_MESSAGE } from "@/backend/agents/family/prompt";
import { RecordingCalleAdapter } from "../support/recording-adapter";

// DEC-011's autonomous behaviour, end to end: the bounded retries, the voicemail
// capability gate, and the restart points that only exist because attempts are
// now persisted. Everything runs in fake mode; not one real call is placed.

function deps(
  calleAdapter: CalleAdapter
): EngineDeps & { repository: InMemoryRepository } {
  const repository = new InMemoryRepository();
  seedRepository(repository);
  return { repository, calleAdapter };
}

// A shared store plus fresh repository objects, standing in for a restart: the
// data survives, every in-memory object does not.
function restartableWorld(adapter: CalleAdapter) {
  const store: InMemoryStore = createInMemoryStore();
  seedRepository(new InMemoryRepository({ store }));
  return {
    open(wrap: (r: Repository) => Repository = (r) => r): EngineDeps {
      return { repository: wrap(new InMemoryRepository({ store })), calleAdapter: adapter };
    },
  };
}

async function timeline(d: { repository: Repository }, eventId: string): Promise<string[]> {
  return (await d.repository.listTimeline(eventId)).map((entry) => entry.message);
}

// Serves a different result per (subject, attempt), which is what the bounded
// retries need: "Julie did not answer" and "Julie answered this time" are two
// results for the same contact.
class PerAttemptAdapter implements CalleAdapter {
  capabilities = { voicemail: true };
  readonly familyCalls: FamilyCallInput[] = [];
  private companionAttempts = 0;

  constructor(
    private readonly script: {
      companion: (attempt: number) => unknown;
      family: (contactId: string, attempt: number) => unknown;
    }
  ) {}

  async startCompanionCall(input: { idempotencyKey: string; attemptNumber: number }) {
    this.companionAttempts += 1;
    return {
      callId: `pa_companion_${input.attemptNumber}`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  // DEC-023. Always delivered — this file asserts cascade behaviour, which the
  // informational callback must leave untouched.
  async startPersonNotificationCall(input: { idempotencyKey: string }) {
    return { callId: "pa_notification", idempotencyKey: input.idempotencyKey };
  }

  async startFamilyCall(input: FamilyCallInput) {
    this.familyCalls.push(input);
    return {
      callId: `pa_family_${input.contact.id}_${input.attemptNumber}`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  get companionCallCount(): number {
    return this.companionAttempts;
  }

  async getCallResult(callId: string): Promise<CallResult> {
    const companion = /^pa_companion_(\d+)$/.exec(callId);
    if (companion) {
      return {
        callId,
        agentType: "companion",
        status: "completed",
        structuredResult: this.script.companion(Number(companion[1])),
        failureCode: null,
        failureMessage: null,
      };
    }
    if (callId === "pa_notification") {
      return {
        callId,
        agentType: "person_notification",
        status: "completed",
        structuredResult: {
          person_reached: "yes",
          message_delivered: "yes",
          summary: "Message passed on.",
        },
        failureCode: null,
        failureMessage: null,
      };
    }
    const family = /^pa_family_(.+)_(\d+)$/.exec(callId);
    if (!family) throw new Error(`PerAttemptAdapter: cannot parse "${callId}".`);
    return {
      callId,
      agentType: "family",
      status: "completed",
      structuredResult: this.script.family(family[1], Number(family[2])),
      failureCode: null,
      failureMessage: null,
    };
  }
}

function companion(overrides: Record<string, unknown> = {}) {
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
  };
}

const NOT_REACHED = companion({
  neutral_summary: "The call reached voicemail.",
  person_reached: "no",
  attention_required: "unknown",
  attention_reasons: ["person_not_reached"],
});

const FALL = companion({
  neutral_summary: "Marie said she fell.",
  fall_mentioned: "yes",
  attention_required: "yes",
  attention_reasons: ["fall"],
});

function family(contactId: string, overrides: Record<string, unknown> = {}) {
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

const CONFIRMS = (contactId: string) =>
  family(contactId, {
    answered: "yes",
    situation_understood: "yes",
    can_intervene: "yes",
    intervention_type: "visit",
    estimated_time: "18:00",
    contact_next_person: "no",
    summary: "Confirmed a visit.",
    voicemail_left: "no",
  });

describe("vulnerable-person retry (DEC-011)", () => {
  it("reaches the person on the retry and closes without contacting anyone else", async () => {
    const adapter = new PerAttemptAdapter({
      // Missed the first call, answered the second, and nothing was wrong.
      companion: (attempt) => (attempt === 1 ? NOT_REACHED : companion()),
      family: (contactId) => family(contactId),
    });

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    expect(adapter.companionCallCount).toBe(2);
    expect(event.status).toBe("CASE_CLOSED");
    expect(event.decision).toBe("LOG_AND_CLOSE");
    // The retry succeeded, so the trusted circle is never involved.
    expect(adapter.familyCalls).toHaveLength(0);

    const messages = await timeline(d, event.id);
    expect(messages).toContain("Marie was not reached (attempt 1)");
    expect(messages).toContain("Calling Marie again (attempt 2)");
    expect(messages).toContain("Case closed");
  });

  it("escalates on the retry's own signal, not on the first attempt's silence", async () => {
    const adapter = new PerAttemptAdapter({
      companion: (attempt) => (attempt === 1 ? NOT_REACHED : FALL),
      family: (contactId) => CONFIRMS(contactId),
    });

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    // The decision came from the SECOND attempt's result, so the family hears
    // about the fall rather than about an unanswered call.
    expect(adapter.familyCalls[0].informationToShare).toContain("mentioned a fall");
    expect(adapter.familyCalls[0].informationToShare).not.toContain(
      "could not be reached for their check-in"
    );
  });

  it("persists the attempt number rather than counting in memory", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => NOT_REACHED,
      family: (contactId) => CONFIRMS(contactId),
    });

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    const companionCalls = (await d.repository.listCallEvents(event.id)).filter(
      (call) => call.agentType === "companion"
    );
    expect(companionCalls.map((call) => call.attemptNumber)).toEqual([1, 2]);
    expect(companionCalls.map((call) => call.idempotencyKey)).toEqual([
      `${event.runId}_companion_attempt_1`,
      `${event.runId}_companion_attempt_2`,
    ]);
  });

  it("resumes at the correct attempt after a restart, without re-dialling attempt 1", async () => {
    const adapter = new PerAttemptAdapter({
      companion: (attempt) => (attempt === 1 ? NOT_REACHED : companion()),
      family: (contactId) => family(contactId),
    });
    const world = restartableWorld(adapter);

    // First process: the person did not answer, so the retry is placed and its
    // result is what remains unprocessed.
    const first = world.open();
    const event = await startDemoEvent("person_marie", first);
    expect(adapter.companionCallCount).toBe(2);

    // Everything in memory is discarded; only the store survives.
    const restarted = world.open();
    const reread = (await restarted.repository.getEvent(event.id))!;
    const calls = await restarted.repository.listCallEvents(reread.id);
    const secondAttempt = calls.find(
      (call) => call.agentType === "companion" && call.attemptNumber === 2
    )!;

    // Re-driving attempt 2's result changes nothing and places no new call: the
    // persisted attempt number is what makes the replay a no-op.
    const resumed = await processCompanionResult(restarted, reread, secondAttempt.id);
    expect(resumed.status).toBe("CASE_CLOSED");
    expect(adapter.companionCallCount).toBe(2);
  });
});

describe("trusted-contact retry (DEC-011)", () => {
  it("answers on the second attempt, closing without reaching the next contact", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => FALL,
      family: (contactId, attempt) =>
        contactId === "contact_julie" && attempt === 2
          ? CONFIRMS(contactId)
          : family(contactId),
    });

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    expect(event.status).toBe("CASE_CLOSED");
    // Julie twice, and Marc never — the retry found her.
    expect(adapter.familyCalls.map((call) => call.contact.id)).toEqual([
      "contact_julie",
      "contact_julie",
    ]);

    const messages = await timeline(d, event.id);
    expect(messages).toContain("Calling Julie again (attempt 2)");
    expect(messages).toContain("Julie confirmed they could help.");
  });

  it("moves to the next contact only after the retry is used up", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => FALL,
      family: (contactId) =>
        contactId === "contact_marc" ? CONFIRMS(contactId) : family(contactId),
    });

    const d = deps(adapter);
    await startDemoEvent("person_marie", d);

    expect(
      adapter.familyCalls.map((call) => `${call.contact.id}#${call.attemptNumber}`)
    ).toEqual(["contact_julie#1", "contact_julie#2", "contact_marc#1"]);
  });

  it("does NOT retry a contact who answered and declined", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => FALL,
      family: (contactId) =>
        contactId === "contact_julie"
          ? family(contactId, { answered: "yes", can_intervene: "no", summary: "Julie cannot." })
          : CONFIRMS(contactId),
    });

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    // A definitive no needs no second call: it would be useless and intrusive.
    expect(
      adapter.familyCalls.map((call) => `${call.contact.id}#${call.attemptNumber}`)
    ).toEqual(["contact_julie#1", "contact_marc#1"]);
    expect(event.status).toBe("CASE_CLOSED");
    expect(await timeline(d, event.id)).toContain("Julie declined");
  });

  it("never exceeds the per-contact bound, so the cascade cannot loop", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => FALL,
      family: (contactId) => family(contactId),
    });

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    // Three contacts, each attempted exactly MAX_CONTACT_ATTEMPTS times, then a
    // terminal state. No contact is ever dialled a third time.
    expect(adapter.familyCalls).toHaveLength(3 * MAX_CONTACT_ATTEMPTS);
    for (const contactId of ["contact_julie", "contact_marc", "contact_nicole"]) {
      const attempts = adapter.familyCalls
        .filter((call) => call.contact.id === contactId)
        .map((call) => call.attemptNumber);
      expect(attempts).toEqual([1, 2]);
    }
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
  });

  it("resumes mid-retry after a restart without duplicating a call", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => FALL,
      family: (contactId, attempt) =>
        contactId === "contact_julie" && attempt === 2
          ? CONFIRMS(contactId)
          : family(contactId),
    });
    const world = restartableWorld(adapter);

    const first = world.open();
    const event = await startDemoEvent("person_marie", first);
    const placedBefore = adapter.familyCalls.length;

    const restarted = world.open();
    const reread = (await restarted.repository.getEvent(event.id))!;
    const julieSecond = (await restarted.repository.listCallEvents(reread.id)).find(
      (call) => call.contactId === "contact_julie" && call.attemptNumber === 2
    )!;

    const resumed = await processFamilyResult(restarted, reread, julieSecond.id);
    expect(resumed.status).toBe("CASE_CLOSED");
    expect(adapter.familyCalls).toHaveLength(placedBefore);
  });
});

describe("voicemail (DEC-011)", () => {
  it("records a voicemail as left only on the final attempt, and only when supported", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => FALL,
      family: (contactId, attempt) =>
        contactId === "contact_julie"
          ? family(contactId, { voicemail_left: attempt >= 2 ? "yes" : "no" })
          : CONFIRMS(contactId),
    });

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);
    const messages = await timeline(d, event.id);

    // Attempt 1 does not even try: one more live attempt is still owed.
    expect(messages).toContain("No voicemail attempted — one more attempt is owed");
    expect(messages).toContain("Voicemail left");

    // The orchestrator, not the agent, decides when a voicemail is permitted.
    const julieCalls = adapter.familyCalls.filter((call) => call.contact.id === "contact_julie");
    expect(julieCalls[0].mayLeaveVoicemail).toBe(false);
    expect(julieCalls[1].mayLeaveVoicemail).toBe(true);
    expect(event.status).toBe("CASE_CLOSED");
  });

  it("records voicemail_unavailable and never claims a message when unsupported", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => FALL,
      family: (contactId, attempt) =>
        contactId === "contact_julie"
          ? // The agent CLAIMS it left one. KinCall must not believe it: this
            // integration cannot leave or confirm a voicemail at all.
            family(contactId, { voicemail_left: attempt >= 2 ? "yes" : "no" })
          : CONFIRMS(contactId),
    });
    adapter.capabilities = { voicemail: false };

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);
    const messages = await timeline(d, event.id);

    expect(messages).toContain("voicemail_unavailable — no message was left");
    expect(messages).not.toContain("Voicemail left");

    // The agent is never even asked to leave one.
    for (const call of adapter.familyCalls) {
      expect(call.mayLeaveVoicemail).toBe(false);
    }
    // And the cascade continues deterministically regardless.
    expect(event.status).toBe("CASE_CLOSED");
  });

  it("reports no voicemail when the agent did not leave one, even though it could have", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => FALL,
      family: (contactId) =>
        contactId === "contact_julie"
          ? family(contactId, { voicemail_left: "no" })
          : CONFIRMS(contactId),
    });

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    expect(await timeline(d, event.id)).toContain("No voicemail left");
    expect(event.status).toBe("CASE_CLOSED");
  });

  it("resumes correctly after a restart following the voicemail attempt", async () => {
    const adapter = new PerAttemptAdapter({
      companion: () => FALL,
      family: (contactId, attempt) =>
        contactId === "contact_julie"
          ? family(contactId, { voicemail_left: attempt >= 2 ? "yes" : "no" })
          : CONFIRMS(contactId),
    });
    const world = restartableWorld(adapter);

    const first = world.open();
    const event = await startDemoEvent("person_marie", first);
    const placedBefore = adapter.familyCalls.length;

    // Re-drive the voicemail attempt's own result from a fresh process: it must
    // continue to the next contact rather than redialling Julie a third time.
    const restarted = world.open();
    const reread = (await restarted.repository.getEvent(event.id))!;
    const julieSecond = (await restarted.repository.listCallEvents(reread.id)).find(
      (call) => call.contactId === "contact_julie" && call.attemptNumber === 2
    )!;

    const resumed = await processFamilyResult(restarted, reread, julieSecond.id);
    expect(resumed.status).toBe("CASE_CLOSED");
    expect(adapter.familyCalls).toHaveLength(placedBefore);
    expect(
      adapter.familyCalls.filter((call) => call.contact.id === "contact_julie")
    ).toHaveLength(MAX_CONTACT_ATTEMPTS);
  });

  it("keeps the voicemail message free of any incident, health or identity detail", () => {
    // §17.3: a recording can be heard by anyone in the household and kept
    // indefinitely, so it says strictly less than the live conversation does.
    expect(VOICEMAIL_MESSAGE).toContain("KinCall");
    expect(VOICEMAIL_MESSAGE).toContain("a loved one");
    for (const forbidden of [
      "Marie",
      "Julie",
      "Marc",
      "Nicole",
      "fall",
      "fell",
      "injur",
      "pain",
      "hospital",
      "emergency",
      "doctor",
      "urgent",
    ]) {
      expect(VOICEMAIL_MESSAGE.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("fake-mode demo scenarios (DEC-011)", () => {
  it("lists every scenario in fake mode", () => {
    vi.stubEnv("CALLE_MODE", "fake");
    const scenarios = listDemoScenarios();
    expect(scenarios?.map((scenario) => scenario.id).sort()).toEqual(
      Object.keys(FAKE_SCENARIOS).sort()
    );
    for (const scenario of scenarios ?? []) {
      expect(scenario.label.length).toBeGreaterThan(0);
      expect(scenario.description.length).toBeGreaterThan(0);
    }
    vi.unstubAllEnvs();
  });

  it("is hidden entirely outside fake mode", () => {
    // Undefined, not an empty list: the selector must not exist in live mode, so
    // a real call can never be steered from the interface.
    vi.stubEnv("CALLE_MODE", "live");
    expect(listDemoScenarios()).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it("never turns a live adapter into a scenario-driven fake", () => {
    vi.stubEnv("CALLE_MODE", "live");
    vi.stubEnv("CALLE_API_KEY", "test-key");
    // A scenario id is accepted by the signature but ignored: live mode always
    // builds the live adapter, which declares no voicemail support.
    const adapter = getCalleAdapter("all_contacts_unavailable");
    expect(adapter).not.toBeInstanceOf(FakeCalleAdapter);
    expect(adapter.capabilities.voicemail).toBe(false);
    vi.unstubAllEnvs();
  });

  it("rejects an unknown scenario id", () => {
    expect(isFakeScenarioId("marie_baseline")).toBe(true);
    expect(isFakeScenarioId("../../etc/passwd")).toBe(false);
    expect(isFakeScenarioId(undefined)).toBe(false);
    expect(isFakeScenarioId(42)).toBe(false);
  });

  it.each([
    ["marie_baseline", "CASE_CLOSED", "CONTACT_TRUSTED_PERSON"],
    ["explicit_help", "CASE_CLOSED", "CONTACT_TRUSTED_PERSON"],
    ["other_incident", "CASE_CLOSED", "CONTACT_TRUSTED_PERSON"],
    ["person_unreachable", "CASE_CLOSED", "CONTACT_TRUSTED_PERSON"],
    ["all_contacts_unavailable", "ATTENTION_UNRESOLVED", "CONTACT_TRUSTED_PERSON"],
  ] as const)("runs %s to its documented terminal state", async (scenario, status, decision) => {
    const d = deps(new RecordingCalleAdapter({ scenario: scenario as FakeScenarioId }));
    const event = await startDemoEvent("person_marie", d);

    expect(event.status).toBe(status);
    expect(event.decision).toBe(decision);
  });

  it("cascades on the explicit-help scenario, overriding the model's own attention_required: no", async () => {
    const d = deps(new RecordingCalleAdapter({ scenario: "explicit_help" }));
    const event = await startDemoEvent("person_marie", d);

    // The scenario's own attention_required is "no"; only the deterministic
    // explicit-help rule can produce a cascade here.
    expect(FAKE_SCENARIOS.explicit_help.companion(1).attention_required).toBe("no");
    // events.priority no longer exists at all (DEC-012); the decision itself
    // is the only outcome to assert.
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
  });

  it("retries the person twice in the unreachable scenario, then cascades", async () => {
    const adapter = new RecordingCalleAdapter({ scenario: "person_unreachable" });
    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    const companionCalls = (await d.repository.listCallEvents(event.id)).filter(
      (call) => call.agentType === "companion"
    );
    expect(companionCalls).toHaveLength(MAX_COMPANION_ATTEMPTS);
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    expect(adapter.contactsCalled().length).toBeGreaterThan(0);
  });

  it("exposes voicemail as unsupported in the all-contacts-unavailable scenario", async () => {
    const adapter = new RecordingCalleAdapter({ scenario: "all_contacts_unavailable" });
    expect(adapter.capabilities.voicemail).toBe(false);

    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    const messages = await timeline(d, event.id);
    expect(messages).toContain("voicemail_unavailable — no message was left");
    expect(messages).not.toContain("Voicemail left");
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
  });

  it("produces a schema-valid companion result for every scenario and attempt", async () => {
    for (const scenario of Object.values(FAKE_SCENARIOS)) {
      for (const attempt of [1, MAX_COMPANION_ATTEMPTS]) {
        // Strict validation: a demo scenario that would degrade to the malformed
        // path is a broken demo, not a test of the malformed path.
        expect(readCompanionResult(scenario.companion(attempt))).not.toBeNull();
      }
    }
  });
});

describe("no path reaches an emergency service (DEC-011)", () => {
  it("places calls only to the person and their configured trusted circle", async () => {
    const adapter = new RecordingCalleAdapter({ scenario: "all_contacts_unavailable" });
    const d = deps(adapter);
    const event = await startDemoEvent("person_marie", d);

    // The exhausted-cascade path is the one where an emergency escalation would
    // be most tempting. Every call placed is to a seeded, consented contact.
    const circle = new Set(
      (await d.repository.getTrustedContacts("person_marie")).map((contact) => contact.id)
    );
    for (const contactId of adapter.contactsCalled()) {
      expect(circle.has(contactId)).toBe(true);
    }
    expect(event.status).toBe("ATTENTION_UNRESOLVED");

    // And nothing in the timeline claims an emergency service was involved.
    const messages = (await timeline(d, event.id)).join(" ").toLowerCase();
    for (const forbidden of ["112", "samu", "pompier", "emergency service", "ambulance"]) {
      expect(messages).not.toContain(forbidden);
    }
  });
});

describe("selectCascadeTarget — who the cascade calls next (DEC-011)", () => {
  function contact(overrides: Partial<TrustedContact> = {}): TrustedContact {
    return {
      id: "contact_a",
      personId: "person_marie",
      firstName: "A",
      phone: "+33611111111",
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

  const julie = contact({ id: "contact_julie", firstName: "Julie", priority: 1 });
  const marc = contact({ id: "contact_marc", firstName: "Marc", priority: 2 });
  const nicole = contact({ id: "contact_nicole", firstName: "Nicole", priority: 3 });
  const circle = [julie, marc, nicole];

  it("starts at the first eligible contact when nobody has been tried", () => {
    const { target, skipped } = selectCascadeTarget(circle, null);
    expect(target?.contact.id).toBe("contact_julie");
    expect(target?.attemptNumber).toBe(1);
    expect(skipped).toHaveLength(0);
  });

  it("retries the same contact while an attempt is still owed", () => {
    const { target } = selectCascadeTarget(circle, {
      contactId: "contact_julie",
      attemptNumber: 1,
      retryable: true,
    });
    expect(target?.contact.id).toBe("contact_julie");
    expect(target?.attemptNumber).toBe(2);
  });

  it("moves on once the retry is used up", () => {
    const { target } = selectCascadeTarget(circle, {
      contactId: "contact_julie",
      attemptNumber: MAX_CONTACT_ATTEMPTS,
      retryable: true,
    });
    expect(target?.contact.id).toBe("contact_marc");
    expect(target?.attemptNumber).toBe(1);
  });

  it("moves on immediately for a non-retryable outcome, whatever the attempt number", () => {
    const { target } = selectCascadeTarget(circle, {
      contactId: "contact_julie",
      attemptNumber: 1,
      retryable: false,
    });
    expect(target?.contact.id).toBe("contact_marc");
  });

  it("skips ineligible contacts and reports each with a reason", () => {
    const withoutConsent = [
      { ...julie, consentStatus: "pending" as const },
      { ...marc, consentStatus: "declined" as const },
      nicole,
    ];
    const { target, skipped } = selectCascadeTarget(withoutConsent, null);

    expect(target?.contact.id).toBe("contact_nicole");
    expect(skipped.map((entry) => entry.contact.id)).toEqual([
      "contact_julie",
      "contact_marc",
    ]);
    for (const entry of skipped) {
      expect(entry.reason).toContain("§17.1");
    }
  });

  it("does not retry a contact who has become ineligible mid-cascade", () => {
    const revoked = [{ ...julie, consentStatus: "pending" as const }, marc, nicole];
    const { target } = selectCascadeTarget(revoked, {
      contactId: "contact_julie",
      attemptNumber: 1,
      retryable: true,
    });
    expect(target?.contact.id).toBe("contact_marc");
  });

  it("returns no target for an empty circle", () => {
    expect(selectCascadeTarget([], null).target).toBeNull();
  });

  it("returns no target once the circle is exhausted", () => {
    const { target } = selectCascadeTarget(circle, {
      contactId: "contact_nicole",
      attemptNumber: MAX_CONTACT_ATTEMPTS,
      retryable: true,
    });
    expect(target).toBeNull();
  });

  it("refuses to guess a successor when the previous contact was archived away", () => {
    // The previous contact is no longer in the active list, so there is no
    // defensible successor — guessing one could call somebody KinCall never
    // selected (CLAUDE.md).
    const { target } = selectCascadeTarget(circle, {
      contactId: "contact_removed",
      attemptNumber: 1,
      retryable: false,
    });
    expect(target).toBeNull();
  });
});
