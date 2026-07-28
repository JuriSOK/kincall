import type { AgentType } from "../calle/adapter";
import type { EventStatus, OrchestrationDecision, Priority } from "../orchestration/states";
import { resolveConfiguredPhone } from "./seed";
import type {
  CallEventRecord,
  CallEventStatus,
  ConsentStatus,
  EventOperationRecord,
  EventRecord,
  TimelineEntry,
  TrustedContact,
  VulnerablePerson,
} from "./types";

// Postgres returns timestamptz as "2026-07-28T18:35:00.123+00:00"; the rest of
// the application produces "…Z" via toISOString(). Normalising here is what
// makes the two drivers indistinguishable to every caller and every test.
function iso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function requiredIso(value: string): string {
  return new Date(value).toISOString();
}

export interface PersonRow {
  id: string;
  first_name: string;
  phone: string;
  preferred_language: string;
  conversation_profile: string;
  preferred_call_time: string;
  interests: string[] | null;
  consent_status: string;
}

export function toPerson(row: PersonRow): VulnerablePerson {
  return {
    id: row.id,
    firstName: row.first_name,
    // The stored value is the reserved-for-fiction default; a real number
    // exists only in the environment (DEC-006).
    phone: resolveConfiguredPhone(row.id, row.phone),
    preferredLanguage: row.preferred_language,
    conversationProfile: row.conversation_profile,
    preferredCallTime: row.preferred_call_time,
    interests: row.interests ?? [],
    consentStatus: row.consent_status as ConsentStatus,
  };
}

export interface ContactRow {
  id: string;
  person_id: string;
  first_name: string;
  phone: string;
  relationship: string;
  priority: number;
  consent_status: string;
}

export function toContact(row: ContactRow): TrustedContact {
  return {
    id: row.id,
    personId: row.person_id,
    firstName: row.first_name,
    phone: resolveConfiguredPhone(row.id, row.phone),
    relationship: row.relationship,
    priority: row.priority,
    consentStatus: row.consent_status as ConsentStatus,
  };
}

export interface EventRow {
  id: string;
  run_id: string;
  person_id: string;
  status: string;
  priority: string | null;
  current_contact_priority: number | null;
  decision: string | null;
  decision_reason: string | null;
  created_at: string;
  closed_at: string | null;
}

export function toEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    personId: row.person_id,
    status: row.status as EventStatus,
    priority: row.priority as Priority | null,
    currentContactPriority: row.current_contact_priority,
    decision: row.decision as OrchestrationDecision | null,
    decisionReason: row.decision_reason,
    createdAt: requiredIso(row.created_at),
    closedAt: iso(row.closed_at),
  };
}

// Only the columns updateEvent is allowed to touch; `id` and `run_id` are
// immutable for the life of an event.
export function fromEventPatch(patch: Partial<EventRecord>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("status" in patch) row.status = patch.status;
  if ("priority" in patch) row.priority = patch.priority;
  if ("currentContactPriority" in patch) row.current_contact_priority = patch.currentContactPriority;
  if ("decision" in patch) row.decision = patch.decision;
  if ("decisionReason" in patch) row.decision_reason = patch.decisionReason;
  if ("closedAt" in patch) row.closed_at = patch.closedAt;
  return row;
}

export interface CallEventRow {
  id: string;
  seq: number;
  event_id: string;
  agent_type: string;
  contact_id: string | null;
  calle_call_id: string | null;
  idempotency_key: string;
  status: string;
  summary: string | null;
  structured_result: unknown;
  started_at: string;
  ended_at: string | null;
  processing_token: string | null;
  processing_started_at: string | null;
  result_processed_at: string | null;
}

export function toCallEvent(row: CallEventRow): CallEventRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    agentType: row.agent_type as AgentType,
    contactId: row.contact_id,
    calleCallId: row.calle_call_id,
    idempotencyKey: row.idempotency_key,
    status: row.status as CallEventStatus,
    summary: row.summary,
    structuredResult: row.structured_result ?? null,
    startedAt: requiredIso(row.started_at),
    endedAt: iso(row.ended_at),
    processingToken: row.processing_token,
    processingStartedAt: iso(row.processing_started_at),
    resultProcessedAt: iso(row.result_processed_at),
  };
}

export function fromCallEventPatch(patch: Partial<CallEventRecord>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("calleCallId" in patch) row.calle_call_id = patch.calleCallId;
  if ("status" in patch) row.status = patch.status;
  if ("summary" in patch) row.summary = patch.summary;
  if ("structuredResult" in patch) row.structured_result = patch.structuredResult;
  if ("endedAt" in patch) row.ended_at = patch.endedAt;
  if ("processingToken" in patch) row.processing_token = patch.processingToken;
  if ("processingStartedAt" in patch) row.processing_started_at = patch.processingStartedAt;
  if ("resultProcessedAt" in patch) row.result_processed_at = patch.resultProcessedAt;
  return row;
}

export interface TimelineRow {
  id: string;
  seq: number;
  event_id: string;
  operation_id: number | null;
  status: string;
  message: string;
  created_at: string;
}

export function toTimelineEntry(row: TimelineRow): TimelineEntry {
  return {
    id: row.id,
    eventId: row.event_id,
    operationId: row.operation_id,
    status: row.status as EventStatus,
    message: row.message,
    createdAt: requiredIso(row.created_at),
  };
}

export interface EventOperationRow {
  id: number;
  event_id: string;
  operation_key: string;
  transition_event: string;
  from_status: string;
  to_status: string;
  call_event_id: string | null;
  created_at: string;
}

export function toEventOperation(row: EventOperationRow): EventOperationRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    operationKey: row.operation_key,
    transitionEvent: row.transition_event,
    fromStatus: row.from_status as EventStatus,
    toStatus: row.to_status as EventStatus,
    callEventId: row.call_event_id,
    createdAt: requiredIso(row.created_at),
  };
}
