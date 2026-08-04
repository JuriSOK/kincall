import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ContactManager, type ContactSummary } from "@/app/(app)/people/[id]/contacts/contact-manager";
import { renderServerComponent } from "../support/render";

// Mirrors the seeded demo circle (src/backend/persistence/seed.ts): three confirmed,
// enabled contacts with no availability window and the default max attempts
// — exactly the shape that used to render "Callable window: Always
// available", "Maximum attempts: 2" and the whole per-contact statistics
// block on the default card.
const contacts: ContactSummary[] = [
  {
    id: "contact_julie",
    firstName: "Julie",
    relationship: "daughter",
    priority: 1,
    maskedPhone: "+33 6 •• •• •• 78",
    consentStatus: "confirmed",
    isPrimary: true,
    enabled: true,
    callableFrom: null,
    callableTo: null,
    timezone: null,
    maxAttempts: 2,
  },
  {
    id: "contact_marc",
    firstName: "Marc",
    relationship: "son",
    priority: 2,
    maskedPhone: "+33 6 •• •• •• 12",
    consentStatus: "confirmed",
    isPrimary: false,
    enabled: true,
    callableFrom: null,
    callableTo: null,
    timezone: null,
    maxAttempts: 2,
  },
];

function renderDefaultCards() {
  // ContactManager itself calls hooks (useRouter, useState, ...) at its own
  // top level — it must be handed to react-dom as an unexecuted element via
  // createElement, not invoked directly, or React has no render pass to
  // attach the hook dispatcher to.
  const element = createElement(ContactManager, {
    personId: "person_marie",
    personName: "Marie",
    contacts,
    readiness: {},
  });
  return renderServerComponent(element);
}

describe("Trusted-circle default card", () => {
  it("no longer shows availability/timezone/max-attempts fields by default", () => {
    const html = renderDefaultCards();
    expect(html).not.toContain("Callable window");
    expect(html).not.toContain("Always available");
    expect(html).not.toContain("Inherits");
    expect(html).not.toContain("Maximum attempts");
  });

  it("no longer shows the per-contact statistics block by default", () => {
    const html = renderDefaultCards();
    expect(html).not.toContain("Answered");
    expect(html).not.toContain("Accepted (of answered)");
    expect(html).not.toContain("Declined (of answered)");
    expect(html).not.toContain("Mean attempt when answering");
    expect(html).not.toContain("Confirmed interventions");
    expect(html).not.toContain("Last participation");
  });

  it("still shows name, relationship, primary status, consent, and masked phone", () => {
    const html = renderDefaultCards();
    expect(html).toContain("Julie");
    expect(html).toContain("daughter");
    expect(html).toContain("Primary");
    expect(html).toContain("Confirmed"); // describeConsentStatus("confirmed")
    expect(html).toContain("+33 6");
  });

  it("keeps edit, enable/disable, make-primary and delete actions available", () => {
    const html = renderDefaultCards();
    expect(html).toContain(">Edit<");
    expect(html).toContain("Disable"); // Julie/Marc are both enabled by default
    expect(html).toContain("Make primary"); // Marc is not primary
    expect(html).toContain('aria-label="Remove Julie"');
  });

  it("no longer carries the 'Cascade order' card's explanatory description", () => {
    const html = renderDefaultCards();
    expect(html).not.toContain("KinCall calls the circle in this order and stops as soon as someone confirms");
    expect(html).not.toContain("see the guarantee above");
  });

  it("availability, timezone and maximum attempts stay editable inside ContactEditPanel (only hidden from the default card, not deleted)", () => {
    // ContactEditPanel only mounts once `editingId` is set via a client
    // click, which this SSR-only harness cannot simulate without jsdom — so
    // this checks the panel's own module source directly, distinct from the
    // default-card assertions above which prove these fields are absent
    // *there*. Together they cover §6: removed from the default view,
    // still present in the edit interface.
    const source = readFileSync(
      new URL("../../src/app/(app)/people/[id]/contacts/contact-manager.tsx", import.meta.url),
      "utf-8"
    );
    const panelSource = source.slice(source.indexOf("function ContactEditPanel"));
    expect(panelSource).toContain("Always available");
    expect(panelSource).toContain('label="Timezone"');
    expect(panelSource).toContain('label="Maximum attempts"');
  });

  it("removes the four explanatory texts from the edit panel without leaving replacement prose", () => {
    const source = readFileSync(
      new URL("../../src/app/(app)/people/[id]/contacts/contact-manager.tsx", import.meta.url),
      "utf-8"
    );
    const panelSource = source.slice(source.indexOf("function ContactEditPanel"));
    expect(panelSource).not.toContain("(no usual callable window)");
    expect(panelSource).not.toContain("means overnight, crossing midnight");
    expect(panelSource).not.toContain("Never more than 2");
    expect(panelSource).not.toContain("Stored on the server, masked wherever it is shown");
  });

  it("shows 'Same as {PersonName}' instead of raw inherited-timezone wording, and never the old 'Inherit' phrasing", () => {
    const source = readFileSync(
      new URL("../../src/app/(app)/people/[id]/contacts/contact-manager.tsx", import.meta.url),
      "utf-8"
    );
    const panelSource = source.slice(source.indexOf("function ContactEditPanel"));
    expect(panelSource).not.toContain("Inherit from person");
    expect(panelSource).not.toContain('"Inherit"');
    expect(panelSource).toContain("describeContactTimezone(null, personName)");
  });
});
