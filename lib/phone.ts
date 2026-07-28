// CALL-E validates recipient phone numbers against this pattern
// (calle.openapi.yaml, CallTaskRecipientRequest.phones.items). Checking it
// locally turns a wasted call credit and a 422 into a clear error.
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isE164(phone: string): boolean {
  return E164_PATTERN.test(phone);
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
