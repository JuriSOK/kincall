import type { MeanMetric, RateMetric } from "@/lib/kpi/dashboard-kpis";

// The ONE place that turns an already-computed KPI (lib/kpi/dashboard-kpis.ts)
// into a display-ready string. Every "Operational activity" card (dashboard,
// person page) calls one of these instead of repeating its own ternary, so
// every card is guaranteed to format the same shape of value the same way.
//
// By product-owner decision, an empty denominator/no qualifying observation
// is displayed as a plain zero here — "0" / "0 (0%)" / "0.0" — rather than
// "Not enough data", everywhere and without exception. This module makes no
// KPI decisions of its own — it only formats numbers the caller already
// computed (RateMetric.percentage is null exactly when the denominator is 0;
// MeanMetric.mean is null exactly when there is no qualifying observation);
// nothing here changes what counts as "normal", "a cascade", or "confirmed"
// — see dashboard-kpis.ts for that.

export type KpiDisplayKind = "count" | "rate" | "average";

export interface KpiDisplay {
  kind: KpiDisplayKind;
  // The exact string a KpiCard's `value` prop should receive.
  text: string;
  // The observation count backing a rate/average (0 when there was none) —
  // carried through even though the current UI does not render its own
  // "n = X" line, so a future caller (or a test) can still tell "no
  // observations" apart from "some, positive count" without recomputing
  // anything. Absent for "count" (a plain count has no separate sample size
  // — it IS the count).
  sampleSize?: number;
}

// A simple count metric (check-ins, unresolved events, "no active circle",
// …). Zero is always a genuine, displayable result.
export function displayCount(count: number): KpiDisplay {
  return { kind: "count", text: String(count) };
}

// A rate metric: `count` out of `total`. When `total` is 0 there is no
// percentage to compute, so this displays it exactly as a genuine 0% would
// read — "0 (0%)" — rather than a separate "unavailable" phrasing.
export function displayRate(metric: RateMetric): KpiDisplay {
  const percentage = metric.percentage ?? 0;
  return {
    kind: "rate",
    text: `${metric.count} (${percentage}%)`,
    sampleSize: metric.total,
  };
}

// A mean/average metric. When there is no qualifying observation, this
// displays 0 run through the same formatter a genuine 0 would use, so the
// two are never visually distinguishable.
export function displayAverage(
  metric: MeanMetric,
  format: (mean: number) => string = (mean) => mean.toFixed(1)
): KpiDisplay {
  return {
    kind: "average",
    text: format(metric.mean ?? 0),
    sampleSize: metric.sampleSize,
  };
}
