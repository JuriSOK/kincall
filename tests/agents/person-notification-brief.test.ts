import { describe, expect, it } from "vitest";
import {
  buildPersonNotificationBrief,
  type ConfirmedNotificationFacts,
} from "@/backend/agents/notification/message";

// DEC-023 revision. What the monitored person actually HEARS once the
// trusted-circle outcome is settled — spoken directly to her.
//
// The live failure this guards against: KinCall called Claire back and said
// "Marc confirmed that he will visit Claire this afternoon", then restated the
// administrative document she had asked about. Two faults in one sentence — a
// third-person reference to its own listener, and repetition of a problem she
// already knew she had. The callback now carries the OUTCOME ONLY.

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

// Fragments of every original Companion context that has ever reached a Family
// call. None may appear in what Claire hears.
const ORIGINAL_CONTEXTS = [
  "administrative document",
  "boiler",
  "house keys",
  "difficult to walk",
  "told KinCall",
];

function assertOutcomeOnly(message: string) {
  // Never her own name — she is the listener.
  expect(message).not.toMatch(/\bClaire\b/);
  // Never the original reason for the call.
  for (const context of ORIGINAL_CONTEXTS) {
    expect(message.toLowerCase()).not.toContain(context.toLowerCase());
  }
}

describe("confirmed outcome — spoken in the second person", () => {
  // Scenario A
  it("a visit with a stated time addresses the listener as 'you'", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ interventionType: "visit", estimatedTime: "this afternoon" })
    );
    expect(brief.message).toBe("Marc confirmed that they will visit you this afternoon.");
    expect(brief.message).toContain("Marc");
    expect(brief.message).toContain("visit you");
    expect(brief.message).toContain("this afternoon");
    expect(brief.message).not.toContain("visit Claire");
    assertOutcomeOnly(brief.message);
  });

  // Scenario B
  it("a call with a stated time", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ contactName: "Julie", interventionType: "call", estimatedTime: "within the hour" })
    );
    expect(brief.message).toBe("Julie confirmed that they will call you within the hour.");
    expect(brief.message).toContain("call you");
    expect(brief.message).not.toContain("call Claire");
    assertOutcomeOnly(brief.message);
  });

  // Scenario C
  it("a visit with no stated time", () => {
    const brief = buildPersonNotificationBrief(confirmed({ interventionType: "visit" }));
    expect(brief.message).toBe("Marc confirmed that they will come and see you.");
    assertOutcomeOnly(brief.message);
  });

  // Scenario D
  it("a call with no stated time", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ contactName: "Julie", interventionType: "call" })
    );
    expect(brief.message).toBe("Julie confirmed that they will call you.");
    assertOutcomeOnly(brief.message);
  });

  it("adds 'at' only before a clock time, never before an adverbial phrase", () => {
    expect(buildPersonNotificationBrief(confirmed({ estimatedTime: "17:30" })).message).toContain(
      "visit you at 17:30."
    );
    const afternoon = buildPersonNotificationBrief(
      confirmed({ estimatedTime: "this afternoon" })
    ).message;
    expect(afternoon).toContain("visit you this afternoon.");
    expect(afternoon).not.toContain("at this afternoon");
  });

  it("never claims the visit happened, that KinCall verified it, or that she is safe", () => {
    const brief = buildPersonNotificationBrief(confirmed({ estimatedTime: "this afternoon" }));
    expect(brief.message).not.toMatch(/\bhas visited\b|\bhas called\b|\balready\b/i);
    expect(brief.message).not.toMatch(/verified|took place/i);
    expect(brief.message).not.toMatch(/\bsafe\b|\byou are fine\b|\bresolved\b/i);
    expect(brief.message).toContain("will visit");
  });

  it("offers no 'contact someone else' guidance — somebody has already committed", () => {
    const brief = buildPersonNotificationBrief(confirmed());
    expect(brief.guidance).toBeNull();
    expect(brief.message).not.toMatch(/contact another person/i);
  });
});

// Scenario E
describe("confirmed 'other' intervention", () => {
  it("uses a safe persisted commitment in direct second-person form", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ interventionType: "other", contactSummary: "Marc will contact the repair service" })
    );
    expect(brief.message).toBe("Marc confirmed that they will contact the repair service for you.");
    assertOutcomeOnly(brief.message);
  });

  it("falls back when no action was recorded at all", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ interventionType: "other", contactSummary: "" })
    );
    expect(brief.message).toBe("Marc confirmed that they can help you.");
  });

  it("falls back rather than repeating a summary that names the listener", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({
        interventionType: "other",
        contactSummary: "Marc will drive Claire to the pharmacy",
      })
    );
    expect(brief.message).toBe("Marc confirmed that they can help you.");
    assertOutcomeOnly(brief.message);
  });

  it("falls back rather than repeating a summary that refers to her as 'her'", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({ interventionType: "other", contactSummary: "Marc will collect her prescription" })
    );
    expect(brief.message).toBe("Marc confirmed that they can help you.");
  });

  it("falls back on narrative prose rather than a commitment", () => {
    for (const summary of [
      "Marc understood the situation and said he would think about what to do next",
      "Marc cannot check in today",
      "The call went well.",
    ]) {
      const brief = buildPersonNotificationBrief(
        confirmed({ interventionType: "other", contactSummary: summary })
      );
      expect(brief.message).toBe("Marc confirmed that they can help you.");
    }
  });

  it("never lets JSON or an internal field name reach the call", () => {
    const brief = buildPersonNotificationBrief(
      confirmed({
        interventionType: "other",
        contactSummary: 'Marc will {"intervention_type":"other"}',
      })
    );
    expect(brief.message).toBe("Marc confirmed that they can help you.");
  });
});

// Scenario F
describe("unresolved outcome", () => {
  it("says nobody confirmed availability, and what she can do", () => {
    const brief = buildPersonNotificationBrief({ kind: "unresolved", personName: "Claire" });
    expect(brief.message).toBe(
      "Nobody in your trusted circle confirmed that they were available. " +
        "If you still need help, please contact another person you trust directly."
    );
    assertOutcomeOnly(brief.message);
  });

  // The distinction that matters: a contact may well have answered and declined.
  it("never says nobody answered, and never promises another attempt", () => {
    const brief = buildPersonNotificationBrief({ kind: "unresolved", personName: "Claire" });
    expect(brief.message).not.toMatch(/nobody answered/i);
    expect(brief.message).not.toMatch(/no answer/i);
    expect(brief.message).not.toMatch(/could not reach/i);
    expect(brief.message).not.toMatch(/try again|will keep trying/i);
  });

  it("never blames, diagnoses or claims urgency", () => {
    const brief = buildPersonNotificationBrief({ kind: "unresolved", personName: "Claire" });
    expect(brief.message).not.toMatch(/urgent|emergency|serious|condition/i);
  });
});

// Test 8 — arbitrary original contexts must never surface.
describe("the original Companion context never reaches the listener", () => {
  it("has no parameter through which a context could arrive", () => {
    // The composer takes facts only; the third-person Family brief cannot be
    // passed in at all any more.
    expect(buildPersonNotificationBrief.length).toBe(1);
  });

  it.each([["administrative document"], ["broken appliance"], ["lost keys"], ["mobility difficulty"]])(
    "stays absent on both outcome paths regardless of the original %s context",
    () => {
      assertOutcomeOnly(
        buildPersonNotificationBrief(confirmed({ estimatedTime: "this afternoon" })).message
      );
      assertOutcomeOnly(
        buildPersonNotificationBrief({ kind: "unresolved", personName: "Claire" }).message
      );
    }
  );
});

// Test 10
describe("nothing internal reaches the call", () => {
  it("emits no field name, enum value, JSON or phone number", () => {
    const messages = [
      buildPersonNotificationBrief(confirmed({ estimatedTime: "17:30" })).message,
      buildPersonNotificationBrief(confirmed({ interventionType: "call" })).message,
      buildPersonNotificationBrief(confirmed({ interventionType: "other" })).message,
      buildPersonNotificationBrief({ kind: "unresolved", personName: "Claire" }).message,
    ];
    for (const message of messages) {
      for (const forbidden of [
        "intervention_type",
        "can_intervene",
        "estimated_time",
        "person_reached",
        "contact_id",
        "{",
        "}",
      ]) {
        expect(message).not.toContain(forbidden);
      }
      expect(message).not.toMatch(/\+\d{6,}/);
    }
  });
});
