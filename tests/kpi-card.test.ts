import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KpiCard } from "@/app/ui/kpi-card";

describe("KpiCard", () => {
  it("hides the sample-size label entirely when the count is zero", () => {
    const html = renderToStaticMarkup(
      KpiCard({ label: "Answered", value: "Not enough data", sampleSize: 0 }) as never
    );
    expect(html).not.toMatch(/n\s*=\s*0/);
    expect(html).not.toContain("()");
  });

  it("still shows the sample-size label for a positive count", () => {
    const html = renderToStaticMarkup(
      KpiCard({ label: "Answered", value: "3 (100%)", sampleSize: 3 }) as never
    );
    expect(html).toContain("n = 3");
  });

  it("omits the sample-size label entirely when sampleSize is not provided (unrelated to the n=0 fix)", () => {
    const html = renderToStaticMarkup(KpiCard({ label: "Check-ins", value: "12" }) as never);
    expect(html).not.toContain("n =");
  });
});
