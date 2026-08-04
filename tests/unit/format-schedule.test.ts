import { describe, expect, it } from "vitest";
import {
  formatCheckInDays,
  formatNextCheckIn,
  formatOccurrence,
  SCHEDULE_STATE_LABEL,
  WEEKDAYS,
} from "@/shared/presentation/format-schedule";
import type { NextCheckInResult } from "@/backend/scheduling/next-check-in";

describe("formatCheckInDays", () => {
  it("renders every day as a short label, never the raw array", () => {
    expect(formatCheckInDays([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
  });

  it("renders an empty selection as a plain-language fallback", () => {
    expect(formatCheckInDays([])).toBe("No days selected");
  });

  it("renders a partial selection as ordered short labels", () => {
    expect(formatCheckInDays([5, 1, 3])).toBe("Mon, Wed, Fri");
  });

  it("WEEKDAYS covers all seven ISO weekdays exactly once", () => {
    expect(WEEKDAYS.map((day) => day.value).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("SCHEDULE_STATE_LABEL", () => {
  it("provides a plain-language label for every stored schedule_state value", () => {
    expect(SCHEDULE_STATE_LABEL.active).toBe("Active");
    expect(SCHEDULE_STATE_LABEL.paused).toBe("Paused");
    expect(SCHEDULE_STATE_LABEL.inactive).toBe("Inactive");
  });
});

describe("formatOccurrence", () => {
  const now = new Date("2026-07-30T06:00:00.000Z"); // Thursday, 08:00 Europe/Paris

  it("labels an occurrence later the same zoned day as Today", () => {
    const label = formatOccurrence("2026-07-30T07:00:00.000Z", "Europe/Paris", now); // 09:00 CEST
    expect(label).toBe("Today at 09:00 (Europe/Paris)");
  });

  it("labels an occurrence on the next zoned day as Tomorrow", () => {
    const label = formatOccurrence("2026-07-31T07:00:00.000Z", "Europe/Paris", now);
    expect(label).toBe("Tomorrow at 09:00 (Europe/Paris)");
  });

  it("labels a further-out occurrence with a full date, never bare relative text", () => {
    const label = formatOccurrence("2026-08-03T07:00:00.000Z", "Europe/Paris", now);
    expect(label).toBe("Mon 3 Aug at 09:00 (Europe/Paris)");
  });

  it("keeps the local time and the timezone identifier in one text node", () => {
    const label = formatOccurrence("2026-07-30T07:00:00.000Z", "Europe/Paris", now);
    expect(label).toContain("09:00");
    expect(label).toContain("Europe/Paris");
  });

  it("is computed relative to the caller's `now`, not the ambient clock", () => {
    // Same occurrence, but relative to a `now` one day later: what was
    // "Tomorrow" from Thursday is "Today" from Friday.
    const later = new Date("2026-07-31T06:00:00.000Z");
    expect(formatOccurrence("2026-07-31T07:00:00.000Z", "Europe/Paris", later)).toBe(
      "Today at 09:00 (Europe/Paris)"
    );
  });
});

describe("formatNextCheckIn", () => {
  const now = new Date("2026-07-30T06:00:00.000Z");

  it("never renders the raw 'paused' state without context", () => {
    const result: NextCheckInResult = { kind: "paused", nextOccurrenceIso: null };
    expect(formatNextCheckIn(result, "Europe/Paris", now)).toBe("Schedule paused");
  });

  it("never renders the raw 'inactive' state without context", () => {
    const result: NextCheckInResult = { kind: "inactive", nextOccurrenceIso: null };
    expect(formatNextCheckIn(result, "Europe/Paris", now)).toBe("Schedule inactive");
  });

  it("explains an empty day selection in plain language", () => {
    const result: NextCheckInResult = { kind: "no_days_selected", nextOccurrenceIso: null };
    expect(formatNextCheckIn(result, "Europe/Paris", now)).toBe("No check-in days selected");
  });

  it("prefixes a scheduled occurrence with the non-committal 'Next planned check-in', never bare 'Next check-in'", () => {
    const result: NextCheckInResult = {
      kind: "scheduled",
      nextOccurrenceIso: "2026-07-30T07:00:00.000Z",
    };
    const label = formatNextCheckIn(result, "Europe/Paris", now);
    expect(label).toMatch(/^Next planned check-in: /);
    expect(label).not.toMatch(/^Next check-in/);
  });
});
