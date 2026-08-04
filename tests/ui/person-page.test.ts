import { describe, expect, it } from "vitest";
import PersonPage from "@/app/(app)/people/[id]/page";
import { collectElements } from "../support/element-tree";
import { renderServerComponent } from "../support/render";
import { ProfilePeriodSelector } from "@/frontend/components/profile-period-selector";

// person_marie is the repository's seeded demo profile: preferredLanguage
// "fr-FR", conversationProfile "cognitive_friendly", and — critically for
// this pass — zero seeded events, which is exactly the shape needed to
// exercise both the "n = 0" and "no check-in yet" empty-state paths.
const PERSON_ID = "person_marie";

async function renderPersonPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  const element = await PersonPage({
    params: Promise.resolve({ id: PERSON_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderServerComponent(element as never);
}

describe("Person page", () => {
  it("does not render the emergency-disclaimer block", async () => {
    const html = await renderPersonPage();
    expect(html).not.toContain("is not an emergency service");
    expect(html).not.toContain("contact your local emergency number directly");
  });

  it("shows fr-FR as the human-readable language label, never the raw code", async () => {
    const html = await renderPersonPage();
    expect(html).toContain("French");
    expect(html).not.toContain("fr-FR");
  });

  it("shows the conversation profile as a readable label, never the raw snake_case code", async () => {
    const html = await renderPersonPage();
    expect(html).not.toContain("cognitive_friendly");
    expect(html.toLowerCase()).toContain("cognitive-friendly");
  });

  it("no longer carries the 'Operational activity only' caption removed from the Activity card", async () => {
    const html = await renderPersonPage();
    expect(html).not.toContain("Operational activity only");
  });

  it("hides every 'n = 0' sample-size label when the person has no check-in history", async () => {
    const html = await renderPersonPage();
    expect(html).not.toMatch(/n\s*=\s*0/);
  });

  it("shows the correct empty state for a person with no check-in history at all", async () => {
    const html = await renderPersonPage();
    expect(html).toContain("No check-in has run yet");
  });

  it("offers Day/Week/Month/Year period filters, shared identically between Activity and Calls and decisions", async () => {
    const element = await PersonPage({
      params: Promise.resolve({ id: PERSON_ID }),
      searchParams: Promise.resolve({}),
    });
    const selectors = collectElements(element as never).filter(
      (node) => node.type === ProfilePeriodSelector
    );
    // One selector for Activity, one for Calls and decisions — both reading
    // the same query param, never two independent pieces of filter state.
    expect(selectors).toHaveLength(2);
    for (const selector of selectors) {
      expect(selector.props.current).toBe("month"); // DEFAULT_PROFILE_PERIOD
    }
  });

  it("preserves an explicit period selection in both selectors, and in the URL", async () => {
    const element = await PersonPage({
      params: Promise.resolve({ id: PERSON_ID }),
      searchParams: Promise.resolve({ period: "week" }),
    });
    const selectors = collectElements(element as never).filter(
      (node) => node.type === ProfilePeriodSelector
    );
    expect(selectors).toHaveLength(2);
    for (const selector of selectors) {
      expect(selector.props.current).toBe("week");
    }
    const html = renderServerComponent(element as never);
    expect(html).toMatch(/period=week/);
  });

  it("falls back to the default period for a malformed/unknown period value, never guessing or crashing", async () => {
    const element = await PersonPage({
      params: Promise.resolve({ id: PERSON_ID }),
      searchParams: Promise.resolve({ period: "not-a-real-period" }),
    });
    const selectors = collectElements(element as never).filter(
      (node) => node.type === ProfilePeriodSelector
    );
    for (const selector of selectors) {
      expect(selector.props.current).toBe("month");
    }
  });
});
