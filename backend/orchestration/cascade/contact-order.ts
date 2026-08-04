// Stage E (docs/DECISION_LOG.md DEC-017): deterministic contact-availability
// ORDERING for the trusted-circle cascade. This module never delays and
// never excludes solely by time — it only decides which ELIGIBLE contact the
// cascade tries FIRST. Nothing here places a call; backend/orchestration/engine.ts
// is the only caller, and it still runs immediately, in configured-priority
// order among whichever partition (in-window / out-of-window) a contact
// falls into at the moment the cascade actually reaches them.
//
// Consent is DELIBERATELY not filtered here — see the comment on
// orderContactsForCascade for why: that stays the job of
// backend/orchestration/engine.ts's own contactBlockedReason/selectCascadeTarget,
// unchanged since DEC-011, which is what produces the "Skipped <name> — has
// not confirmed consent (§17.1)" timeline entry every existing test already
// depends on. Duplicating that filter here would silently swallow that
// message for any consent-missing contact this module also removed.
//
// No timezone library: every conversion is built from `Intl.DateTimeFormat`
// with an explicit `timeZone`, the same dependency-free guarantee
// backend/scheduling/next-check-in.ts already relies on.

import type { TrustedContact } from "@/shared/domain/types";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// shared/validation/profile.ts independently validates "HH:MM" at the input
// boundary with its own identical CALL_TIME_PATTERN; this module is pure
// domain logic and deliberately does not import a validation-layer concern,
// so it re-declares the same pattern here rather than depending on it.
function minutesSinceMidnight(value: string): number {
  const match = TIME_PATTERN.exec(value);
  if (!match) {
    throw new Error(`orderContactsForCascade: invalid time "${value}" — expected "HH:MM".`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

// The contact's local wall-clock minute-of-day at `instantIso`, in `timeZone`.
function localMinutesAt(instantIso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instantIso));
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  return hour * 60 + Number(map.minute);
}

// Rule 6: a null window (either side — migration 0011 guarantees both are
// null together) means always available. Rule 7: callableFrom > callableTo
// expresses a window crossing midnight (e.g. "22:00"-"07:00"). A degenerate
// callableFrom === callableTo window is treated as always-available (a
// zero-width exclusion would otherwise be indistinguishable from "excluded
// for the entire day", which no rule here asks for) — a safe, inclusive,
// fail-open default consistent with "nobody is excluded solely for being
// outside their window" whenever the configuration itself is ambiguous.
function isWithinCallableWindow(
  contact: TrustedContact,
  eventCreatedAtIso: string,
  personTimezone: string
): boolean {
  if (contact.callableFrom === null || contact.callableTo === null) return true;

  const from = minutesSinceMidnight(contact.callableFrom);
  const to = minutesSinceMidnight(contact.callableTo);
  if (from === to) return true;

  // Rule 3: the contact's own timezone when configured, otherwise the
  // person's persisted timezone — never the browser's or server's default.
  const timeZone = contact.timezone ?? personTimezone;
  const nowMinutes = localMinutesAt(eventCreatedAtIso, timeZone);

  return from < to ? nowMinutes >= from && nowMinutes < to : nowMinutes >= from || nowMinutes < to;
}

// Deterministic contact ordering for one cascade step.
//
// 1. Removes archived and disabled contacts — never called under any
//    circumstance, exactly like an archived contact already was before this
//    stage (silently absent, no timeline message of its own; `enabled` is a
//    reversible version of the same exclusion). Consent is NOT filtered here
//    — see this module's own top comment.
// 2. Partitions the remainder into "in their callable window right now" and
//    "not" — evaluated at `eventCreatedAt`, an already-persisted, immutable
//    instant, NEVER `Date.now()` (rule 8: replay-stability). A webhook
//    replay, a poll, or a process restart recomputes the identical partition
//    from the same durable fact every time.
// 3. Within each partition, contacts keep their CONFIGURED priority order —
//    availability only decides which partition a contact falls into, never
//    reorders within one.
//
// Default preservation: when every contact is enabled and has no
// availability window, every contact is "in window" (rule 6), so the single
// partition sorts by priority and the result is byte-identical to the
// existing trusted_contacts.priority order — the five fake scenarios and
// every pre-Stage-E cascade test are unaffected by construction, not by a
// special case.
export function orderContactsForCascade(
  contacts: TrustedContact[],
  eventCreatedAt: string,
  personTimezone: string
): TrustedContact[] {
  const eligible = contacts.filter((contact) => contact.archivedAt === null && contact.enabled);

  const inWindow: TrustedContact[] = [];
  const outOfWindow: TrustedContact[] = [];
  for (const contact of eligible) {
    (isWithinCallableWindow(contact, eventCreatedAt, personTimezone) ? inWindow : outOfWindow).push(
      contact
    );
  }

  const byPriority = (a: TrustedContact, b: TrustedContact) => a.priority - b.priority;
  return [...inWindow.sort(byPriority), ...outOfWindow.sort(byPriority)];
}
