import type { CalleAdapter } from "../calle/adapter";
import { getCalleAdapter, getCalleMode } from "../calle/adapter";
import {
  isCompanionStructuredResult,
  isFamilyStructuredResult,
  normalizeCompanionResult,
} from "../calle/schemas";
import { assertIntentMatches, CallStartFailedError, UnknownRecordError } from "../database/errors";
import type {
  CallEventLease,
  CallIntentInput,
  CommitTransitionInput,
  Repository,
} from "../database/repository";
import { CONTACT_PHONE_ENV_VARS } from "../database/seed";
import { getRepository } from "../database/store";
import { describeUnusablePhone } from "../phone";
import type { CallEventRecord, EventRecord, TrustedContact } from "../database/types";
import { nextContactAfter } from "./cascade-order";
import { decideCompanionAction } from "./decide-companion-action";
import { handleFamilyResult } from "./handle-family-result";
import { operationKey, type CascadeStage } from "./operation-keys";
import type { TransitionEvent } from "./states";
import { nextStatus } from "./transitions";

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
  const result = calls.find((call) => call.agentType === "companion")?.structuredResult;
  if (!isCompanionStructuredResult(result)) return [];

  const facts: Array<[boolean, string]> = [
    [result.fall_mentioned === "yes", "mentioned a fall"],
    [result.mobility_difficulty === "yes", "described difficulty moving around"],
    [result.person_requests_help === "yes", "asked for help"],
    [
      result.person_does_not_want_to_disturb_family === "yes",
      "said they did not want to disturb their family",
    ],
    [result.conversation_shorter_than_usual === "yes", "spoke more briefly than usual"],
    [result.unusual_confusion === "yes", "seemed more confused than usual"],
  ];

  return facts.filter(([present]) => present).map(([, fact]) => fact);
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
    const contacts = await deps.repository.getTrustedContacts(event.personId);
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
          })
        : await deps.calleAdapter.startFamilyCall({
            eventId: event.id,
            person,
            contact: contact!,
            idempotencyKey: callEvent.idempotencyKey,
            informationToShare: await collectInformationToShare(deps, event.id),
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

// Starts the next trusted-contact call, or ends the cascade when nobody is
// left. One step per inbound event: in fake mode processFamilyResult finds a
// terminal result immediately and recurses, so the whole cascade still
// completes synchronously; in live mode it sees `queued` and returns, leaving
// the event to be resumed by the webhook or the poll route.
async function startNextFamilyCall(
  deps: EngineDeps,
  event: EventRecord,
  options: { trigger: string; previousContactId: string | null }
): Promise<CascadeStep> {
  const key = (transitionEvent: TransitionEvent) =>
    operationKey(options.trigger, "advance", transitionEvent);

  const current = (await deps.repository.getEvent(event.id)) ?? event;

  // Another worker already finished this event. Stop immediately — never call
  // one more person on top of a closed or escalated case.
  if (current.status === "CASE_CLOSED" || current.status === "HUMAN_REVIEW_REQUIRED") {
    return { event: current, nextCallEventId: null };
  }

  // Chosen by priority succession from the contact whose result triggered this
  // step, NOT by "who has not been called yet" — the latter reads the answer
  // out of which rows exist, so a replay would skip the intended contact.
  const contacts = await deps.repository.getTrustedContacts(current.personId);
  const intended = nextContactAfter(contacts, options.previousContactId);

  if (!intended) {
    const outcome = await applyTransition(deps, current, "NO_CONTACTS_REMAINING", key("NO_CONTACTS_REMAINING"), {
      messages: ["Human review required — no contacts remaining"],
    });
    return { event: outcome.event, nextCallEventId: null };
  }

  // Pre-flight, BEFORE any transition: an unusable number must not leave the
  // event parked at CALLING_TRUSTED_CONTACT with no call in flight, and must
  // not write a "Calling X" entry for a call that never happens.
  const unusablePhone = describeUnusablePhone(intended.phone, CONTACT_PHONE_ENV_VARS[intended.id]);
  if (getCalleMode() === "live" && unusablePhone) {
    const outcome = await applyTransition(
      deps,
      current,
      "FAMILY_CALL_NOT_POSSIBLE",
      key("FAMILY_CALL_NOT_POSSIBLE"),
      { messages: [`Human review required — cannot call ${intended.firstName}: ${unusablePhone}`] }
    );
    return { event: outcome.event, nextCallEventId: null };
  }

  // Transition and intent in ONE transaction. Derived from runId, not id (DEC-004).
  const result = await applyTransitionWithCallIntent(
    deps,
    current,
    "FAMILY_CALL_STARTED",
    key("FAMILY_CALL_STARTED"),
    {
      messages: [`Calling ${intended.firstName}`],
      // Denormalized for display only — the cascade reads nextContactAfter().
      patch: { currentContactPriority: intended.priority },
      intent: {
        agentType: "family",
        contactId: intended.id,
        idempotencyKey: `${current.runId}_${intended.id}_attempt_1`,
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
      {
        messages: [
          `Human review required — could not start the call to ${intended.firstName} (${detail})`,
        ],
      }
    );
    return { event: failed.event, nextCallEventId: null };
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
        operationKey(current.runId, "start", "COMPANION_CONVERSATION_STARTED")
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

    if (rawResult.status === "failed" || rawResult.status === "canceled") {
      const detail = rawResult.failureMessage ?? rawResult.failureCode ?? `call ${rawResult.status}`;
      const failed = await applyTransition(
        deps,
        current,
        "COMPANION_RESULT_MALFORMED",
        key("COMPANION_RESULT_MALFORMED"),
        { messages: [`Human review required — companion call did not complete (${detail})`] }
      );
      if (failed.conflict) return supersede(deps, event, callEventId, lease, completedOutcome());
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, completedOutcome());
      return failed.event;
    }

    if (!isCompanionStructuredResult(rawResult.structuredResult)) {
      const malformed = await applyTransition(
        deps,
        current,
        "COMPANION_RESULT_MALFORMED",
        key("COMPANION_RESULT_MALFORMED"),
        { messages: ["Human review required — malformed companion result"] }
      );
      if (malformed.conflict) return supersede(deps, event, callEventId, lease, completedOutcome());
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, completedOutcome());
      return malformed.event;
    }

    const structuredResult = rawResult.structuredResult;
    const outcome = completedOutcome(structuredResult.conversation_summary, structuredResult);
    // Written before the cascade starts, because collectInformationToShare
    // reads this row to decide what a family member may be told. Idempotent:
    // a replay writes the same values.
    await deps.repository.updateCallEvent(callEventId, {
      summary: structuredResult.conversation_summary,
      structuredResult,
    });

    const normalized = normalizeCompanionResult(structuredResult);
    const { decision, priority, reason } = decideCompanionAction(normalized);
    const patch = { decision, priority, decisionReason: reason };
    const personName = (await deps.repository.getPerson(current.personId))?.firstName ?? "the person";

    // DEC-003: the case stays open — closedAt is never set on these two paths.
    // KinCall must not assert that someone it never spoke to is safe (§7.5).
    if (decision === "RETRY_CHECK_IN") {
      const retry = await applyTransition(
        deps,
        current,
        "COMPANION_PERSON_NO_ANSWER",
        key("COMPANION_PERSON_NO_ANSWER"),
        { patch, messages: [`${personName} was not reached — no check-in conversation took place`] }
      );
      if (retry.conflict) return supersede(deps, event, callEventId, lease, outcome);
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, outcome);
      return retry.event;
    }

    if (decision === "REQUEST_HUMAN_REVIEW") {
      const uncertain = await applyTransition(
        deps,
        current,
        "COMPANION_RESULT_UNCERTAIN",
        key("COMPANION_RESULT_UNCERTAIN"),
        {
          patch,
          messages: [`Human review required — unable to confirm the check-in reached ${personName}`],
        }
      );
      if (uncertain.conflict) return supersede(deps, event, callEventId, lease, outcome);
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, outcome);
      return uncertain.event;
    }

    if (decision === "CONTACT_TRUSTED_PERSON") {
      const attention = await applyTransition(
        deps,
        current,
        "COMPANION_RESULT_ATTENTION",
        key("COMPANION_RESULT_ATTENTION"),
        { patch, messages: ["Fall and mobility difficulty detected"] }
      );
      if (attention.conflict) return supersede(deps, event, callEventId, lease, outcome);

      // Single trigger point for the cascade, so startDemoEvent, the webhook
      // route and the poll route all behave identically without knowing it
      // exists. Runs BEFORE finalize, so result_processed_at is only set once
      // the next call's intent durably exists.
      const step = await startNextFamilyCall(deps, attention.event, {
        trigger: callEventId,
        previousContactId: null,
      });
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, outcome);
      if (!step.nextCallEventId) return step.event;
      return processFamilyResult(deps, step.event, step.nextCallEventId);
    }

    const noAction = await applyTransition(
      deps,
      current,
      "COMPANION_RESULT_NO_ACTION",
      key("COMPANION_RESULT_NO_ACTION"),
      { patch, messages: ["No concerning signal detected"] }
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

  const contacts = await deps.repository.getTrustedContacts(event.personId);
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

  const advance = async (current: EventRecord, outcome: CallOutcome): Promise<EventRecord> => {
    // The next call's intent durably exists before this result is finalized,
    // so a crash in between leaves this result reclaimable and the replay
    // recovers that intent rather than skipping to the contact after it.
    const step = await startNextFamilyCall(deps, current, {
      trigger: callEventId,
      previousContactId: contact.id,
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
      return advance(noAnswer.event, completedOutcome());
    }

    if (!isFamilyStructuredResult(rawResult.structuredResult)) {
      const malformed = await applyTransition(
        deps,
        event,
        "FAMILY_RESULT_MALFORMED",
        key("FAMILY_RESULT_MALFORMED"),
        { messages: ["Human review required — malformed family result"] }
      );
      if (malformed.conflict) return supersede(deps, event, callEventId, lease, completedOutcome());
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, completedOutcome());
      return malformed.event;
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
        { messages: ["Human review required — family result identified the wrong contact"] }
      );
      if (wrongContact.conflict) {
        return supersede(deps, event, callEventId, lease, completedOutcome());
      }
      await deps.repository.finalizeCallEventResult(callEventId, lease.token, completedOutcome());
      return wrongContact.event;
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
      return advance(declined.event, outcome);
    }

    const noAnswer = await applyTransition(deps, event, "FAMILY_NO_ANSWER", key("FAMILY_NO_ANSWER"), {
      messages: ["No answer"],
    });
    if (noAnswer.conflict) return supersede(deps, event, callEventId, lease, outcome);
    return advance(noAnswer.event, outcome);
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

  const created = await deps.repository.createEvent(personId);
  const key = (stage: CascadeStage, transitionEvent: TransitionEvent) =>
    operationKey(created.runId, stage, transitionEvent);

  // Transition and Companion intent in one transaction, so the event can never
  // sit at CALLING_PERSON with no intent to drive. Key derived from runId, not
  // the restart-unstable sequential id (DEC-004).
  const started = await applyTransitionWithCallIntent(
    deps,
    created,
    "COMPANION_CALL_STARTED",
    key("start", "COMPANION_CALL_STARTED"),
    {
      messages: ["Check-in call started"],
      intent: {
        agentType: "companion",
        contactId: null,
        idempotencyKey: `${created.runId}_companion_attempt_1`,
      },
    }
  );

  const callEvent = await placeCallForIntent(deps, started.callEvent!);

  const inProgress = await applyTransition(
    deps,
    started.event,
    "COMPANION_CONVERSATION_STARTED",
    key("start", "COMPANION_CONVERSATION_STARTED")
  );

  // processCompanionResult starts the cascade itself when it reaches
  // ATTENTION_REQUIRED, so there is nothing to chain here.
  return processCompanionResult(deps, inProgress.event, callEvent.id);
}
