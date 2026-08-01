import { describe, expect, it } from "vitest";
import {
  describeAction,
  describeAttentionOutcome,
  describeFamilyCascade,
  describeOwnership,
  findConfirmation,
} from "@/lib/presentation/event-summary";
import type { FamilyStructuredResult } from "@/lib/calle/schemas";
import { toEvent, type EventRow } from "@/lib/database/row-mappers";
import type { CallEventRecord, EventRecord, TrustedContact } from "@/lib/database/types";

const REASSURING_ACTION = "KinCall reviewed the check-in and found no attention signal.";
const REASSURING_OWNERSHIP = "No intervention required.";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event_001",
    runId: "00000000-0000-0000-0000-000000000000",
    personId: "person_marie",
    status: "SCHEDULED",
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

  it("says the person was not reached and KinCall is trying again", () => {
    // DEC-011: the retry is autonomous now, so this no longer says a retry is
    // "owed" — nothing is waiting on a human to place it.
    const e = event({ status: "PERSON_DID_NOT_ANSWER", decision: "RETRY_CHECK_IN" });
    expect(describeAction(e)).toContain("did not reach the person");
    expect(describeAction(e)).toContain("trying again");
    expect(describeOwnership(e)).toContain("trying again");
  });

  it("states the unresolved outcome plainly, with no suggestion KinCall is still working", () => {
    const e = event({ status: "ATTENTION_UNRESOLVED", decision: "CONTACT_TRUSTED_PERSON" });
    expect(describeAction(e)).toContain("Nobody was able to confirm");
    expect(describeAction(e)).not.toBe(REASSURING_ACTION);
    expect(describeOwnership(e)).toContain("Nobody");
    expect(describeOwnership(e)).toContain("finished trying");
    expect(describeOwnership(e)).not.toBe(REASSURING_OWNERSHIP);
  });

  it("still renders a historical human-review event rather than breaking on it", () => {
    // DEC-011 stopped producing this status but must keep displaying the events
    // that already have it.
    const e = event({ status: "HUMAN_REVIEW_REQUIRED", decision: "REQUEST_HUMAN_REVIEW" });
    expect(describeAction(e)).toBe("Human review is required.");
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

const julie: TrustedContact = {
  id: "contact_julie",
  personId: "person_marie",
  firstName: "Julie",
  phone: "+33639980002",
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
};

const marc: TrustedContact = {
  id: "contact_marc",
  personId: "person_marie",
  firstName: "Marc",
  phone: "+33639980003",
  relationship: "son",
  priority: 2,
  consentStatus: "confirmed",
  archivedAt: null,
  isPrimary: false,
  enabled: true,
  callableFrom: null,
  callableTo: null,
  timezone: null,
  maxAttempts: 2,
};

function familyResult(overrides: Partial<FamilyStructuredResult> = {}): FamilyStructuredResult {
  return {
    contact_id: "contact_julie",
    answered: "no",
    situation_understood: "unknown",
    can_intervene: "no",
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: "Julie did not answer.",
    ...overrides,
  };
}

function familyCall(overrides: Partial<CallEventRecord> = {}): CallEventRecord {
  return {
    id: "call_event_julie",
    eventId: "event_001",
    agentType: "family",
    contactId: "contact_julie",
    attemptNumber: 1,
    calleCallId: "fake_family_contact_julie_x",
    idempotencyKey: "key",
    status: "completed",
    summary: "Julie did not answer.",
    structuredResult: familyResult(),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    processingToken: null,
    processingStartedAt: null,
    resultProcessedAt: new Date().toISOString(),
    ...overrides,
  };
}

// Regression coverage for the bug where "Who is taking care of it?" showed
// Julie's voicemail result even though Marc was the one who confirmed.
describe("findConfirmation", () => {
  it("does not confuse a non-answer for a confirmation (the root-cause bug)", () => {
    // Before the fix this checked `if (structuredResult.can_intervene)`, a
    // truthiness check — and "no" is a non-empty, truthy string.
    const julieCall = familyCall({ structuredResult: familyResult({ can_intervene: "no" }) });
    expect(findConfirmation([julieCall], [julie, marc])).toBeNull();
  });

  it("does not confuse 'unknown' for a confirmation either", () => {
    const julieCall = familyCall({ structuredResult: familyResult({ can_intervene: "unknown" }) });
    expect(findConfirmation([julieCall], [julie, marc])).toBeNull();
  });

  it("finds Marc's confirmation, not Julie's earlier no-answer, when Marc is later in the list", () => {
    const julieCall = familyCall({ id: "call_event_julie" });
    const marcCall = familyCall({
      id: "call_event_marc",
      contactId: "contact_marc",
      structuredResult: familyResult({
        contact_id: "contact_marc",
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "vers 18h00",
        summary: "Marc confirmed that he will visit Marie vers 18h00.",
      }),
    });

    const confirmation = findConfirmation([julieCall, marcCall], [julie, marc]);

    expect(confirmation).not.toBeNull();
    expect(confirmation?.contact?.id).toBe("contact_marc");
    expect(confirmation?.result.summary).toContain("Marc");
    expect(confirmation?.result.summary).not.toContain("Julie");
  });

  it("resolves the contact via callEvent.contactId, never via the model-returned contact_id", () => {
    // The structured result claims Julie, but KinCall actually called Marc —
    // this must never happen given engine.ts's own guard, but the UI must
    // not compound a hypothetical mismatch by trusting the wrong field either.
    const marcCall = familyCall({
      id: "call_event_marc",
      contactId: "contact_marc",
      structuredResult: familyResult({
        contact_id: "contact_julie",
        answered: "yes",
        can_intervene: "yes",
      }),
    });

    const confirmation = findConfirmation([marcCall], [julie, marc]);
    expect(confirmation?.contact?.id).toBe("contact_marc");
  });

  it("returns null when nobody confirmed", () => {
    const julieCall = familyCall();
    const marcCall = familyCall({
      id: "call_event_marc",
      contactId: "contact_marc",
      structuredResult: familyResult({ contact_id: "contact_marc", answered: "no" }),
    });
    expect(findConfirmation([julieCall, marcCall], [julie, marc])).toBeNull();
  });

  it("returns null when there are no family calls at all (no cascade needed)", () => {
    expect(findConfirmation([], [julie, marc])).toBeNull();
  });
});

describe("describeFamilyCascade", () => {
  it("narrates: Julie did not answer, so KinCall contacted Marc", () => {
    const julieCall = familyCall();
    const marcCall = familyCall({
      id: "call_event_marc",
      contactId: "contact_marc",
      structuredResult: familyResult({
        contact_id: "contact_marc",
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "vers 18h00",
      }),
    });

    const confirmation = findConfirmation([julieCall, marcCall], [julie, marc])!;
    const narrative = describeFamilyCascade([julieCall, marcCall], [julie, marc], confirmation);

    expect(narrative).toBe("Julie did not answer, so KinCall contacted Marc.");
  });

  it("narrates a decline distinctly from a no-answer", () => {
    const julieCall = familyCall({
      structuredResult: familyResult({ answered: "yes", can_intervene: "no" }),
    });
    const marcCall = familyCall({
      id: "call_event_marc",
      contactId: "contact_marc",
      structuredResult: familyResult({
        contact_id: "contact_marc",
        answered: "yes",
        can_intervene: "yes",
      }),
    });

    const confirmation = findConfirmation([julieCall, marcCall], [julie, marc])!;
    const narrative = describeFamilyCascade([julieCall, marcCall], [julie, marc], confirmation);

    expect(narrative).toBe("Julie declined, so KinCall contacted Marc.");
  });

  it("does not mention anyone else when the first contact confirms immediately", () => {
    const julieCall = familyCall({
      structuredResult: familyResult({ answered: "yes", can_intervene: "yes" }),
    });

    const confirmation = findConfirmation([julieCall], [julie, marc])!;
    const narrative = describeFamilyCascade([julieCall], [julie, marc], confirmation);

    expect(narrative).toBe("KinCall contacted Julie, who confirmed they would help.");
    expect(narrative).not.toContain("did not answer");
    expect(narrative).not.toContain("declined");
  });
});

describe("event page summary — regression: cascade summary must identify the confirming contact", () => {
  it("shows Marc's confirmation text, not Julie's no-answer text, in Who is taking care of it", () => {
    const julieCall = familyCall();
    const marcCall = familyCall({
      id: "call_event_marc",
      contactId: "contact_marc",
      structuredResult: familyResult({
        contact_id: "contact_marc",
        answered: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "vers 18h00",
        summary: "Marc confirmed that he will visit Marie vers 18h00.",
      }),
    });

    const confirmation = findConfirmation([julieCall, marcCall], [julie, marc]);

    // This is exactly the "Who is taking care of it?" rendering expression.
    expect(confirmation?.result.summary).toBe("Marc confirmed that he will visit Marie vers 18h00.");
    expect(confirmation?.result.summary).not.toContain("did not answer");
  });
});

describe("describeAttentionOutcome — the binary operational outcome (DEC-011, \"Priority removed\")", () => {
  it('shows "No attention needed" for a clearly normal closed check-in', () => {
    const e = event({
      status: "CASE_CLOSED",
      decision: "LOG_AND_CLOSE",
      closedAt: new Date().toISOString(),
    });
    expect(describeAttentionOutcome(e)).toBe("No attention needed");
  });

  it('shows "Trusted circle contacted" once the cascade has started', () => {
    for (const status of [
      "ATTENTION_REQUIRED",
      "CALLING_TRUSTED_CONTACT",
      "CONTACT_DID_NOT_ANSWER",
      "CONTACT_DECLINED",
      "CONTACT_CONFIRMED",
      "CASE_CLOSED",
    ] as const) {
      const e = event({ status, decision: "CONTACT_TRUSTED_PERSON" });
      expect(describeAttentionOutcome(e)).toBe("Trusted circle contacted");
    }
  });

  it('shows "Attention unresolved" when every eligible contact has been exhausted', () => {
    const e = event({ status: "ATTENTION_UNRESOLVED", decision: "CONTACT_TRUSTED_PERSON" });
    expect(describeAttentionOutcome(e)).toBe("Attention unresolved");
  });

  it("shows nothing yet for an event with no decision, rather than guessing", () => {
    const e = event({ status: "CALLING_PERSON", decision: null });
    expect(describeAttentionOutcome(e)).toBeNull();
  });

  // events.priority was removed entirely (DEC-012). There is no longer a
  // `priority` property on EventRecord to pass in, which is itself the
  // strongest possible guarantee that no rendering path can depend on it —
  // enforced by the compiler, not by a runtime assertion.
});

describe("historical rows survive the events.priority column removal (DEC-012)", () => {
  // Before migration 0009 runs remotely, a raw database row can still carry a
  // `priority` column value the application has not written since DEC-011's
  // revision, and — mid-deployment, or against a database this migration has
  // not reached yet — could still contain one. `toEvent` must map such a row
  // exactly as it maps one that never had the column, and every rendering
  // helper downstream must keep working from that mapped result.
  it("toEvent ignores a legacy priority column instead of choking on it", () => {
    const legacyRow = {
      id: "event_001",
      run_id: "00000000-0000-0000-0000-000000000000",
      person_id: "person_marie",
      status: "CASE_CLOSED",
      // Not part of EventRow any more — simulates a not-yet-migrated row.
      priority: "medium",
      current_contact_priority: null,
      decision: "LOG_AND_CLOSE",
      decision_reason: "No attention signal detected.",
      created_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
    };

    const mapped = toEvent(legacyRow as EventRow);

    expect(mapped).not.toHaveProperty("priority");
    expect(mapped.status).toBe("CASE_CLOSED");
    expect(mapped.decision).toBe("LOG_AND_CLOSE");

    // And every rendering helper on the mapped result works exactly as it
    // would for a row that never had the column at all.
    expect(() => describeAction(mapped)).not.toThrow();
    expect(() => describeOwnership(mapped)).not.toThrow();
    expect(() => describeAttentionOutcome(mapped)).not.toThrow();
    expect(describeAction(mapped)).toBe(describeAction(event({ ...mapped })));
  });

  it("still renders a historical HUMAN_REVIEW_REQUIRED event without throwing", () => {
    // DEC-011 stopped producing this status; a historical row can still have
    // it, with or without a legacy priority value on the underlying row.
    const e = event({ status: "HUMAN_REVIEW_REQUIRED", decision: "REQUEST_HUMAN_REVIEW" });
    expect(() => describeAction(e)).not.toThrow();
    expect(() => describeOwnership(e)).not.toThrow();
    expect(() => describeAttentionOutcome(e)).not.toThrow();
  });
});
