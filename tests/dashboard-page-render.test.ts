import { describe, expect, it } from "vitest";
import DashboardPage from "@/app/(app)/dashboard/page";
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
});
