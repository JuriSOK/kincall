import { describe, expect, it, vi } from "vitest";
import type {
  CalleAdapter,
  CallReference,
  CallResult,
  CompanionCallInput,
  FamilyCallInput,
} from "@/lib/calle/adapter";
import type { FamilyStructuredResult } from "@/lib/calle/schemas";
import { FakeCalleAdapter } from "@/lib/calle/fake-adapter";
import { ContactHasActiveCallError } from "@/lib/database/errors";
import { InMemoryRepository } from "@/lib/database/in-memory-repository";
import { seedRepository } from "@/lib/database/seed";
import { describeFamilyCascade, findConfirmation } from "@/lib/presentation/event-summary";
import { startDemoEvent, type EngineDeps } from "@/lib/orchestration/engine";
import { seedPendingFamilyCallIntent } from "./support/seed-calls";

// DEC-009: soft deletion is optional interface administration, not a core
// orchestration feature — these tests prove that an archived contact is
// structurally excluded from the cascade (never dialled), that archiving is
// still refused while a contact's call is genuinely active, and that
// historical display keeps resolving an archived contact's name.

function createDeps(calleAdapter: CalleAdapter = new FakeCalleAdapter()): EngineDeps {
  const repository = new InMemoryRepository();
  seedRepository(repository);
  return { repository, calleAdapter };
}

// A scripted adapter for the one scenario FakeCalleAdapter's fixed
// Marie/Julie/Marc script cannot produce: a Nicole result. Companion always
// returns the attention-triggering result instantly.
class ScriptedFamilyAdapter implements CalleAdapter {
  // Voicemail is treated as supported unless a test overrides it, so the
  // voicemail-unsupported fallback is exercised explicitly where it matters.
  capabilities = { voicemail: true };

  startFamilyCallSpy = vi.fn();
  familyResultsByContact: Record<string, FamilyStructuredResult> = {};
  private counter = 0;

  async startCompanionCall(): Promise<CallReference> {
    this.counter += 1;
    return { callId: `scripted_companion_${this.counter}`, idempotencyKey: "x" };
  }

  async startFamilyCall(input: FamilyCallInput): Promise<CallReference> {
    this.startFamilyCallSpy(input);
    this.counter += 1;
    return {
      callId: `scripted_family_${input.contact.id}_${this.counter}`,
      idempotencyKey: input.idempotencyKey,
    };
  }

  async startPersonNotificationCall(input: { idempotencyKey: string }) {
    return { callId: "archive_notification", idempotencyKey: input.idempotencyKey };
  }

  async getCallResult(callId: string): Promise<CallResult> {
    if (callId === "archive_notification") {
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
    if (callId.startsWith("scripted_companion_")) {
      return {
        callId,
        agentType: "companion",
        status: "completed",
        structuredResult: {
          conversation_summary: "Marie mentioned a fall.",
          person_reached: "yes",
          fall_mentioned: "yes",
          mobility_difficulty: "yes",
          person_requests_help: "no",
          person_does_not_want_to_disturb_family: "yes",
          conversation_shorter_than_usual: "no",
          unusual_confusion: "no",
          recommended_attention_level: "high",
        },
        failureCode: null,
        failureMessage: null,
      };
    }
    const contactId = Object.keys(this.familyResultsByContact).find((id) => callId.includes(id));
    return {
      callId,
      agentType: "family",
      status: "completed",
      structuredResult: contactId ? this.familyResultsByContact[contactId] : null,
      failureCode: null,
      failureMessage: null,
    };
  }

  contactsCalled(): string[] {
    return this.startFamilyCallSpy.mock.calls.map((call) => (call[0] as FamilyCallInput).contact.id);
  }
}

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

describe("archived contacts are excluded from the cascade", () => {
  it("skips an archived first-priority contact, dialling the next active one instead", async () => {
    const deps = createDeps(); // unmodified FakeCalleAdapter: Julie no-answer, Marc confirms
    await deps.repository.archiveTrustedContact("contact_julie");

    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
    const messages = (await deps.repository.listTimeline(event.id)).map((entry) => entry.message);
    // Julie was never dialled at all — not skipped-and-recorded, simply absent.
    expect(messages).not.toContain("Calling Julie");
    expect(messages).toContain("Calling Marc");
  });

  it("skips an archived middle contact, dialling the one after them instead", async () => {
    const adapter = new ScriptedFamilyAdapter();
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", { answered: "no" }),
      contact_nicole: familyResult("contact_nicole", {
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "18:00",
        summary: "Nicole confirmed she will visit.",
      }),
    };
    const deps = createDeps(adapter);
    await deps.repository.archiveTrustedContact("contact_marc");

    const event = await startDemoEvent("person_marie", deps);

    expect(event.status).toBe("CASE_CLOSED");
    // Julie twice (her bounded retry, DEC-011), then straight to Nicole: Marc is
    // archived and so is structurally absent from the list the cascade reasons over.
    expect(adapter.contactsCalled()).toEqual([
      "contact_julie",
      "contact_julie",
      "contact_nicole",
    ]);
    expect(adapter.contactsCalled()).not.toContain("contact_marc");
  });

  it("never re-selects a contact archived after their own turn already closed", async () => {
    // Marie -> Julie confirms immediately; nobody else should ever be considered.
    const adapter = new ScriptedFamilyAdapter();
    adapter.familyResultsByContact = {
      contact_julie: familyResult("contact_julie", {
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "09:00",
      }),
    };
    const deps = createDeps(adapter);

    const event = await startDemoEvent("person_marie", deps);
    expect(event.status).toBe("CASE_CLOSED");

    // Archiving afterwards must not retroactively change anything already decided.
    await deps.repository.archiveTrustedContact("contact_marc");
    expect((await deps.repository.getEvent(event.id))?.status).toBe("CASE_CLOSED");
    expect(adapter.contactsCalled()).toEqual(["contact_julie"]);
  });
});

describe("archiving a contact mid-cascade, while their own call is active, is still refused", () => {
  it("refuses to archive the contact the cascade is currently waiting on", async () => {
    const repository = new InMemoryRepository();
    seedRepository(repository);

    // A real, engine-created call event — not a hand-built fixture — parked
    // unprocessed, exactly the state a live cascade leaves between a webhook
    // and its eventual delivery.
    const { callEvent } = await seedPendingFamilyCallIntent(repository, "contact_julie");

    await expect(repository.archiveTrustedContact("contact_julie")).rejects.toThrow(
      ContactHasActiveCallError
    );

    // Nothing changed: still unarchived, call still unprocessed.
    const contact = (await repository.getTrustedContacts("person_marie")).find(
      (c) => c.id === "contact_julie"
    );
    expect(contact?.archivedAt).toBeNull();
    expect((await repository.getCallEvent(callEvent.id))?.resultProcessedAt).toBeNull();
  });
});

describe("historical display keeps resolving an archived contact's name", () => {
  it("findConfirmation and describeFamilyCascade still resolve an archived contact", async () => {
    const repository = new InMemoryRepository();
    seedRepository(repository);

    // Julie declined, Marc confirmed — the real event-summary regression
    // scenario (tests/event-summary.test.ts), replayed with Julie archived
    // AFTER the fact, the way an operator might tidy up a trusted circle long
    // after an old event closed.
    await repository.archiveTrustedContact("contact_julie");

    const contacts = await repository.getTrustedContacts("person_marie"); // UNFILTERED — historical read
    const julie = contacts.find((c) => c.id === "contact_julie")!;
    const marc = contacts.find((c) => c.id === "contact_marc")!;
    expect(julie.archivedAt).not.toBeNull(); // sanity: genuinely archived

    const julieCall = {
      id: "call_event_julie",
      eventId: "event_001",
      agentType: "family" as const,
      contactId: "contact_julie",
      attemptNumber: 1,
      calleCallId: "fake_family_contact_julie_x",
      idempotencyKey: "key_julie",
      status: "completed" as const,
      summary: "Julie did not answer.",
      structuredResult: familyResult("contact_julie", { answered: "no", can_intervene: "no" }),
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      processingToken: null,
      processingStartedAt: null,
      resultProcessedAt: new Date().toISOString(),
    };
    const marcCall = {
      ...julieCall,
      id: "call_event_marc",
      contactId: "contact_marc",
      calleCallId: "fake_family_contact_marc_x",
      idempotencyKey: "key_marc",
      summary: "Marc confirmed that he will visit Marie vers 18h00.",
      structuredResult: familyResult("contact_marc", {
        contact_id: "contact_marc",
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "vers 18h00",
        summary: "Marc confirmed that he will visit Marie vers 18h00.",
      }),
    };

    const confirmation = findConfirmation([julieCall, marcCall], contacts);
    expect(confirmation?.contact?.id).toBe("contact_marc");
    expect(confirmation?.contact?.firstName).toBe(marc.firstName);

    const narrative = describeFamilyCascade([julieCall, marcCall], contacts, confirmation!);
    // The archived contact's name still resolves correctly in the narrative.
    expect(narrative).toBe("Julie did not answer, so KinCall contacted Marc.");
  });
});
