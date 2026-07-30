import { describe, expect, it } from "vitest";
import { buildMonthCalendar, shiftMonthKey } from "@/lib/history/calendar";
import { filterHistoryEvents } from "@/lib/history/filter-events";
import {
  buildHistoryEventView,
  categorizeEventOutcome,
  type HistoryEventView,
} from "@/lib/presentation/history-view";
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
    summary: "Fallback summary.",
    structuredResult: null,
    startedAt: "2026-07-30T09:00:00.000Z",
    endedAt: "2026-07-30T09:05:00.000Z",
    processingToken: null,
    processingStartedAt: null,
    resultProcessedAt: "2026-07-30T09:05:00.000Z",
    ...overrides,
  };
}

function view(overrides: Partial<HistoryEventView> = {}): HistoryEventView {
  return {
    eventId: "event_001",
    personId: "person_marie",
    personName: "Marie",
    avatarKey: null,
    createdAt: "2026-07-30T09:00:00.000Z",
    dayKey: "2026-07-30",
    status: "CASE_CLOSED",
    statusLabel: "All well at the last check-in",
    statusTone: "calm",
    category: "normal",
    summary: "Marie is doing fine.",
    href: "/events/event_001",
    ...overrides,
  };
}

describe("categorizeEventOutcome", () => {
  it("prioritises unresolved over a decision that also exists", () => {
    expect(
      categorizeEventOutcome(
        event({ status: "ATTENTION_UNRESOLVED", decision: "CONTACT_TRUSTED_PERSON" })
      )
    ).toBe("unresolved");
  });

  it("categorises a cascade by decision, regardless of final status", () => {
    expect(
      categorizeEventOutcome(event({ status: "CASE_CLOSED", decision: "CONTACT_TRUSTED_PERSON" }))
    ).toBe("cascade");
  });

  it("categorises LOG_AND_CLOSE as normal", () => {
    expect(categorizeEventOutcome(event({ decision: "LOG_AND_CLOSE" }))).toBe("normal");
  });

  it("returns null (no marker) for an event with no decision yet", () => {
    expect(
      categorizeEventOutcome(event({ status: "CALLING_PERSON", decision: null }))
    ).toBeNull();
  });
});

describe("buildHistoryEventView", () => {
  it("prefers the Companion's neutral summary when a usable one exists", () => {
    const companionResult = {
      neutral_summary: "Marie mentioned a fall.",
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
    };
    const v = buildHistoryEventView(event(), "Marie", [
      callEvent({ structuredResult: companionResult, summary: "raw summary" }),
    ]);
    expect(v.summary).toBe("Marie mentioned a fall.");
  });

  it("falls back to the call summary, then to the action description", () => {
    const withCallSummary = buildHistoryEventView(event(), "Marie", [
      callEvent({ structuredResult: null, summary: "A plain call summary." }),
    ]);
    expect(withCallSummary.summary).toBe("A plain call summary.");

    const withNoCallsAtAll = buildHistoryEventView(event({ status: "SCHEDULED", decision: null }), "Marie", []);
    expect(withNoCallsAtAll.summary).toBe("Check-in in progress.");
  });

  it("never renders a raw status enum in statusLabel", () => {
    const v = buildHistoryEventView(event({ status: "ATTENTION_UNRESOLVED" }), "Marie", []);
    expect(v.statusLabel).not.toBe("ATTENTION_UNRESOLVED");
    expect(v.statusLabel.toLowerCase()).toContain("unresolved");
  });

  it("carries the correct href and person association", () => {
    const v = buildHistoryEventView(event({ id: "event_042", personId: "person_sophie" }), "Sophie", []);
    expect(v.href).toBe("/events/event_042");
    expect(v.personId).toBe("person_sophie");
    expect(v.personName).toBe("Sophie");
  });
});

describe("filterHistoryEvents", () => {
  const views = [
    view({ eventId: "e1", personId: "person_marie", personName: "Marie", dayKey: "2026-07-30", category: "normal", summary: "Marie mentioned a fall." }),
    view({ eventId: "e2", personId: "person_sophie", personName: "Sophie", dayKey: "2026-07-15", category: "unresolved", summary: "Nobody could be reached." }),
  ];

  it("filters by personId", () => {
    expect(filterHistoryEvents(views, { personId: "person_marie" }).map((v) => v.eventId)).toEqual([
      "e1",
    ]);
  });

  it("filters by outcome category", () => {
    expect(filterHistoryEvents(views, { category: "unresolved" }).map((v) => v.eventId)).toEqual([
      "e2",
    ]);
  });

  it("filters by inclusive date range against dayKey", () => {
    expect(
      filterHistoryEvents(views, { from: "2026-07-20", to: "2026-07-31" }).map((v) => v.eventId)
    ).toEqual(["e1"]);
  });

  it("searches person name and summary, case-insensitively", () => {
    expect(filterHistoryEvents(views, { query: "sophie" }).map((v) => v.eventId)).toEqual(["e2"]);
    expect(filterHistoryEvents(views, { query: "FALL" }).map((v) => v.eventId)).toEqual(["e1"]);
    expect(filterHistoryEvents(views, { query: "nonexistent" })).toEqual([]);
  });

  it("combines filters with AND semantics", () => {
    expect(
      filterHistoryEvents(views, { personId: "person_marie", query: "nobody" })
    ).toEqual([]);
  });

  it("returns everything when no filter is set", () => {
    expect(filterHistoryEvents(views, {})).toHaveLength(2);
  });
});

describe("buildMonthCalendar", () => {
  it("emits exactly one marker per day of the month, in order", () => {
    const markers = buildMonthCalendar("2026-07", []);
    expect(markers).toHaveLength(31);
    expect(markers[0]).toEqual({
      dayKey: "2026-07-01",
      dayOfMonth: 1,
      hasNormal: false,
      hasCascade: false,
      hasUnresolved: false,
      hasEvents: false,
    });
    expect(markers.map((m) => m.dayOfMonth)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("handles a 28-day February correctly", () => {
    expect(buildMonthCalendar("2026-02", [])).toHaveLength(28);
  });

  it("marks each category on the correct day", () => {
    const events = [
      event({ id: "e1", createdAt: "2026-07-05T09:00:00.000Z", decision: "LOG_AND_CLOSE" }),
      event({
        id: "e2",
        createdAt: "2026-07-10T09:00:00.000Z",
        decision: "CONTACT_TRUSTED_PERSON",
      }),
      event({
        id: "e3",
        createdAt: "2026-07-15T09:00:00.000Z",
        status: "ATTENTION_UNRESOLVED",
        decision: "CONTACT_TRUSTED_PERSON",
      }),
    ];
    const markers = buildMonthCalendar("2026-07", events);
    expect(markers[4]).toMatchObject({ hasNormal: true, hasCascade: false, hasUnresolved: false });
    expect(markers[9]).toMatchObject({ hasNormal: false, hasCascade: true, hasUnresolved: false });
    expect(markers[14]).toMatchObject({ hasNormal: false, hasCascade: false, hasUnresolved: true });
  });

  it("ignores events outside the requested month", () => {
    // Unambiguously mid-June regardless of the Paris/UTC offset (never a
    // day-boundary edge case, unlike a timestamp right at month's end).
    const events = [event({ createdAt: "2026-06-15T12:00:00.000Z" })];
    const markers = buildMonthCalendar("2026-07", events);
    expect(markers.every((m) => !m.hasEvents)).toBe(true);
  });

  it("marks hasEvents even for an event with no decision yet", () => {
    const events = [event({ createdAt: "2026-07-05T09:00:00.000Z", status: "SCHEDULED", decision: null })];
    const markers = buildMonthCalendar("2026-07", events);
    expect(markers[4]).toMatchObject({
      hasEvents: true,
      hasNormal: false,
      hasCascade: false,
      hasUnresolved: false,
    });
  });
});

describe("shiftMonthKey", () => {
  it("moves forward and backward within a year", () => {
    expect(shiftMonthKey("2026-07", 1)).toBe("2026-08");
    expect(shiftMonthKey("2026-07", -1)).toBe("2026-06");
  });

  it("rolls over a year boundary in both directions", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });
});
