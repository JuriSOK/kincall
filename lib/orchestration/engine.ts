import type { CalleAdapter } from "../calle/adapter";
import { getCalleAdapter, getCalleMode } from "../calle/adapter";
import {
  isCompanionStructuredResult,
  isFamilyStructuredResult,
  normalizeCompanionResult,
  readCompanionResult,
} from "../calle/schemas";
import {
  assertIntentMatches,
  CallStartFailedError,
  ConsentNotConfirmedError,
  UnknownRecordError,
} from "../database/errors";
import type {
  CallEventLease,
  CallIntentInput,
  CommitTransitionInput,
  Repository,
} from "../database/repository";
import { phoneEnvVarFor } from "../database/seed";
import { getRepository } from "../database/store";
import { describeUnusablePhone } from "../phone";
import type { CallEventRecord, EventRecord, TrustedContact } from "../database/types";
import { orderContactsForCascade } from "./contact-order";
import { decideCompanionAction } from "./decide-companion-action";
import { handleFamilyResult } from "./handle-family-result";
import { attemptDiscriminator, operationKey } from "./operation-keys";
import { isTerminalEventStatus, type TransitionEvent } from "./states";
import { nextStatus } from "./transitions";
import { classifyVoicemail, describeVoicemailOutcome } from "./voicemail";

export interface EngineDeps {
  repository: Repository;
  calleAdapter: CalleAdapter;
}

export function getDefaultDeps(): EngineDeps {
  return { repository: getRepository(), calleAdapter: getCalleAdapter() };
}

// How long a worker may hold a result before another may reclaim it. The rule:
// this must be >= the platform's function timeout, so a worker that is still
// running is never preempted, while a killed worker's lease expires shortly
// after its death. Too short means wasteful concurrent replays of live work
// (safe, because every write is idempotent); too long delays recovery.
const DEFAULT_LEASE_SECONDS = 90;

export function getLeaseSeconds(): number {
  const configured = Number(process.env.KINCALL_PROCESSING_LEASE_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LEASE_SECONDS;
}

interface TransitionOutcome {
  event: EventRecord;
  applied: boolean;
  conflict: boolean;
}

type TransitionOptions = Pick<CommitTransitionInput, "patch" | "messages">;

// Applies a transition exactly once. The already-applied check runs BEFORE
// nextStatus(), which throws on an edge that is illegal from an
// already-advanced status (transitions.ts) — a replay must no-op, not crash.
async function applyTransition(
  deps: EngineDeps,
  event: EventRecord,
  transitionEvent: TransitionEvent,
  key: string,
  options: TransitionOptions = {}
): Promise<TransitionOutcome> {
  if (await deps.repository.findAppliedOperation(event.id, key)) {
    return { event: (await deps.repository.getEvent(event.id)) ?? event, applied: false, conflict: false };
  }

  const status = nextStatus(event.status, transitionEvent);
  return deps.repository.commitTransition({
    eventId: event.id,
    operationKey: key,
    transitionEvent,
    expectedFromStatus: event.status,
    status,
    ...options,
  });
}

// Same, for the two transitions that start an outbound call. The transition
// and its call intent are written in ONE transaction, so a crash can never
// leave the event advanced with no intent to drive it.
//
// The replay lookup happens first and short-circuits: a replayed
// FAMILY_CALL_STARTED arrives when the event is already at
// CALLING_TRUSTED_CONTACT, from which that edge is illegal, so evaluating
// nextStatus() first would throw on a perfectly legitimate replay.
async function applyTransitionWithCallIntent(
  deps: EngineDeps,
  event: EventRecord,
  transitionEvent: TransitionEvent,
  key: string,
  options: TransitionOptions & { intent: CallIntentInput }
): Promise<TransitionOutcome & { callEvent: CallEventRecord | null }> {
  const replay = await deps.repository.getAppliedTransitionWithCallIntent(event.id, key);
  if (replay) {
    // The ledger permanently records which intent this operation created.
    // If it is not the one we expect, our reasoning has drifted from what was
    // durably decided — an integrity error, never a second intent.
    assertIntentMatches(event.id, key, replay.callEvent, options.intent);
    return { event: replay.event, applied: false, conflict: false, callEvent: replay.callEvent };
  }

  const status = nextStatus(event.status, transitionEvent);
  return deps.repository.commitTransitionWithCallIntent({
    eventId: event.id,
    operationKey: key,
    transitionEvent,
    expectedFromStatus: event.status,
    status,
    ...options,
  });
}

// The complete set of facts a Family call may mention (§17.3: transmit only
// what is necessary; §9.2's `information_to_share`). Derived from the validated
// Companion result so a family member is never told something the check-in did
// not actually establish.
async function collectInformationToShare(deps: EngineDeps, eventId: string): Promise<string[]> {
  const calls = await deps.repository.listCallEvents(eventId);
  // The LAST companion call, not the first: after a bounded retry there are two,
  // and what a relative is told must come from the attempt that actually
  // produced the decision (DEC-011).
  const companionCalls = calls.filter((call) => call.agentType === "companion");
  const latest = companionCalls[companionCalls.length - 1]?.structuredResult;

  // readCompanionResult, not the strict guard: an event that started before
  // DEC-011 still has a v1 result stored, and a relative must still be told the
  // right facts about it.
  const result = readCompanionResult(latest);
  if (!result) {
    // A result KinCall cannot read at all. It says nothing rather than
    // guessing — but the call still happens, because the cascade was triggered
    // precisely because this could not be validated.
    return ["could not be checked in on successfully"];
  }

  const facts: Array<[boolean, string]> = [
    [result.personReached === "no", "could not be reached for their check-in"],
    [result.explicitHelpRequested === "yes", "asked for help"],
    [result.fallMentioned === "yes", "mentioned a fall"],
    [result.mobilityDifficulty === "yes", "described difficulty moving around"],
    [result.painOrInjuryMentioned === "yes", "mentioned pain or an injury"],
    [result.unusualConfusion === "yes", "seemed more confused than usual"],
    [result.distressExpressed === "yes", "expressed distress"],
    [result.conversationEndedNormally === "no", "ended the check-in call unexpectedly"],
    [result.otherAttentionSignal === "yes", "described another unusual situation"],
    [
      result.doesNotWantToDisturbFamily === "yes",
      "said they did not want to disturb their family",
    ],
  ];

  return facts.filter(([present]) => present).map(([, fact]) => fact);
}

// Whether this contact may be called at all, and why not.
//
// DEC-007's consent rule is unchanged and still absolute: no call is placed to
// anyone whose consent is not confirmed, in ANY mode, because §17.1 makes that a
// property of the person and not of whether the dialling is real. What DEC-011
// changed is only what happens NEXT — the cascade skips them and calls the next
// eligible contact, instead of the whole event stopping.
function contactBlockedReason(contact: TrustedContact): string | null {
  if (contact.consentStatus !== "confirmed") {
    return `${contact.firstName} has not confirmed consent to be called (§17.1)`;
  }
  // Only live mode needs a dialable number; fake mode never dials.
  return getCalleMode() === "live"
    ? describeUnusablePhone(contact.phone, phoneEnvVarFor(contact.id))
    : null;
}

// Places the CALL-E call for an ALREADY-PERSISTED intent, then attaches the
// returned call id. Idempotent twice over: it returns immediately when the id
// is already attached, and it reuses the intent's idempotency key so CALL-E
// itself returns the same call rather than placing a second one.
//
// It cannot be reached without an intent — there is no other signature — and
// the repository offers no other way to create one.
export async function placeCallForIntent(
  deps: EngineDeps,
  callEvent: CallEventRecord
): Promise<CallEventRecord> {
  if (callEvent.calleCallId !== null) return callEvent;

  const event = await deps.repository.getEvent(callEvent.eventId);
  if (!event) throw new UnknownRecordError("event", callEvent.eventId);

  const person = await deps.repository.getPerson(event.personId);
  if (!person) throw new Error(`Engine: unknown person "${event.personId}".`);

  let contact: TrustedContact | undefined;
  if (callEvent.agentType === "family") {
    // Active-only (DEC-009): this contact's call is still an unprocessed
    // intent at this point, and the safety rule that blocks archiving a
    // contact with an active call means they cannot have been archived yet.
    const contacts = await deps.repository.getActiveTrustedContacts(event.personId);
    contact = contacts.find((candidate) => candidate.id === callEvent.contactId);
    if (!contact) {
      throw new Error(`Engine: call event "${callEvent.id}" has no known trusted contact.`);
    }
  }

  // Only the ADAPTER call is classified as a start failure. Everything after
  // it — including attaching the returned id — happens with a real call
  // already in flight, and must surface as an ordinary error so a later poll
  // or webhook re-drives it rather than escalating a live call to human review.
  let callId: string;
  try {
    const reference =
      callEvent.agentType === "companion"
        ? await deps.calleAdapter.startCompanionCall({
            eventId: event.id,
            person,
            idempotencyKey: callEvent.idempotencyKey,
            attemptNumber: callEvent.attemptNumber,
          })
        : await deps.calleAdapter.startFamilyCall({
            eventId: event.id,
            person,
            contact: contact!,
            idempotencyKey: callEvent.idempotencyKey,
            informationToShare: await collectInformationToShare(deps, event.id),
            attemptNumber: callEvent.attemptNumber,
            // A voicemail is only ever attempted on the FINAL attempt to this
            // contact, and only when the integration can genuinely leave and
            // confirm one (DEC-011). Both conditions, decided here rather than
            // by the agent, so an unsupported integration never produces a
            // message KinCall would then have to describe as "left". "Final"
            // is per-contact (DEC-017: effectiveMaxAttempts) — a contact
            // configured for a single attempt has no attempt 2 at all, so
            // attempt 1 is already their last.
            mayLeaveVoicemail:
              deps.calleAdapter.capabilities.voicemail &&
              callEvent.attemptNumber >= effectiveMaxAttempts(contact!),
          });
    callId = reference.callId;
  } catch (error) {
    throw new CallStartFailedError(callEvent.id, error);
  }

  return deps.repository.attachCalleCallId(callEvent.id, callId);
}

type CallOutcome = Pick<
  CallEventRecord,
  "status" | "summary" | "structuredResult" | "endedAt"
>;

function completedOutcome(
  summary: string | null = null,
  structuredResult: unknown = null
): CallOutcome {
  return { status: "completed", summary, structuredResult, endedAt: new Date().toISOString() };
}

// A terminal result that can never be applied, because another worker already
// advanced the event past the state this transition leaves from. It must still
// be RETIRED: returning while holding the lease would let it expire, be
// reclaimed, conflict, and return again — forever, every lease period.
//
// The outcome is stored so it stays inspectable, and nothing else is touched:
// no event change, no timeline entry, no outbound call, no ledger row.
async function supersede(
  deps: EngineDeps,
  event: EventRecord,
  callEventId: string,
  lease: CallEventLease,
  outcome: CallOutcome
): Promise<EventRecord> {
  // A null return means the lease was stolen; the winner owns it now.
  await deps.repository.finalizeCallEventResult(callEventId, lease.token, outcome);
  return (await deps.repository.getEvent(event.id)) ?? event;
}

interface CascadeStep {
  event: EventRecord;
  nextCallEventId: string | null;
}

// The two transitions that bracket one outbound check-in call. Keyed on the
// event's runId plus the attempt number: the runId because it is stable across a
// restart (DEC-004), and the attempt because attempt 2 must not collide with
// attempt 1's already-applied operation and silently no-op (DEC-011).
function companionStartKey(
  runId: string,
  transitionEvent: TransitionEvent,
  attemptNumber: number
): string {
  return operationKey(
    runId,
    "start",
    transitionEvent,
    attemptDiscriminator("companion", attemptNumber)
  );
}

// Places the bounded second check-in call to the vulnerable person.
//
// DEC-003 left RETRY_CHECK_IN meaning "a retry is owed", waiting for a human to
// act. DEC-011 makes it autonomous. It cannot loop: the attempt number is
// persisted, decideCompanionAction refuses to ask for an attempt beyond
// MAX_COMPANION_ATTEMPTS, and the (event, companion, attempt) uniqueness rule
// would reject a duplicate intent even if it did.
async function startCompanionRetry(
  deps: EngineDeps,
  event: EventRecord,
  options: { attemptNumber: number; personName: string }
): Promise<CascadeStep> {
  const current = (await deps.repository.getEvent(event.id)) ?? event;
  if (isTerminalEventStatus(current.status)) {
    return { event: current, nextCallEventId: null };
  }

  const key = (transitionEvent: TransitionEvent) =>
    companionStartKey(current.runId, transitionEvent, options.attemptNumber);

  const result = await applyTransitionWithCallIntent(
    deps,
    current,
    "COMPANION_CALL_STARTED",
    key("COMPANION_CALL_STARTED"),
    {
      messages: [
        `Calling ${options.personName} again (attempt ${options.attemptNumber})`,
      ],
      intent: {
        agentType: "companion",
        contactId: null,
        attemptNumber: options.attemptNumber,
        idempotencyKey: `${current.runId}_companion_attempt_${options.attemptNumber}`,
      },
    }
  );

  if (result.conflict) {
    return {
      event: (await deps.repository.getEvent(current.id)) ?? current,
      nextCallEventId: null,
    };
  }

  const callEvent = result.callEvent!;
  if (callEvent.resultProcessedAt !== null) {
    return { event: result.event, nextCallEventId: null };
  }

  try {
    await placeCallForIntent(deps, callEvent);
  } catch (error) {
    if (!(error instanceof CallStartFailedError)) throw error;
    // The retry could not even be placed, so nobody has spoken to the person on
    // either attempt. Go to the trusted circle rather than stalling with a
    // half-started call (DEC-011).
    const detail = error.cause instanceof Error ? error.cause.message : "unknown error";
    const escalated = await applyTransition(
      deps,
      result.event,
      "COMPANION_RESULT_ATTENTION",
      key("COMPANION_RESULT_ATTENTION"),
      {
        patch: {
          decision: "CONTACT_TRUSTED_PERSON",
          decisionReason: `The person could not be called back (${detail}).`,
        },
        messages: [`Could not call ${options.personName} back — ${detail}`],
      }
    );
    const step = await startNextFamilyCall(deps, escalated.event, {
      trigger: callEvent.id,
      previous: null,
    });
    return { event: step.event, nextCallEventId: step.nextCallEventId };
  }

  const inProgress = await applyTransition(
    deps,
    result.event,
    "COMPANION_CONVERSATION_STARTED",
    key("COMPANION_CONVERSATION_STARTED")
  );

  return { event: inProgress.event, nextCallEventId: callEvent.id };
}

// Exactly one retry per trusted contact (DEC-011). Bounded for the same reason
// the person's retry is: an unanswered contact must lead to the NEXT contact, not
// to an endless redial of the same one.
export const MAX_CONTACT_ATTEMPTS = 2;

// Stage E (DEC-017) / CLAUDE.md: per-contact configuration
// (TrustedContact.maxAttempts) may only LOWER how many times a contact is
// tried below MAX_CONTACT_ATTEMPTS, never raise it. Applied everywhere an
// attempt number is compared against "the last attempt to this contact" —
// selection (selectCascadeTarget), and voicemail eligibility below — so a
// stored value greater than 2 (however it got there) can never be honoured.
function effectiveMaxAttempts(contact: TrustedContact): number {
  return Math.min(contact.maxAttempts, MAX_CONTACT_ATTEMPTS);
}

// What just happened to the contact whose result triggered this cascade step.
// `retryable` is what distinguishes "call them once more" from "move on": a
// contact who declined has given a definitive answer, so calling them again
// would be both useless and intrusive.
interface PreviousCascadeStep {
  contactId: string;
  attemptNumber: number;
  retryable: boolean;
}

interface CascadeTarget {
  contact: TrustedContact;
  attemptNumber: number;
}

interface TargetSelection {
  target: CascadeTarget | null;
  // Contacts passed over without being called, with the reason, so the timeline
  // can say so rather than silently omitting them.
  skipped: Array<{ contact: TrustedContact; reason: string }>;
}

// Chooses the next call the cascade should place, deterministically and from
// durable facts only, so a replaying worker reaches the identical decision.
//
// The order is: retry the same contact if that attempt is still owed, otherwise
// walk forward through the circle by priority succession.
//
// Deliberately NOT "whoever has no call_events row yet". That reads the answer
// out of which rows happen to exist, so a replay — where the next contact's row
// was already written before the crash — would skip past them and dial the
// contact *after* the intended one. Julie's step must intend Marc on the first
// run and on every replay, or a stale worker ends up calling Nicole while a live
// call to Marc is in flight.
export function selectCascadeTarget(
  contacts: TrustedContact[],
  previous: PreviousCascadeStep | null
): TargetSelection {
  const skipped: TargetSelection["skipped"] = [];

  // A retry of the same contact, if one is still owed and they are still
  // eligible. `contacts` is the ACTIVE circle, so a contact archived mid-cascade
  // has already disappeared from it and falls through to the walk below.
  // The bound is per-contact (DEC-017: effectiveMaxAttempts), never higher
  // than MAX_CONTACT_ATTEMPTS — a contact configured for a single attempt
  // (maxAttempts: 1) has no retry owed at all, whatever `previous` says.
  if (previous && previous.retryable) {
    const same = contacts.find((candidate) => candidate.id === previous.contactId);
    if (
      same &&
      previous.attemptNumber < effectiveMaxAttempts(same) &&
      contactBlockedReason(same) === null
    ) {
      return { target: { contact: same, attemptNumber: previous.attemptNumber + 1 }, skipped };
    }
  }

  const startIndex =
    previous === null
      ? 0
      : contacts.findIndex((candidate) => candidate.id === previous.contactId) + 1;
  // findIndex returned -1 (the previous contact was archived mid-cascade, so it
  // is no longer in this list): there is no defensible successor to resume from,
  // and guessing one could call somebody KinCall never selected.
  if (previous !== null && startIndex === 0) return { target: null, skipped };

  for (let index = startIndex; index < contacts.length; index += 1) {
    const candidate = contacts[index];
    const blocked = contactBlockedReason(candidate);
    if (blocked === null) {
      return { target: { contact: candidate, attemptNumber: 1 }, skipped };
    }
    skipped.push({ contact: candidate, reason: blocked });
  }

  return { target: null, skipped };
}

// Starts the next trusted-contact call, or ends the cascade when nobody is
// left. One step per inbound event: in fake mode processFamilyResult finds a
// terminal result immediately and recurses, so the whole cascade still
// completes synchronously; in live mode it sees `queued` and returns, leaving
// the event to be resumed by the webhook or the poll route.
async function startNextFamilyCall(
  deps: EngineDeps,
  event: EventRecord,
  options: { trigger: string; previous: PreviousCascadeStep | null }
): Promise<CascadeStep> {
  const current = (await deps.repository.getEvent(event.id)) ?? event;

  // Another worker already finished this event. Stop immediately — never call
  // one more person on top of an already-finished case.
  if (isTerminalEventStatus(current.status)) {
    return { event: current, nextCallEventId: null };
  }

  // Active-only (DEC-009): an archived contact must never be selected for a
  // new cascade step. Stage E (DEC-017): reordered by availability at the
  // event's own persisted creation instant — never Date.now() — so a replay,
  // a poll, or a restart recomputes the identical order every time. Consent
  // is deliberately NOT filtered by orderContactsForCascade; that stays
  // selectCascadeTarget's own job (contactBlockedReason, unchanged since
  // DEC-011), which is what still produces its "Skipped <name> — has not
  // confirmed consent" timeline entry.
  const activeContacts = await deps.repository.getActiveTrustedContacts(current.personId);
  const person = await deps.repository.getPerson(current.personId);
  if (!person) throw new Error(`Engine: unknown person "${current.personId}".`);
  const contacts = orderContactsForCascade(activeContacts, current.createdAt, person.timezone);
  const { target, skipped } = selectCascadeTarget(contacts, options.previous);

  // Recorded on whichever transition actually applies, so these entries are
  // written exactly once and can never be orphaned by a replay (DEC-006). A skip
  // is not a transition of its own: nothing about the event changed, and nobody
  // was called.
  const skipMessages = skipped.map(
    ({ contact, reason }) => `Skipped ${contact.firstName} without calling — ${reason}`
  );

  if (!target) {
    // Terminal and autonomous: KinCall could not rule out a need for attention
    // and has run out of people it may call. It does not wait for a human, and
    // it does not contact an emergency service (DEC-011).
    const outcome = await applyTransition(
      deps,
      current,
      "NO_CONTACTS_REMAINING",
      operationKey(options.trigger, "advance", "NO_CONTACTS_REMAINING"),
      {
        messages: [
          ...skipMessages,
          "No trusted contact could be reached — attention unresolved",
        ],
      }
    );
    return { event: outcome.event, nextCallEventId: null };
  }

  const { contact: intended, attemptNumber } = target;
  // Distinguishes "call Julie again" from "call Marc" — both are
  // <trigger>:advance:FAMILY_CALL_STARTED without it, and the second would
  // silently no-op against the first (see operation-keys.ts).
  const key = (transitionEvent: TransitionEvent) =>
    operationKey(
      options.trigger,
      "advance",
      transitionEvent,
      attemptDiscriminator(intended.id, attemptNumber)
    );

  // Transition and intent in ONE transaction. Derived from runId, not id (DEC-004).
  const result = await applyTransitionWithCallIntent(
    deps,
    current,
    "FAMILY_CALL_STARTED",
    key("FAMILY_CALL_STARTED"),
    {
      messages: [
        ...skipMessages,
        attemptNumber === 1
          ? `Calling ${intended.firstName}`
          : `Calling ${intended.firstName} again (attempt ${attemptNumber})`,
      ],
      // Denormalized for display only — the cascade reads selectCascadeTarget().
      patch: { currentContactPriority: intended.priority },
      intent: {
        agentType: "family",
        contactId: intended.id,
        attemptNumber,
        idempotencyKey: `${current.runId}_${intended.id}_attempt_${attemptNumber}`,
      },
    }
  );

  if (result.conflict) {
    // The event moved under us; another worker owns this cascade. Never
    // re-drive from a stale status.
    return { event: (await deps.repository.getEvent(current.id)) ?? current, nextCallEventId: null };
  }

  const callEvent = result.callEvent!;
  if (callEvent.resultProcessedAt !== null) {
    // The cascade already advanced past this step.
    return { event: result.event, nextCallEventId: null };
  }

  try {
    await placeCallForIntent(deps, callEvent);
  } catch (error) {
    // Safety net for what the pre-flight cannot predict (network failure,
    // CalleApiError, a bad number CALL-E rejects). Caught rather than thrown so
    // the webhook and poll routes still respond and the event reaches a
    // visible, actionable state instead of stalling mid-cascade.
    //
    // ONLY a start failure is caught. If CALL-E accepted the call and we then
    // failed to record it, a real call is ringing: escalating to human review
    // would leave the event in a state from which its eventual result can
    // never be applied. That error propagates, the lease is released, and a
    // later poll or webhook re-drives the same idempotency key.
    if (!(error instanceof CallStartFailedError)) throw error;
    const detail = error.cause instanceof Error ? error.cause.message : "unknown error";
    const failed = await applyTransition(
      deps,
      result.event,
      "FAMILY_RESULT_MALFORMED",
      key("FAMILY_RESULT_MALFORMED"),
      { messages: [`Could not start the call to ${intended.firstName} — ${detail}`] }
    );

    // DEC-011: a technical failure gets the same bounded retry policy as an
    // unanswered call, and then the cascade continues. Terminating here would
    // let one broken number strand the vulnerable person. Bounded twice over —
    // by MAX_CONTACT_ATTEMPTS per contact and by the finite circle — so this
    // recursion always reaches either a placed call or ATTENTION_UNRESOLVED.
    return startNextFamilyCall(deps, failed.event, {
      trigger: options.trigger,
      previous: { contactId: intended.id, attemptNumber, retryable: true },
    });
  }

  return { event: result.event, nextCallEventId: callEvent.id };
}

// Resolves the call event to work on, resuming an intent whose CALL-E request
// never completed. Returns null when the result is already finished.
async function prepareCallEvent(
  deps: EngineDeps,
  callEventId: string
): Promise<CallEventRecord | null> {
  const callEvent = await deps.repository.getCallEvent(callEventId);
  if (!callEvent) throw new UnknownRecordError("call event", callEventId);
  if (callEvent.resultProcessedAt) return null;
  // A 'starting' intent has no call id to fetch a result for: repeat the
  // CALL-E request with the same idempotency key first.
  if (callEvent.calleCallId === null) return placeCallForIntent(deps, callEvent);
  return callEvent;
}

// Fetches the terminal result for a companion call and drives the decision +
// state transition exactly once. Re-invoking with the same callEventId after
// it has already been processed (duplicate webhook/retry) is a no-op.
export async function processCompanionResult(
  deps: EngineDeps,
  event: EventRecord,
  callEventId: string
): Promise<EventRecord> {
  const reread = async () => (await deps.repository.getEvent(event.id)) ?? event;

  const callEvent = await prepareCallEvent(deps, callEventId);
  if (!callEvent) return reread();

  const rawResult = await deps.calleAdapter.getCallResult(callEvent.calleCallId!);

  // Not terminal yet (live mode only — FakeCalleAdapter is always
  // "completed"): leave the event untouched, and take NO lease, so a later
  // webhook/poll can process the eventual result. Not a malformed result.
  if (rawResult.status === "queued" || rawResult.status === "in_progress") {
    return reread();
  }

  const lease = await deps.repository.claimCallEventResult(callEventId, getLeaseSeconds());
  if (!lease) return reread(); // finished, or another worker holds it

  const key = (transitionEvent: TransitionEvent) =>
    operationKey(callEventId, "result", transitionEvent);

  try {
    // Self-heal a crash between placing the companion call and marking the
    // conversation started: the event is left at CALLING_PERSON, from which
    // COMPANION_CALL_ENDED is illegal, so without this the result could never
    // be processed and the event would be stuck forever. Keyed on runId, so
    // replaying startDemoEvent's own transition is a no-op.
    let current = event;
    if (current.status === "CALLING_PERSON") {
      const resumed = await applyTransition(
        deps,
        current,
        "COMPANION_CONVERSATION_STARTED",
        companionStartKey(
          current.runId,
          "COMPANION_CONVERSATION_STARTED",
          callEvent.attemptNumber
        )
      );
      if (resumed.conflict) {
        return supersede(
          deps, event, callEventId, lease,
          completedOutcome(null, rawResult.structuredResult)
        );
      }
      current = resumed.event;
    }

    const ended = await applyTransition(deps, current, "COMPANION_CALL_ENDED", key("COMPANION_CALL_ENDED"), {
      messages: ["Check-in call completed"],
    });
    if (ended.conflict) {
      return supersede(
        deps, event, callEventId, lease,
        completedOutcome(null, rawResult.structuredResult)
      );
    }
    current = ended.event;

    const personName = (await deps.repository.getPerson(current.personId))?.firstName ?? "the person";

    // Starts the trusted-circle cascade and drives it as far as this inbound
    // event can take it. Shared by every path that reaches ATTENTION_REQUIRED —
    // a validated concerning result, a call that never completed, and a result
    // KinCall could not read — because DEC-011 gives all three the same
    // destination: a person, not a wait for a human.
    const escalate = async (
      from: EventRecord,
      patch: TransitionOptions["patch"],
      message: string,
      outcome: CallOutcome
    ): Promise<EventRecord> => {
      const attention = await applyTransition(
        deps,
        from,
        "COMPANION_RESULT_ATTENTION",
        key("COMPANION_RESULT_ATTENTION"),
        { patch, messages: [message] }
      );
      if (attention.conflict) return supersede(deps, event, callEventId, lease, outcome);

      // Single trigger point for the cascade, so startDemoEvent, the webhook
      // route and the poll route all behave identically without knowing it
      // exists. Runs BEFORE finalize, so result_processed_at is only set once
      // the next call's intent durably exists.
      const step = await startNextFamilyCall(deps, attention.event, {
        trigger: callEventId,
        previous: null,
      });
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, outcome);
      if (!step.nextCallEventId) return step.event;
      return processFamilyResult(deps, step.event, step.nextCallEventId);
    };

    // ── A call that never produced a conversation ─────────────────────────────
    // DEC-011: this used to stop at human review. A check-in that failed
    // technically is not evidence that anyone is fine, so it now takes the same
    // route as a concerning one. The COMPANION_RESULT_MALFORMED edge is kept for
    // the audit trail; only its destination changed.
    if (rawResult.status === "failed" || rawResult.status === "canceled") {
      const detail = rawResult.failureMessage ?? rawResult.failureCode ?? `call ${rawResult.status}`;
      const malformed = await applyTransition(
        deps,
        current,
        "COMPANION_RESULT_MALFORMED",
        key("COMPANION_RESULT_MALFORMED"),
        {
          patch: {
            decision: "CONTACT_TRUSTED_PERSON",
            decisionReason: `The check-in call did not complete (${detail}).`,
          },
          messages: [`Check-in call did not complete — ${detail}`],
        }
      );
      if (malformed.conflict) return supersede(deps, event, callEventId, lease, completedOutcome());
      const step = await startNextFamilyCall(deps, malformed.event, {
        trigger: callEventId,
        previous: null,
      });
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, completedOutcome());
      if (!step.nextCallEventId) return step.event;
      return processFamilyResult(deps, step.event, step.nextCallEventId);
    }

    // ── A result KinCall cannot validate ─────────────────────────────────────
    // Degrades to the attention cascade, never to a closure (DEC-011): an
    // unreadable check-in is exactly when somebody should look in on the person.
    if (!isCompanionStructuredResult(rawResult.structuredResult)) {
      const unreadableOutcome = completedOutcome(null, rawResult.structuredResult);
      const malformed = await applyTransition(
        deps,
        current,
        "COMPANION_RESULT_MALFORMED",
        key("COMPANION_RESULT_MALFORMED"),
        {
          patch: {
            decision: "CONTACT_TRUSTED_PERSON",
            decisionReason: "The check-in result could not be validated.",
          },
          messages: ["Check-in result could not be validated — contacting the trusted circle"],
        }
      );
      if (malformed.conflict) {
        return supersede(deps, event, callEventId, lease, unreadableOutcome);
      }
      const step = await startNextFamilyCall(deps, malformed.event, {
        trigger: callEventId,
        previous: null,
      });
      await deps.repository.finalizeCallEventResult(
        callEventId,
        lease.token,
        unreadableOutcome
      );
      if (!step.nextCallEventId) return step.event;
      return processFamilyResult(deps, step.event, step.nextCallEventId);
    }

    const structuredResult = rawResult.structuredResult;
    const outcome = completedOutcome(structuredResult.neutral_summary, structuredResult);
    // Written before the cascade starts, because collectInformationToShare
    // reads this row to decide what a family member may be told. Idempotent:
    // a replay writes the same values.
    await deps.repository.updateCallEvent(callEventId, {
      summary: structuredResult.neutral_summary,
      structuredResult,
    });

    const normalized = normalizeCompanionResult(structuredResult);
    // The attempt number comes from the persisted call event, never from a
    // counter in memory, so a restart resumes at the correct attempt (DEC-011).
    // No priority is assigned (DEC-011, "Priority removed"): the decision is
    // binary, close or cascade, and `patch` therefore never touches `priority`
    // — new events simply leave the column null.
    const { decision, reason } = decideCompanionAction(normalized, {
      attemptNumber: callEvent.attemptNumber,
    });
    const patch = { decision, decisionReason: reason };

    // ── The bounded retry of the vulnerable person ────────────────────────────
    // DEC-003 left RETRY_CHECK_IN meaning "a retry is owed", surfaced for a human
    // to act on. DEC-011 makes it autonomous: KinCall places the second call
    // itself. closedAt is still never set — KinCall must not assert that someone
    // it never spoke to is safe (§7.5).
    if (decision === "RETRY_CHECK_IN") {
      const retry = await applyTransition(
        deps,
        current,
        "COMPANION_PERSON_NO_ANSWER",
        key("COMPANION_PERSON_NO_ANSWER"),
        { patch, messages: [`${personName} was not reached (attempt ${callEvent.attemptNumber})`] }
      );
      if (retry.conflict) return supersede(deps, event, callEventId, lease, outcome);

      // Same ordering rule as the family cascade: the next intent durably exists
      // before this result is finalized, so a crash in between leaves the result
      // reclaimable and the replay recovers that intent.
      const step = await startCompanionRetry(deps, retry.event, {
        attemptNumber: callEvent.attemptNumber + 1,
        personName,
      });
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, outcome);
      if (!step.nextCallEventId) return step.event;
      return processCompanionResult(deps, step.event, step.nextCallEventId);
    }

    if (decision === "CONTACT_TRUSTED_PERSON") {
      // The decision's own reason is the timeline entry: it already names the
      // stated signals in preserved-uncertainty wording ("The person mentioned
      // a fall, difficulty moving around."), so nothing is asserted here that
      // the check-in did not establish (§17.5).
      return escalate(current, patch, reason, outcome);
    }

    const noAction = await applyTransition(
      deps,
      current,
      "COMPANION_RESULT_NO_ACTION",
      key("COMPANION_RESULT_NO_ACTION"),
      { patch, messages: ["No attention signal detected"] }
    );
    if (noAction.conflict) return supersede(deps, event, callEventId, lease, outcome);

    const closed = await applyTransition(deps, noAction.event, "CASE_CLOSED_EVENT", key("CASE_CLOSED_EVENT"), {
      patch: { closedAt: new Date().toISOString() },
      messages: ["Case closed"],
    });
    if (closed.conflict) return supersede(deps, event, callEventId, lease, outcome);
    await deps.repository.finalizeCallEventResult(callEventId, lease.token, outcome);
    return closed.event;
  } catch (error) {
    // Release rather than let it expire, so a retry need not wait out the full
    // lease. The result stays reclaimable — never permanently consumed.
    await deps.repository.releaseCallEventLease(callEventId, lease.token);
    throw error;
  }
}

// Same no-op-on-duplicate guarantee as processCompanionResult, for a single
// family cascade step. The contact is always resolved from the CallEventRecord
// KinCall created, never from anything the model returned.
export async function processFamilyResult(
  deps: EngineDeps,
  event: EventRecord,
  callEventId: string
): Promise<EventRecord> {
  const reread = async () => (await deps.repository.getEvent(event.id)) ?? event;

  const callEvent = await prepareCallEvent(deps, callEventId);
  if (!callEvent) return reread();

  // Active-only (DEC-009): this call's own contact cannot have been archived
  // while its result is still unprocessed (the same safety rule as above), and
  // `remaining` must only ever count contacts the cascade could actually call.
  // Stage E (DEC-017): ordered the same way startNextFamilyCall orders its own
  // selection, from the SAME persisted event.createdAt instant, so the two
  // never disagree about the circle's shape mid-cascade.
  const activeContacts = await deps.repository.getActiveTrustedContacts(event.personId);
  const person = await deps.repository.getPerson(event.personId);
  if (!person) throw new Error(`Engine: unknown person "${event.personId}".`);
  const contacts = orderContactsForCascade(activeContacts, event.createdAt, person.timezone);
  const contact = contacts.find((candidate) => candidate.id === callEvent.contactId);
  if (!contact) {
    throw new Error(`Engine: call event "${callEventId}" has no known trusted contact.`);
  }

  const rawResult = await deps.calleAdapter.getCallResult(callEvent.calleCallId!);

  // Not terminal yet (live mode only): no lease is taken, nothing consumed.
  if (rawResult.status === "queued" || rawResult.status === "in_progress") {
    return reread();
  }

  const lease = await deps.repository.claimCallEventResult(callEventId, getLeaseSeconds());
  if (!lease) return reread();

  const key = (transitionEvent: TransitionEvent) =>
    operationKey(callEventId, "result", transitionEvent);

  // Contacts still untried after this one, for handleFamilyResult's own
  // "any contacts remaining?" determination.
  const remaining = contacts.slice(contacts.findIndex((c) => c.id === contact.id) + 1);

  // `retryable` decides whether this contact gets their second attempt or the
  // cascade moves on: an unanswered or technically failed call is worth one more
  // try, a definitive decline is not (DEC-011).
  const advance = async (
    current: EventRecord,
    outcome: CallOutcome,
    retryable: boolean
  ): Promise<EventRecord> => {
    // The next call's intent durably exists before this result is finalized,
    // so a crash in between leaves this result reclaimable and the replay
    // recovers that intent rather than skipping to the contact after it.
    const step = await startNextFamilyCall(deps, current, {
      trigger: callEventId,
      previous: {
        contactId: contact.id,
        attemptNumber: callEvent.attemptNumber,
        retryable,
      },
    });
    await deps.repository.finalizeCallEventResult(callEventId, lease.token, outcome);
    if (!step.nextCallEventId) return step.event;
    return processFamilyResult(deps, step.event, step.nextCallEventId);
  };

  try {
    // DEC-005: a call that never connected is not an intervention, and not an
    // error to stop on — this contact simply was not reached, so the cascade
    // continues. One unreachable number must not strand the vulnerable person.
    if (rawResult.status === "failed" || rawResult.status === "canceled") {
      const detail = rawResult.failureMessage ?? rawResult.failureCode ?? `call ${rawResult.status}`;
      const noAnswer = await applyTransition(deps, event, "FAMILY_NO_ANSWER", key("FAMILY_NO_ANSWER"), {
        messages: [`Could not reach ${contact.firstName} — ${detail}`],
      });
      if (noAnswer.conflict) return supersede(deps, event, callEventId, lease, completedOutcome());
      return advance(noAnswer.event, completedOutcome(), true);
    }

    // DEC-011: an unusable answer is not an answer, and not a reason to stop the
    // whole event. Treated exactly like an unanswered call, so this contact still
    // gets their bounded retry and the cascade still reaches everybody after them.
    if (!isFamilyStructuredResult(rawResult.structuredResult)) {
      const malformed = await applyTransition(
        deps,
        event,
        "FAMILY_RESULT_MALFORMED",
        key("FAMILY_RESULT_MALFORMED"),
        { messages: [`Could not read the result of the call to ${contact.firstName}`] }
      );
      if (malformed.conflict) return supersede(deps, event, callEventId, lease, completedOutcome());
      return advance(malformed.event, completedOutcome(), true);
    }

    const structuredResult = rawResult.structuredResult;

    // CLAUDE.md: a model must never freely select who is called. contact_id is
    // untrusted input — it is verified against the contact KinCall chose, and a
    // mismatch stops the cascade rather than switching to whoever it named.
    if (structuredResult.contact_id !== callEvent.contactId) {
      const wrongContact = await applyTransition(
        deps,
        event,
        "FAMILY_RESULT_MALFORMED",
        key("FAMILY_RESULT_MALFORMED"),
        {
          messages: [
            `The result of the call to ${contact.firstName} identified a different contact — disregarded`,
          ],
        }
      );
      if (wrongContact.conflict) {
        return supersede(deps, event, callEventId, lease, completedOutcome());
      }
      // The result is discarded, never acted on — but the cascade continues, so
      // one confused result cannot leave the vulnerable person with nobody
      // called (DEC-011). It is deliberately NOT retryable: whatever this call
      // returned cannot be trusted to describe this contact at all, so the
      // cascade moves on rather than redialling on the strength of it.
      return advance(wrongContact.event, completedOutcome(), false);
    }

    const outcome = completedOutcome(structuredResult.summary, structuredResult);
    await deps.repository.updateCallEvent(callEventId, {
      summary: structuredResult.summary,
      structuredResult,
    });

    const familyOutcome = handleFamilyResult(structuredResult, remaining);

    if (familyOutcome.kind === "confirmed") {
      // Neutral punctuation, not "at": estimated_time is CALL-E's free-text
      // wording verbatim (e.g. "vers 18h00") and is never parsed or translated,
      // so a fixed preposition can collide with one already inside it.
      const detail = structuredResult.estimated_time
        ? `Visit confirmed — ${structuredResult.estimated_time}`
        : "Intervention confirmed";
      const confirmed = await applyTransition(deps, event, "FAMILY_CONFIRMED", key("FAMILY_CONFIRMED"), {
        messages: [`${contact.firstName} answered`, detail],
      });
      if (confirmed.conflict) return supersede(deps, event, callEventId, lease, outcome);

      const closed = await applyTransition(
        deps,
        confirmed.event,
        "CASE_CLOSED_EVENT",
        key("CASE_CLOSED_EVENT"),
        { patch: { closedAt: new Date().toISOString() }, messages: ["Case closed"] }
      );
      if (closed.conflict) return supersede(deps, event, callEventId, lease, outcome);
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, outcome);
      return closed.event;
    }

    if (
      familyOutcome.kind === "declined" ||
      familyOutcome.kind === "declined_no_contacts_remaining"
    ) {
      const declined = await applyTransition(deps, event, "FAMILY_DECLINED", key("FAMILY_DECLINED"), {
        messages: [`${contact.firstName} declined`],
      });
      if (declined.conflict) return supersede(deps, event, callEventId, lease, outcome);
      // Not retryable: they answered and gave a definitive no. Calling them a
      // second time would be useless and intrusive.
      return advance(declined.event, outcome, false);
    }

    const noAnswer = await applyTransition(deps, event, "FAMILY_NO_ANSWER", key("FAMILY_NO_ANSWER"), {
      messages: [
        `No answer from ${contact.firstName} (attempt ${callEvent.attemptNumber})`,
        describeVoicemailOutcome(
          classifyVoicemail(structuredResult, {
            supported: deps.calleAdapter.capabilities.voicemail,
            attemptNumber: callEvent.attemptNumber,
            // Per-contact (DEC-017), never higher than MAX_CONTACT_ATTEMPTS.
            maxAttempts: effectiveMaxAttempts(contact),
          })
        ),
      ],
    });
    if (noAnswer.conflict) return supersede(deps, event, callEventId, lease, outcome);
    return advance(noAnswer.event, outcome, true);
  } catch (error) {
    await deps.repository.releaseCallEventLease(callEventId, lease.token);
    throw error;
  }
}

// Starts an event: place the Companion call and process whatever result is
// available. In fake mode the result is instant, so processCompanionResult
// drives the whole cascade to a terminal state before returning. In live mode
// the call is still queued, so this returns at CONVERSATION_IN_PROGRESS and
// the webhook or poll route resumes from there.
export async function startDemoEvent(
  personId: string,
  deps: EngineDeps = getDefaultDeps()
): Promise<EventRecord> {
  const person = await deps.repository.getPerson(personId);
  if (!person) {
    throw new Error(`Engine: unknown person "${personId}".`);
  }

  // DEC-007 / §17.1: the person must have agreed to receive automated calls
  // and to have the conversation analysed. Checked before the event is created,
  // so an unconsented profile leaves no orphaned event behind — and in every
  // mode, because consent is a property of the person, not of the dialling.
  if (person.consentStatus !== "confirmed") {
    throw new ConsentNotConfirmedError(person.id, person.firstName);
  }

  const created = await deps.repository.createEvent(personId);
  // Attempt 1 explicitly: the same key scheme startCompanionRetry uses for
  // attempt 2, so the two can never collide (DEC-011).
  const key = (transitionEvent: TransitionEvent) =>
    companionStartKey(created.runId, transitionEvent, 1);

  // Transition and Companion intent in one transaction, so the event can never
  // sit at CALLING_PERSON with no intent to drive. Key derived from runId, not
  // the restart-unstable sequential id (DEC-004).
  const started = await applyTransitionWithCallIntent(
    deps,
    created,
    "COMPANION_CALL_STARTED",
    key("COMPANION_CALL_STARTED"),
    {
      messages: ["Check-in call started"],
      intent: {
        agentType: "companion",
        contactId: null,
        attemptNumber: 1,
        idempotencyKey: `${created.runId}_companion_attempt_1`,
      },
    }
  );

  const callEvent = await placeCallForIntent(deps, started.callEvent!);

  const inProgress = await applyTransition(
    deps,
    started.event,
    "COMPANION_CONVERSATION_STARTED",
    key("COMPANION_CONVERSATION_STARTED")
  );

  // processCompanionResult starts the cascade itself when it reaches
  // ATTENTION_REQUIRED, so there is nothing to chain here.
  return processCompanionResult(deps, inProgress.event, callEvent.id);
}
