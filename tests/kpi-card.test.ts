import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KpiCard } from "@/app/ui/kpi-card";

describe("KpiCard", () => {
  it("never renders a sample-size line — value alone carries the count", () => {
    const html = renderToStaticMarkup(
      KpiCard({ label: "Answered", value: "3 (100%)" }) as never
    );
    expect(html).not.toMatch(/n\s*=\s*\d/);
  });

  it("renders label and value, plus an optional caption", () => {
    const html = renderToStaticMarkup(
      KpiCard({ label: "Check-ins", value: "12", caption: "last 30 days" }) as never
    );
    expect(html).toContain("Check-ins");
    expect(html).toContain("12");
    expect(html).toContain("last 30 days");
  });
});
