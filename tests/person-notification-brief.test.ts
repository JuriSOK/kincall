import { describe, expect, it } from "vitest";
import {
  buildPersonNotificationBrief,
  type ConfirmedNotificationFacts,
} from "@/lib/orchestration/person-notification-brief";

// DEC-023. What the monitored person actually hears once the trusted-circle
// outcome is settled. Pure wording — no orchestration, no clock, no database.

function confirmed(
  overrides: Partial<ConfirmedNotificationFacts> = {}
): ConfirmedNotificationFacts {
  return {
    kind: "confirmed",
    personName: "Claire",
    contactName: "Marc",
    estimatedTime: "",
    interventionType: "visit",
    contactSummary: "",
    ...overrides,
  };
}

describe("confirmed outcome — every intervention type", () => {
  it("a visit with a stated time", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ interventionType: "visit", estimatedTime: "this afternoon" }),
      null
    );
    expect(brief.outcome).toBe("Marc confirmed that they will visit you this afternoon.");
  });

  it("a call with a stated time", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ contactName: "Julie", interventionType: "call", estimatedTime: "within the hour" }),
      null
    );
    expect(brief.outcome).toBe("Julie confirmed that they will call you within the hour.");
  });

  it("a visit with no stated time", () => {
    const brief = buildPersonNotificationBrief(confirmed({ interventionType: "visit" }), null);
    expect(brief.outcome).toBe("Marc confirmed that they will come and see you.");
  });

  it("a call with no stated time", () => {
    const brief = buildPersonNotificationBrief(confirmed({ interventionType: "call" }), null);
    expect(brief.outcome).toBe("Marc confirmed that they will call you.");
  });

  it("an 'other' action falls back to the contact's own persisted summary", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({
        interventionType: "other",
        contactSummary: "Marc will send his neighbour round with the paperwork",
      }),
      null
    );
    expect(brief.outcome).toContain("Marc confirmed that they can help.");
    expect(brief.outcome).toContain("send his neighbour round with the paperwork");
  });

  it("an 'other' action with no summary says only that they can help", () => {
    const brief = buildPersonNotificationBrief(confirmed({ interventionType: "other" }), null);
    expect(brief.outcome).toBe(
      "Marc confirmed that they can help with the situation you described."
    );
  });

  it("adds 'at' only in front of a clock time, never an adverbial phrase", () => {
    expect(
      buildPersonNotificationBrief(confirmed({ estimatedTime: "17:30" }), null).outcome
    ).toContain("visit you at 17:30.");
    expect(
      buildPersonNotificationBrief(confirmed({ estimatedTime: "this afternoon" }), null).outcome
    ).toContain("visit you this afternoon.");
    expect(
      buildPersonNotificationBrief(confirmed({ estimatedTime: "this afternoon" }), null).outcome
    ).not.toContain("at this afternoon");
  });

  it("never claims the visit already happened, that KinCall verified it, or that the person is safe", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ estimatedTime: "this afternoon" }),
      "Claire told KinCall that she would like help with a form."
    );
    expect(brief.message).not.toMatch(/\bhas visited\b|\bhas called\b|\balready\b/i);
    expect(brief.message).not.toMatch(/verified|confirmed that it took place/i);
    expect(brief.message).not.toMatch(/\bsafe\b|\byou are fine\b|\bresolved\b/i);
    // Future tense throughout.
    expect(brief.outcome).toContain("will visit");
  });

  it("offers no 'contact someone else' guidance — somebody has already committed", () => {
    const brief = buildPersonNotificationBrief(confirmed(), null);
    expect(brief.guidance).toBeNull();
    expect(brief.message).not.toMatch(/contact another person/i);
  });
});

describe("unresolved outcome", () => {
  it("says nobody confirmed availability, and tells the person what they can do", () => {
    const brief = buildPersonNotificationBrief({ kind: "unresolved", personName: "Claire" }, null);
    expect(brief.outcome).toBe(
      "Nobody in your trusted circle confirmed that they were available."
    );
    expect(brief.guidance).toBe(
      "If you still need help, please contact another person you trust directly."
    );
  });

  // The distinction that matters: a contact may well have answered and declined.
  it("never says nobody answered", () => {
    const brief = buildPersonNotificationBrief({ kind: "unresolved", personName: "Claire" }, null);
    expect(brief.message).not.toMatch(/nobody answered/i);
    expect(brief.message).not.toMatch(/no answer/i);
    expect(brief.message).not.toMatch(/could not reach/i);
  });

  it("never blames the person, diagnoses, or claims urgency", () => {
    const brief = buildPersonNotificationBrief({ kind: "unresolved", personName: "Claire" }, null);
    expect(brief.message).not.toMatch(/urgent|emergency|serious|condition/i);
  });
});

describe("context appending", () => {
  it("appends the same factual brief the Family calls carried", () => {
    const context = "Claire told KinCall that she would like help completing an administrative document.";
    const brief = buildPersonNotificationBrief(
      confirmed({ estimatedTime: "this afternoon" }),
      context
    );
    expect(brief.context).toBe(context);
    expect(brief.message).toContain("administrative document");
    // Outcome first, context after — the person needs the answer, then the reminder.
    expect(brief.message.indexOf("Marc confirmed")).toBeLessThan(
      brief.message.indexOf("administrative document")
    );
  });

  it("works for an arbitrary context with no code change", () => {
    for (const context of [
      "Claire told KinCall that her boiler has stopped working.",
      "Claire told KinCall that she cannot find her house keys.",
    ]) {
      const brief = buildPersonNotificationBrief(confirmed(), context);
      expect(brief.message).toContain(context);
    }
  });

  it("omits the context entirely when there is none, rather than padding", () => {
    for (const empty of [null, "", "   "]) {
      const brief = buildPersonNotificationBrief(confirmed(), empty);
      expect(brief.context).toBeNull();
      expect(brief.message).toBe(brief.outcome);
    }
  });

  it("never emits an internal field name, enum value, or JSON", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ interventionType: "visit", estimatedTime: "17:30" }),
      "Claire told KinCall that she needs a hand with paperwork."
    );
    for (const forbidden of [
      "intervention_type",
      "can_intervene",
      "estimated_time",
      "person_reached",
      "contact_id",
      "{",
      "}",
    ]) {
      expect(brief.message).not.toContain(forbidden);
    }
  });
});
