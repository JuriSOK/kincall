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
    // anyone, so every count and every rate's denominator here is genuinely
    // zero — this proves the page actually calls the shared kpi-display
    // helper (lib/presentation/kpi-display.ts) rather than reintroducing an
    // inline ternary that could drift from it. By explicit product decision,
    // "Not enough data" is never shown anywhere — an empty denominator
    // displays as a plain zero, identically to a genuine measured zero. The
    // "positive denominator" cases are exercised directly against the helper
    // itself in tests/kpi-display.test.ts, since this fixture cannot produce
    // them.
    async function kpiCardValues() {
      const element = await DashboardPage({ searchParams: Promise.resolve({}) });
      const cards = collectElements(element as never).filter((node) => node.type === KpiCard);
      return new Map(cards.map((card) => [card.props.label as string, card.props.value as string]));
    }

    it("shows a genuine numeric 0 for count metrics", async () => {
      const values = await kpiCardValues();
      expect(values.get("Check-ins")).toBe("0");
      expect(values.get("No confirmed support")).toBe("0");
    });

    it("shows 0 (0%) for a rate whose denominator is genuinely zero, never 'Not enough data'", async () => {
      const values = await kpiCardValues();
      expect(values.get("Normal")).toBe("0 (0%)");
      expect(values.get("Reached the circle")).toBe("0 (0%)");
      expect(values.get("Person answered")).toBe("0 (0%)");
      expect(values.get("Attempts before confirmation")).toBe("0.0");
    });

    it("never renders 'Not enough data' anywhere in Operational activity", async () => {
      const html = await renderDashboard();
      expect(html).not.toContain("Not enough data");
    });

    // Removed deliberately: it is a configuration fact, not operational
    // activity, and the Configuration gaps card already reports it per person
    // with a link to fix it.
    it("no longer shows the 'No active circle' metric, in any capitalisation", async () => {
      const html = await renderDashboard();
      expect(html).not.toMatch(/no active circle/i);

      const values = await kpiCardValues();
      expect([...values.keys()]).not.toContain("No active circle");
      // The six operational metrics that remain.
      expect(values.size).toBe(6);
    });
  });
});
