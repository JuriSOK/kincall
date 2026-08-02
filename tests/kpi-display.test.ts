import { describe, expect, it } from "vitest";
import { displayAverage, displayCount, displayRate } from "@/lib/presentation/kpi-display";
import type { MeanMetric, RateMetric } from "@/lib/kpi/dashboard-kpis";

describe("displayCount", () => {
  it("shows a genuine zero count as '0'", () => {
    const result = displayCount(0);
    expect(result.kind).toBe("count");
    expect(result.text).toBe("0");
  });

  it("shows a positive count as-is", () => {
    expect(displayCount(12).text).toBe("12");
  });
});

describe("displayRate", () => {
  it("shows '0%' (with the count) when the denominator is positive but the numerator is zero", () => {
    // 5 calls, none answered.
    const metric: RateMetric = { count: 0, total: 5, percentage: 0 };
    const result = displayRate(metric);
    expect(result.kind).toBe("rate");
    expect(result.text).toBe("0 (0%)");
    expect(result.sampleSize).toBe(5);
  });

  it("shows the calculated percentage when the numerator is positive", () => {
    const metric: RateMetric = { count: 3, total: 6, percentage: 50 };
    expect(displayRate(metric).text).toBe("3 (50%)");
  });

  it("shows a plain 0 (0%), not 'Not enough data', when the denominator is empty — by explicit product decision", () => {
    const metric: RateMetric = { count: 0, total: 0, percentage: null };
    const result = displayRate(metric);
    expect(result.text).toBe("0 (0%)");
    expect(result.text).not.toContain("Not enough data");
    expect(result.sampleSize).toBe(0);
  });
});

describe("displayAverage", () => {
  it("shows a plain 0, not 'Not enough data', when there is no qualifying observation — by explicit product decision", () => {
    const metric: MeanMetric = { mean: null, sampleSize: 0 };
    const result = displayAverage(metric);
    expect(result.text).toBe("0.0");
    expect(result.text).not.toContain("Not enough data");
    expect(result.sampleSize).toBe(0);
  });

  it("shows the calculated mean, formatted to one decimal by default", () => {
    const metric: MeanMetric = { mean: 1.6666666, sampleSize: 3 };
    const result = displayAverage(metric);
    expect(result.kind).toBe("average");
    expect(result.text).toBe("1.7");
    expect(result.sampleSize).toBe(3);
  });

  it("shows a mathematically valid mean of exactly zero identically to 'no observation'", () => {
    const metric: MeanMetric = { mean: 0, sampleSize: 2 };
    const result = displayAverage(metric);
    expect(result.text).toBe("0.0");
  });

  it("accepts a custom formatter", () => {
    const metric: MeanMetric = { mean: 2, sampleSize: 4 };
    expect(displayAverage(metric, (m) => `${m} attempts`).text).toBe("2 attempts");
    expect(displayAverage({ mean: null, sampleSize: 0 }, (m) => `${m} attempts`).text).toBe(
      "0 attempts"
    );
  });
});
