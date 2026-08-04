import { describe, expect, it } from "vitest";
import { describePersonStatus } from "@/backend/presentation/person-status";
import type { EventRecord } from "@/shared/domain/types";
import type { EventStatus } from "@/backend/orchestration/state-machine/states";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event_001",
    runId: "00000000-0000-0000-0000-000000000000",
    personId: "person_marie",
    status: "CASE_CLOSED",
    currentContactPriority: null,
    decision: null,
    decisionReason: null,
    createdAt: "2026-07-30T09:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

const ALL_STATUSES: EventStatus[] = [
  "SCHEDULED",
  "CALLING_PERSON",
  "PERSON_DID_NOT_ANSWER",
  "CONVERSATION_IN_PROGRESS",
  "ANALYSING_CONVERSATION",
  "NO_ACTION_REQUIRED",
  "ATTENTION_REQUIRED",
  "CALLING_TRUSTED_CONTACT",
  "CONTACT_DID_NOT_ANSWER",
  "CONTACT_DECLINED",
  "CONTACT_CONFIRMED",
  "HUMAN_REVIEW_REQUIRED",
  "ATTENTION_UNRESOLVED",
  "CASE_CLOSED",
];

describe("describePersonStatus", () => {
  it("gives ATTENTION_UNRESOLVED its own tone, distinct from an in-flight cascade", () => {
    // The point of the separate tone (DEC-011): "we are currently contacting
    // the circle" and "we finished and reached nobody" are different outcomes
    // and must not render identically. Before this they were both "attention".
    const unresolved = describePersonStatus(event({ status: "ATTENTION_UNRESOLVED" }));
    const contacting = describePersonStatus(event({ status: "CALLING_TRUSTED_CONTACT" }));

    expect(unresolved.tone).toBe("unresolved");
    expect(contacting.tone).toBe("attention");
    expect(unresolved.tone).not.toBe(contacting.tone);
  });

  it("never labels an unresolved event as calm", () => {
    expect(describePersonStatus(event({ status: "ATTENTION_UNRESOLVED" })).tone).not.toBe("calm");
  });

  it("distinguishes a check-in that closed after the circle stepped in from one that was simply fine", () => {
    const steppedIn = describePersonStatus(
      event({ status: "CASE_CLOSED", decision: "CONTACT_TRUSTED_PERSON" })
    );
    const allWell = describePersonStatus(
      event({ status: "CASE_CLOSED", decision: "LOG_AND_CLOSE" })
    );

    // Both are calm — somebody is handling it, or nothing needed handling — but
    // they must not claim the same thing happened.
    expect(steppedIn.tone).toBe("calm");
    expect(allWell.tone).toBe("calm");
    expect(steppedIn.label).not.toBe(allWell.label);
  });

  it("returns a label and a known tone for every EventStatus, including retained legacy ones", () => {
    // Guards the exhaustive switch: a new status with no case would hit the
    // `never` default and throw here rather than silently rendering undefined.
    for (const status of ALL_STATUSES) {
      const result = describePersonStatus(event({ status }));
      expect(result.label, status).toBeTruthy();
      expect(["calm", "attention", "unresolved", "unknown"], status).toContain(result.tone);
    }
  });

  it("reports no check-in rather than a reassuring state when there is no event at all", () => {
    const result = describePersonStatus(undefined);
    expect(result.tone).toBe("unknown");
    expect(result.label).toMatch(/no check-in/i);
  });
});
