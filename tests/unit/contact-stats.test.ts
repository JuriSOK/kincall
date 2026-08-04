import { describe, expect, it } from "vitest";
import type { CallEventRecord } from "@/shared/domain/types";
import { computeContactStats, computeContactStatsByContact } from "@/backend/kpi/contact-stats";

function familyCall(overrides: Partial<CallEventRecord> = {}): CallEventRecord {
  return {
    id: "call_event_001",
    eventId: "event_001",
    agentType: "family",
    contactId: "contact_julie",
    attemptNumber: 1,
    calleCallId: "calle_1",
    idempotencyKey: "key_1",
    status: "completed",
    summary: "No answer.",
    structuredResult: {
      contact_id: "contact_julie",
      answered: "no",
      situation_understood: "unknown",
      can_intervene: "no",
      intervention_type: "other",
      estimated_time: "",
      contact_next_person: "yes",
      summary: "No answer.",
    },
    startedAt: "2026-07-01T09:00:00.000Z",
    endedAt: "2026-07-01T09:01:00.000Z",
    processingToken: null,
    processingStartedAt: null,
    resultProcessedAt: "2026-07-01T09:01:00.000Z",
    ...overrides,
  };
}

describe("computeContactStats — sample counts and 'not enough data'", () => {
  it("reports zero sample size for a contact never called", () => {
    const stats = computeContactStats([]);
    expect(stats.timesContacted).toBe(0);
    expect(stats.answerRate).toEqual({ count: 0, total: 0, percentage: null });
    expect(stats.acceptanceRate).toEqual({ count: 0, total: 0, percentage: null });
    expect(stats.meanAttemptWhenAnswering).toEqual({ mean: null, sampleSize: 0 });
    expect(stats.latestParticipationIso).toBeNull();
    expect(stats.confirmedInterventions).toBe(0);
  });

  it("never shows a fabricated 0% acceptance rate when nobody has answered yet", () => {
    // The default fixture is already an unanswered call.
    const stats = computeContactStats([familyCall()]);
    expect(stats.timesContacted).toBe(1);
    expect(stats.answerRate).toEqual({ count: 0, total: 1, percentage: 0 });
    // Nobody answered, so the "among answered calls" denominator is 0 — not
    // enough data, never a misleading 0%.
    expect(stats.acceptanceRate.total).toBe(0);
    expect(stats.acceptanceRate.percentage).toBeNull();
  });
});

describe("computeContactStats — answer, acceptance and decline rates", () => {
  it("computes answer rate against every call placed", () => {
    const calls = [
      familyCall({ id: "c1", attemptNumber: 1 }), // no answer
      familyCall({
        id: "c2",
        attemptNumber: 2,
        structuredResult: {
          contact_id: "contact_julie",
          answered: "yes",
          situation_understood: "yes",
          can_intervene: "yes",
          intervention_type: "visit",
          estimated_time: "18:00",
          contact_next_person: "no",
          summary: "Confirmed.",
        },
      }),
    ];
    const stats = computeContactStats(calls);
    expect(stats.timesContacted).toBe(2);
    expect(stats.answerRate).toEqual({ count: 1, total: 2, percentage: 50 });
  });

  it("computes acceptance and decline as complementary rates among answered calls only", () => {
    const answeredAccepts = familyCall({
      id: "c1",
      structuredResult: {
        contact_id: "contact_julie",
        answered: "yes",
        situation_understood: "yes",
        can_intervene: "yes",
        intervention_type: "visit",
        estimated_time: "18:00",
        contact_next_person: "no",
        summary: "Confirmed.",
      },
    });
    const answeredDeclines = familyCall({
      id: "c2",
      structuredResult: {
        contact_id: "contact_julie",
        answered: "yes",
        situation_understood: "yes",
        can_intervene: "no",
        intervention_type: "other",
        estimated_time: "",
        contact_next_person: "yes",
        summary: "Cannot help.",
      },
    });
    const noAnswer = familyCall({ id: "c3" }); // excluded from both denominators

    const stats = computeContactStats([answeredAccepts, answeredDeclines, noAnswer]);

    expect(stats.acceptanceRate).toEqual({ count: 1, total: 2, percentage: 50 });
    expect(stats.declineRate).toEqual({ count: 1, total: 2, percentage: 50 });
    expect(stats.confirmedInterventions).toBe(1);
  });

  it("treats an unreadable/malformed structured result as unanswered, not as a decline", () => {
    const stats = computeContactStats([familyCall({ structuredResult: { garbage: true } })]);
    expect(stats.answerRate).toEqual({ count: 0, total: 1, percentage: 0 });
    expect(stats.acceptanceRate.total).toBe(0);
  });
});

describe("computeContactStats — mean attempt and latest participation", () => {
  it("computes the mean attempt number only over calls that were answered", () => {
    const stats = computeContactStats([
      familyCall({ id: "c1", attemptNumber: 1 }), // no answer, excluded
      familyCall({
        id: "c2",
        attemptNumber: 2,
        structuredResult: {
          contact_id: "contact_julie",
          answered: "yes",
          situation_understood: "yes",
          can_intervene: "no",
          intervention_type: "other",
          estimated_time: "",
          contact_next_person: "yes",
          summary: "Declined.",
        },
      }),
    ]);
    expect(stats.meanAttemptWhenAnswering).toEqual({ mean: 2, sampleSize: 1 });
  });

  it("reports the most recent call's startedAt as latest participation", () => {
    const stats = computeContactStats([
      familyCall({ id: "c1", startedAt: "2026-01-01T09:00:00.000Z" }),
      familyCall({ id: "c2", startedAt: "2026-06-01T09:00:00.000Z" }),
      familyCall({ id: "c3", startedAt: "2026-03-01T09:00:00.000Z" }),
    ]);
    expect(stats.latestParticipationIso).toBe("2026-06-01T09:00:00.000Z");
  });
});

describe("computeContactStatsByContact — batching", () => {
  it("groups by contactId in one pass, keyed correctly", () => {
    const julieCall = familyCall({ id: "c1", contactId: "contact_julie" });
    const marcCall = familyCall({ id: "c2", contactId: "contact_marc" });

    const byContact = computeContactStatsByContact([julieCall, marcCall]);

    expect(byContact.get("contact_julie")?.timesContacted).toBe(1);
    expect(byContact.get("contact_marc")?.timesContacted).toBe(1);
    expect(byContact.has("contact_nicole")).toBe(false);
  });

  it("ignores companion call events entirely", () => {
    const companionCall = familyCall({
      id: "c1",
      agentType: "companion",
      contactId: null,
    });
    const byContact = computeContactStatsByContact([companionCall]);
    expect(byContact.size).toBe(0);
  });
});
