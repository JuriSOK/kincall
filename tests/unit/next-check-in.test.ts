import { afterEach, describe, expect, it } from "vitest";
import {
  computeNextCheckIn,
  zonedWallClockToUtc,
  type CheckInSchedule,
} from "@/backend/scheduling/next-check-in";

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

function schedule(overrides: Partial<CheckInSchedule> = {}): CheckInSchedule {
  return {
    timezone: "Europe/Paris",
    preferredCallTime: "09:00",
    checkInDays: [1, 2, 3, 4, 5, 6, 7],
    scheduleState: "active",
    ...overrides,
  };
}

describe("computeNextCheckIn — schedule state", () => {
  it("returns no occurrence when paused", () => {
    const result = computeNextCheckIn(
      schedule({ scheduleState: "paused" }),
      new Date("2026-07-30T08:00:00.000Z")
    );
    expect(result).toEqual({ kind: "paused", nextOccurrenceIso: null });
  });

  it("returns no occurrence when inactive", () => {
    const result = computeNextCheckIn(
      schedule({ scheduleState: "inactive" }),
      new Date("2026-07-30T08:00:00.000Z")
    );
    expect(result).toEqual({ kind: "inactive", nextOccurrenceIso: null });
  });

  it("returns no occurrence when no day is selected", () => {
    const result = computeNextCheckIn(
      schedule({ checkInDays: [] }),
      new Date("2026-07-30T08:00:00.000Z")
    );
    expect(result).toEqual({ kind: "no_days_selected", nextOccurrenceIso: null });
  });
});

describe("computeNextCheckIn — ordinary daily schedule", () => {
  it("returns later today when the preferred time has not yet passed", () => {
    // 2026-07-30 is a Thursday. 06:00 UTC is 08:00 Europe/Paris (CEST,+2) —
    // still before the 09:00 preferred time.
    const result = computeNextCheckIn(schedule(), new Date("2026-07-30T06:00:00.000Z"));
    expect(result.kind).toBe("scheduled");
    expect(result.nextOccurrenceIso).toBe("2026-07-30T07:00:00.000Z"); // 09:00 CEST
  });

  it("moves to tomorrow once today's preferred time has already passed", () => {
    // 08:00 UTC = 10:00 CEST, already past 09:00 today.
    const result = computeNextCheckIn(schedule(), new Date("2026-07-30T08:00:00.000Z"));
    expect(result.kind).toBe("scheduled");
    expect(result.nextOccurrenceIso).toBe("2026-07-31T07:00:00.000Z"); // tomorrow 09:00 CEST
  });

  it("never returns an occurrence equal to `now` — strictly after", () => {
    // now is exactly 09:00:00.000 Paris time (07:00:00.000Z in summer).
    const result = computeNextCheckIn(schedule(), new Date("2026-07-30T07:00:00.000Z"));
    expect(result.nextOccurrenceIso).not.toBe("2026-07-30T07:00:00.000Z");
    expect(result.nextOccurrenceIso).toBe("2026-07-31T07:00:00.000Z");
  });
});

describe("computeNextCheckIn — selected weekdays and week wrap", () => {
  it("only returns an occurrence on a selected weekday", () => {
    // 2026-07-30 is Thursday (4), 2026-07-31 is Friday (5). Select only
    // Friday; from Thursday morning, the next occurrence must be Friday.
    const result = computeNextCheckIn(
      schedule({ checkInDays: [5] }),
      new Date("2026-07-30T06:00:00.000Z")
    );
    expect(result.kind).toBe("scheduled");
    expect(result.nextOccurrenceIso).toBe("2026-07-31T07:00:00.000Z");
  });

  it("wraps to next week when this week's only selected day has passed", () => {
    // 2026-07-30 is Thursday (4). Select only Monday (1): the next Monday is
    // 2026-08-03, five days later — the loop must wrap past the weekend.
    const result = computeNextCheckIn(
      schedule({ checkInDays: [1] }),
      new Date("2026-07-30T06:00:00.000Z")
    );
    expect(result.kind).toBe("scheduled");
    expect(result.nextOccurrenceIso).toBe("2026-08-03T07:00:00.000Z");
  });

  it("selects the correct occurrence among several selected weekdays", () => {
    // Mon/Wed/Fri selected; from Thursday, next is Friday, not next Monday.
    const result = computeNextCheckIn(
      schedule({ checkInDays: [1, 3, 5] }),
      new Date("2026-07-30T06:00:00.000Z")
    );
    expect(result.nextOccurrenceIso).toBe("2026-07-31T07:00:00.000Z");
  });
});

describe("computeNextCheckIn — deterministic across process timezones", () => {
  it("produces the same result regardless of the ambient process timezone", () => {
    const now = new Date("2026-07-30T08:00:00.000Z");
    const before = computeNextCheckIn(schedule(), now);

    process.env.TZ = "America/Los_Angeles";
    const after = computeNextCheckIn(schedule(), now);

    expect(after).toEqual(before);
  });

  it("computes correctly for a person in a different zone than the process", () => {
    process.env.TZ = "Europe/Paris";
    // Tokyo person, 09:00 JST (UTC+9, no DST) — should be entirely
    // unaffected by the process running in Europe/Paris.
    const result = computeNextCheckIn(
      schedule({ timezone: "Asia/Tokyo" }),
      new Date("2026-07-30T08:00:00.000Z") // 17:00 JST, already past 09:00
    );
    expect(result.nextOccurrenceIso).toBe("2026-07-31T00:00:00.000Z"); // 09:00 JST next day
  });
});

describe("zonedWallClockToUtc — Europe/Paris DST boundaries", () => {
  it("resolves a nonexistent spring-forward local time forward to the first valid instant", () => {
    // Clocks jump from 02:00 CET to 03:00 CEST at 2026-03-29T01:00:00Z.
    // 02:30 never happens that day; the documented rule resolves forward to
    // the exact moment the gap ends (03:00:00 local = 01:00:00Z).
    const result = zonedWallClockToUtc({ year: 2026, month: 3, day: 29 }, 2, 30, "Europe/Paris");
    expect(result.kind).toBe("gap");
    expect(new Date(result.utcMs).toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("resolves every nonexistent time within the gap to the same boundary instant", () => {
    const at0210 = zonedWallClockToUtc({ year: 2026, month: 3, day: 29 }, 2, 10, "Europe/Paris");
    const at0250 = zonedWallClockToUtc({ year: 2026, month: 3, day: 29 }, 2, 50, "Europe/Paris");
    expect(new Date(at0210.utcMs).toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(new Date(at0250.utcMs).toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("resolves an ordinary spring day (no transition) uniquely", () => {
    const result = zonedWallClockToUtc({ year: 2026, month: 3, day: 28 }, 9, 0, "Europe/Paris");
    expect(result.kind).toBe("unique");
    // 28 March 2026 is still CET (+1).
    expect(new Date(result.utcMs).toISOString()).toBe("2026-03-28T08:00:00.000Z");
  });

  it("resolves an ambiguous fall-back local time to the earlier (pre-transition) UTC instant", () => {
    // Clocks fall back from 03:00 CEST to 02:00 CET at 2026-10-25T01:00:00Z.
    // 02:30 occurs twice: once at 00:30Z (still CEST) and again at 01:30Z
    // (now CET). The documented rule picks the earlier UTC instant.
    const result = zonedWallClockToUtc({ year: 2026, month: 10, day: 25 }, 2, 30, "Europe/Paris");
    expect(result.kind).toBe("ambiguous");
    expect(new Date(result.utcMs).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("resolves an ordinary autumn day (no transition) uniquely", () => {
    const result = zonedWallClockToUtc({ year: 2026, month: 10, day: 26 }, 9, 0, "Europe/Paris");
    expect(result.kind).toBe("unique");
    // 26 October 2026 is already back to CET (+1).
    expect(new Date(result.utcMs).toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });
});

describe("computeNextCheckIn — full DST transition through the outer scan", () => {
  it("a Sunday-only schedule crossing the spring-forward boundary lands on the resolved gap instant", () => {
    // 2026-03-29 is a Sunday (7). Scanning forward from the previous
    // Thursday must land on the gap-resolved 03:00 CEST occurrence.
    const result = computeNextCheckIn(
      schedule({ checkInDays: [7], preferredCallTime: "02:30" }),
      new Date("2026-03-26T08:00:00.000Z")
    );
    expect(result.kind).toBe("scheduled");
    expect(result.nextOccurrenceIso).toBe("2026-03-29T01:00:00.000Z");
  });

  it("a Sunday-only schedule crossing the fall-back boundary lands on the earlier ambiguous instant", () => {
    // 2026-10-25 is a Sunday (7).
    const result = computeNextCheckIn(
      schedule({ checkInDays: [7], preferredCallTime: "02:30" }),
      new Date("2026-10-22T08:00:00.000Z")
    );
    expect(result.kind).toBe("scheduled");
    expect(result.nextOccurrenceIso).toBe("2026-10-25T00:30:00.000Z");
  });
});
