import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_PERIOD,
  PROFILE_PERIOD_OPTIONS,
  parseProfilePeriod,
  profilePeriodOption,
  profilePeriodSince,
} from "@/backend/kpi/period";

describe("PROFILE_PERIOD_OPTIONS", () => {
  it("offers exactly Day, Week, Month, Year with the recommended day counts", () => {
    expect(PROFILE_PERIOD_OPTIONS.map((option) => option.key)).toEqual([
      "day",
      "week",
      "month",
      "year",
    ]);
    expect(PROFILE_PERIOD_OPTIONS.map((option) => option.days)).toEqual([1, 7, 30, 365]);
  });
});

describe("parseProfilePeriod", () => {
  it("accepts every known key", () => {
    for (const option of PROFILE_PERIOD_OPTIONS) {
      expect(parseProfilePeriod(option.key)).toBe(option.key);
    }
  });

  it("falls back to the default for undefined, unknown, or a repeated query param — never guesses", () => {
    expect(parseProfilePeriod(undefined)).toBe(DEFAULT_PROFILE_PERIOD);
    expect(parseProfilePeriod("not-a-real-period")).toBe(DEFAULT_PROFILE_PERIOD);
    expect(parseProfilePeriod(["week", "year"])).toBe("week");
    expect(parseProfilePeriod(["not-a-real-period"])).toBe(DEFAULT_PROFILE_PERIOD);
  });
});

describe("profilePeriodOption / profilePeriodSince", () => {
  it("computes the inclusive lower bound as exactly N days before now", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    expect(profilePeriodSince("day", now)).toBe("2026-07-31T12:00:00.000Z");
    expect(profilePeriodSince("week", now)).toBe("2026-07-25T12:00:00.000Z");
    expect(profilePeriodSince("month", now)).toBe("2026-07-02T12:00:00.000Z");
    expect(profilePeriodSince("year", now)).toBe("2025-08-01T12:00:00.000Z");
  });

  it("resolves each key to its matching option", () => {
    expect(profilePeriodOption("day").days).toBe(1);
    expect(profilePeriodOption("year").days).toBe(365);
  });
});
