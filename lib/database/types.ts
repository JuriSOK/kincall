import type { AgentType } from "../calle/adapter";
import type { EventStatus, OrchestrationDecision } from "../orchestration/states";

export type ConsentStatus = "pending" | "confirmed" | "declined";

// Field-for-field per TECHNICAL_ARCHITECTURE.md §9 / PRODUCT_SPECIFICATION.md §16.
export interface VulnerablePerson {
  id: string;
  firstName: string;
  phone: string;
  preferredLanguage: string;
  conversationProfile: string;
  preferredCallTime: string;
  interests: string[];
  consentStatus: ConsentStatus;
  // Soft deletion (optional interface administration, not core orchestration
  // — see docs/DECISION_LOG.md DEC-009). Never physically deleted: historical
  // events must keep resolving this person's name. Null means active.
  archivedAt: string | null;
}

export interface TrustedContact {
  id: string;
  personId: string;
  firstName: string;
  phone: string;
  relationship: string;
  priority: number;
  consentStatus: ConsentStatus;
  // Soft deletion (DEC-009). An archived contact disappears from the active
  // circle and the cascade, but historical call summaries still resolve it.
  archivedAt: string | null;
}

export interface EventRecord {
  id: string;
  // Globally unique and immutable for the lifetime of this event, unlike
  // `id` (a sequential, human-readable counter that restarts at 1 whenever
  // the in-memory repository is recreated). Companion/Family idempotency
  // keys are derived from this, not from `id` — CALL-E's idempotency store
  // is durable across our restarts, so a key that can repeat after a
  // restart is a correctness bug, not just a cosmetic one (see
  // docs/DECISION_LOG.md DEC-004).
  runId: string;
  personId: string;
  status: EventStatus;
  // events.priority was removed entirely (docs/DECISION_LOG.md DEC-012): the
  // operational decision is binary — close or contact the trusted circle —
  // and the column had no distinguishable effect on any behaviour.
  currentContactPriority: number | null;
  decision: OrchestrationDecision | null;
  decisionReason: string | null;
  createdAt: string;
  closedAt: string | null;
}

export type CallEventStatus = "starting" | "in_progress" | "completed";

export interface CallEventRecord {
  id: string;
  eventId: string;
  agentType: AgentType;
  contactId: string | null;
  // Which attempt to this subject this call is: 1 for the first, 2 for the
  // bounded retry (DEC-011). Persisted rather than counted in memory, so a
  // restart mid-cascade resumes at the correct attempt instead of restarting
  // the sequence or looping. Part of the uniqueness key that replaced
  // DEC-005's one-call-per-contact constraint.
  attemptNumber: number;
  // Null while the row is only an *intent*: the transition that decided to
  // place this call has been committed, but CALL-E has not answered yet. The
  // row is created before the outbound request so a crash in that window can
  // never leave CALL-E holding a call KinCall cannot find (DEC-006).
  calleCallId: string | null;
  idempotencyKey: string;
  // "starting" ⟺ calleCallId === null.
  status: CallEventStatus;
  summary: string | null;
  structuredResult: unknown;
  startedAt: string;
  endedAt: string | null;
  // Who is processing this call's terminal result right now, and since when.
  // A lease, not a claim: it expires, so a crashed worker's result is
  // reclaimable rather than permanently consumed (DEC-006).
  processingToken: string | null;
  processingStartedAt: string | null;
  // Terminal. Set ONLY after the whole result branch has succeeded, so a
  // duplicate webhook or retry for the same call is a no-op.
  resultProcessedAt: string | null;
}

// One row per successfully applied transition. The unique operation key is
// what makes a replayed transition a no-op instead of a duplicate timeline
// entry, and `callEventId` permanently records which outbound call intent a
// call-start transition created (DEC-006).
export interface EventOperationRecord {
  id: number;
  eventId: string;
  operationKey: string;
  transitionEvent: string;
  fromStatus: EventStatus;
  toStatus: EventStatus;
  callEventId: string | null;
  createdAt: string;
}

export interface TimelineEntry {
  id: string;
  eventId: string;
  // Which applied transition wrote this entry, so a replay can never orphan
  // or duplicate its entries. Null for entries written outside a transition.
  operationId: number | null;
  status: EventStatus;
  message: string;
  createdAt: string;
}
