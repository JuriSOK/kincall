import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilePeriodSelector } from "@/app/ui/profile-period-selector";

describe("ProfilePeriodSelector", () => {
  it("renders all four options with visible, accessible labels", () => {
    const html = renderToStaticMarkup(
      ProfilePeriodSelector({ current: "month", basePath: "/people/person_marie" }) as never
    );
    expect(html).toContain(">Day<");
    expect(html).toContain(">Week<");
    expect(html).toContain(">Month<");
    expect(html).toContain(">Year<");
    expect(html).toContain('aria-label="Period"');
  });

  it("identifies the selected period without relying on colour alone (aria-current)", () => {
    const html = renderToStaticMarkup(
      ProfilePeriodSelector({ current: "week", basePath: "/people/person_marie" }) as never
    );
    const weekLinkMatch = html.match(/<a[^>]*href="[^"]*period=week"[^>]*>/);
    expect(weekLinkMatch?.[0]).toContain('aria-current="page"');
    const dayLinkMatch = html.match(/<a[^>]*href="[^"]*period=day"[^>]*>/);
    expect(dayLinkMatch?.[0]).not.toContain("aria-current");
  });

  it("preserves other query parameters on every option's link, not only the active one", () => {
    const html = renderToStaticMarkup(
      ProfilePeriodSelector({
        current: "day",
        basePath: "/people/person_marie",
        preserveParams: { tab: "activity" },
      }) as never
    );
    for (const key of ["day", "week", "month", "year"]) {
      expect(html).toContain(`tab=activity`);
      expect(html).toContain(`period=${key}`);
    }
  });
});
