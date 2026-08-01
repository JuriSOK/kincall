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

// PRODUCT_SPECIFICATION.md §17.1: people who are called must have agreed to
// receive automated calls and to have the conversation analysed. Raised before
// any event is created, so an unconsented profile leaves nothing behind
// (DEC-007).
export class ConsentNotConfirmedError extends Error {
  constructor(
    public readonly personId: string,
    firstName: string
  ) {
    super(
      `${firstName} has not confirmed consent to receive automated calls, so KinCall will not call them.`
    );
    this.name = "ConsentNotConfirmedError";
  }
}

// DEC-009: a person may not be archived (soft-deleted) while any of their
// events is still open. Historical events are unaffected either way — this
// guards against archiving someone mid-check-in, which would leave a live
// cascade with nowhere to resolve back to.
export class PersonHasActiveEventError extends Error {
  constructor(public readonly personId: string) {
    super(
      `Repository: cannot archive person "${personId}" — an active event is still open.`
    );
    this.name = "PersonHasActiveEventError";
  }
}

// DEC-009: a trusted contact may not be archived while they have a call whose
// result is not yet processed — that call is either ringing or awaiting a
// webhook/poll, and archiving mid-call would orphan its eventual result.
export class ContactHasActiveCallError extends Error {
  constructor(public readonly contactId: string) {
    super(
      `Repository: cannot archive contact "${contactId}" — an active call is in progress.`
    );
    this.name = "ContactHasActiveCallError";
  }
}

// `orderedIds` was not exactly the person's trusted circle. Rejected whole:
// applying a partial order could silently drop somebody out of the cascade,
// which for a vulnerable person means nobody calls them.
export class InvalidContactOrderError extends Error {
  constructor(personId: string, detail: string) {
    super(`Repository: invalid contact order for "${personId}" — ${detail}.`);
    this.name = "InvalidContactOrderError";
  }
}

// Stage E (DEC-017): there is no "unarchive" action anywhere in this
// codebase, so an archived contact re-becoming primary or enabled would be a
// silent, permanent inconsistency with no interface path to notice or fix it
// — migration 0011's own CHECK constraint enforces this at the database
// layer; this is what a violation of it surfaces as in TypeScript.
export class ArchivedContactCannotBeReactivatedError extends Error {
  constructor(public readonly contactId: string) {
    super(
      `Repository: cannot enable or set as primary — contact "${contactId}" is archived.`
    );
    this.name = "ArchivedContactCannotBeReactivatedError";
  }
}

// setPrimaryContact refused: the id is unknown, belongs to a different
// person, or is archived. Nothing is changed when this is thrown — no
// interim state with zero or two primaries is ever left behind.
export class InvalidPrimaryContactError extends Error {
  constructor(personId: string, detail: string) {
    super(`Repository: cannot set primary contact for "${personId}" — ${detail}.`);
    this.name = "InvalidPrimaryContactError";
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
    // DEC-011: the attempt number is part of the intent's identity. Without it,
    // a replaying worker reasoning about attempt 2 could adopt attempt 1's
    // intent and place a second call under the first attempt's key.
    callEvent.attemptNumber !== expected.attemptNumber ||
    callEvent.idempotencyKey !== expected.idempotencyKey
  ) {
    throw new CallIntentIntegrityError(
      eventId,
      operationKey,
      `recorded (${callEvent.agentType}, ${callEvent.contactId}, attempt ${callEvent.attemptNumber}, ` +
        `${callEvent.idempotencyKey}) but expected (${expected.agentType}, ${expected.contactId}, ` +
        `attempt ${expected.attemptNumber}, ${expected.idempotencyKey})`
    );
  }
}
