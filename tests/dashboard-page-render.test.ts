import { describe, expect, it } from "vitest";
import DashboardPage from "@/app/(app)/dashboard/page";
import { KpiCard } from "@/app/ui/kpi-card";
import { collectElements } from "./support/element-tree";
import { renderServerComponent } from "./support/render";

async function renderDashboard(searchParams: Record<string, string | string[] | undefined> = {}) {
  const element = await DashboardPage({ searchParams: Promise.resolve(searchParams) });
  return renderServerComponent(element as never);
}

describe("Dashboard page", () => {
  it("no longer carries any of the three explanatory texts removed from this page", async () => {
    const html = await renderDashboard();
    expect(html).not.toContain("Operational activity only");
    expect(html).not.toContain("One line per person");
    expect(html).not.toContain("Widen the period above");
  });

  it("hides every 'n = 0' sample-size label in the Operational activity strip", async () => {
    const html = await renderDashboard();
    expect(html).not.toMatch(/n\s*=\s*0/);
  });

  it("shows the daily-recap 'Not checked in yet' wording for a person with no events at all", async () => {
    // person_marie is seeded with zero events (lib/database/seed.ts), so
    // regardless of what "now" happens to be when this test runs, the Daily
    // recap row can only ever be in the "no check-in today" state — a
    // deterministic, wiring-level check that the page actually calls
    // computeDailyRecapStatus rather than the old describePersonStatus path
    // (exhaustively covered separately in tests/daily-recap-status.test.ts).
    const html = await renderDashboard();
    expect(html).toContain("Not checked in yet");
  });

  describe("Operational activity zero-value display", () => {
    // The seeded in-memory fixture (lib/database/seed.ts) has zero events for
    // anyone, so every count here is a genuine, correctly-computed zero, and
    // every rate's denominator is genuinely zero too — this proves the page
    // actually calls the shared kpi-display helper (lib/presentation/
    // kpi-display.ts) rather than reintroducing an inline ternary that could
    // drift from it. The "0% with a positive denominator" and "positive
    // average" cases are exercised directly against the helper itself in
    // tests/kpi-display.test.ts, since this fixture cannot produce them.
    async function kpiCardValues() {
      const element = await DashboardPage({ searchParams: Promise.resolve({}) });
      const cards = collectElements(element as never).filter((node) => node.type === KpiCard);
      return new Map(cards.map((card) => [card.props.label as string, card.props.value as string]));
    }

    it("shows a genuine numeric 0 for count metrics, never 'Not enough data'", async () => {
      const values = await kpiCardValues();
      expect(values.get("Check-ins")).toBe("0");
      expect(values.get("No confirmed support")).toBe("0");
    });

    it("shows 'Not enough data' for a rate whose denominator is genuinely zero (no check-ins at all)", async () => {
      const values = await kpiCardValues();
      expect(values.get("Normal")).toBe("Not enough data");
      expect(values.get("Reached the circle")).toBe("Not enough data");
      expect(values.get("Person answered")).toBe("Not enough data");
      expect(values.get("Attempts before confirmation")).toBe("Not enough data");
    });
  });
});
