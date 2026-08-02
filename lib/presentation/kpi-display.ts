import type { MeanMetric, RateMetric } from "@/lib/kpi/dashboard-kpis";

// The ONE place that turns an already-computed KPI (lib/kpi/dashboard-kpis.ts,
// lib/kpi/contact-stats.ts) into a display-ready string. Every "Operational
// activity" card (dashboard, person page) calls one of these instead of
// repeating its own ternary, so a genuine measured zero, an absence of
// observations, and an unknown/unavailable calculation can never be
// conflated by one card doing the check slightly differently from another.
//
// This module makes no KPI decisions of its own — it only formats numbers
// the caller already computed (RateMetric.percentage is already null exactly
// when the denominator is 0; MeanMetric.mean is already null exactly when
// there is no qualifying observation). Nothing here changes what counts as
// "normal", "a cascade", or "confirmed" — see dashboard-kpis.ts for that.

export type KpiDisplayKind = "count" | "rate" | "average" | "unavailable";

export interface KpiDisplay {
  kind: KpiDisplayKind;
  // The exact string a KpiCard's `value` prop should receive.
  text: string;
  // The observation count backing a rate/average, carried through even
  // though the current UI does not render its own "n = X" line — so a
  // future caller (or a test) can still distinguish "no observations" from
  // "some observations, positive count" without recomputing anything.
  // Absent for "count" (a plain count has no separate sample size — it IS
  // the count) and for "unavailable" (there is nothing to size).
  sampleSize?: number;
}

const UNAVAILABLE_TEXT = "Not enough data";

// A simple count metric (check-ins, unresolved events, "no active circle",
// …). Zero is always a genuine, displayable result — a count is never
// "unavailable" merely for being zero, so this never returns "unavailable".
export function displayCount(count: number): KpiDisplay {
  return { kind: "count", text: String(count) };
}

// A rate metric: `count` out of `total`. `total === 0` (no denominator) is
// the ONLY case this returns "unavailable" — a zero numerator with a
// positive denominator is a real, measured 0%, never mistaken for "no data".
export function displayRate(metric: RateMetric): KpiDisplay {
  if (metric.percentage === null) {
    return { kind: "unavailable", text: UNAVAILABLE_TEXT };
  }
  return {
    kind: "rate",
    text: `${metric.count} (${metric.percentage}%)`,
    sampleSize: metric.total,
  };
}

// A mean/average metric. `mean === null` (no qualifying observation) is the
// ONLY case this returns "unavailable" — a computed mean of exactly 0 is
// shown as 0, never silently upgraded to "unavailable" and never fabricated
// when there was nothing to average.
export function displayAverage(
  metric: MeanMetric,
  format: (mean: number) => string = (mean) => mean.toFixed(1)
): KpiDisplay {
  if (metric.mean === null) {
    return { kind: "unavailable", text: UNAVAILABLE_TEXT };
  }
  return { kind: "average", text: format(metric.mean), sampleSize: metric.sampleSize };
}
