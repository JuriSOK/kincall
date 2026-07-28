import type { CalleAdapter } from "../calle/adapter";
import { getCalleAdapter, getCalleMode } from "../calle/adapter";
import {
  isCompanionStructuredResult,
  isFamilyStructuredResult,
  normalizeCompanionResult,
} from "../calle/schemas";
import type { Repository } from "../database/repository";
import { CONTACT_PHONE_ENV_VARS } from "../database/seed";
import { getRepository } from "../database/store";
import { describeUnusablePhone } from "../phone";
import type { CallEventRecord, EventRecord, TrustedContact } from "../database/types";
import { decideCompanionAction } from "./decide-companion-action";
import { handleFamilyResult } from "./handle-family-result";
import type { TransitionEvent } from "./states";
import { nextStatus } from "./transitions";

export interface EngineDeps {
  repository: Repository;
  calleAdapter: CalleAdapter;
}

export function getDefaultDeps(): EngineDeps {
  return { repository: getRepository(), calleAdapter: getCalleAdapter() };
}

function applyTransition(
  deps: EngineDeps,
  event: EventRecord,
  transitionEvent: TransitionEvent,
  message?: string
): EventRecord {
  const status = nextStatus(event.status, transitionEvent);
  const updated = deps.repository.updateEvent(event.id, { status });
  if (message) {
    deps.repository.appendTimelineEntry(updated.id, status, message);
  }
  return updated;
}

// The complete set of facts a Family call may mention (§17.3: transmit only
// what is necessary; §9.2's `information_to_share`). Derived from the validated
// Companion result so a family member is never told something the check-in did
// not actually establish — this used to be a hardcoded list that claimed a fall
// and difficulty walking regardless of what Marie said.
function collectInformationToShare(deps: EngineDeps, eventId: string): string[] {
  const companionCall = deps.repository
    .listCallEvents(eventId)
    .find((call) => call.agentType === "companion");

  const result = companionCall?.structuredResult;
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

// Idempotent: a second call with the same idempotencyKey reuses the existing
// CallEvent instead of invoking the adapter again (TECHNICAL_ARCHITECTURE.md §8).
export async function ensureCompanionCallStarted(
  deps: EngineDeps,
  eventId: string,
  personId: string,
  idempotencyKey: string
): Promise<CallEventRecord> {
  const existing = deps.repository.findCallEventByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  const person = deps.repository.getPerson(personId);
  if (!person) {
    throw new Error(`Engine: unknown person "${personId}".`);
  }

  const reference = await deps.calleAdapter.startCompanionCall({ eventId, person, idempotencyKey });
  return deps.repository.createCallEvent({
    eventId,
    agentType: "companion",
    contactId: null,
    calleCallId: reference.callId,
    idempotencyKey,
    status: "in_progress",
    summary: null,
    structuredResult: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    resultProcessedAt: null,
  });
}

export async function ensureFamilyCallStarted(
  deps: EngineDeps,
  eventId: string,
  personId: string,
  contact: TrustedContact,
  idempotencyKey: string
): Promise<CallEventRecord> {
  const existing = deps.repository.findCallEventByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  const person = deps.repository.getPerson(personId);
  if (!person) {
    throw new Error(`Engine: unknown person "${personId}".`);
  }

  const reference = await deps.calleAdapter.startFamilyCall({
    eventId,
    person,
    contact,
    idempotencyKey,
    informationToShare: collectInformationToShare(deps, eventId),
  });
  return deps.repository.createCallEvent({
    eventId,
    agentType: "family",
    contactId: contact.id,
    calleCallId: reference.callId,
    idempotencyKey,
    status: "in_progress",
    summary: null,
    structuredResult: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    resultProcessedAt: null,
  });
}

// Fetches the terminal result for a companion call and drives the decision +
// state transition exactly once. Re-invoking with the same callEventId after
// it has already been processed (duplicate webhook/retry) is a no-op.
export async function processCompanionResult(
  deps: EngineDeps,
  event: EventRecord,
  callEventId: string
): Promise<EventRecord> {
  const callEvent = deps.repository.getCallEvent(callEventId);
  if (!callEvent) {
    throw new Error(`Engine: unknown call event "${callEventId}".`);
  }
  if (callEvent.resultProcessedAt) {
    return deps.repository.getEvent(event.id) ?? event;
  }

  const rawResult = await deps.calleAdapter.getCallResult(callEvent.calleCallId);

  // Not terminal yet (live mode only — FakeCalleAdapter is always
  // "completed"): leave the event untouched so a later webhook/poll call
  // can process the eventual result. Not a malformed result.
  if (rawResult.status === "queued" || rawResult.status === "in_progress") {
    return deps.repository.getEvent(event.id) ?? event;
  }

  let current = applyTransition(deps, event, "COMPANION_CALL_ENDED", "Check-in call completed");

  if (rawResult.status === "failed" || rawResult.status === "canceled") {
    deps.repository.updateCallEvent(callEvent.id, {
      status: "completed",
      endedAt: new Date().toISOString(),
      resultProcessedAt: new Date().toISOString(),
    });
    const detail = rawResult.failureMessage ?? rawResult.failureCode ?? `call ${rawResult.status}`;
    return applyTransition(
      deps,
      current,
      "COMPANION_RESULT_MALFORMED",
      `Human review required — companion call did not complete (${detail})`
    );
  }

  if (!isCompanionStructuredResult(rawResult.structuredResult)) {
    deps.repository.updateCallEvent(callEvent.id, {
      status: "completed",
      endedAt: new Date().toISOString(),
      resultProcessedAt: new Date().toISOString(),
    });
    return applyTransition(
      deps,
      current,
      "COMPANION_RESULT_MALFORMED",
      "Human review required — malformed companion result"
    );
  }

  const structuredResult = rawResult.structuredResult;
  const normalized = normalizeCompanionResult(structuredResult);
  const { decision, priority, reason } = decideCompanionAction(normalized);

  deps.repository.updateCallEvent(callEvent.id, {
    status: "completed",
    summary: structuredResult.conversation_summary,
    structuredResult,
    endedAt: new Date().toISOString(),
    resultProcessedAt: new Date().toISOString(),
  });
  deps.repository.updateEvent(current.id, { decision, priority, decisionReason: reason });

  const personName = deps.repository.getPerson(current.personId)?.firstName ?? "the person";

  // DEC-003: the case stays open — closedAt is never set on these two paths.
  // KinCall must not assert that someone it never spoke to is safe (§7.5).
  if (decision === "RETRY_CHECK_IN") {
    return applyTransition(
      deps,
      current,
      "COMPANION_PERSON_NO_ANSWER",
      `${personName} was not reached — no check-in conversation took place`
    );
  }

  if (decision === "REQUEST_HUMAN_REVIEW") {
    return applyTransition(
      deps,
      current,
      "COMPANION_RESULT_UNCERTAIN",
      `Human review required — unable to confirm the check-in reached ${personName}`
    );
  }

  if (decision === "CONTACT_TRUSTED_PERSON") {
    current = applyTransition(
      deps,
      current,
      "COMPANION_RESULT_ATTENTION",
      "Fall and mobility difficulty detected"
    );
    // Single trigger point for the cascade, so startDemoEvent, the webhook
    // route and the poll route all behave identically without knowing it exists.
    return advanceFamilyCascade(deps, current);
  }

  current = applyTransition(
    deps,
    current,
    "COMPANION_RESULT_NO_ACTION",
    "No concerning signal detected"
  );
  current = applyTransition(deps, current, "CASE_CLOSED_EVENT", "Case closed");
  return deps.repository.updateEvent(current.id, { closedAt: new Date().toISOString() });
}

// Contacts already attempted in this event, derived from the CallEventRecords
// we actually created rather than from stored cursor state — so a webhook
// redelivery or a poll can never lose track of where the cascade is, and no
// contact is ever called twice.
function contactsNotYetCalled(deps: EngineDeps, event: EventRecord): TrustedContact[] {
  const alreadyCalled = new Set(
    deps.repository
      .listCallEvents(event.id)
      .filter((call) => call.agentType === "family" && call.contactId !== null)
      .map((call) => call.contactId as string)
  );

  return deps.repository
    .getTrustedContacts(event.personId)
    .filter((contact) => !alreadyCalled.has(contact.id));
}

// Starts the next trusted-contact call, or ends the cascade when nobody is
// left. One step per inbound event: in fake mode processFamilyResult finds a
// terminal result immediately and recurses, so the whole cascade still
// completes synchronously; in live mode it sees `queued` and returns, leaving
// the event to be resumed by the webhook or the poll route.
export async function advanceFamilyCascade(
  deps: EngineDeps,
  event: EventRecord
): Promise<EventRecord> {
  const contact = contactsNotYetCalled(deps, event)[0];

  if (!contact) {
    return applyTransition(
      deps,
      event,
      "NO_CONTACTS_REMAINING",
      "Human review required — no contacts remaining"
    );
  }

  // Pre-flight, BEFORE any transition: an unusable number must not leave the
  // event parked at CALLING_TRUSTED_CONTACT with no call in flight, and must
  // not write a "Calling X" entry for a call that never happens.
  const unusablePhone = describeUnusablePhone(contact.phone, CONTACT_PHONE_ENV_VARS[contact.id]);
  if (getCalleMode() === "live" && unusablePhone) {
    return applyTransition(
      deps,
      event,
      "FAMILY_CALL_NOT_POSSIBLE",
      `Human review required — cannot call ${contact.firstName}: ${unusablePhone}`
    );
  }

  let current = applyTransition(deps, event, "FAMILY_CALL_STARTED", `Calling ${contact.firstName}`);
  // Denormalized for display only — the cascade reads contactsNotYetCalled().
  current = deps.repository.updateEvent(current.id, {
    currentContactPriority: contact.priority,
  });

  // Derived from runId, not id: see EventRecord.runId and DEC-004.
  const idempotencyKey = `${event.runId}_${contact.id}_attempt_1`;
  let callEvent: CallEventRecord;
  try {
    callEvent = await ensureFamilyCallStarted(
      deps,
      current.id,
      event.personId,
      contact,
      idempotencyKey
    );
  } catch (error) {
    // Safety net for anything the pre-flight cannot predict (network failure,
    // CalleApiError, a bug). Caught rather than thrown so the webhook and poll
    // routes still respond and the event reaches a visible, actionable state
    // instead of stalling mid-cascade. The reason always reaches the timeline.
    const detail = error instanceof Error ? error.message : "unknown error";
    return applyTransition(
      deps,
      current,
      "FAMILY_RESULT_MALFORMED",
      `Human review required — could not start the call to ${contact.firstName} (${detail})`
    );
  }

  return processFamilyResult(deps, current, callEvent.id);
}

// Same no-op-on-duplicate guarantee as processCompanionResult, for a single
// family cascade step. The contact is always resolved from the CallEventRecord
// KinCall created, never from anything the model returned.
export async function processFamilyResult(
  deps: EngineDeps,
  event: EventRecord,
  callEventId: string
): Promise<EventRecord> {
  const callEvent = deps.repository.getCallEvent(callEventId);
  if (!callEvent) {
    throw new Error(`Engine: unknown call event "${callEventId}".`);
  }
  if (callEvent.resultProcessedAt) {
    return deps.repository.getEvent(event.id) ?? event;
  }

  const contact = deps.repository
    .getTrustedContacts(event.personId)
    .find((candidate) => candidate.id === callEvent.contactId);
  if (!contact) {
    throw new Error(`Engine: call event "${callEventId}" has no known trusted contact.`);
  }

  const rawResult = await deps.calleAdapter.getCallResult(callEvent.calleCallId);

  // Not terminal yet (live mode only): leave the event untouched so a later
  // webhook or poll can process the eventual result. Not a malformed result.
  if (rawResult.status === "queued" || rawResult.status === "in_progress") {
    return deps.repository.getEvent(event.id) ?? event;
  }

  const markProcessed = () =>
    deps.repository.updateCallEvent(callEvent.id, {
      status: "completed",
      endedAt: new Date().toISOString(),
      resultProcessedAt: new Date().toISOString(),
    });

  // DEC-005: a call that never connected is not an intervention, and not an
  // error to stop on — this contact simply was not reached, so the cascade
  // continues. One unreachable number must not strand the vulnerable person.
  if (rawResult.status === "failed" || rawResult.status === "canceled") {
    markProcessed();
    const detail = rawResult.failureMessage ?? rawResult.failureCode ?? `call ${rawResult.status}`;
    const current = applyTransition(
      deps,
      event,
      "FAMILY_NO_ANSWER",
      `Could not reach ${contact.firstName} — ${detail}`
    );
    return advanceFamilyCascade(deps, current);
  }

  if (!isFamilyStructuredResult(rawResult.structuredResult)) {
    markProcessed();
    return applyTransition(
      deps,
      event,
      "FAMILY_RESULT_MALFORMED",
      "Human review required — malformed family result"
    );
  }

  const structuredResult = rawResult.structuredResult;

  // CLAUDE.md: a model must never freely select who is called. contact_id is
  // untrusted input — it is verified against the contact KinCall chose, and a
  // mismatch stops the cascade rather than switching to whoever it named.
  if (structuredResult.contact_id !== callEvent.contactId) {
    markProcessed();
    return applyTransition(
      deps,
      event,
      "FAMILY_RESULT_MALFORMED",
      "Human review required — family result identified the wrong contact"
    );
  }

  deps.repository.updateCallEvent(callEvent.id, {
    status: "completed",
    summary: structuredResult.summary,
    structuredResult,
    endedAt: new Date().toISOString(),
    resultProcessedAt: new Date().toISOString(),
  });

  // Contacts still untried after this one, recomputed from persisted state.
  const outcome = handleFamilyResult(structuredResult, contactsNotYetCalled(deps, event));
  let current = event;

  if (outcome.kind === "confirmed") {
    current = applyTransition(deps, current, "FAMILY_CONFIRMED", `${contact.firstName} answered`);
    // Neutral punctuation, not "at": estimated_time is CALL-E's free-text
    // wording verbatim (e.g. "vers 18h00") and is never parsed or translated,
    // so a fixed preposition like "at" can collide with one already inside it
    // ("at vers 18h00"). An em dash reads correctly regardless of language
    // or phrasing.
    const detail = structuredResult.estimated_time
      ? `Visit confirmed — ${structuredResult.estimated_time}`
      : "Intervention confirmed";
    deps.repository.appendTimelineEntry(current.id, current.status, detail);
    current = applyTransition(deps, current, "CASE_CLOSED_EVENT", "Case closed");
    return deps.repository.updateEvent(current.id, { closedAt: new Date().toISOString() });
  }

  if (outcome.kind === "declined" || outcome.kind === "declined_no_contacts_remaining") {
    current = applyTransition(deps, current, "FAMILY_DECLINED", `${contact.firstName} declined`);
    return advanceFamilyCascade(deps, current);
  }

  current = applyTransition(deps, current, "FAMILY_NO_ANSWER", "No answer");
  return advanceFamilyCascade(deps, current);
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
  const person = deps.repository.getPerson(personId);
  if (!person) {
    throw new Error(`Engine: unknown person "${personId}".`);
  }

  const created = deps.repository.createEvent(personId);
  let current = applyTransition(deps, created, "COMPANION_CALL_STARTED", "Check-in call started");

  // Derived from runId, not id: see EventRecord.runId and DEC-004.
  const idempotencyKey = `${current.runId}_companion_attempt_1`;
  const callEvent = await ensureCompanionCallStarted(deps, current.id, personId, idempotencyKey);

  current = applyTransition(deps, current, "COMPANION_CONVERSATION_STARTED");
  // processCompanionResult starts the cascade itself when it reaches
  // ATTENTION_REQUIRED, so there is nothing to chain here.
  return processCompanionResult(deps, current, callEvent.id);
}
