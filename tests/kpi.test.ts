import { describe, expect, it } from "vitest";
import {
  computeCheckInKpis,
  groupCallEventsByEvent,
} from "@/lib/kpi/dashboard-kpis";
import { DEFAULT_PERIOD, parsePeriod, periodOption, periodSince } from "@/lib/kpi/period";
import type { CallEventRecord, EventRecord } from "@/lib/database/types";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event_001",
    runId: "00000000-0000-0000-0000-000000000000",
    personId: "person_marie",
    status: "CASE_CLOSED",
    currentContactPriority: null,
    decision: "LOG_AND_CLOSE",
    decisionReason: null,
    createdAt: "2026-07-30T09:00:00.000Z",
    closedAt: "2026-07-30T09:10:00.000Z",
    ...overrides,
  };
}

function callEvent(overrides: Partial<CallEventRecord> = {}): CallEventRecord {
  return {
    id: "call_event_001",
    eventId: "event_001",
    agentType: "companion",
    contactId: null,
    attemptNumber: 1,
    calleCallId: "calle_1",
    idempotencyKey: "key_1",
    status: "completed",
    summary: "Marie is doing fine.",
    structuredResult: null,
    startedAt: "2026-07-30T09:00:00.000Z",
    endedAt: "2026-07-30T09:05:00.000Z",
    processingToken: null,
    processingStartedAt: null,
    resultProcessedAt: "2026-07-30T09:05:00.000Z",
    ...overrides,
  };
}

const COMPANION_REACHED = {
  neutral_summary: "Marie says she is fine.",
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
};

const COMPANION_NOT_REACHED = { ...COMPANION_REACHED, person_reached: "no" };

function familyResult(canIntervene: "yes" | "no" | "unknown") {
  return {
    contact_id: "contact_julie",
    answered: canIntervene === "yes" ? "yes" : "no",
    situation_understood: "yes",
    can_intervene: canIntervene,
    intervention_type: canIntervene === "yes" ? "visit" : "other",
    estimated_time: canIntervene === "yes" ? "17:30" : "",
    contact_next_person: canIntervene === "yes" ? "no" : "yes",
    summary: "Julie's call.",
  };
}

describe("period", () => {
  it("defaults on missing, unknown, or repeated-and-ambiguous values", () => {
    expect(parsePeriod(undefined)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod("1y")).toBe(DEFAULT_PERIOD);
    expect(parsePeriod([])).toBe(DEFAULT_PERIOD);
  });

  it("accepts each known key, including the first of a repeated query param", () => {
    expect(parsePeriod("7d")).toBe("7d");
    expect(parsePeriod("30d")).toBe("30d");
    expect(parsePeriod("3m")).toBe("3m");
    expect(parsePeriod(["7d", "30d"])).toBe("7d");
  });

  it("computes since as exactly N days before `now`, in whole days", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(periodSince("7d", now)).toBe("2026-07-23T12:00:00.000Z");
    expect(periodSince("30d", now)).toBe("2026-06-30T12:00:00.000Z");
    expect(periodOption("3m").days).toBe(90);
  });
});

describe("groupCallEventsByEvent", () => {
  it("groups a flat batch read by eventId, preserving input order within each group", () => {
    const calls = [
      callEvent({ id: "c1", eventId: "event_001" }),
      callEvent({ id: "c2", eventId: "event_002" }),
      callEvent({ id: "c3", eventId: "event_001" }),
    ];
    const grouped = groupCallEventsByEvent(calls);
    expect(grouped.get("event_001")?.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(grouped.get("event_002")?.map((c) => c.id)).toEqual(["c2"]);
    expect(grouped.get("event_003")).toBeUndefined();
  });
});

describe("computeCheckInKpis", () => {
  it("never divides by zero: every rate is 'not enough data' over no events", () => {
    const kpis = computeCheckInKpis([], new Map());
    expect(kpis.totalCheckIns).toBe(0);
    expect(kpis.normalCheckIns).toEqual({ count: 0, total: 0, percentage: null });
    expect(kpis.cascadesTriggered).toEqual({ count: 0, total: 0, percentage: null });
    expect(kpis.personReached).toEqual({ count: 0, total: 0, percentage: null });
    expect(kpis.meanFamilyAttemptsBeforeConfirmation).toEqual({ mean: null, sampleSize: 0 });
    expect(kpis.attentionUnresolvedCount).toBe(0);
  });

  it("counts normal check-ins by decision, not by status", () => {
    const events = [
      event({ id: "e1", decision: "LOG_AND_CLOSE" }),
      event({ id: "e2", decision: "CONTACT_TRUSTED_PERSON" }),
    ];
    const kpis = computeCheckInKpis(events, new Map());
    expect(kpis.normalCheckIns).toEqual({ count: 1, total: 2, percentage: 50 });
  });

  it("counts a cascade as any event with at least one Family call event", () => {
    const events = [event({ id: "e1" }), event({ id: "e2" })];
    const byEvent = groupCallEventsByEvent([
      callEvent({ id: "c1", eventId: "e1", agentType: "family", contactId: "contact_julie" }),
    ]);
    const kpis = computeCheckInKpis(events, byEvent);
    expect(kpis.cascadesTriggered).toEqual({ count: 1, total: 2, percentage: 50 });
  });

  it("counts ATTENTION_UNRESOLVED by status", () => {
    const events = [
      event({ id: "e1", status: "ATTENTION_UNRESOLVED", decision: "CONTACT_TRUSTED_PERSON" }),
      event({ id: "e2", status: "CASE_CLOSED" }),
    ];
    expect(computeCheckInKpis(events, new Map()).attentionUnresolvedCount).toBe(1);
  });

  it("person-reached rate is over usable completed Companion results only", () => {
    const events = [event({ id: "e1" }), event({ id: "e2" }), event({ id: "e3" })];
    const byEvent = groupCallEventsByEvent([
      callEvent({ id: "c1", eventId: "e1", structuredResult: COMPANION_REACHED }),
      callEvent({ id: "c2", eventId: "e2", structuredResult: COMPANION_NOT_REACHED }),
      // Still in progress: not a completed result, so excluded from the
      // denominator entirely — not counted as "not reached".
      callEvent({ id: "c3", eventId: "e3", resultProcessedAt: null, structuredResult: null }),
    ]);
    const kpis = computeCheckInKpis(events, byEvent);
    expect(kpis.personReached).toEqual({ count: 1, total: 2, percentage: 50 });
  });

  it("excludes a malformed structured result from the person-reached denominator", () => {
    const events = [event({ id: "e1" })];
    const byEvent = groupCallEventsByEvent([
      callEvent({ id: "c1", eventId: "e1", structuredResult: { garbage: true } }),
    ]);
    expect(computeCheckInKpis(events, byEvent).personReached).toEqual({
      count: 0,
      total: 0,
      percentage: null,
    });
  });

  it("uses only the LAST companion call when a retry occurred", () => {
    const events = [event({ id: "e1" })];
    const byEvent = groupCallEventsByEvent([
      callEvent({
        id: "c1",
        eventId: "e1",
        attemptNumber: 1,
        structuredResult: COMPANION_NOT_REACHED,
      }),
      callEvent({
        id: "c2",
        eventId: "e1",
        attemptNumber: 2,
        structuredResult: COMPANION_REACHED,
      }),
    ]);
    expect(computeCheckInKpis(events, byEvent).personReached).toEqual({
      count: 1,
      total: 1,
      percentage: 100,
    });
  });

  it("counts family attempts up to and including the confirming call", () => {
    const events = [event({ id: "e1" })];
    const byEvent = groupCallEventsByEvent([
      callEvent({
        id: "c1",
        eventId: "e1",
        agentType: "family",
        contactId: "contact_julie",
        structuredResult: familyResult("no"),
      }),
      callEvent({
        id: "c2",
        eventId: "e1",
        agentType: "family",
        contactId: "contact_marc",
        structuredResult: familyResult("yes"),
      }),
    ]);
    const kpis = computeCheckInKpis(events, byEvent);
    expect(kpis.meanFamilyAttemptsBeforeConfirmation).toEqual({ mean: 2, sampleSize: 1 });
  });

  it("excludes an event with no confirming call from the attempts mean", () => {
    const events = [event({ id: "e1" })];
    const byEvent = groupCallEventsByEvent([
      callEvent({
        id: "c1",
        eventId: "e1",
        agentType: "family",
        contactId: "contact_julie",
        structuredResult: familyResult("no"),
      }),
    ]);
    expect(computeCheckInKpis(events, byEvent).meanFamilyAttemptsBeforeConfirmation).toEqual({
      mean: null,
      sampleSize: 0,
    });
  });

  it("a per-person summary is the same function over that person's own events", () => {
    // The point: there is no separate "per-person" formula to drift from the
    // global one — a caller subsets `events` first and gets an identical shape.
    const all = [
      event({ id: "e1", personId: "person_marie" }),
      event({ id: "e2", personId: "person_sophie", decision: "CONTACT_TRUSTED_PERSON" }),
    ];
    const marieOnly = all.filter((e) => e.personId === "person_marie");
    const kpis = computeCheckInKpis(marieOnly, new Map());
    expect(kpis.totalCheckIns).toBe(1);
    expect(kpis.normalCheckIns).toEqual({ count: 1, total: 1, percentage: 100 });
  });
});
