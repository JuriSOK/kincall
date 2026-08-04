import { describe, expect, it } from "vitest";
import HistoryPage from "@/app/(app)/history/page";
import { renderServerComponent } from "../support/render";

async function renderHistory(searchParams: Record<string, string | string[] | undefined> = {}) {
  const element = await HistoryPage({ searchParams: Promise.resolve(searchParams) });
  return renderServerComponent(element as never);
}

describe("History page", () => {
  it("no longer carries any of the three explanatory texts removed from this page", async () => {
    const html = await renderHistory();
    expect(html).not.toContain("Every check-in, grouped by day");
    expect(html).not.toContain("Operational activity only");
    expect(html).not.toContain("Try a wider period");
  });

  it("keeps the empty-state title when filters match nothing, without the removed explanatory paragraph", async () => {
    const html = await renderHistory({ q: "no-such-person-should-match-this-query" });
    expect(html).toContain("No check-ins match these filters");
    expect(html).not.toContain("a different profile, or clearing the search");
  });
});
