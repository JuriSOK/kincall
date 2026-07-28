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
    answered: false,
    situation_understood: false,
    can_intervene: false,
    intervention_type: null,
    estimated_time: null,
    contact_next_person: true,
    summary: "",
    ...overrides,
  };
}

describe("handleFamilyResult", () => {
  it("calls the next contact when the first contact does not answer", () => {
    const outcome = handleFamilyResult(familyResult({ answered: false }), [marc, nicole]);
    expect(outcome).toEqual({ kind: "no_answer", nextContactId: "contact_marc" });
  });

  it("calls the next contact when a contact declines", () => {
    const outcome = handleFamilyResult(familyResult({ answered: true, can_intervene: false }), [
      marc,
      nicole,
    ]);
    expect(outcome).toEqual({ kind: "declined", nextContactId: "contact_marc" });
  });

  it("stops the cascade when a contact confirms", () => {
    const outcome = handleFamilyResult(familyResult({ answered: true, can_intervene: true }), [
      marc,
      nicole,
    ]);
    expect(outcome).toEqual({ kind: "confirmed" });
  });

  it("requests human review when no contacts remain after a no-answer", () => {
    const outcome = handleFamilyResult(familyResult({ answered: false }), []);
    expect(outcome).toEqual({ kind: "no_answer_no_contacts_remaining" });
  });

  it("requests human review when no contacts remain after a decline", () => {
    const outcome = handleFamilyResult(familyResult({ answered: true, can_intervene: false }), []);
    expect(outcome).toEqual({ kind: "declined_no_contacts_remaining" });
  });
});
