import type { AgentType } from "../calle/adapter";
import type { EventStatus, TransitionEvent } from "../orchestration/states";
import type {
  CallEventRecord,
  EventRecord,
  TimelineEntry,
  TrustedContact,
  VulnerablePerson,
} from "./types";

// An exclusive, time-bounded right to process one call event's terminal
// result. The token must be presented by every later write for that lease.
export interface CallEventLease {
  callEvent: CallEventRecord;
  token: string;
}

export interface CommitTransitionInput {
  eventId: string;
  // Deterministic; see lib/orchestration/operation-keys.ts.
  operationKey: string;
  transitionEvent: TransitionEvent;
  // Compare-and-set: the lease is scoped to one call event, not to the event,
  // so two call events can race one EventRecord. A new operation may only be
  // applied from the status the caller reasoned about.
  expectedFromStatus: EventStatus;
  // Computed by nextStatus() in TypeScript — no state machine logic in SQL.
  status: EventStatus;
  patch?: Partial<
    Pick<
      EventRecord,
      "priority" | "decision" | "decisionReason" | "currentContactPriority" | "closedAt"
    >
  >;
  // 0..n timeline entries written under this one operation, so a multi-line
  // step ("Marc answered" + "Visit confirmed — …") is atomic with its status.
  messages?: string[];
}

export interface CommitTransitionResult {
  // Always the freshly-read current row.
  event: EventRecord;
  // True only when this call actually wrote.
  applied: boolean;
  // True when events.status did not equal expectedFromStatus; nothing written.
  conflict: boolean;
}

export interface CallIntentInput {
  agentType: AgentType;
  contactId: string | null;
  idempotencyKey: string;
}

export interface CommitTransitionWithCallIntentResult extends CommitTransitionResult {
  // Null only when `conflict` is true.
  callEvent: CallEventRecord | null;
}

// The seam a Supabase-backed implementation satisfies — engine code and the
// pure orchestration functions never touch storage directly.
// `phone` IS part of both create inputs (DEC-008): the caller must supply a
// validated E.164 number (lib/validation/profile.ts's `phone` field), and it
// is stored exactly as given. A per-entity KINCALL_PHONE_<ID> environment
// variable can still override it on read (phoneEnvVarFor), which is how the
// four legacy demo entities keep working without ever storing a real number.
export type CreatePersonInput = Omit<VulnerablePerson, "id">;
// `personId` is a separate argument, and `priority` is assigned by appending.
export type CreateTrustedContactInput = Omit<TrustedContact, "id" | "priority" | "personId">;

export interface Repository {
  getPerson(personId: string): Promise<VulnerablePerson | undefined>;
  listPeople(): Promise<VulnerablePerson[]>;
  getTrustedContacts(personId: string): Promise<TrustedContact[]>; // priority ascending

  createPerson(input: CreatePersonInput): Promise<VulnerablePerson>;
  // Appended at the end of the circle, so adding a contact never silently
  // reorders the cascade.
  createTrustedContact(
    personId: string,
    input: CreateTrustedContactInput
  ): Promise<TrustedContact>;
  // Rewrites priorities to 1..n in the given order, atomically. `orderedIds`
  // must be exactly this person's circle — no duplicates, nothing missing,
  // nothing foreign — or the whole call is rejected and nothing changes.
  reorderTrustedContacts(personId: string, orderedIds: string[]): Promise<TrustedContact[]>;

  createEvent(personId: string): Promise<EventRecord>;
  listEvents(personId: string, limit?: number): Promise<EventRecord[]>; // newest first
  getEvent(eventId: string): Promise<EventRecord | undefined>;
  updateEvent(eventId: string, patch: Partial<EventRecord>): Promise<EventRecord>;

  appendTimelineEntry(
    eventId: string,
    status: EventStatus,
    message: string
  ): Promise<TimelineEntry>;
  listTimeline(eventId: string): Promise<TimelineEntry[]>; // insertion order

  getCallEvent(callEventId: string): Promise<CallEventRecord | undefined>;
  listCallEvents(eventId: string): Promise<CallEventRecord[]>; // insertion order
  findCallEventByIdempotencyKey(key: string): Promise<CallEventRecord | undefined>;
  updateCallEvent(callEventId: string, patch: Partial<CallEventRecord>): Promise<CallEventRecord>;

  // Conditional: sets calleCallId and status="in_progress" only while
  // calleCallId is still null. Returns the current row either way, so a caller
  // that lost the race can compare ids and decide (webhook adoption).
  attachCalleCallId(callEventId: string, calleCallId: string): Promise<CallEventRecord>;

  // ── Processing lease ─────────────────────────────────────────────────────
  // Exclusive, time-bounded lease on an UNPROCESSED call event. Returns null
  // when resultProcessedAt is set, or another worker holds a lease younger
  // than leaseSeconds. NEVER sets resultProcessedAt. The caller must already
  // have established that the CALL-E result is terminal — the database cannot
  // see CALL-E status, so that precondition lives at the call site.
  claimCallEventResult(callEventId: string, leaseSeconds: number): Promise<CallEventLease | null>;

  // The only place resultProcessedAt is ever set. Applies only if `token`
  // still holds the lease; returns null when the lease was lost, so the caller
  // abandons quietly while the winner replays the same idempotent work.
  finalizeCallEventResult(
    callEventId: string,
    token: string,
    outcome: Pick<CallEventRecord, "status" | "summary" | "structuredResult" | "endedAt">
  ): Promise<CallEventRecord | null>;

  releaseCallEventLease(callEventId: string, token: string): Promise<void>;

  // ── Idempotent, compare-and-set transitions ──────────────────────────────
  // Consulted BEFORE nextStatus(), which throws on an edge illegal from an
  // already-advanced status — a replay must no-op, not crash.
  findAppliedOperation(eventId: string, operationKey: string): Promise<boolean>;

  commitTransition(input: CommitTransitionInput): Promise<CommitTransitionResult>;

  // Resolves an already-applied call-start operation to its event and to THE
  // INTENT IT CREATED, through the ledger's own foreign key — never by
  // re-deriving from parameters. Null when the key was never applied.
  getAppliedTransitionWithCallIntent(
    eventId: string,
    operationKey: string
  ): Promise<{ event: EventRecord; callEvent: CallEventRecord } | null>;

  // The ONLY way a call_events row is created, so there is no way to persist
  // an intent outside its transition's transaction. On a duplicate operation
  // key it returns applied:false together with the exact intent that key
  // created, and raises CallIntentIntegrityError if the recorded intent does
  // not match what the caller expected.
  commitTransitionWithCallIntent(
    input: CommitTransitionInput & { intent: CallIntentInput }
  ): Promise<CommitTransitionWithCallIntentResult>;
}
