import { describe, expect, it, vi } from "vitest";
import type {
  CalleAdapter,
  CallReference,
  CallResult,
  CompanionCallInput,
  FamilyCallInput,
} from "@/lib/calle/adapter";
import type { CompanionStructuredResult, FamilyStructuredResult } from "@/lib/calle/schemas";
import { InMemoryRepository } from "@/lib/database/in-memory-repository";
import { seedRepository } from "@/lib/database/seed";
import { startDemoEvent, type EngineDeps } from "@/lib/orchestration/engine";
import { buildFamilyTask } from "@/prompts/family-agent";

// DEC-022, end to end: the Companion result's own free-text context must reach
// EVERY trusted contact in the cascade, identically, through the real engine —
// not just the pure helper (covered in tests/family-context-brief.test.ts).
//
// The failure this reproduces: Claire asked for help with an administrative
// document; Julie and Marc were both told only that she "asked for help".

class ContextCapturingAdapter implements CalleAdapter {
  capabilities = { voicemail: false };
  familyCalls: FamilyCallInput[] = [];
  private counter = 0;

  constructor(
    private readonly companion: CompanionStructuredResult,
    // Every contact declines, so the cascade runs all the way through the
    // circle and we observe what each one was told.
    private readonly familyByContact: Record<string, FamilyStructuredResult> = {}
  ) {}

  async startCompanionCall(input: CompanionCallInput): Promise<CallReference> {
    this.counter += 1;
    return { callId: `companion_${this.counter}`, idempotencyKey: input.idempotencyKey };
  }

  async startFamilyCall(input: FamilyCallInput): Promise<CallReference> {
    this.familyCalls.push(input);
    this.counter += 1;
    return {
      callId: `family_${input.contact.id}_${this.counter}`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  async getCallResult(callId: string): Promise<CallResult> {
    if (callId.startsWith("companion_")) {
      return {
        callId,
        agentType: "companion",
        status: "completed",
        structuredResult: this.companion,
        failureCode: null,
        failureMessage: null,
      };
    }
    const contactId = Object.keys(this.familyByContact).find((id) =>
      callId.startsWith(`family_${id}_`)
    );
    return {
      callId,
      agentType: "family",
      status: "completed",
      structuredResult: contactId
        ? this.familyByContact[contactId]
        : declined("unknown_contact"),
      failureCode: null,
      failureMessage: null,
    };
  }
}

function declined(contactId: string): FamilyStructuredResult {
  return {
    contact_id: contactId,
    answered: "yes",
    situation_understood: "yes",
    can_intervene: "no",
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: "Cannot help today.",
  };
}

function companionResult(
  overrides: Partial<CompanionStructuredResult> = {}
): CompanionStructuredResult {
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

// The seeded demo circle is Julie (1), Marc (2), Nicole (3) — all declining,
// so every contact is called and every brief is observable.
function setup(companion: CompanionStructuredResult) {
  const repository = new InMemoryRepository();
  seedRepository(repository);
  const calleAdapter = new ContextCapturingAdapter(companion, {
    contact_julie: declined("contact_julie"),
    contact_marc: declined("contact_marc"),
    contact_nicole: declined("contact_nicole"),
  });
  return { repository, calleAdapter } satisfies EngineDeps;
}

describe("Companion context reaches every trusted contact (DEC-022)", () => {
  it("gives Julie AND Marc the identical administrative-document context", async () => {
    const deps = setup(
      companionResult({
        neutral_summary:
          "Marie said she would like help completing an administrative document.",
        explicit_help_requested: "yes",
        attention_required: "no",
        attention_reasons: ["explicit_help_request"],
      })
    );

    const event = await startDemoEvent("person_marie", deps);
    const adapter = deps.calleAdapter as ContextCapturingAdapter;

    const julie = adapter.familyCalls.find((call) => call.contact.id === "contact_julie");
    const marc = adapter.familyCalls.find((call) => call.contact.id === "contact_marc");

    expect(julie?.contextBrief).toContain("administrative document");
    expect(marc?.contextBrief).toContain("administrative document");
    // The SAME situation, not two paraphrases of it.
    expect(marc?.contextBrief).toBe(julie?.contextBrief);

    // The categorical fact list is unchanged by DEC-022 — it still says only
    // "asked for help", which is exactly why the brief had to exist.
    expect(julie?.informationToShare).toEqual(["asked for help"]);

    // Deterministic outcome is untouched: everyone declined, so the event is
    // terminal-unresolved, and all three contacts were tried in priority order.
    expect(event.status).toBe("ATTENTION_UNRESOLVED");
    expect(adapter.familyCalls.map((call) => call.contact.id)).toEqual([
      "contact_julie",
      "contact_marc",
      "contact_nicole",
    ]);
  });

  it("propagates a mobility context through the same path", async () => {
    const deps = setup(
      companionResult({
        neutral_summary: "Marie said she is finding it difficult to walk today.",
        mobility_difficulty: "yes",
        attention_required: "yes",
        attention_reasons: ["mobility_difficulty"],
      })
    );

    await startDemoEvent("person_marie", deps);
    const adapter = deps.calleAdapter as ContextCapturingAdapter;

    for (const call of adapter.familyCalls) {
      expect(call.contextBrief).toContain("difficult to walk");
    }
    expect(adapter.familyCalls[0]?.informationToShare).toEqual([
      "described difficulty moving around",
    ]);
  });

  it("propagates a context nobody wrote code for, with no hardcoded branch", async () => {
    const deps = setup(
      companionResult({
        neutral_summary: "Marie said her washing machine has flooded the kitchen floor.",
        explicit_help_requested: "yes",
        other_attention_signal: "yes",
        attention_required: "yes",
        attention_reasons: ["explicit_help_request", "other_attention_signal"],
      })
    );

    await startDemoEvent("person_marie", deps);
    const adapter = deps.calleAdapter as ContextCapturingAdapter;

    for (const call of adapter.familyCalls) {
      expect(call.contextBrief).toContain("washing machine");
      expect(call.contextBrief).toContain("flooded the kitchen floor");
    }
  });

  it("falls back to a generic sentence when the summary is empty, without inventing a reason", async () => {
    const deps = setup(
      companionResult({
        neutral_summary: "",
        explicit_help_requested: "yes",
        attention_required: "yes",
        attention_reasons: ["explicit_help_request"],
      })
    );

    await startDemoEvent("person_marie", deps);
    const adapter = deps.calleAdapter as ContextCapturingAdapter;

    for (const call of adapter.familyCalls) {
      expect(call.contextBrief).toBe(
        "Marie asked KinCall to contact someone in their trusted circle for help."
      );
    }
  });

  it("tells contacts plainly when the person was never reached", async () => {
    const deps = setup(
      companionResult({
        neutral_summary: "The call reached voicemail.",
        person_reached: "no",
        attention_required: "unknown",
        attention_reasons: ["person_not_reached"],
      })
    );

    await startDemoEvent("person_marie", deps);
    const adapter = deps.calleAdapter as ContextCapturingAdapter;

    // The companion retry is exhausted first, then the circle is called.
    expect(adapter.familyCalls.length).toBeGreaterThan(0);
    for (const call of adapter.familyCalls) {
      expect(call.contextBrief).toBe(
        "KinCall could not reach Marie during the scheduled check-in."
      );
    }
  });

  it("never leaks a raw enum, an internal field name, or JSON into what a contact hears", async () => {
    const deps = setup(
      companionResult({
        neutral_summary: "Marie said she needs a hand with some paperwork.",
        explicit_help_requested: "yes",
        fall_mentioned: "yes",
        attention_required: "yes",
        attention_reasons: ["explicit_help_request", "fall"],
      })
    );

    await startDemoEvent("person_marie", deps);
    const adapter = deps.calleAdapter as ContextCapturingAdapter;

    for (const call of adapter.familyCalls) {
      // The brief itself.
      for (const forbidden of ["neutral_summary", "attention_reasons", "explicit_help_request", "{", "}"]) {
        expect(call.contextBrief ?? "").not.toContain(forbidden);
      }

      // And the fully rendered prompt the agent actually receives.
      const task = buildFamilyTask(
        call.person,
        call.contact,
        call.informationToShare,
        { attemptNumber: call.attemptNumber, mayLeaveVoicemail: call.mayLeaveVoicemail },
        call.contextBrief
      );
      expect(task).toContain("needs a hand with some paperwork");
      expect(task).not.toContain("neutral_summary");
      expect(task).not.toContain("attention_reasons");
      expect(task).not.toContain(call.contact.phone);
    }
  });

  it("keeps the cascade outcome, order and attempt counts byte-identical to before", async () => {
    // A confirming first contact: the cascade must still stop at Julie.
    const repository = new InMemoryRepository();
    seedRepository(repository);
    const calleAdapter = new ContextCapturingAdapter(
      companionResult({
        neutral_summary: "Marie said she would like help with a form.",
        explicit_help_requested: "yes",
        attention_required: "yes",
        attention_reasons: ["explicit_help_request"],
      }),
      {
        contact_julie: {
          contact_id: "contact_julie",
          answered: "yes",
          situation_understood: "yes",
          can_intervene: "yes",
          intervention_type: "visit",
          estimated_time: "this afternoon",
          contact_next_person: "no",
          summary: "Will visit this afternoon.",
        },
      }
    );

    const event = await startDemoEvent("person_marie", { repository, calleAdapter });

    expect(event.status).toBe("CASE_CLOSED");
    expect(event.decision).toBe("CONTACT_TRUSTED_PERSON");
    // Marc and Nicole are never called once Julie confirms.
    expect(calleAdapter.familyCalls.map((call) => call.contact.id)).toEqual(["contact_julie"]);
    expect(calleAdapter.familyCalls[0]?.attemptNumber).toBe(1);
  });
});

describe("no hardcoded situation vocabulary exists (DEC-022)", () => {
  it("the brief module names no specific real-world situation", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../lib/orchestration/family-context-brief.ts", import.meta.url),
      "utf-8"
    );
    // Strip comments: the header legitimately explains the administrative
    // example that motivated the fix, but no executable branch may test for it.
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");

    for (const situation of ["administrative", "document", "paperwork", "boiler", "walk", "fall"]) {
      expect(code.toLowerCase()).not.toContain(situation);
    }
  });
});
