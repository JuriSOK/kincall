import type { AgentType } from "../calle/adapter";
import type { EventStatus, OrchestrationDecision } from "../orchestration/states";
import { resolveConfiguredPhone } from "./seed";
import type { UpdatePersonInput } from "./repository";
import type {
  CallEventRecord,
  CallEventStatus,
  ConsentStatus,
  EventOperationRecord,
  EventRecord,
  ScheduleState,
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
  archived_at: string | null;
  // Stage C (DEC-015) — migration 0010_person_profile.sql.
  timezone: string;
  avatar_key: string | null;
  conversation_notes: string | null;
  check_in_days: number[] | null;
  schedule_state: string;
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
    archivedAt: iso(row.archived_at),
    timezone: row.timezone,
    avatarKey: row.avatar_key,
    conversationNotes: row.conversation_notes,
    checkInDays: row.check_in_days ?? [1, 2, 3, 4, 5, 6, 7],
    scheduleState: row.schedule_state as ScheduleState,
  };
}

// Only the columns updatePerson is allowed to touch — see UpdatePersonInput
// in repository.ts for exactly which fields those are and why (`firstName`
// and `phone` are deliberately absent from both).
export function fromPersonPatch(patch: UpdatePersonInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("avatarKey" in patch) row.avatar_key = patch.avatarKey;
  if ("preferredLanguage" in patch) row.preferred_language = patch.preferredLanguage;
  if ("timezone" in patch) row.timezone = patch.timezone;
  if ("preferredCallTime" in patch) row.preferred_call_time = patch.preferredCallTime;
  if ("checkInDays" in patch) row.check_in_days = patch.checkInDays;
  if ("scheduleState" in patch) row.schedule_state = patch.scheduleState;
  if ("interests" in patch) row.interests = patch.interests;
  if ("conversationProfile" in patch) row.conversation_profile = patch.conversationProfile;
  if ("conversationNotes" in patch) row.conversation_notes = patch.conversationNotes;
  if ("consentStatus" in patch) row.consent_status = patch.consentStatus;
  return row;
}

export interface ContactRow {
  id: string;
  person_id: string;
  first_name: string;
  phone: string;
  relationship: string;
  priority: number;
  consent_status: string;
  archived_at: string | null;
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
    archivedAt: iso(row.archived_at),
  };
}

export interface EventRow {
  id: string;
  run_id: string;
  person_id: string;
  status: string;
  // events.priority column removed entirely (DEC-012); no field here to match.
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
  attempt_number: number;
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
    // Defaulted for rows written before 0008 added the column (DEC-011): every
    // pre-existing call was, by the old one-call-per-contact constraint, the
    // first and only attempt to its subject.
    attemptNumber: row.attempt_number ?? 1,
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
