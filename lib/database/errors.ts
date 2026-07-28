import type { CallIntentInput } from "./repository";
import type { CallEventRecord } from "./types";

// Typed repository errors, so callers can distinguish failure modes that look
// alike on the wire but mean very different things (DEC-006).

export class UnknownRecordError extends Error {
  constructor(kind: string, id: string) {
    super(`Repository: unknown ${kind} "${id}".`);
    this.name = "UnknownRecordError";
  }
}

// A genuine attempt to create a second row under an idempotency key that is
// already taken. Distinct from the same-key *recovery* case, which is not an
// error at all — see commitTransitionWithCallIntent.
export class DuplicateIdempotencyKeyError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`Repository: duplicate idempotency key "${idempotencyKey}".`);
    this.name = "DuplicateIdempotencyKeyError";
  }
}

// CALL-E itself refused to place the call, so NO call is in flight: the number
// is unusable, the network failed, or the API rejected the request.
//
// Deliberately distinct from a failure to *record* a call that CALL-E already
// accepted. DEC-005's safety net escalates this to human review, which is only
// correct when nobody is being called — escalating while a call is genuinely
// ringing would strand its eventual result, because the event would by then be
// at HUMAN_REVIEW_REQUIRED, from which every family transition is illegal.
export class CallStartFailedError extends Error {
  constructor(callEventId: string, cause: unknown) {
    super(
      `Engine: CALL-E did not accept the call for "${callEventId}" — ` +
        `${cause instanceof Error ? cause.message : "unknown error"}.`
    );
    this.name = "CallStartFailedError";
    this.cause = cause;
  }
}

// A call-start operation was replayed, but the intent the ledger permanently
// recorded for it is not the one the caller expected — a different contact, or
// a different idempotency key. Never a reason to create a second intent: the
// caller's reasoning has drifted from what was durably decided, and letting it
// proceed would place a call to somebody KinCall never selected (CLAUDE.md:
// a model must never freely select who is called).
export class CallIntentIntegrityError extends Error {
  constructor(
    public readonly eventId: string,
    public readonly operationKey: string,
    detail: string
  ) {
    super(
      `Repository: call intent mismatch for operation "${operationKey}" on event "${eventId}" — ${detail}.`
    );
    this.name = "CallIntentIntegrityError";
  }
}

// The four-field verification a replayed call-start operation must pass: the
// intent the ledger recorded has to be the one the caller expects.
//
// Performed in BOTH the TypeScript replay path (where the RPC is never
// reached, because the pre-check short-circuits) and inside the SQL function
// (which covers the race where the pre-check misses). Neither is redundant,
// because neither path executes the other.
export function assertIntentMatches(
  eventId: string,
  operationKey: string,
  callEvent: CallEventRecord,
  expected: CallIntentInput
): void {
  if (
    callEvent.eventId !== eventId ||
    callEvent.agentType !== expected.agentType ||
    callEvent.contactId !== expected.contactId ||
    callEvent.idempotencyKey !== expected.idempotencyKey
  ) {
    throw new CallIntentIntegrityError(
      eventId,
      operationKey,
      `recorded (${callEvent.agentType}, ${callEvent.contactId}, ${callEvent.idempotencyKey}) ` +
        `but expected (${expected.agentType}, ${expected.contactId}, ${expected.idempotencyKey})`
    );
  }
}
