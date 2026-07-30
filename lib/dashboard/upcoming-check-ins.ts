import { computeNextCheckIn, type CheckInSchedule } from "@/lib/schedule/next-check-in";

export interface UpcomingCheckInPerson {
  personId: string;
  personName: string;
  avatarKey: string | null;
  schedule: CheckInSchedule;
}

export interface UpcomingCheckIn {
  personId: string;
  personName: string;
  avatarKey: string | null;
  timezone: string;
  nextOccurrenceIso: string;
}

// The dashboard's "Upcoming check-ins" section (Stage D). Pure — callers
// supply already-resolved person/schedule data; this module never touches a
// repository or a clock of its own (`now` is always the caller's explicit
// instant, exactly like computeNextCheckIn requires).
//
// A person is excluded entirely — never shown with a placeholder — when
// their schedule is paused, inactive, or has no valid day selected: those
// are exactly the `NextCheckInResult` kinds other than "scheduled".
// Chronological order and the `limit` bound are both applied here, once, so
// every caller sees identical ordering.
export function computeUpcomingCheckIns(
  people: UpcomingCheckInPerson[],
  now: Date,
  limit: number
): UpcomingCheckIn[] {
  const upcoming: UpcomingCheckIn[] = [];

  for (const person of people) {
    const result = computeNextCheckIn(person.schedule, now);
    if (result.kind !== "scheduled" || result.nextOccurrenceIso === null) continue;
    upcoming.push({
      personId: person.personId,
      personName: person.personName,
      avatarKey: person.avatarKey,
      timezone: person.schedule.timezone,
      nextOccurrenceIso: result.nextOccurrenceIso,
    });
  }

  // ISO 8601 UTC strings compare chronologically as plain strings, the same
  // property Repository.listRecentEvents already relies on elsewhere.
  upcoming.sort((a, b) => a.nextOccurrenceIso.localeCompare(b.nextOccurrenceIso));
  return upcoming.slice(0, limit);
}
