import { describe, expect, it } from "vitest";
import ContactsPage from "@/app/(app)/people/[id]/contacts/page";
import { renderServerComponent } from "./support/render";

// person_marie is the repository's seeded demo profile.
const PERSON_ID = "person_marie";

async function renderContactsPage() {
  const element = await ContactsPage({ params: Promise.resolve({ id: PERSON_ID }) });
  return renderServerComponent(element as never);
}

describe("Trusted circle page", () => {
  it("no longer carries the removed page-header explanatory paragraph", async () => {
    const html = await renderContactsPage();
    expect(html).not.toContain("The people KinCall calls when a check-in for");
    expect(html).not.toContain("Availability only changes the ORDER contacts are tried in");
  });

  it("still shows the page title", async () => {
    const html = await renderContactsPage();
    expect(html).toContain("Trusted circle");
  });
});
