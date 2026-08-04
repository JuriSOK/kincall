import { describe, expect, it } from "vitest";
import { computeDailyRecapStatus } from "@/backend/dashboard/daily-recap-status";
import type { EventRecord } from "@/shared/domain/types";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event_001",
    runId: "00000000-0000-0000-0000-000000000000",
    personId: "person_marie",
    status: "CASE_CLOSED",
    currentContactPriority: null,
    decision: "LOG_AND_CLOSE",
    decisionReason: null,
    createdAt: "2026-08-02T09:00:00.000Z",
    closedAt: "2026-08-02T09:10:00.000Z",
    ...overrides,
  };
}

const PARIS = "Europe/Paris"; // UTC+2 (CEST) in August.
const HONOLULU = "Pacific/Honolulu"; // Fixed UTC-10, no DST — deterministic.

describe("computeDailyRecapStatus", () => {
  it("shows today's actual result for an event earlier today", () => {
    // now: 2026-08-02T12:00 Paris local (10:00 UTC). Event: 09:00 UTC = 11:00
    // Paris local, same local day.
    const now = new Date("2026-08-02T10:00:00.000Z");
    const todaysEvent = event({
      id: "event_today",
      createdAt: "2026-08-02T09:00:00.000Z",
      status: "CASE_CLOSED",
      decision: "LOG_AND_CLOSE",
    });

    const result = computeDailyRecapStatus([todaysEvent], PARIS, now);

    expect(result.todaysEvent?.id).toBe("event_today");
    expect(result.label).not.toBe("Not checked in yet");
    expect(result.tone).toBe("calm");
  });

  it("does NOT treat an event from yesterday as checked-in, even when less than 24 hours old", () => {
    // now: 2026-08-02T02:30 Paris local (00:30 UTC) — just after Paris local
    // midnight, so "today" is Aug 2. The event is only ~3.5 hours old but
    // fell on Aug 1 local (21:00 UTC = 23:00 Paris, the previous local day).
    // A rolling 24h window would wrongly call this "checked in"; the daily
    // reset must not.
    const now = new Date("2026-08-02T00:30:00.000Z");
    const recentButYesterday = event({
      id: "event_late_yesterday",
      createdAt: "2026-08-01T21:00:00.000Z",
    });

    const result = computeDailyRecapStatus([recentButYesterday], PARIS, now);

    expect(result.label).toBe("Not checked in yet");
    expect(result.tone).toBe("unknown");
    expect(result.todaysEvent).toBeNull();
  });

  it("resolves the local-midnight boundary correctly on both sides", () => {
    // Paris local midnight (Aug 2 00:00 CEST) is 2026-08-01T22:00:00Z.
    const now = new Date("2026-08-02T10:00:00.000Z"); // Aug 2 local, clearly.

    const justBeforeMidnight = event({
      id: "event_before",
      createdAt: "2026-08-01T21:59:00.000Z", // Aug 1, 23:59 Paris — yesterday.
    });
    const justAfterMidnight = event({
      id: "event_after",
      createdAt: "2026-08-01T22:01:00.000Z", // Aug 2, 00:01 Paris — today.
    });

    expect(computeDailyRecapStatus([justBeforeMidnight], PARIS, now).todaysEvent).toBeNull();
    expect(computeDailyRecapStatus([justAfterMidnight], PARIS, now).todaysEvent?.id).toBe(
      "event_after"
    );
  });

  it("uses each person's OWN persisted timezone, not a shared or server zone", () => {
    // Same event and "now" instants, evaluated against two different person
    // timezones 12 hours apart (Paris UTC+2 vs Honolulu UTC-10): the event
    // crosses Paris's local midnight between its own creation and `now`, but
    // does not cross Honolulu's — so the two timezones must disagree about
    // whether this is "today".
    const createdAt = "2026-08-02T20:00:00.000Z";
    const now = new Date("2026-08-03T04:00:00.000Z");
    const sharedEvent = event({ id: "event_shared", createdAt });

    const parisResult = computeDailyRecapStatus([sharedEvent], PARIS, now);
    const honoluluResult = computeDailyRecapStatus([sharedEvent], HONOLULU, now);

    expect(parisResult.todaysEvent).toBeNull(); // Aug 2 22:00 Paris vs "now" Aug 3 06:00 Paris.
    expect(honoluluResult.todaysEvent?.id).toBe("event_shared"); // Aug 2 10:00 vs "now" Aug 2 18:00 Honolulu.
  });

  it("resets to 'Not checked in yet' on a new day even though yesterday's event still exists", () => {
    const yesterdaysEvent = event({
      id: "event_yesterday",
      createdAt: "2026-08-02T09:00:00.000Z",
      status: "CASE_CLOSED",
      decision: "LOG_AND_CLOSE",
    });

    const sameDayNow = new Date("2026-08-02T12:00:00.000Z");
    const nextDayNow = new Date("2026-08-03T12:00:00.000Z");

    expect(computeDailyRecapStatus([yesterdaysEvent], PARIS, sameDayNow).todaysEvent?.id).toBe(
      "event_yesterday"
    );

    const nextDay = computeDailyRecapStatus([yesterdaysEvent], PARIS, nextDayNow);
    expect(nextDay.label).toBe("Not checked in yet");
    expect(nextDay.todaysEvent).toBeNull();
  });

  it("selects the LATEST of multiple events today, regardless of array order", () => {
    const earlier = event({
      id: "event_morning",
      createdAt: "2026-08-02T07:00:00.000Z",
      status: "CASE_CLOSED",
      decision: "LOG_AND_CLOSE",
    });
    const later = event({
      id: "event_afternoon",
      createdAt: "2026-08-02T13:00:00.000Z",
      status: "ATTENTION_UNRESOLVED",
      decision: null,
    });
    const now = new Date("2026-08-02T18:00:00.000Z");

    const forwardOrder = computeDailyRecapStatus([earlier, later], PARIS, now);
    const reverseOrder = computeDailyRecapStatus([later, earlier], PARIS, now);

    for (const result of [forwardOrder, reverseOrder]) {
      expect(result.todaysEvent?.id).toBe("event_afternoon");
      expect(result.tone).toBe("unresolved");
    }
  });

  it("never falls back to a rolling last-24-hours calculation", () => {
    // An event exactly 23 hours before `now` but on the previous Paris local
    // day must still read as "not today" — proving the boundary is the local
    // calendar day, not a fixed duration.
    const now = new Date("2026-08-02T01:00:00.000Z"); // Aug 2, 03:00 Paris.
    const twentyThreeHoursAgo = event({
      id: "event_23h_ago",
      createdAt: "2026-08-01T02:00:00.000Z", // Aug 1, 04:00 Paris — yesterday.
    });

    expect(computeDailyRecapStatus([twentyThreeHoursAgo], PARIS, now).todaysEvent).toBeNull();
  });

  it("reports 'Not checked in yet' when the person has no events at all", () => {
    const result = computeDailyRecapStatus([], PARIS, new Date("2026-08-02T10:00:00.000Z"));
    expect(result.label).toBe("Not checked in yet");
    expect(result.todaysEvent).toBeNull();
  });
});
