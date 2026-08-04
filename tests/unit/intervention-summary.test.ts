import { describe, expect, it } from "vitest";
import type { FamilyStructuredResult } from "@/backend/integrations/calle/schemas";
import type { CallEventRecord, EventRecord, TrustedContact } from "@/shared/domain/types";
import {
  buildInterventionSummary,
  VERIFICATION_DISCLAIMER,
  withTimePreposition,
} from "@/backend/presentation/intervention-summary";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event_001",
    runId: "00000000-0000-0000-0000-000000000000",
    personId: "person_marie",
    status: "CASE_CLOSED",
    currentContactPriority: null,
    decision: "CONTACT_TRUSTED_PERSON",
    decisionReason: null,
    createdAt: "2026-07-30T09:00:00.000Z",
    closedAt: "2026-07-30T09:10:00.000Z",
    ...overrides,
  };
}

function contact(overrides: Partial<TrustedContact> = {}): TrustedContact {
  return {
    id: "contact_marc",
    personId: "person_marie",
    firstName: "Marc",
    phone: "+33639980003",
    relationship: "son",
    priority: 2,
    consentStatus: "confirmed",
    archivedAt: null,
    isPrimary: false,
    enabled: true,
    callableFrom: null,
    callableTo: null,
    timezone: null,
    maxAttempts: 2,
    ...overrides,
  };
}

function familyResult(overrides: Partial<FamilyStructuredResult> = {}): FamilyStructuredResult {
  return {
    contact_id: "contact_marc",
    answered: "yes",
    situation_understood: "yes",
    can_intervene: "yes",
    intervention_type: "visit",
    estimated_time: "17:30",
    contact_next_person: "no",
    summary: "Marc confirmed a visit to Marie at 17:30.",
    voicemail_left: "no",
    ...overrides,
  };
}

function familyCall(
  structuredResult: unknown,
  overrides: Partial<CallEventRecord> = {}
): CallEventRecord {
  return {
    id: "call_event_002",
    eventId: "event_001",
    agentType: "family",
    contactId: "contact_marc",
    attemptNumber: 1,
    calleCallId: "calle_2",
    idempotencyKey: "key_2",
    status: "completed",
    summary: "",
    structuredResult,
    startedAt: "2026-07-30T09:05:00.000Z",
    endedAt: "2026-07-30T09:06:00.000Z",
    processingToken: null,
    processingStartedAt: null,
    resultProcessedAt: "2026-07-30T09:06:00.000Z",
    ...overrides,
  };
}

describe("buildInterventionSummary — a confirmed visit", () => {
  it("reads a clock time with the right preposition", () => {
    const summary = buildInterventionSummary(
      event(),
      [familyCall(familyResult())],
      [contact()]
    )!;

    expect(summary.concise).toBe("Marc will visit at 17:30.");
    expect(summary.action).toBe("Will visit");
    expect(summary.estimatedTimeText).toBe("at 17:30");
    expect(summary.contactName).toBe("Marc");
    expect(summary.relationship).toBe("son");
    expect(summary.missingFields).toEqual([]);
  });

  it("reads a relative time without inventing a preposition", () => {
    const summary = buildInterventionSummary(
      event(),
      [familyCall(familyResult({ estimated_time: "this afternoon" }))],
      // Same contact id the call was placed to, under a different name — the
      // accepting contact is resolved by callEvent.contactId, never by the
      // model-returned structuredResult.contact_id.
      [contact({ firstName: "Julie", relationship: "daughter" })]
    )!;

    expect(summary.concise).toBe("Julie will visit this afternoon.");
    expect(summary.estimatedTimeText).toBe("this afternoon");
  });

  it("includes the relationship in the fuller event-page sentence", () => {
    const summary = buildInterventionSummary(
      event(),
      [familyCall(familyResult())],
      [contact()]
    )!;
    expect(summary.detailed).toBe("Marc (son) told KinCall they would visit at 17:30.");
  });
});

describe("buildInterventionSummary — other intervention types", () => {
  it("renders a call intervention in plain language", () => {
    const summary = buildInterventionSummary(
      event(),
      [familyCall(familyResult({ intervention_type: "call", estimated_time: "this afternoon" }))],
      [contact()]
    )!;

    expect(summary.concise).toBe("Marc will call this afternoon.");
    expect(summary.action).toBe("Will call");
    expect(summary.actionKnown).toBe(true);
  });

  it("uses neutral wording for `other`, never inventing an action from the free text", () => {
    const summary = buildInterventionSummary(
      event(),
      [
        familyCall(
          familyResult({
            intervention_type: "other",
            estimated_time: "within the hour",
            summary: "Julie said she would pop round and check on her mother.",
          })
        ),
      ],
      [contact()]
    )!;

    // "pop round" is not upgraded to a visit — the summary is surfaced
    // verbatim instead, and the action stays neutral.
    expect(summary.concise).toBe("Marc confirmed they would help within the hour.");
    expect(summary.action).toBe("Confirmed they would help");
    expect(summary.actionKnown).toBe(false);
    expect(summary.action.toLowerCase()).not.toContain("visit");
    expect(summary.missingFields).toContain("the planned action");
  });
});

describe("buildInterventionSummary — missing and historical data", () => {
  it("omits the time cleanly when none was supplied", () => {
    const summary = buildInterventionSummary(
      event(),
      [familyCall(familyResult({ estimated_time: "" }))],
      [contact()]
    )!;

    expect(summary.concise).toBe("Marc will visit.");
    expect(summary.estimatedTimeText).toBeNull();
    expect(summary.missingFields).toContain("an estimated time");
  });

  it("falls back to neutral wording when the accepting contact record is gone", () => {
    const summary = buildInterventionSummary(
      event(),
      [familyCall(familyResult())],
      [] // the contact record no longer resolves
    )!;

    expect(summary.contactKnown).toBe(false);
    expect(summary.contactName).toBe("A trusted contact");
    expect(summary.relationship).toBeNull();
    expect(summary.concise).toBe("A trusted contact will visit at 17:30.");
    expect(summary.missingFields).toContain("the accepting contact's record");
  });

  it("still names an archived accepting contact, with a neutral note", () => {
    const summary = buildInterventionSummary(
      event(),
      [familyCall(familyResult())],
      [contact({ archivedAt: "2026-08-01T00:00:00.000Z", enabled: false })]
    )!;

    expect(summary.contactName).toBe("Marc");
    expect(summary.contactStateNote).toContain("removed from the trusted circle");
    // The note describes the contact's CURRENT state, never the intervention.
    expect(summary.concise).toBe("Marc will visit at 17:30.");
  });

  it("still names a disabled accepting contact, with its own distinct note", () => {
    const summary = buildInterventionSummary(
      event(),
      [familyCall(familyResult())],
      [contact({ enabled: false })]
    )!;

    expect(summary.contactName).toBe("Marc");
    expect(summary.contactStateNote).toContain("paused");
    expect(summary.contactStateNote).not.toContain("removed");
  });

  it("handles a historical result that predates voicemail_left", () => {
    const { voicemail_left: _omitted, ...withoutVoicemail } = familyResult();
    const summary = buildInterventionSummary(
      event(),
      [familyCall(withoutVoicemail)],
      [contact()]
    );
    expect(summary).not.toBeNull();
    expect(summary!.concise).toBe("Marc will visit at 17:30.");
  });

  it("has no missing-field noise when everything was recorded", () => {
    const summary = buildInterventionSummary(event(), [familyCall(familyResult())], [contact()])!;
    expect(summary.missingFields).toHaveLength(0);
  });
});

describe("buildInterventionSummary — confirmation validity", () => {
  it("returns null for a malformed historical structured result", () => {
    expect(
      buildInterventionSummary(event(), [familyCall({ nonsense: true })], [contact()])
    ).toBeNull();
  });

  it("returns null when a contact answered but did not confirm", () => {
    expect(
      buildInterventionSummary(
        event(),
        [familyCall(familyResult({ can_intervene: "no" }))],
        [contact()]
      )
    ).toBeNull();
  });

  it("returns null for a non-committal answer, never treating unknown as confirmation", () => {
    expect(
      buildInterventionSummary(
        event(),
        [familyCall(familyResult({ can_intervene: "unknown" }))],
        [contact()]
      )
    ).toBeNull();
  });

  it("returns null for CASE_CLOSED with no trusted-contact call at all", () => {
    expect(
      buildInterventionSummary(event({ decision: "LOG_AND_CLOSE" }), [], [contact()])
    ).toBeNull();
  });

  it("returns null when an intervention_type exists but nothing was confirmed", () => {
    // The schema's `visit` sentinel can appear on a result that confirms
    // nothing — the type alone must never be read as acceptance.
    expect(
      buildInterventionSummary(
        event(),
        [familyCall(familyResult({ can_intervene: "no", intervention_type: "visit" }))],
        [contact()]
      )
    ).toBeNull();
  });

  it("returns null for ATTENTION_UNRESOLVED, where nobody confirmed", () => {
    const unresolved = event({ status: "ATTENTION_UNRESOLVED", closedAt: null });
    const declined = familyCall(familyResult({ can_intervene: "no", answered: "yes" }));
    const noAnswer = familyCall(familyResult({ can_intervene: "no", answered: "no" }), {
      id: "call_event_003",
    });

    expect(buildInterventionSummary(unresolved, [declined, noAnswer], [contact()])).toBeNull();
  });

  it("ignores a companion call, however its result reads", () => {
    const companion = familyCall(familyResult(), {
      id: "call_event_001",
      agentType: "companion",
      contactId: null,
    });
    expect(buildInterventionSummary(event(), [companion], [contact()])).toBeNull();
  });
});

describe("buildInterventionSummary — what is never rendered", () => {
  const summary = buildInterventionSummary(event(), [familyCall(familyResult())], [contact()])!;
  const allText = [
    summary.concise,
    summary.detailed,
    summary.action,
    summary.contactName,
    summary.estimatedTimeText ?? "",
    summary.contactStateNote ?? "",
    summary.disclaimer,
  ].join(" ");

  it("never leaks a raw enum value", () => {
    // "visit" legitimately appears as an English verb ("Will visit"); what
    // must never appear is a bare machine value standing alone as a field
    // value, nor any schema field name.
    expect(summary.action).not.toBe("visit");
    expect(summary.action).not.toBe("call");
    expect(summary.action).not.toBe("other");
    expect(allText).not.toContain("can_intervene");
    expect(allText).not.toContain("intervention_type");
    expect(allText).not.toContain("estimated_time");
  });

  it("never leaks an internal contact id", () => {
    expect(allText).not.toContain("contact_marc");
    expect(allText).not.toContain("person_marie");
    expect(allText).not.toContain("event_001");
  });

  it("never leaks a phone number", () => {
    expect(allText).not.toContain("+33639980003");
    expect(allText).not.toMatch(/\+\d{6,}/);
  });

  it("always carries the verification disclaimer", () => {
    expect(summary.disclaimer).toBe(VERIFICATION_DISCLAIMER);
    expect(summary.disclaimer).toMatch(/has not verified/i);
  });

  it("never claims the intervention actually happened", () => {
    // Deliberately EXCLUDES the disclaimer: its whole job is to deny that the
    // action took place ("has not verified that the action took place"), so
    // scanning it for those same phrases would fail on the one sentence that
    // makes the guarantee. Only KinCall's own claims are checked here.
    const claimText = [
      summary.concise,
      summary.detailed,
      summary.action,
      summary.estimatedTimeText ?? "",
      summary.contactStateNote ?? "",
    ].join(" ");

    // Every sentence is future or reported speech — never a past-tense claim
    // that the visit or call happened.
    expect(summary.concise).toMatch(/will visit/);
    expect(claimText).not.toMatch(/\b(has visited|visited them|did visit|has called|took place)\b/i);
    expect(claimText).not.toMatch(/\b(is safe|resolved|verified)\b/i);
  });
});

describe("withTimePreposition — grammar only, never parsing", () => {
  it.each([
    ["17:30", "at 17:30"],
    ["9:05", "at 9:05"],
    ["18h00", "at 18h00"],
    ["6pm", "at 6pm"],
    ["6 p.m.", "at 6 p.m."],
  ])("prefixes a clock-like value: %s -> %s", (input, expected) => {
    expect(withTimePreposition(input)).toBe(expected);
  });

  it.each([
    ["this afternoon", "this afternoon"],
    ["this evening", "this evening"],
    ["within the hour", "within the hour"],
    ["tomorrow morning", "tomorrow morning"],
    ["around 6", "around 6"],
    ["at 17:30", "at 17:30"],
    ["vers 18h00", "vers 18h00"],
  ])("leaves an already-readable value untouched: %s", (input, expected) => {
    expect(withTimePreposition(input)).toBe(expected);
  });

  it("renders unusual historical free text exactly as stored", () => {
    expect(withTimePreposition("dès que possible")).toBe("dès que possible");
    expect(withTimePreposition("??? unknown ???")).toBe("??? unknown ???");
  });

  it("treats whitespace-only as absent", () => {
    expect(withTimePreposition("   ")).toBe("");
  });
});
