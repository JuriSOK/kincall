// CALL-E validates recipient phone numbers against this pattern
// (calle.openapi.yaml, CallTaskRecipientRequest.phones.items). Checking it
// locally turns a wasted call credit and a 422 into a clear error.
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isE164(phone: string): boolean {
  return E164_PATTERN.test(phone);
}

// French numbers reserved for fiction (ARCEP 06 39 98 00 00 – 06 39 98 99 99).
// Valid E.164 so the format guard behaves realistically, but never routable to
// a real subscriber. Seeded as defaults so fake mode needs no configuration —
// which is exactly why live mode has to reject them explicitly: an unset
// KINCALL_*_PHONE silently leaves one of these in place, and it would sail
// past isE164() straight into a real outbound call.
export const RESERVED_FICTION_PHONES = {
  marie: "+33639980001",
  julie: "+33639980002",
  marc: "+33639980003",
  nicole: "+33639980004",
} as const;

// The whole ARCEP block, not just the four seeded constants: a profile created
// through the UI is minted a number from this range, and it has to be
// recognised as undialable too (DEC-006). +33 6 39 98 00 00 – +33 6 39 98 99 99.
const RESERVED_FICTION_PATTERN = /^\+3363998\d{4}$/;

export function isReservedFictionPhone(phone: string): boolean {
  return RESERVED_FICTION_PATTERN.test(phone.trim());
}

// The stored phone for a person or contact created through the interface.
//
// DEC-006: a real number is never written to the database — it lives only in
// KINCALL_*_PHONE and is overlaid on read. Every stored number is therefore
// reserved-for-fiction, which LiveCalleAdapter refuses to dial, so an
// unconfigured profile is visible and editable but can never place a live call.
//
// Deterministic in the entity id, so the same profile always shows the same
// number. Two entities may collide, which is harmless: the fake adapter ignores
// phone entirely and the live adapter refuses every number in this range.
// Starts at 0100 to stay clear of the four seeded demo numbers.
export function mintFictionPhone(entityId: string): string {
  let hash = 0;
  for (let index = 0; index < entityId.length; index += 1) {
    hash = (hash * 31 + entityId.charCodeAt(index)) >>> 0;
  }
  return `+3363998${String(100 + (hash % 9900)).padStart(4, "0")}`;
}

// Safety rule (CLAUDE.md): mask telephone numbers in anything that can be
// displayed or logged. Keeps the country prefix and the last two digits so a
// number is still recognisable to its owner without being dialable.
export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 5) return "•".repeat(trimmed.length);

  const head = trimmed.slice(0, 3);
  const tail = trimmed.slice(-2);
  return `${head}${"•".repeat(trimmed.length - 5)}${tail}`;
}

// Single source of truth for "may this number be dialled in live mode?".
// Returns null when it may, or a masked, actionable message when it may not —
// used both by the orchestrator's pre-flight check (so a misconfigured contact
// never strands an event mid-cascade) and by LiveCalleAdapter as a last line of
// defence before any request reaches CALL-E. The number is always masked.
export function describeUnusablePhone(phone: string, envVar?: string): string | null {
  const remedy = envVar ? ` Set ${envVar} to a consenting test participant's number.` : "";

  if (!isE164(phone)) {
    return `${maskPhone(phone)} is not a valid E.164 number.${remedy}`;
  }
  if (isReservedFictionPhone(phone)) {
    return `${maskPhone(phone)} is a reserved-for-fiction number and must never be dialled.${remedy}`;
  }
  return null;
}
