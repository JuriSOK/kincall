import { afterEach, describe, expect, it } from "vitest";
import {
  DISPLAY_TIME_ZONE,
  formatDateTime,
  formatDayKey,
  formatDayLabel,
  formatMonthKey,
  formatMonthLabel,
  formatTime,
} from "@/lib/presentation/format-date";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("format-date — Europe/Paris display timezone", () => {
  it("is fixed to Europe/Paris regardless of the ambient process timezone", () => {
    // Every formatter in the module passes `timeZone: DISPLAY_TIME_ZONE`
    // explicitly, so its output must be identical no matter what the
    // process's own default timezone happens to be (Vercel's region, a
    // developer's machine) — this is the property that makes server-rendered
    // output deterministic. Flip TZ mid-test and assert nothing changes.
    expect(DISPLAY_TIME_ZONE).toBe("Europe/Paris");

    const instant = "2026-07-30T10:15:00.000Z";
    const before = { dt: formatDateTime(instant), time: formatTime(instant), day: formatDayKey(instant) };

    process.env.TZ = "America/Los_Angeles";
    const after = { dt: formatDateTime(instant), time: formatTime(instant), day: formatDayKey(instant) };

    expect(after).toEqual(before);
  });

  it("renders summer instants at UTC+2 (CEST)", () => {
    // The exact separator between date and time is ICU-version-dependent
    // (a comma on some ICU builds, a space on others); the offset — 12:15,
    // not 10:15 — is the fact this test exists to pin down.
    expect(formatDateTime("2026-07-30T10:15:00.000Z")).toMatch(/^30\/07\/2026.+12:15$/);
    expect(formatTime("2026-07-30T10:15:00.000Z")).toBe("12:15");
  });

  it("renders winter instants at UTC+1 (CET) — a different offset than summer", () => {
    expect(formatDateTime("2026-01-15T10:00:00.000Z")).toMatch(/^15\/01\/2026.+11:00$/);
    expect(formatTime("2026-01-15T10:00:00.000Z")).toBe("11:00");
  });

  it("formatDayKey produces a sortable, comparable YYYY-MM-DD grouping key", () => {
    expect(formatDayKey("2026-07-30T22:30:00.000Z")).toBe("2026-07-31");
    expect(formatDayKey("2026-01-15T10:00:00.000Z")).toBe("2026-01-15");
  });

  it("formatDayKey correctly shifts an instant across the UTC day boundary", () => {
    // 23:30 UTC in July is 01:30 the NEXT day in Paris (UTC+2) — a naive
    // UTC-only day key would get this wrong.
    expect(formatDayKey("2026-07-15T23:30:00.000Z")).toBe("2026-07-16");
  });

  it("round-trips a day key to a human label without drifting a day either way", () => {
    expect(formatDayLabel("2026-07-30")).toBe("30 juillet 2026");
    expect(formatDayLabel("2026-01-01")).toBe("1 janvier 2026");
  });

  it("derives and labels a month key from a day key", () => {
    expect(formatMonthKey("2026-07-30")).toBe("2026-07");
    expect(formatMonthLabel("2026-07")).toBe("juillet 2026");
  });
});
