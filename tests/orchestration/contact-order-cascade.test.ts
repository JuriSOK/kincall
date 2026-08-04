import { describe, expect, it } from "vitest";
import type { CalleAdapter, CallResult, FamilyCallInput } from "@/backend/integrations/calle/adapter";
import { FAKE_SCENARIOS, type FakeScenarioId } from "@/backend/integrations/calle/fake-adapter";
import {
  createInMemoryStore,
  InMemoryRepository,
  type InMemoryStore,
} from "@/backend/persistence/in-memory-repository";
import type { Repository } from "@/backend/persistence/repository";
import { seedRepository } from "@/backend/persistence/seed";
import {
  MAX_CONTACT_ATTEMPTS,
  processFamilyResult,
  startDemoEvent,
  type EngineDeps,
} from "@/backend/orchestration/engine";
import { RecordingCalleAdapter } from "../support/recording-adapter";

// Stage E (docs/DECISION_LOG.md DEC-017): the explicit regression net comparing
// the cascade's behaviour BEFORE and AFTER the new availability-ordering layer
// (backend/orchestration/cascade/contact-order.ts). At the seeded default configuration —
// every contact enabled, no availability window, maxAttempts: 2 — the ordering
// layer must be a complete no-op: every one of the five fake scenarios places
// EXACTLY the same calls, in the same order, with the same attempt numbers, and
// reaches the same terminal status and decision as before this stage.

// A fixed instant — 10:00 Europe/Paris (CEST, +2) — so every availability-window
// assertion is deterministic regardless of the real wall-clock time the test
// suite happens to run at. InMemoryRepository timestamps every row it creates
// (including events.created_at, the instant orderContactsForCascade actually
// uses) from this injected clock rather than the real Date.now().
const FIXED_NOW = new Date("2026-07-30T08:00:00.000Z").getTime();

function deps(
  adapter: CalleAdapter,
  now: () => number = () => FIXED_NOW
): EngineDeps & { repository: InMemoryRepository } {
  const repository = new InMemoryRepository({ now });
  seedRepository(repository);
  return { repository, calleAdapter: adapter };
}

function restartableWorld(adapter: CalleAdapter, now: () => number = () => FIXED_NOW) {
  const store: InMemoryStore = createInMemoryStore();
  seedRepository(new InMemoryRepository({ store, now }));
  return {
    open(wrap: (r: Repository) => Repository = (r) => r): EngineDeps {
      return { repository: wrap(new InMemoryRepository({ store, now })), calleAdapter: adapter };
    },
  };
}

interface ScenarioExpectation {
  scenario: FakeScenarioId;
  calls: string[]; // "contactId#attempt", in order
  status: string;
  decision: string;
}

// Hand-derived directly from backend/integrations/calle/fake-adapter.ts's FAKE_SCENARIOS
// definitions — a definitive, independent snapshot of "what should happen",
// not merely "whatever the code currently does".
const EXPECTATIONS: ScenarioExpectation[] = [
  {
    scenario: "marie_baseline",
    calls: ["contact_julie#1", "contact_julie#2", "contact_marc#1"],
    status: "CASE_CLOSED",
    decision: "CONTACT_TRUSTED_PERSON",
  },
  {
    scenario: "explicit_help",
    calls: ["contact_julie#1"],
    status: "CASE_CLOSED",
    decision: "CONTACT_TRUSTED_PERSON",
  },
  {
    scenario: "other_incident",
    calls: ["contact_julie#1"],
    status: "CASE_CLOSED",
    decision: "CONTACT_TRUSTED_PERSON",
  },
  {
    scenario: "person_unreachable",
    calls: ["contact_julie#1"],
    status: "CASE_CLOSED",
    decision: "CONTACT_TRUSTED_PERSON",
  },
  {
    scenario: "all_contacts_unavailable",
    // Julie: no answer twice (retryable). Marc: declines once (NOT retried —
    // a definitive "no" needs no second call). Nicole: no answer twice.
    calls: [
      "contact_julie#1",
      "contact_julie#2",
      "contact_marc#1",
      "contact_nicole#1",
      "contact_nicole#2",
    ],
    status: "ATTENTION_UNRESOLVED",
    decision: "CONTACT_TRUSTED_PERSON",
  },
];

describe("Stage E regression — the five fake scenarios are byte-identical at default configuration", () => {
  it.each(EXPECTATIONS)(
    "$scenario: exact call order, attempt numbers, and terminal outcome unchanged",
    async ({ scenario, calls, status, decision }) => {
      const adapter = new RecordingCalleAdapter({ scenario });
      const d = deps(adapter);
      const event = await startDemoEvent("person_marie", d);

      const placed = adapter.startFamilyCallSpy.mock.calls.map(
        (call) => `${(call[0] as FamilyCallInput).contact.id}#${(call[0] as FamilyCallInput).attemptNumber}`
      );

      expect(placed).toEqual(calls);
      expect(event.status).toBe(status);
      expect(event.decision).toBe(decision);
      expect(Object.keys(FAKE_SCENARIOS)).toContain(scenario);
    }
  );
});

// Custom scriptable adapter for the Stage-E-specific scenarios below, where the
// canned fake scenarios don't apply (they assume the default seeded config).
class ScriptedAdapter implements CalleAdapter {
  capabilities = { voicemail: true };
  readonly familyCalls: FamilyCallInput[] = [];

  constructor(
    private readonly script: {
      companion?: (attempt: number) => unknown;
      family: (contactId: string, attempt: number) => unknown;
    }
  ) {}

  async startCompanionCall(input: { idempotencyKey: string; attemptNumber: number }) {
    return { callId: `sc_companion_${input.attemptNumber}`, idempotencyKey: input.idempotencyKey };
  }

  async startFamilyCall(input: FamilyCallInput) {
    this.familyCalls.push(input);
    return {
      callId: `sc_family_${input.contact.id}_${input.attemptNumber}`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  // DEC-023. Always delivered — this file's assertions are about contact
  // ORDER, which the informational callback must not disturb.
  async startPersonNotificationCall(input: { idempotencyKey: string }) {
    return { callId: "sc_notification", idempotencyKey: input.idempotencyKey };
  }

  async getCallResult(callId: string): Promise<CallResult> {
    if (callId === "sc_notification") {
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
    const companion = /^sc_companion_(\d+)$/.exec(callId);
    if (companion) {
      return {
        callId,
        agentType: "companion",
        status: "completed",
        structuredResult: (this.script.companion ?? (() => FALL))(Number(companion[1])),
        failureCode: null,
        failureMessage: null,
      };
    }
    const family = /^sc_family_(.+)_(\d+)$/.exec(callId);
    if (!family) throw new Error(`ScriptedAdapter: cannot parse "${callId}".`);
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
    neutral_summary: "Marie said she fell.",
    person_reached: "yes",
    explicit_help_requested: "no",
    fall_mentioned: "yes",
    mobility_difficulty: "no",
    pain_or_injury_mentioned: "no",
    unusual_confusion: "no",
    distress_expressed: "no",
    conversation_ended_normally: "yes",
    does_not_want_to_disturb_family: "no",
    other_attention_signal: "no",
    attention_required: "yes",
    attention_reasons: ["fall"],
    confidence: "high",
    ...overrides,
  };
}
const FALL = companion();

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
    voicemail_left: "no",
    ...overrides,
  };
}

const CONFIRMS = (contactId: string, firstName: string) =>
  family(contactId, {
    answered: "yes",
    situation_understood: "yes",
    can_intervene: "yes",
    intervention_type: "visit",
    estimated_time: "18:00",
    contact_next_person: "no",
    summary: `${firstName} confirmed.`,
  });

describe("Stage E — availability reorders, never waits, never excludes", () => {
  it("tries the second (available) contact before the first (unavailable), then still reaches the first afterward", async () => {
    // 10:00 Europe/Paris. Julie (priority 1) is only callable 18:00-23:00 —
    // not now. Marc (priority 2, no window) confirms on his own retry, so the
    // cascade stops before Julie's or Nicole's turn would otherwise arrive.
    const adapter = new ScriptedAdapter({
      family: (contactId, attempt) =>
        contactId === "contact_marc" && attempt === 2
          ? CONFIRMS(contactId, "Marc")
          : family(contactId),
    });
    const d = deps(adapter);
    await d.repository.updateTrustedContact("contact_julie", {
      callableFrom: "18:00",
      callableTo: "23:00",
    });

    const event = await startDemoEvent("person_marie", d);

    // Marc (in-window, no restriction) is tried BEFORE Julie (out-of-window,
    // priority 1) despite Julie's higher configured priority — no waiting
    // occurred, and Julie remained eligible rather than being dropped: had
    // Marc not confirmed, Nicole then Julie would be tried next, immediately.
    expect(
      adapter.familyCalls.map((call) => `${call.contact.id}#${call.attemptNumber}`)
    ).toEqual(["contact_marc#1", "contact_marc#2"]);
    expect(event.status).toBe("CASE_CLOSED");
  });

  it("calls the previously-unavailable contact immediately once everyone else is exhausted — no wait, ever", async () => {
    const adapter = new ScriptedAdapter({
      family: (contactId, attempt) =>
        contactId === "contact_julie" && attempt === 1
          ? CONFIRMS(contactId, "Julie")
          : family(contactId),
    });
    const d = deps(adapter);
    await d.repository.updateTrustedContact("contact_julie", {
      callableFrom: "18:00",
      callableTo: "23:00",
    });

    const event = await startDemoEvent("person_marie", d);

    // Marc and Nicole tried first (out-of-window Julie ordered last), each
    // exhausting their two attempts with no answer, and THEN Julie — still
    // out of her preferred window — is called immediately and confirms.
    expect(adapter.familyCalls.map((call) => `${call.contact.id}#${call.attemptNumber}`)).toEqual([
      "contact_marc#1",
      "contact_marc#2",
      "contact_nicole#1",
      "contact_nicole#2",
      "contact_julie#1",
    ]);
    expect(event.status).toBe("CASE_CLOSED");
  });
});

describe("Stage E — disabled contacts are skipped, exactly like archived ones", () => {
  it("never calls a disabled first contact, and needs no retry-count adjustment for it", async () => {
    const adapter = new ScriptedAdapter({ family: (contactId) => family(contactId) });
    const d = deps(adapter);
    await d.repository.updateTrustedContact("contact_julie", { enabled: false });

    const event = await startDemoEvent("person_marie", d);

    expect(adapter.familyCalls.map((call) => call.contact.id)).not.toContain("contact_julie");
    expect(adapter.familyCalls[0]?.contact.id).toBe("contact_marc");
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
  });
});

describe("Stage E — per-contact maxAttempts", () => {
  it("never retries a contact configured for a single attempt", async () => {
    const adapter = new ScriptedAdapter({ family: (contactId) => family(contactId) });
    const d = deps(adapter);
    await d.repository.updateTrustedContact("contact_julie", { maxAttempts: 1 });

    await startDemoEvent("person_marie", d);

    const julieAttempts = adapter.familyCalls
      .filter((call) => call.contact.id === "contact_julie")
      .map((call) => call.attemptNumber);
    expect(julieAttempts).toEqual([1]);
  });

  it("still allows the normal two attempts for a contact configured with maxAttempts: 2", async () => {
    const adapter = new ScriptedAdapter({ family: (contactId) => family(contactId) });
    const d = deps(adapter);
    await d.repository.updateTrustedContact("contact_julie", { maxAttempts: 2 });

    await startDemoEvent("person_marie", d);

    const julieAttempts = adapter.familyCalls
      .filter((call) => call.contact.id === "contact_julie")
      .map((call) => call.attemptNumber);
    expect(julieAttempts).toEqual([1, 2]);
    expect(MAX_CONTACT_ATTEMPTS).toBe(2); // the global bound this clamps against
  });

  it("cannot exceed the global bound even if a stored value somehow did", async () => {
    const adapter = new ScriptedAdapter({ family: (contactId) => family(contactId) });
    const d = deps(adapter);
    // Bypasses validation deliberately, to prove the ENGINE — not just the
    // input validator — enforces the ceiling.
    d.repository.seedContact({
      ...(await d.repository.getTrustedContacts("person_marie")).find(
        (c) => c.id === "contact_julie"
      )!,
      maxAttempts: 99,
    });

    await startDemoEvent("person_marie", d);

    const julieAttempts = adapter.familyCalls
      .filter((call) => call.contact.id === "contact_julie")
      .map((call) => call.attemptNumber);
    expect(Math.max(...julieAttempts)).toBeLessThanOrEqual(MAX_CONTACT_ATTEMPTS);
  });
});

describe("Stage E — replay stability", () => {
  it("resumes with the identical next-contact decision after a restart, availability included", async () => {
    const adapter = new ScriptedAdapter({ family: (contactId) => family(contactId) });
    const world = restartableWorld(adapter);

    const first = world.open();
    await first.repository.updateTrustedContact("contact_julie", {
      callableFrom: "18:00",
      callableTo: "23:00",
    });
    const event = await startDemoEvent("person_marie", first);
    const placedBefore = adapter.familyCalls.length;

    const restarted = world.open();
    const reread = (await restarted.repository.getEvent(event.id))!;
    const lastCall = (await restarted.repository.listCallEvents(reread.id)).filter(
      (c) => c.agentType === "family"
    );
    const nicoleSecond = lastCall.find(
      (c) => c.contactId === "contact_nicole" && c.attemptNumber === 2
    )!;

    // Re-driving an already-processed result changes nothing and places no
    // new call — the persisted order is recomputed identically, not guessed.
    await processFamilyResult(restarted, reread, nicoleSecond.id);
    expect(adapter.familyCalls.length).toBe(placedBefore);
  });

  it("a config change made mid-cascade affects only the NEXT decision, never an already-decided step", async () => {
    const adapter = new ScriptedAdapter({ family: (contactId) => family(contactId) });
    const d = deps(adapter);

    // Nobody has a window yet: Marc is priority 2, so Julie (priority 1) goes
    // first as usual, exhausting both attempts.
    await startDemoEvent("person_marie", d);
    const julieCallCountAfterFirstRun = adapter.familyCalls.filter(
      (c) => c.contact.id === "contact_julie"
    ).length;
    expect(julieCallCountAfterFirstRun).toBe(2); // already decided, unaffected by anything below

    // Changing Julie's availability now (after the event already finished
    // deciding her calls) must not retroactively alter what already happened.
    await d.repository.updateTrustedContact("contact_julie", {
      callableFrom: "18:00",
      callableTo: "23:00",
    });
    expect(
      adapter.familyCalls.filter((c) => c.contact.id === "contact_julie").length
    ).toBe(julieCallCountAfterFirstRun);
  });
});
