import { describe, expect, it } from "vitest";
import type { FamilyStructuredResult } from "@/lib/calle/schemas";
import type { TrustedContact } from "@/lib/database/types";
import { handleFamilyResult } from "@/lib/orchestration/handle-family-result";

const marc: TrustedContact = {
  id: "contact_marc",
  personId: "person_marie",
  firstName: "Marc",
  phone: "+33639980003",
  relationship: "son",
  priority: 2,
  consentStatus: "confirmed",
};

const nicole: TrustedContact = {
  id: "contact_nicole",
  personId: "person_marie",
  firstName: "Nicole",
  phone: "+33639980004",
  relationship: "trusted neighbour",
  priority: 3,
  consentStatus: "confirmed",
};

function familyResult(overrides: Partial<FamilyStructuredResult>): FamilyStructuredResult {
  return {
    contact_id: "contact_julie",
    answered: "no",
    situation_understood: "unknown",
    can_intervene: "no",
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: "",
    ...overrides,
  };
}

describe("handleFamilyResult", () => {
  it("calls the next contact when the first contact does not answer", () => {
    const outcome = handleFamilyResult(familyResult({ answered: "no" }), [marc, nicole]);
    expect(outcome).toEqual({ kind: "no_answer", nextContactId: "contact_marc" });
  });

  it("calls the next contact when a contact declines", () => {
    const outcome = handleFamilyResult(familyResult({ answered: "yes", can_intervene: "no" }), [
      marc,
      nicole,
    ]);
    expect(outcome).toEqual({ kind: "declined", nextContactId: "contact_marc" });
  });

  it("stops the cascade when a contact confirms", () => {
    const outcome = handleFamilyResult(familyResult({ answered: "yes", can_intervene: "yes" }), [
      marc,
      nicole,
    ]);
    expect(outcome).toEqual({ kind: "confirmed" });
  });

  it("does not confirm when the contact answered but was non-committal", () => {
    const outcome = handleFamilyResult(
      familyResult({ answered: "yes", can_intervene: "unknown" }),
      [marc, nicole]
    );
    expect(outcome).toEqual({ kind: "declined", nextContactId: "contact_marc" });
  });

  it("does not confirm when reachability and intent are both unknown", () => {
    const outcome = handleFamilyResult(
      familyResult({ answered: "unknown", can_intervene: "unknown" }),
      [marc, nicole]
    );
    expect(outcome).toEqual({ kind: "no_answer", nextContactId: "contact_marc" });
  });

  it("requests human review when no contacts remain after a no-answer", () => {
    const outcome = handleFamilyResult(familyResult({ answered: "no" }), []);
    expect(outcome).toEqual({ kind: "no_answer_no_contacts_remaining" });
  });

  it("requests human review when no contacts remain after a decline", () => {
    const outcome = handleFamilyResult(familyResult({ answered: "yes", can_intervene: "no" }), []);
    expect(outcome).toEqual({ kind: "declined_no_contacts_remaining" });
  });
});
