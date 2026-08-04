import type { AgentType } from "@/backend/integrations/calle/adapter";
import type { EventStatus, TransitionEvent } from "@/backend/orchestration/state-machine/states";
import type {
  CallEventRecord,
  EventRecord,
  TimelineEntry,
  TrustedContact,
  VulnerablePerson,
} from "@/shared/domain/types";

// An exclusive, time-bounded right to process one call event's terminal
// result. The token must be presented by every later write for that lease.
export interface CallEventLease {
  callEvent: CallEventRecord;
  token: string;
}

export interface CommitTransitionInput {
  eventId: string;
  // Deterministic; see backend/orchestration/operation-keys.ts.
  operationKey: string;
  transitionEvent: TransitionEvent;
  // Compare-and-set: the lease is scoped to one call event, not to the event,
  // so two call events can race one EventRecord. A new operation may only be
  // applied from the status the caller reasoned about.
  expectedFromStatus: EventStatus;
  // Computed by nextStatus() in TypeScript — no state machine logic in SQL.
  status: EventStatus;
  patch?: Partial<
    Pick<EventRecord, "decision" | "decisionReason" | "currentContactPriority" | "closedAt">
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
  // 1 for the first attempt to this subject, 2 for the bounded retry (DEC-011).
  // Part of the intent's identity: an intent recorded for attempt 1 can never
  // be adopted by a caller reasoning about attempt 2 (assertIntentMatches).
  attemptNumber: number;
  idempotencyKey: string;
}

export interface CommitTransitionWithCallIntentResult extends CommitTransitionResult {
  // Null only when `conflict` is true.
  callEvent: CallEventRecord | null;
}

// The seam a Supabase-backed implementation satisfies — engine code and the
// pure orchestration functions never touch storage directly.
// `phone` IS part of both create inputs (DEC-008): the caller must supply a
// validated E.164 number (shared/validation/profile.ts's `phone` field), and it
// is stored exactly as given. A per-entity KINCALL_PHONE_<ID> environment
// variable can still override it on read (phoneEnvVarFor), which is how the
// four legacy demo entities keep working without ever storing a real number.
// `archivedAt` is never supplied by a caller — it starts null and is only
// ever set by archivePerson/archiveTrustedContact (DEC-009).
//
// The five Stage-C enrichment fields (timezone, avatarKey, conversationNotes,
// checkInDays, scheduleState) are optional here — unlike every other field —
// so every caller and fixture that predates DEC-015 keeps compiling and
// keeps working unchanged; both repository drivers apply the same defaults
// the database column defaults express (see createPerson in each) when a
// caller omits one.
export type CreatePersonInput = Omit<
  VulnerablePerson,
  "id" | "archivedAt" | "timezone" | "avatarKey" | "conversationNotes" | "checkInDays" | "scheduleState"
> &
  Partial<
    Pick<
      VulnerablePerson,
      "timezone" | "avatarKey" | "conversationNotes" | "checkInDays" | "scheduleState"
    >
  >;

// The editable subset for the profile-edit route (Stage C, §3 of the brief).
// Deliberately excludes `firstName` and `phone`: neither is in the approved
// edit-field list, and phone in particular carries DEC-008's validation and
// masking rules that a general-purpose patch would bypass. Every field is
// optional so a caller may update just one — an absent key means "leave this
// exactly as it is", never "clear it" (a nullable field must be sent
// explicitly as `null` to be cleared).
export type UpdatePersonInput = Partial<
  Pick<
    VulnerablePerson,
    | "avatarKey"
    | "preferredLanguage"
    | "timezone"
    | "preferredCallTime"
    | "checkInDays"
    | "scheduleState"
    | "interests"
    | "conversationProfile"
    | "conversationNotes"
    | "consentStatus"
  >
>;

// `personId` is a separate argument, and `priority` is assigned by appending.
// The six Stage-E fields are optional — like CreatePersonInput's own
// enrichment fields — so every caller and fixture that predates DEC-017 keeps
// compiling and keeps working unchanged; both drivers apply the identical
// defaults migration 0011's own column defaults express (enabled: true,
// maxAttempts: 2, isPrimary: false, no availability window) when a caller
// omits one.
export type CreateTrustedContactInput = Omit<
  TrustedContact,
  | "id"
  | "priority"
  | "personId"
  | "archivedAt"
  | "isPrimary"
  | "enabled"
  | "callableFrom"
  | "callableTo"
  | "timezone"
  | "maxAttempts"
> &
  Partial<
    Pick<
      TrustedContact,
      "isPrimary" | "enabled" | "callableFrom" | "callableTo" | "timezone" | "maxAttempts"
    >
  >;

// Stage E (DEC-017), the trusted-circle editing counterpart to
// UpdatePersonInput: a partial patch where an absent key means "leave this
// exactly as it is". Deliberately excludes `isPrimary` — primary status
// changes ONLY through setPrimaryContact, which must atomically clear the
// previous primary, something a plain field-by-field patch cannot do safely.
export type UpdateTrustedContactInput = Partial<
  Pick<
    TrustedContact,
    "relationship" | "enabled" | "callableFrom" | "callableTo" | "timezone" | "maxAttempts"
  >
>;

export interface Repository {
  // Unfiltered by design: an archived person's own row must still resolve so
  // historical events can display their name (DEC-009). getPerson/getEvent/
  // getTrustedContacts are the "historical" reads; listPeople/
  // getActiveTrustedContacts are the "currently active" reads.
  getPerson(personId: string): Promise<VulnerablePerson | undefined>;
  // Active people only (archivedAt === null) — backs the home page. Use
  // getPerson for a single archived-or-not lookup by id.
  listPeople(): Promise<VulnerablePerson[]>;
  // Unfiltered, priority ascending, INCLUDING archived contacts — the one
  // list historical event/call-summary resolution depends on
  // (app/events/[id]/page.tsx). Never use this to decide who the cascade may
  // call next; use getActiveTrustedContacts for that.
  getTrustedContacts(personId: string): Promise<TrustedContact[]>;
  // Active contacts only (archivedAt === null), priority ascending. The only
  // list the cascade, the ordering UI and the trusted-circle display may use
  // — an archived contact must never be selected for a new cascade step.
  getActiveTrustedContacts(personId: string): Promise<TrustedContact[]>;

  createPerson(input: CreatePersonInput): Promise<VulnerablePerson>;
  // Stage C (DEC-015). A partial patch: an absent key preserves the existing
  // value, exactly like updateEvent. Throws UnknownRecordError for an unknown
  // id. Works on an archived person too — nothing in this product requires
  // blocking that, and the interface simply never offers the edit action for
  // one.
  updatePerson(personId: string, input: UpdatePersonInput): Promise<VulnerablePerson>;
  // Appended at the end of the ACTIVE circle, so adding a contact never
  // silently reorders the cascade and never collides with an archived
  // contact's stale priority.
  createTrustedContact(
    personId: string,
    input: CreateTrustedContactInput
  ): Promise<TrustedContact>;
  // Rewrites priorities to 1..n in the given order, atomically. `orderedIds`
  // must be exactly this person's ACTIVE circle — no duplicates, nothing
  // missing, nothing foreign, and no archived contact — or the whole call is
  // rejected and nothing changes.
  reorderTrustedContacts(personId: string, orderedIds: string[]): Promise<TrustedContact[]>;
  // Stage E (DEC-017). A partial patch — see UpdateTrustedContactInput for
  // exactly which fields and why `isPrimary` is not among them. Throws
  // UnknownRecordError for an unknown id, and ArchivedContactCannotBeReactivatedError
  // when the patch would set `enabled: true` on an archived contact (an
  // archived contact can never become enabled again — see migration 0011).
  updateTrustedContact(
    contactId: string,
    input: UpdateTrustedContactInput
  ): Promise<TrustedContact>;
  // Stage E. The ONLY way isPrimary changes: atomically clears any previous
  // primary and sets the new one, so no interim state with zero or two
  // primaries is ever observable. Returns the person's full active circle.
  // Throws InvalidPrimaryContactError for an unknown, foreign, or archived
  // contact id — never silently promotes one.
  setPrimaryContact(personId: string, contactId: string): Promise<TrustedContact[]>;

  // ── Soft deletion (DEC-009): optional interface administration, not a core
  // orchestration feature. Rows are never physically deleted. Idempotent —
  // archiving an already-archived row is a no-op, not an error.
  //
  // Refuses (PersonHasActiveEventError) while any of the person's events is
  // not yet terminal (isTerminalEventStatus).
  archivePerson(personId: string): Promise<VulnerablePerson>;
  // Refuses (ContactHasActiveCallError) while the contact has any call whose
  // result is not yet processed.
  archiveTrustedContact(contactId: string): Promise<TrustedContact>;

  createEvent(personId: string): Promise<EventRecord>;
  listEvents(personId: string, limit?: number): Promise<EventRecord[]>; // newest first
  // Cross-person, for the dashboard and history page (Stage B). Bounded by
  // BOTH an explicit time window and a row limit — there is deliberately no
  // unbounded "all events" read. Newest first, with the same id tie-break as
  // listEvents, so paging/ordering is identical between the per-person and
  // cross-person reads. `since` is inclusive.
  listRecentEvents(range: { since: string; limit: number }): Promise<EventRecord[]>;
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
  // Batched form of listCallEvents for the dashboard/history/KPI reads (Stage
  // B), so displaying N events' call history costs one query instead of N.
  // Insertion order overall, same as listCallEvents; group by eventId at the
  // call site. Returns [] for an empty eventIds array without querying.
  listCallEventsForEvents(eventIds: string[]): Promise<CallEventRecord[]>;
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
