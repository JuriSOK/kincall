import type { CalleAdapter } from "../calle/adapter";
import { getCalleAdapter } from "../calle/adapter";
import {
  isCompanionStructuredResult,
  isFamilyStructuredResult,
  normalizeCompanionResult,
} from "../calle/schemas";
import type { Repository } from "../database/repository";
import { getRepository } from "../database/store";
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

  const reference = await deps.calleAdapter.startFamilyCall({
    personId,
    contactId: contact.id,
    idempotencyKey,
    informationToShare: [
      "fall mentioned",
      "difficulty walking",
      "person did not want to disturb family",
    ],
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
    return applyTransition(
      deps,
      current,
      "COMPANION_RESULT_ATTENTION",
      "Fall and mobility difficulty detected"
    );
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

// Same no-op-on-duplicate guarantee as processCompanionResult, for a single
// family cascade step.
export async function processFamilyResult(
  deps: EngineDeps,
  event: EventRecord,
  callEventId: string,
  contact: TrustedContact,
  remainingContacts: TrustedContact[]
): Promise<EventRecord> {
  const callEvent = deps.repository.getCallEvent(callEventId);
  if (!callEvent) {
    throw new Error(`Engine: unknown call event "${callEventId}".`);
  }
  if (callEvent.resultProcessedAt) {
    return deps.repository.getEvent(event.id) ?? event;
  }

  const rawResult = await deps.calleAdapter.getCallResult(callEvent.calleCallId);

  if (!isFamilyStructuredResult(rawResult.structuredResult)) {
    deps.repository.updateCallEvent(callEvent.id, {
      status: "completed",
      endedAt: new Date().toISOString(),
      resultProcessedAt: new Date().toISOString(),
    });
    return applyTransition(
      deps,
      event,
      "FAMILY_RESULT_MALFORMED",
      "Human review required — malformed family result"
    );
  }

  const structuredResult = rawResult.structuredResult;
  deps.repository.updateCallEvent(callEvent.id, {
    status: "completed",
    summary: structuredResult.summary,
    structuredResult,
    endedAt: new Date().toISOString(),
    resultProcessedAt: new Date().toISOString(),
  });

  const outcome = handleFamilyResult(structuredResult, remainingContacts);
  let current = event;

  if (outcome.kind === "confirmed") {
    current = applyTransition(deps, current, "FAMILY_CONFIRMED", `${contact.firstName} answered`);
    const detail = structuredResult.estimated_time
      ? `Visit confirmed at ${structuredResult.estimated_time}`
      : "Intervention confirmed";
    deps.repository.appendTimelineEntry(current.id, current.status, detail);
    current = applyTransition(deps, current, "CASE_CLOSED_EVENT", "Case closed");
    return deps.repository.updateEvent(current.id, { closedAt: new Date().toISOString() });
  }

  if (outcome.kind === "declined") {
    return applyTransition(deps, current, "FAMILY_DECLINED", `${contact.firstName} declined`);
  }

  if (outcome.kind === "no_answer") {
    return applyTransition(deps, current, "FAMILY_NO_ANSWER", "No answer");
  }

  if (outcome.kind === "declined_no_contacts_remaining") {
    current = applyTransition(deps, current, "FAMILY_DECLINED", `${contact.firstName} declined`);
    return applyTransition(
      deps,
      current,
      "NO_CONTACTS_REMAINING",
      "Human review required — no contacts remaining"
    );
  }

  current = applyTransition(deps, current, "FAMILY_NO_ANSWER", "No answer");
  return applyTransition(
    deps,
    current,
    "NO_CONTACTS_REMAINING",
    "Human review required — no contacts remaining"
  );
}

async function runFamilyCascade(deps: EngineDeps, event: EventRecord): Promise<EventRecord> {
  const person = deps.repository.getPerson(event.personId);
  if (!person) {
    throw new Error(`Engine: unknown person "${event.personId}".`);
  }

  let current = event;
  let remaining = deps.repository.getTrustedContacts(event.personId);

  while (remaining.length > 0) {
    const contact = remaining[0];
    const restAfterThis = remaining.slice(1);

    current = applyTransition(deps, current, "FAMILY_CALL_STARTED", `Calling ${contact.firstName}`);

    const idempotencyKey = `${event.id}_${contact.id}_attempt_1`;
    const callEvent = await ensureFamilyCallStarted(
      deps,
      current.id,
      person.id,
      contact,
      idempotencyKey
    );

    current = await processFamilyResult(deps, current, callEvent.id, contact, restAfterThis);

    if (current.status === "CASE_CLOSED" || current.status === "HUMAN_REVIEW_REQUIRED") {
      return current;
    }

    remaining = restAfterThis;
  }

  return current;
}

// Runs the full Phase 2 scenario synchronously: start the Companion call,
// fetch its (instant, fake) result, decide, and — if attention is required —
// run the family cascade until confirmation or exhaustion.
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

  const idempotencyKey = `${current.id}_companion_attempt_1`;
  const callEvent = await ensureCompanionCallStarted(deps, current.id, personId, idempotencyKey);

  current = applyTransition(deps, current, "COMPANION_CONVERSATION_STARTED");
  current = await processCompanionResult(deps, current, callEvent.id);

  if (current.status === "ATTENTION_REQUIRED") {
    current = await runFamilyCascade(deps, current);
  }

  return current;
}
