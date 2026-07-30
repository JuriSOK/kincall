import { isFamilyStructuredResult, readCompanionResult } from "@/lib/calle/schemas";
import type { CallEventRecord, EventRecord } from "@/lib/database/types";

// Count-based operational metrics only (§8 of the Stage B brief). Deliberately
// excluded, and not present anywhere in this module:
//
//   - any duration or response-time metric ("average time before a trusted
//     contact confirmed"). Fake-mode events run the ENTIRE cascade
//     synchronously (see lib/orchestration/engine.ts's startDemoEvent), so
//     every such duration would measure ~0ms for every fake-mode event —
//     a number that is technically computed but operationally meaningless,
//     and indistinguishable in the UI from a real, fast confirmation. Showing
//     it would be a fabricated metric, not merely an unavailable one.
//   - false-positive rate / unnecessary-escalation rate. Both require ground
//     truth about whether attention was actually warranted, which KinCall
//     never learns — it never receives a "that call was unnecessary" signal
//     from anyone. Publishing either would assert a clinical judgement the
//     product deliberately never makes (PRODUCT_SPECIFICATION.md §7.5, §17.6).
//
// Every metric here is a plain count over already-persisted, already-typed
// fields: event.decision, event.status, and the two structured call results.

export interface RateMetric {
  count: number;
  total: number;
  // null when total is 0 — "not enough data", never a divide-by-zero NaN and
  // never a fabricated 0%.
  percentage: number | null;
}

function rate(count: number, total: number): RateMetric {
  return {
    count,
    total,
    percentage: total === 0 ? null : Math.round((count / total) * 1000) / 10,
  };
}

export interface MeanMetric {
  mean: number | null;
  sampleSize: number;
}

export interface CheckInKpis {
  totalCheckIns: number;
  normalCheckIns: RateMetric;
  cascadesTriggered: RateMetric;
  attentionUnresolvedCount: number;
  personReached: RateMetric;
  meanFamilyAttemptsBeforeConfirmation: MeanMetric;
}

// Groups a flat batch read (Repository.listCallEventsForEvents) back into
// per-event lists, in the same order listCallEvents would return for each
// event individually — the contract both repository drivers guarantee.
export function groupCallEventsByEvent(
  callEvents: CallEventRecord[]
): Map<string, CallEventRecord[]> {
  const map = new Map<string, CallEventRecord[]>();
  for (const call of callEvents) {
    const list = map.get(call.eventId);
    if (list) {
      list.push(call);
    } else {
      map.set(call.eventId, [call]);
    }
  }
  return map;
}

// Computes every count-based metric in one pass over `events`. Works
// identically whether `events` is the whole dashboard's recent window or one
// person's own events — the per-person summary (used on a profile card) is
// literally this same function called on that person's subset, so the two
// can never silently disagree about what "normal" or "a cascade" means.
export function computeCheckInKpis(
  events: EventRecord[],
  callEventsByEvent: Map<string, CallEventRecord[]>
): CheckInKpis {
  const totalCheckIns = events.length;

  let normalCount = 0;
  let cascadeCount = 0;
  let unresolvedCount = 0;
  let reachedYes = 0;
  let reachedTotal = 0;
  const attemptsBeforeConfirmation: number[] = [];

  for (const event of events) {
    if (event.decision === "LOG_AND_CLOSE") normalCount += 1;
    if (event.status === "ATTENTION_UNRESOLVED") unresolvedCount += 1;

    const callEvents = callEventsByEvent.get(event.id) ?? [];
    const companionCalls = callEvents.filter((call) => call.agentType === "companion");
    const familyCalls = callEvents.filter((call) => call.agentType === "family");

    if (familyCalls.length > 0) cascadeCount += 1;

    // The LAST companion call, matching the event page's own reasoning
    // (lib/presentation/event-summary.ts): after a bounded retry there are
    // two, and only the most recent one is the "completed Companion result"
    // the decision was actually based on.
    const lastCompanion = companionCalls[companionCalls.length - 1];
    if (lastCompanion && lastCompanion.resultProcessedAt !== null) {
      const result = readCompanionResult(lastCompanion.structuredResult);
      // "a usable completed Companion result" — resultProcessedAt is not
      // enough on its own; a malformed result is completed but not usable.
      if (result !== null) {
        reachedTotal += 1;
        if (result.personReached === "yes") reachedYes += 1;
      }
    }

    // "Family call events up to and including the confirming call" — the
    // index of the first confirming call, 1-based, in call order.
    const confirmingIndex = familyCalls.findIndex(
      (call) =>
        isFamilyStructuredResult(call.structuredResult) &&
        call.structuredResult.can_intervene === "yes"
    );
    if (confirmingIndex !== -1) attemptsBeforeConfirmation.push(confirmingIndex + 1);
  }

  return {
    totalCheckIns,
    normalCheckIns: rate(normalCount, totalCheckIns),
    cascadesTriggered: rate(cascadeCount, totalCheckIns),
    attentionUnresolvedCount: unresolvedCount,
    personReached: rate(reachedYes, reachedTotal),
    meanFamilyAttemptsBeforeConfirmation: {
      mean:
        attemptsBeforeConfirmation.length === 0
          ? null
          : attemptsBeforeConfirmation.reduce((sum, n) => sum + n, 0) /
            attemptsBeforeConfirmation.length,
      sampleSize: attemptsBeforeConfirmation.length,
    },
  };
}
