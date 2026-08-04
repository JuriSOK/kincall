import { isFamilyStructuredResult } from "@/backend/integrations/calle/schemas";
import type { CallEventRecord } from "@/shared/domain/types";
import type { MeanMetric, RateMetric } from "./dashboard-kpis";

// Stage E (docs/DECISION_LOG.md DEC-017): per-contact operational statistics,
// calculated ONLY from persisted Family call events — reusing the exact same
// RateMetric/MeanMetric shapes src/backend/kpi/dashboard-kpis.ts already established,
// so a contact's numbers read consistently with the rest of the product
// (sample count always shown, "Not enough data" rather than a fabricated 0%).
//
// Deliberately excluded, same reasoning as dashboard-kpis.ts:
//   - any duration metric (fake-mode calls complete synchronously);
//   - a "reliable"/"unreliable" label — a rate is shown with its own sample
//     size and left for a human to read, never a verdict this module renders;
//   - ranking or comparing contacts against each other on a small sample.

export interface ContactStats {
  // Every family call event ever placed to this contact, regardless of
  // outcome — the denominator behind "answer rate".
  timesContacted: number;
  // count = answered "yes"; total = timesContacted.
  answerRate: RateMetric;
  // count = can_intervene "yes"; total = answered "yes" calls — "among
  // answered calls" (Stage E brief §9), never against every call placed.
  acceptanceRate: RateMetric;
  // count = answered "yes" but can_intervene !== "yes"; total = the same
  // answered-call denominator as acceptanceRate. acceptanceRate.count +
  // declineRate.count always equals declineRate.total (answered calls are
  // exhaustively either an acceptance or a decline once they answer at all).
  declineRate: RateMetric;
  // Mean attemptNumber among calls where this contact answered — "how many
  // rings in, typically, does this contact tend to pick up".
  meanAttemptWhenAnswering: MeanMetric;
  // The most recent family call's own startedAt, or null when this contact
  // has never been called. A raw ISO instant — presentation formats it.
  latestParticipationIso: string | null;
  // How many of this contact's calls actually confirmed an intervention
  // (can_intervene: "yes") — the Stage E brief's own "number of confirmed
  // interventions", tracked separately from the acceptance RATE because a
  // count survives being read even when the sample is too small for a rate
  // to mean much.
  confirmedInterventions: number;
}

function rate(count: number, total: number): RateMetric {
  return { count, total, percentage: total === 0 ? null : Math.round((count / total) * 1000) / 10 };
}

// Computes one contact's stats from an already-filtered, already-fetched list
// of THAT contact's own family call events (any order) — pure, no repository
// access of its own, matching computeCheckInKpis's own calling convention.
export function computeContactStats(familyCallEvents: CallEventRecord[]): ContactStats {
  const timesContacted = familyCallEvents.length;

  let answeredCount = 0;
  let confirmedCount = 0;
  const attemptsWhenAnswering: number[] = [];
  let latestStartedAt: string | null = null;

  for (const call of familyCallEvents) {
    if (latestStartedAt === null || call.startedAt > latestStartedAt) {
      latestStartedAt = call.startedAt;
    }

    if (!isFamilyStructuredResult(call.structuredResult)) continue;
    if (call.structuredResult.answered !== "yes") continue;

    answeredCount += 1;
    attemptsWhenAnswering.push(call.attemptNumber);
    if (call.structuredResult.can_intervene === "yes") confirmedCount += 1;
  }

  return {
    timesContacted,
    answerRate: rate(answeredCount, timesContacted),
    acceptanceRate: rate(confirmedCount, answeredCount),
    declineRate: rate(answeredCount - confirmedCount, answeredCount),
    meanAttemptWhenAnswering: {
      mean:
        attemptsWhenAnswering.length === 0
          ? null
          : attemptsWhenAnswering.reduce((sum, n) => sum + n, 0) / attemptsWhenAnswering.length,
      sampleSize: attemptsWhenAnswering.length,
    },
    latestParticipationIso: latestStartedAt,
    confirmedInterventions: confirmedCount,
  };
}

// Groups an already-fetched batch of call events (e.g. from
// Repository.listCallEventsForEvents over a person's full event history) into
// one ContactStats per contactId — one pass, no N+1, mirroring
// groupCallEventsByEvent's own batching convention.
export function computeContactStatsByContact(
  callEvents: CallEventRecord[]
): Map<string, ContactStats> {
  const byContact = new Map<string, CallEventRecord[]>();
  for (const call of callEvents) {
    if (call.agentType !== "family" || call.contactId === null) continue;
    const list = byContact.get(call.contactId);
    if (list) {
      list.push(call);
    } else {
      byContact.set(call.contactId, [call]);
    }
  }

  const result = new Map<string, ContactStats>();
  for (const [contactId, calls] of byContact) {
    result.set(contactId, computeContactStats(calls));
  }
  return result;
}
