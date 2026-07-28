import type { FamilyStructuredResult } from "../calle/schemas";
import type { TrustedContact } from "../database/types";

export type FamilyOutcome =
  | { kind: "confirmed" }
  | { kind: "declined"; nextContactId: string }
  | { kind: "no_answer"; nextContactId: string }
  | { kind: "declined_no_contacts_remaining" }
  | { kind: "no_answer_no_contacts_remaining" };

// Implements PRODUCT_SPECIFICATION.md §9.3's cascade-failure behavior.
// remainingContacts must already exclude the contact this result is for.
export function handleFamilyResult(
  result: FamilyStructuredResult,
  remainingContacts: TrustedContact[]
): FamilyOutcome {
  // Only an explicit "yes" stops the cascade (DEC-005). "unknown" means the
  // contact was vague or non-committal, and KinCall must never record a
  // hesitant answer as a confirmed intervention (§7.5) — it keeps looking for
  // someone who will actually commit.
  if (result.can_intervene === "yes") {
    return { kind: "confirmed" };
  }

  const nextContact = remainingContacts[0];

  if (result.answered === "yes") {
    if (!nextContact) return { kind: "declined_no_contacts_remaining" };
    return { kind: "declined", nextContactId: nextContact.id };
  }

  if (!nextContact) return { kind: "no_answer_no_contacts_remaining" };
  return { kind: "no_answer", nextContactId: nextContact.id };
}
