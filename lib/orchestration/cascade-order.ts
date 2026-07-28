import type { TrustedContact } from "../database/types";

// Which trusted contact the cascade calls next, chosen by priority succession
// from the contact whose result triggered this step.
//
// This deliberately does NOT derive the next contact from "who has not been
// called yet". That older approach read the answer out of which rows exist, so
// a replay — where the next contact's row was already written before the crash
// — would skip past them and call the contact *after* the intended one. Julie's
// step must always intend Marc, on the first run and on every replay, or a
// stale worker ends up dialling Nicole while a live call to Marc is in flight.
//
// `contacts` must be priority-ascending, which the repository guarantees.
// Returns undefined when the trusted circle is exhausted.
export function nextContactAfter(
  contacts: TrustedContact[],
  previousContactId: string | null
): TrustedContact | undefined {
  // Triggered by the Companion result: nobody has been tried yet.
  if (previousContactId === null) return contacts[0];

  const index = contacts.findIndex((contact) => contact.id === previousContactId);
  if (index === -1) return undefined;
  return contacts[index + 1];
}
