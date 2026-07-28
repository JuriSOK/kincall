import type { AgentType } from "../calle/adapter";
import type { EventStatus, OrchestrationDecision, Priority } from "../orchestration/states";

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
}

export interface TrustedContact {
  id: string;
  personId: string;
  firstName: string;
  phone: string;
  relationship: string;
  priority: number;
  consentStatus: ConsentStatus;
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
  priority: Priority | null;
  currentContactPriority: number | null;
  decision: OrchestrationDecision | null;
  decisionReason: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface CallEventRecord {
  id: string;
  eventId: string;
  agentType: AgentType;
  contactId: string | null;
  calleCallId: string;
  idempotencyKey: string;
  status: "in_progress" | "completed";
  summary: string | null;
  structuredResult: unknown;
  startedAt: string;
  endedAt: string | null;
  // Marks that the structured result has already driven a decision/transition,
  // so a duplicate webhook or retry for the same call is a no-op.
  resultProcessedAt: string | null;
}

export interface TimelineEntry {
  id: string;
  eventId: string;
  status: EventStatus;
  message: string;
  createdAt: string;
}
