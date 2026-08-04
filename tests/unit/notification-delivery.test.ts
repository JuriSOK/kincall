import { describe, expect, it } from "vitest";
import { describeNotificationDelivery } from "@/backend/presentation/event-summary";
import { describePersonStatus } from "@/backend/presentation/person-status";
import type { CallEventRecord, EventRecord } from "@/shared/domain/types";

// DEC-023 revision. The workflow outcome and the delivery of the follow-up call
// are two different facts, shown on two different lines. "Case closed" means
// KinCall's workflow finished — never that the person answered the callback.

function notificationCall(overrides: Partial<CallEventRecord> = {}): CallEventRecord {
  return {
    id: "call_notify",
    eventId: "event_001",
    agentType: "person_notification",
    contactId: null,
    attemptNumber: 1,
    calleCallId: "calle_notify",
    idempotencyKey: "run_person_notification",
    status: "completed",
    summary: null,
    structuredResult: null,
    startedAt: "2026-08-04T09:00:00.000Z",
    endedAt: "2026-08-04T09:01:00.000Z",
    processingToken: null,
    processingStartedAt: null,
    resultProcessedAt: "2026-08-04T09:01:00.000Z",
    ...overrides,
  } as CallEventRecord;
}

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event_001",
    runId: "run_001",
    personId: "person_claire",
    status: "CASE_CLOSED",
    currentContactPriority: null,
    decision: "CONTACT_TRUSTED_PERSON",
    decisionReason: null,
    createdAt: "2026-08-04T08:00:00.000Z",
    closedAt: "2026-08-04T09:01:00.000Z",
    ...overrides,
  } as EventRecord;
}

describe("delivery confirmed", () => {
  it("says the outcome was shared, with a positive tone", () => {
    const view = describeNotificationDelivery(
      notificationCall({
        structuredResult: { person_reached: "yes", message_delivered: "yes", summary: "Passed on." },
      }),
      "Claire"
    );
    expect(view.state).toBe("delivered");
    expect(view.label).toBe("Outcome shared with Claire");
    expect(view.tone).toBe("calm");
  });
});

describe("delivery not confirmed — never a success claim", () => {
  // Test 8: a completed provider call alone does NOT imply delivery.
  it("treats a completed call with message_delivered 'no' as unconfirmed", () => {
    const view = describeNotificationDelivery(
      notificationCall({
        status: "completed",
        structuredResult: { person_reached: "no", message_delivered: "no", summary: "No answer." },
      }),
      "Claire"
    );
    expect(view.state).toBe("unconfirmed");
    expect(view.label).toBe("KinCall could not confirm that the outcome was delivered");
    expect(view.tone).not.toBe("calm");
  });

  it("treats an unknown delivery as unconfirmed", () => {
    const view = describeNotificationDelivery(
      notificationCall({
        structuredResult: { person_reached: "unknown", message_delivered: "unknown", summary: "" },
      }),
      "Claire"
    );
    expect(view.state).toBe("unconfirmed");
    expect(view.tone).not.toBe("calm");
  });

  it("treats an unreadable or absent result as unconfirmed", () => {
    for (const structuredResult of [null, { nonsense: true }, "garbage"]) {
      const view = describeNotificationDelivery(
        notificationCall({ structuredResult } as Partial<CallEventRecord>),
        "Claire"
      );
      expect(view.state).toBe("unconfirmed");
    }
  });

  // A technical failure never persists a structured result — the call event is
  // finalized with none, which is exactly the unreadable case below.
  it("treats a technical failure as unconfirmed, never as voicemail", () => {
    const view = describeNotificationDelivery(
      notificationCall({ structuredResult: null }),
      "Claire"
    );
    expect(view.state).toBe("unconfirmed");
    // CALL-E exposes no answering-machine detection — never label one.
    expect(view.label.toLowerCase()).not.toContain("voicemail");
    expect(view.label.toLowerCase()).not.toContain("answering machine");
  });

  it("never labels any state as voicemail", () => {
    for (const call of [
      notificationCall({ resultProcessedAt: null }),
      notificationCall({ structuredResult: { person_reached: "no", message_delivered: "no", summary: "" } }),
      notificationCall({ structuredResult: { person_reached: "yes", message_delivered: "yes", summary: "" } }),
    ]) {
      const label = describeNotificationDelivery(call, "Claire").label.toLowerCase();
      expect(label).not.toContain("voicemail");
      expect(label).not.toContain("answering machine");
    }
  });
});

describe("callback still in progress", () => {
  it("is neutral, never green, until the result is processed", () => {
    const view = describeNotificationDelivery(
      notificationCall({ resultProcessedAt: null, structuredResult: null }),
      "Claire"
    );
    expect(view.state).toBe("in_progress");
    expect(view.tone).toBe("neutral");
    expect(view.label).not.toContain("Outcome shared");
  });
});

describe("workflow status is independent of delivery", () => {
  it("NOTIFYING_PERSON is in-progress and not a terminal green state", () => {
    const status = describePersonStatus(event({ status: "NOTIFYING_PERSON", closedAt: null }));
    expect(status.label).toBe("Calling back with the outcome");
    expect(status.tone).toBe("unknown");
    expect(status.tone).not.toBe("calm");
  });

  it("a confirmed case closes green even when delivery was not confirmed", () => {
    const status = describePersonStatus(event({ status: "CASE_CLOSED" }));
    expect(status.tone).toBe("calm");
    expect(status.label).not.toContain("Calling back");

    const delivery = describeNotificationDelivery(
      notificationCall({ structuredResult: { person_reached: "no", message_delivered: "no", summary: "" } }),
      "Claire"
    );
    // Terminal and green, yet delivery is explicitly unconfirmed.
    expect(delivery.state).toBe("unconfirmed");
  });

  it("an unresolved case stays unresolved even when delivery WAS confirmed", () => {
    const status = describePersonStatus(event({ status: "ATTENTION_UNRESOLVED", closedAt: null }));
    expect(status.label).toBe("No confirmed support");
    expect(status.tone).toBe("unresolved");
    expect(status.label).not.toContain("Calling back");

    const delivery = describeNotificationDelivery(
      notificationCall({ structuredResult: { person_reached: "yes", message_delivered: "yes", summary: "" } }),
      "Claire"
    );
    expect(delivery.state).toBe("delivered");
  });
});
