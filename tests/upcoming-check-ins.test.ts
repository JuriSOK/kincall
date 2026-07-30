import { describe, expect, it } from "vitest";
import {
  computeUpcomingCheckIns,
  type UpcomingCheckInPerson,
} from "@/lib/dashboard/upcoming-check-ins";

function person(overrides: Partial<UpcomingCheckInPerson> = {}): UpcomingCheckInPerson {
  return {
    personId: "person_marie",
    personName: "Marie",
    avatarKey: null,
    schedule: {
      timezone: "Europe/Paris",
      preferredCallTime: "09:00",
      checkInDays: [1, 2, 3, 4, 5, 6, 7],
      scheduleState: "active",
    },
    ...overrides,
  };
}

const NOW = new Date("2026-07-30T06:00:00.000Z"); // Thursday, 08:00 Europe/Paris

describe("computeUpcomingCheckIns — sorting and bounding", () => {
  it("sorts scheduled people chronologically, regardless of input order", () => {
    const later = person({
      personId: "person_later",
      personName: "Later",
      schedule: { timezone: "Europe/Paris", preferredCallTime: "20:00", checkInDays: [4], scheduleState: "active" },
    });
    const sooner = person({
      personId: "person_sooner",
      personName: "Sooner",
      schedule: { timezone: "Europe/Paris", preferredCallTime: "10:00", checkInDays: [4], scheduleState: "active" },
    });

    const result = computeUpcomingCheckIns([later, sooner], NOW, 10);

    expect(result.map((r) => r.personId)).toEqual(["person_sooner", "person_later"]);
  });

  it("bounds the result to the given limit, keeping only the soonest occurrences", () => {
    const people = [1, 2, 3, 4, 5].map((n) =>
      person({
        personId: `person_${n}`,
        personName: `Person ${n}`,
        schedule: {
          timezone: "Europe/Paris",
          preferredCallTime: `1${n}:00`,
          checkInDays: [4],
          scheduleState: "active",
        },
      })
    );

    const result = computeUpcomingCheckIns(people, NOW, 2);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.personId)).toEqual(["person_1", "person_2"]);
  });
});

describe("computeUpcomingCheckIns — exclusion of paused, inactive and unconfigured profiles", () => {
  it("excludes a paused profile entirely — no placeholder entry", () => {
    const paused = person({ schedule: { ...person().schedule, scheduleState: "paused" } });
    expect(computeUpcomingCheckIns([paused], NOW, 10)).toEqual([]);
  });

  it("excludes an inactive profile entirely", () => {
    const inactive = person({ schedule: { ...person().schedule, scheduleState: "inactive" } });
    expect(computeUpcomingCheckIns([inactive], NOW, 10)).toEqual([]);
  });

  it("excludes a profile with no check-in days selected", () => {
    const unconfigured = person({ schedule: { ...person().schedule, checkInDays: [] } });
    expect(computeUpcomingCheckIns([unconfigured], NOW, 10)).toEqual([]);
  });

  it("keeps active, fully configured profiles alongside excluded ones", () => {
    const paused = person({ personId: "person_paused", schedule: { ...person().schedule, scheduleState: "paused" } });
    const active = person({ personId: "person_active" });

    const result = computeUpcomingCheckIns([paused, active], NOW, 10);

    expect(result.map((r) => r.personId)).toEqual(["person_active"]);
  });
});
