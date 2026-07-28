import { describe, expect, it } from "vitest";
import { describeAction, describeOwnership } from "@/app/events/[id]/page";
import type { EventRecord } from "@/lib/database/types";

const REASSURING_ACTION = "KinCall reviewed the check-in and found nothing unusual.";
const REASSURING_OWNERSHIP = "No intervention required.";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event_001",
    runId: "00000000-0000-0000-0000-000000000000",
    personId: "person_marie",
    status: "SCHEDULED",
    priority: null,
    currentContactPriority: null,
    decision: null,
    decisionReason: null,
    createdAt: new Date().toISOString(),
    closedAt: null,
    ...overrides,
  };
}

describe("event summary — before a decision exists", () => {
  const preDecisionStatuses = [
    "SCHEDULED",
    "CALLING_PERSON",
    "CONVERSATION_IN_PROGRESS",
  ] as const;

  it.each(preDecisionStatuses)('shows "Check-in in progress." while status is %s', (status) => {
    const e = event({ status });
    expect(describeAction(e)).toBe("Check-in in progress.");
  });

  it("shows the analysing message once the call has ended", () => {
    const e = event({ status: "ANALYSING_CONVERSATION" });
    expect(describeAction(e)).toBe("KinCall is analysing the conversation.");
  });

  it.each(preDecisionStatuses)(
    "never claims nothing unusual or no intervention required while status is %s",
    (status) => {
      const e = event({ status });
      expect(describeAction(e)).not.toBe(REASSURING_ACTION);
      expect(describeOwnership(e)).not.toBe(REASSURING_OWNERSHIP);
    }
  );

  it("never claims nothing unusual or no intervention required while analysing", () => {
    const e = event({ status: "ANALYSING_CONVERSATION" });
    expect(describeAction(e)).not.toBe(REASSURING_ACTION);
    expect(describeOwnership(e)).not.toBe(REASSURING_OWNERSHIP);
  });
});

describe("event summary — after a decision exists", () => {
  it("shows the reassuring message when the case closed with no concerning signal", () => {
    const e = event({ status: "CASE_CLOSED", decision: "LOG_AND_CLOSE", closedAt: new Date().toISOString() });
    expect(describeAction(e)).toBe(REASSURING_ACTION);
    expect(describeOwnership(e)).toBe(REASSURING_OWNERSHIP);
  });

  it("shows the reassuring message for the transient NO_ACTION_REQUIRED status too", () => {
    const e = event({ status: "NO_ACTION_REQUIRED", decision: "LOG_AND_CLOSE" });
    expect(describeAction(e)).toBe(REASSURING_ACTION);
    expect(describeOwnership(e)).toBe(REASSURING_OWNERSHIP);
  });

  it("says a trusted contact needs to be contacted when attention is required", () => {
    const e = event({ status: "ATTENTION_REQUIRED", decision: "CONTACT_TRUSTED_PERSON" });
    expect(describeAction(e)).toContain("trusted contact needs to be contacted");
    expect(describeAction(e)).not.toBe(REASSURING_ACTION);
    expect(describeOwnership(e)).not.toBe(REASSURING_OWNERSHIP);
  });

  it("says the person was not reached and a retry is owed", () => {
    const e = event({ status: "PERSON_DID_NOT_ANSWER", decision: "RETRY_CHECK_IN" });
    expect(describeAction(e)).toContain("did not reach the person");
    expect(describeAction(e)).toContain("retry is owed");
    expect(describeOwnership(e)).toContain("retry is owed");
  });

  it("says human review is required when reachability could not be confirmed", () => {
    const e = event({ status: "HUMAN_REVIEW_REQUIRED", decision: "REQUEST_HUMAN_REVIEW" });
    expect(describeAction(e)).toContain("could not confirm");
    expect(describeOwnership(e)).toContain("human review");
  });

  it("says human review is required for a malformed companion result (decision still null)", () => {
    const e = event({ status: "HUMAN_REVIEW_REQUIRED", decision: null });
    expect(describeAction(e)).toBe("Human review is required.");
    expect(describeAction(e)).not.toBe(REASSURING_ACTION);
    expect(describeOwnership(e)).not.toBe(REASSURING_OWNERSHIP);
  });

  it("does not claim nothing unusual when the case closed after a confirmed intervention", () => {
    const e = event({
      status: "CASE_CLOSED",
      decision: "CONTACT_TRUSTED_PERSON",
      closedAt: new Date().toISOString(),
    });
    expect(describeAction(e)).not.toBe(REASSURING_ACTION);
    expect(describeAction(e)).toBe("KinCall contacted the trusted circle.");
    expect(describeOwnership(e)).not.toBe(REASSURING_OWNERSHIP);
  });
});
