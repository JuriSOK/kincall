import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeNextCheckIn, type CheckInSchedule } from "@/backend/scheduling/next-check-in";
import { computeUpcomingCheckIns } from "@/backend/dashboard/upcoming-check-ins";
import { formatNextCheckIn, formatOccurrence } from "@/shared/presentation/format-schedule";

// Stage D / DEC-016: rendering a next planned check-in — on the dashboard, on
// a profile card, on the person page's Schedule card — must never create an
// event. These modules are pure: they take only already-loaded plain data
// (a schedule, a list of people, a `now`) and return plain data back. None of
// them accepts, imports, or can reach a Repository, so none of them can call
// `createEvent`, `updatePerson`, or any other write — this is a structural
// guarantee, not just a convention, and this file both documents and checks
// it two ways: by reading the source (no forbidden references at all) and by
// exercising the functions and confirming their behaviour is a pure
// computation with no observable side effect.
const SCHEDULE_MODULES = [
  "src/backend/scheduling/next-check-in.ts",
  "src/shared/presentation/format-schedule.ts",
  "src/backend/dashboard/upcoming-check-ins.ts",
];

describe("schedule rendering has no repository access at all", () => {
  it.each(SCHEDULE_MODULES)("%s never references a repository or an event write", (relativePath) => {
    const source = readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf-8");
    expect(source).not.toMatch(/getRepository/);
    expect(source).not.toMatch(/createEvent/);
    expect(source).not.toMatch(/updatePerson/);
    expect(source).not.toMatch(/from ["']@\/lib\/database\/store["']/);
  });
});

describe("computeNextCheckIn and computeUpcomingCheckIns are pure — same input, same output, no mutation", () => {
  const schedule: CheckInSchedule = {
    timezone: "Europe/Paris",
    preferredCallTime: "09:00",
    checkInDays: [1, 2, 3, 4, 5, 6, 7],
    scheduleState: "active",
  };
  const now = new Date("2026-07-30T06:00:00.000Z");

  it("computeNextCheckIn does not mutate its `schedule` argument", () => {
    const frozenSchedule = Object.freeze({ ...schedule, checkInDays: Object.freeze([...schedule.checkInDays]) });
    expect(() => computeNextCheckIn(frozenSchedule as CheckInSchedule, now)).not.toThrow();
  });

  it("calling computeNextCheckIn twice with identical input returns identical output — no hidden state", () => {
    const first = computeNextCheckIn(schedule, now);
    const second = computeNextCheckIn(schedule, now);
    expect(second).toEqual(first);
  });

  it("computeUpcomingCheckIns does not mutate the people array or its entries", () => {
    const people = [
      { personId: "person_marie", personName: "Marie", avatarKey: null, schedule },
    ];
    const frozenPeople = Object.freeze(people.map((p) => Object.freeze(p)));
    expect(() => computeUpcomingCheckIns(frozenPeople as typeof people, now, 10)).not.toThrow();
  });

  it("rendering a formatted label is a pure string computation with no side effect", () => {
    const result = computeNextCheckIn(schedule, now);
    const labelOne = formatNextCheckIn(result, schedule.timezone, now);
    const labelTwo = formatNextCheckIn(result, schedule.timezone, now);
    expect(labelTwo).toBe(labelOne);
    if (result.kind === "scheduled" && result.nextOccurrenceIso) {
      expect(formatOccurrence(result.nextOccurrenceIso, schedule.timezone, now)).toBe(
        formatOccurrence(result.nextOccurrenceIso, schedule.timezone, now)
      );
    }
  });
});
