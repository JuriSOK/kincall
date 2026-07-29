import { describe, expect, it } from "vitest";
import type { TrustedContact, VulnerablePerson } from "@/lib/database/types";
import { buildFamilyResultSchema, buildFamilyTask } from "@/prompts/family-agent";

const marie: VulnerablePerson = {
  id: "person_marie",
  firstName: "Marie",
  phone: "+33612345678",
  preferredLanguage: "fr-FR",
  conversationProfile: "cognitive_friendly",
  preferredCallTime: "09:00",
  interests: ["gardening"],
  consentStatus: "confirmed",
  archivedAt: null,
};

const julie: TrustedContact = {
  id: "contact_julie",
  personId: "person_marie",
  firstName: "Julie",
  phone: "+33698765432",
  relationship: "daughter",
  priority: 1,
  consentStatus: "confirmed",
  archivedAt: null,
};

describe("buildFamilyTask", () => {
  it("identifies KinCall as an automated assistant and forbids impersonation", () => {
    const task = buildFamilyTask(marie, julie, ["mentioned a fall"]);
    expect(task).toContain("automated assistant");
    expect(task).toMatch(/do not claim to be a family member/i);
  });

  it("carries only the supplied facts", () => {
    const task = buildFamilyTask(marie, julie, ["mentioned a fall"]);
    expect(task).toContain("mentioned a fall");
    expect(task).not.toContain("difficulty moving around");
    expect(task).toMatch(/do not repeat the rest of the conversation/i);
  });

  it("never contains the contact's phone number", () => {
    const task = buildFamilyTask(marie, julie, ["mentioned a fall"]);
    expect(task).not.toContain(julie.phone);
    expect(task).not.toContain("698765432");
  });

  it("instructs hedged wording rather than assertions of fact", () => {
    const task = buildFamilyTask(marie, julie, ["described difficulty moving around"]);
    expect(task).toMatch(/never as a diagnosis or a certainty/i);
    expect(task).toMatch(/told me she is having difficulty walking/i);
  });

  it("forbids promising that anyone will intervene", () => {
    const task = buildFamilyTask(marie, julie, []);
    expect(task).toMatch(/do not promise that anyone will intervene/i);
  });

  it("degrades safely when no facts were established", () => {
    const task = buildFamilyTask(marie, julie, []);
    expect(task).toContain("no specific detail was recorded");
  });
});

describe("buildFamilyResultSchema", () => {
  it("pins contact_id to the KinCall-selected contact", () => {
    const schema = buildFamilyResultSchema("contact_marc");
    expect(schema.properties.contact_id.description).toContain("contact_marc");
    expect(schema.properties.contact_id.description).toMatch(/copied verbatim/i);
  });

  it("uses only result_schema features CALL-E documents as supported", () => {
    const schema = buildFamilyResultSchema("contact_julie");
    const serialised = JSON.stringify(schema);
    expect(schema.additionalProperties).toBe(false);
    expect(serialised).not.toContain("$ref");
    expect(serialised).not.toContain("oneOf");
    expect(serialised).not.toContain("anyOf");
    expect(serialised).not.toContain("allOf");

    // No nullable/union types — CALL-E's result_schema has no null support,
    // which is why the sentinels exist. (Descriptions may mention the word
    // "null" as guidance to the model; only the types matter here.)
    for (const property of Object.values(schema.properties)) {
      expect(property.type).toBe("string");
    }
  });

  it("tells the model to use the sentinels instead of omitting a value", () => {
    const schema = buildFamilyResultSchema("contact_julie");
    expect(schema.properties.intervention_type.description).toMatch(/Never leave this empty/i);
    expect(schema.properties.estimated_time.description).toMatch(/Never return null/i);
    expect(schema.properties.estimated_time.description).toMatch(/empty string/i);
  });

  it("tells the model not to guess yes for can_intervene", () => {
    const schema = buildFamilyResultSchema("contact_julie");
    expect(schema.properties.can_intervene.description).toMatch(/do not guess yes/i);
    expect(schema.properties.can_intervene.enum).toEqual(["yes", "no", "unknown"]);
  });
});
