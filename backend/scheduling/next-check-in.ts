// Stage D (docs/DECISION_LOG.md DEC-016): the deterministic next-check-in
// calculation. This module computes what the FIRST future scheduled instant
// would be, given a person's persisted schedule configuration — it does not
// place, schedule, or trigger anything. Nothing in this codebase reads its
// output to place a call; `Call now` / `Launch demo` remain the only trigger
// anywhere in this product. See the module's own exports for exactly what is
// and is not computed.
//
// No timezone library is used. Every conversion here is built from
// `Intl.DateTimeFormat` with an explicit `timeZone`, which is backed by the
// full IANA database any Node build ships with (the same guarantee
// shared/presentation/format-date.ts already relies on) — safe, dependency-free,
// and correct for arbitrary zones without this project taking on its own
// copy of the tz database or a library to parse one.

export type ScheduleStateLike = "active" | "paused" | "inactive";

export interface CheckInSchedule {
  // IANA identifier, e.g. "Europe/Paris" — the person's OWN timezone
  // (VulnerablePerson.timezone), never the browser's or the server
  // process's. Assumed already validated (shared/validation/profile.ts's
  // isValidTimezone) by the time it reaches this module.
  timezone: string;
  // "HH:MM", 24-hour, assumed already validated.
  preferredCallTime: string;
  // ISO weekday numbers, 1 (Monday) through 7 (Sunday). May be empty.
  checkInDays: number[];
  scheduleState: ScheduleStateLike;
}

export type NextCheckInKind = "scheduled" | "paused" | "inactive" | "no_days_selected";

export interface NextCheckInResult {
  kind: NextCheckInKind;
  // An ISO 8601 UTC instant, set only when kind === "scheduled". Null for
  // every other kind — there is deliberately no "occurrence" to report for a
  // paused/inactive schedule or one with no valid day selected.
  nextOccurrenceIso: string | null;
}

// Mirrors shared/validation/profile.ts's CALL_TIME_PATTERN exactly (not
// imported from there: this module is pure domain computation and does not
// depend on the validation layer, which is an input-boundary concern).
const CALL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parsePreferredCallTime(value: string): [hour: number, minute: number] {
  const match = CALL_TIME_PATTERN.exec(value);
  if (!match) {
    throw new Error(`computeNextCheckIn: invalid preferredCallTime "${value}" — expected "HH:MM".`);
  }
  return [Number(match[1]), Number(match[2])];
}

interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

// Today's calendar date AS SEEN IN `timeZone`, from a UTC instant — e.g. it
// can already be "tomorrow" in Tokyo while it is still "today" in UTC. Uses
// "en-CA" purely for its YYYY-MM-DD part order (never shown to a user), the
// same trick shared/presentation/format-date.ts's formatDayKey already uses.
function ymdInZone(instantMs: number, timeZone: string): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instantMs));
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

// Pure calendar arithmetic — deliberately anchored via Date.UTC/getUTC*
// throughout, never the local Date constructor or local getters, so this
// never depends on the server process's own timezone.
function addDaysToYmd(ymd: Ymd, days: number): Ymd {
  const date = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  date.setUTCDate(date.getUTCDate() + days);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

// A calendar date's weekday does not depend on any timezone — 29 March 2026
// is a Sunday everywhere on Earth — so this is pure UTC-anchored arithmetic.
// Returns ISO 8601 weekday numbers: 1 (Monday) .. 7 (Sunday).
function isoWeekdayOfYmd(ymd: Ymd): number {
  const jsDay = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day)).getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay;
}

// The UTC offset (in minutes, zone-ahead-of-UTC positive) that `timeZone`
// observes at a given UTC instant.
function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  // Some ICU builds render midnight as hour "24" under h23 — normalise it.
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asUtcMs = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second)
  );
  return Math.round((asUtcMs - instantMs) / 60000);
}

// Whether formatting `utcMs` in `timeZone` reproduces exactly this wall-clock
// date and time.
function wallClockMatches(utcMs: number, timeZone: string, target: Ymd, hour: number, minute: number): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const h = Number(map.hour) === 24 ? 0 : Number(map.hour);
  return (
    Number(map.year) === target.year &&
    Number(map.month) === target.month &&
    Number(map.day) === target.day &&
    h === hour &&
    Number(map.minute) === minute
  );
}

// Binary-searches, to the second, the exact UTC instant a DST transition
// takes effect. `lo` must already carry the pre-transition offset and `hi`
// the post-transition offset. Real-world DST transitions land on an exact
// minute (almost always an exact hour), so second-level precision is always
// enough to resolve the boundary exactly once rounded up to the minute.
function findTransitionBoundary(lo: number, hi: number, timeZone: string): number {
  const loOffset = offsetMinutesAt(lo, timeZone);
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (offsetMinutesAt(mid, timeZone) === loOffset) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // By construction `hi` always carries the post-transition offset (the loop
  // only ever moves `hi` to a midpoint whose offset differs from `lo`'s), so
  // `hi` is always in [true boundary, true boundary + 1000ms) — never
  // before it. Real transitions land exactly on a whole minute, so a sub-
  // second remainder here is at most 1000ms out of a 60000ms minute: nowhere
  // near the rounding midpoint, meaning `round` always snaps back down to
  // the exact boundary. `ceil` would be wrong — it rounds up even when `hi`
  // is only a few milliseconds past the boundary, jumping a whole minute too
  // far forward.
  return Math.round(hi / 60000) * 60000;
}

export type ZonedResolutionKind = "unique" | "ambiguous" | "gap";

export interface ZonedResolution {
  utcMs: number;
  kind: ZonedResolutionKind;
}

// Samples the offsets `timeZone` exhibits in a wide window around a naive
// UTC guess. A normal day yields exactly one; a day containing a DST
// transition yields exactly two. ±26 hours safely brackets any real-world
// transition that could affect this specific wall-clock target, regardless
// of how far the zone's own absolute offset (-12..+14) puts the naive guess
// from the true instant.
function distinctOffsetsNear(naiveUtcMs: number, timeZone: string): number[] {
  const offsets = new Set<number>();
  for (let hoursOffset = -26; hoursOffset <= 26; hoursOffset += 1) {
    offsets.add(offsetMinutesAt(naiveUtcMs + hoursOffset * 3600000, timeZone));
  }
  return [...offsets];
}

// Converts a wall-clock date and time in `timeZone` to the UTC instant it
// represents — the one piece of arithmetic that makes "09:00 in
// Europe/Paris" mean something absolute. Handles the two DST edge cases
// explicitly rather than letting an ordinary offset calculation silently
// produce a wrong or nonsensical instant:
//
//   - a NONEXISTENT local time (the spring-forward gap, e.g. 02:30 on the
//     day clocks jump from 02:00 to 03:00): resolves FORWARD to the first
//     valid local instant — the exact moment the gap ends.
//   - an AMBIGUOUS local time (the fall-back repeat, e.g. 02:30 occurring
//     once before and once after clocks are set back): resolves to the
//     EARLIER of the two UTC instants — the occurrence while the earlier
//     (pre-transition) offset is still in effect. This is a deliberate,
//     documented choice, not an accident of the algorithm: the alternative
//     (the later instant) is equally defensible, but a schedule must pick
//     exactly one and this is it.
export function zonedWallClockToUtc(target: Ymd, hour: number, minute: number, timeZone: string): ZonedResolution {
  const naiveUtcMs = Date.UTC(target.year, target.month - 1, target.day, hour, minute, 0, 0);
  const offsets = distinctOffsetsNear(naiveUtcMs, timeZone);

  const candidates = [...new Set(offsets.map((offsetMinutes) => naiveUtcMs - offsetMinutes * 60000))]
    .filter((utcMs) => wallClockMatches(utcMs, timeZone, target, hour, minute))
    .sort((a, b) => a - b);

  if (candidates.length >= 1) {
    return { utcMs: candidates[0], kind: candidates.length > 1 ? "ambiguous" : "unique" };
  }

  // No candidate reproduces the requested wall clock at all: a
  // spring-forward gap. Bracket the transition using the smallest and
  // largest observed offsets (pre- and post-transition) and binary-search
  // the exact boundary between them.
  const sortedOffsets = [...offsets].sort((a, b) => a - b);
  const a = naiveUtcMs - sortedOffsets[0] * 60000;
  const b = naiveUtcMs - sortedOffsets[sortedOffsets.length - 1] * 60000;
  const boundary = findTransitionBoundary(Math.min(a, b), Math.max(a, b), timeZone);
  return { utcMs: boundary, kind: "gap" };
}

// How many consecutive calendar days (starting today, in the person's own
// zone) to scan forward — 8 guarantees every one of the 7 ISO weekdays is
// checked at least once, so "week wrap" (e.g. only Monday selected, today is
// Saturday) is handled by the same loop as the ordinary case.
const SCAN_DAYS = 8;

// The deterministic next-check-in calculation (DEC-016). Returns the first
// scheduled instant strictly after `now` — never `now` itself, never a past
// occurrence. `now` is always the caller's explicit instant: this function
// never reads `Date.now()` or any ambient timezone itself, which is what
// makes it deterministic regardless of the process's own timezone.
export function computeNextCheckIn(schedule: CheckInSchedule, now: Date): NextCheckInResult {
  if (schedule.scheduleState === "paused") return { kind: "paused", nextOccurrenceIso: null };
  if (schedule.scheduleState === "inactive") return { kind: "inactive", nextOccurrenceIso: null };

  const validDays = new Set(schedule.checkInDays);
  if (validDays.size === 0) return { kind: "no_days_selected", nextOccurrenceIso: null };

  const [hour, minute] = parsePreferredCallTime(schedule.preferredCallTime);
  const nowMs = now.getTime();
  const todayYmd = ymdInZone(nowMs, schedule.timezone);

  for (let dayOffset = 0; dayOffset < SCAN_DAYS; dayOffset += 1) {
    const candidateYmd = addDaysToYmd(todayYmd, dayOffset);
    if (!validDays.has(isoWeekdayOfYmd(candidateYmd))) continue;

    const { utcMs } = zonedWallClockToUtc(candidateYmd, hour, minute, schedule.timezone);
    if (utcMs > nowMs) {
      return { kind: "scheduled", nextOccurrenceIso: new Date(utcMs).toISOString() };
    }
  }

  // Provably unreachable: validDays is non-empty (guarded above) and any 8
  // consecutive calendar days contain every one of the 7 ISO weekdays at
  // least once, so the loop above always finds a match before exhausting
  // the scan window. Thrown rather than silently reporting
  // "no_days_selected" (which would misreport a real, valid configuration as
  // empty) — a genuine bug here should fail loudly, not lie about its cause.
  throw new Error(
    "computeNextCheckIn: no matching day found within the scan window — this should be unreachable."
  );
}
