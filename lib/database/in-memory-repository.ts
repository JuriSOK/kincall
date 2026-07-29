import { randomUUID } from "node:crypto";
import { isTerminalEventStatus, type EventStatus } from "../orchestration/states";
import { slugify } from "../validation/profile";
import {
  assertIntentMatches,
  CallIntentIntegrityError,
  ContactHasActiveCallError,
  InvalidContactOrderError,
  PersonHasActiveEventError,
  UnknownRecordError,
} from "./errors";
import type {
  CallEventLease,
  CommitTransitionInput,
  CommitTransitionResult,
  CommitTransitionWithCallIntentResult,
  CallIntentInput,
  CreatePersonInput,
  CreateTrustedContactInput,
  Repository,
} from "./repository";
import type {
  CallEventRecord,
  EventOperationRecord,
  EventRecord,
  TimelineEntry,
  TrustedContact,
  VulnerablePerson,
} from "./types";

// The backing data, separated from the repository object so a test can open a
// *second* repository over the same data — standing in for a second process,
// which is what makes restart recovery assertable without a real database.
export interface InMemoryStore {
  people: Map<string, VulnerablePerson>;
  contacts: Map<string, TrustedContact>;
  events: Map<string, EventRecord>;
  callEvents: Map<string, CallEventRecord>;
  operations: Map<string, EventOperationRecord>;
  timeline: Map<string, TimelineEntry[]>;
  sequences: { event: number; callEvent: number; timeline: number; operation: number };
}

export function createInMemoryStore(): InMemoryStore {
  return {
    people: new Map(),
    contacts: new Map(),
    events: new Map(),
    callEvents: new Map(),
    operations: new Map(),
    timeline: new Map(),
    sequences: { event: 0, callEvent: 0, timeline: 0, operation: 0 },
  };
}

export interface InMemoryRepositoryOptions {
  store?: InMemoryStore;
  // Injectable so lease expiry is testable without waiting 90 real seconds.
  now?: () => number;
}

function operationId(eventId: string, operationKey: string): string {
  return `${eventId}::${operationKey}`;
}

export class InMemoryRepository implements Repository {
  private readonly store: InMemoryStore;
  private readonly now: () => number;

  constructor(options: InMemoryRepositoryOptions = {}) {
    this.store = options.store ?? createInMemoryStore();
    this.now = options.now ?? (() => Date.now());
  }

  // Lets a test open a second repository over the same data.
  getStore(): InMemoryStore {
    return this.store;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  seedPerson(person: VulnerablePerson): void {
    this.store.people.set(person.id, person);
  }

  seedContact(contact: TrustedContact): void {
    this.store.contacts.set(contact.id, contact);
  }

  async getPerson(personId: string): Promise<VulnerablePerson | undefined> {
    return this.store.people.get(personId);
  }

  async listPeople(): Promise<VulnerablePerson[]> {
    return [...this.store.people.values()].filter((person) => person.archivedAt === null);
  }

  async getTrustedContacts(personId: string): Promise<TrustedContact[]> {
    return [...this.store.contacts.values()]
      .filter((contact) => contact.personId === personId)
      .sort((a, b) => a.priority - b.priority);
  }

  async getActiveTrustedContacts(personId: string): Promise<TrustedContact[]> {
    return (await this.getTrustedContacts(personId)).filter(
      (contact) => contact.archivedAt === null
    );
  }

  // Slug-based ids matching the seeded convention (person_marie), retrying
  // with a numeric suffix when the slug is taken. Two people called Marie must
  // both be creatable.
  private allocateId(prefix: string, firstName: string, taken: (id: string) => boolean): string {
    const base = `${prefix}_${slugify(firstName)}`;
    for (let attempt = 1; attempt <= 1000; attempt += 1) {
      const id = attempt === 1 ? base : `${base}_${attempt}`;
      if (!taken(id)) return id;
    }
    throw new Error(`InMemoryRepository: could not allocate an id for "${base}".`);
  }

  async createPerson(input: CreatePersonInput): Promise<VulnerablePerson> {
    const id = this.allocateId("person", input.firstName, (candidate) =>
      this.store.people.has(candidate)
    );
    // input.phone is already a validated E.164 number (DEC-008) — stored as
    // given, never minted.
    const person: VulnerablePerson = { ...input, id, archivedAt: null };
    this.store.people.set(id, person);
    return person;
  }

  async createTrustedContact(
    personId: string,
    input: CreateTrustedContactInput
  ): Promise<TrustedContact> {
    if (!this.store.people.has(personId)) throw new UnknownRecordError("person", personId);

    // Appended after the highest ACTIVE priority: an archived contact's stale
    // priority is irrelevant, since only active contacts are ever renumbered
    // or dialled (DEC-009).
    const activeSiblings = await this.getActiveTrustedContacts(personId);
    const id = this.allocateId("contact", input.firstName, (candidate) =>
      this.store.contacts.has(candidate)
    );
    // input.phone is already a validated E.164 number (DEC-008) — stored as
    // given, never minted.
    const contact: TrustedContact = {
      ...input,
      id,
      personId,
      archivedAt: null,
      priority: activeSiblings.reduce((max, sibling) => Math.max(max, sibling.priority), 0) + 1,
    };
    this.store.contacts.set(id, contact);
    return contact;
  }

  async reorderTrustedContacts(
    personId: string,
    orderedIds: string[]
  ): Promise<TrustedContact[]> {
    // Archived contacts are invisible to this validation entirely: they must
    // never be part of "exactly this circle" and are never renumbered.
    const circle = await this.getActiveTrustedContacts(personId);

    // Validate the whole request before writing anything: a partial apply
    // could drop a contact out of the cascade entirely.
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new InvalidContactOrderError(personId, "the same contact appears more than once");
    }
    if (orderedIds.length !== circle.length) {
      throw new InvalidContactOrderError(
        personId,
        `expected all ${circle.length} active contacts, received ${orderedIds.length}`
      );
    }
    const known = new Set(circle.map((contact) => contact.id));
    for (const id of orderedIds) {
      if (!known.has(id)) {
        throw new InvalidContactOrderError(
          personId,
          `"${id}" is not an active contact in this trusted circle`
        );
      }
    }

    orderedIds.forEach((id, index) => {
      this.store.contacts.set(id, { ...this.store.contacts.get(id)!, priority: index + 1 });
    });
    return this.getActiveTrustedContacts(personId);
  }

  // ── Soft deletion (DEC-009) ─────────────────────────────────────────────────
  async archivePerson(personId: string): Promise<VulnerablePerson> {
    const existing = this.store.people.get(personId);
    if (!existing) throw new UnknownRecordError("person", personId);
    if (existing.archivedAt !== null) return existing; // idempotent no-op

    const hasActiveEvent = [...this.store.events.values()].some(
      (event) => event.personId === personId && !isTerminalEventStatus(event.status)
    );
    if (hasActiveEvent) throw new PersonHasActiveEventError(personId);

    const updated: VulnerablePerson = { ...existing, archivedAt: this.nowIso() };
    this.store.people.set(personId, updated);
    return updated;
  }

  async archiveTrustedContact(contactId: string): Promise<TrustedContact> {
    const existing = this.store.contacts.get(contactId);
    if (!existing) throw new UnknownRecordError("trusted contact", contactId);
    if (existing.archivedAt !== null) return existing; // idempotent no-op

    const hasActiveCall = [...this.store.callEvents.values()].some(
      (call) => call.contactId === contactId && call.resultProcessedAt === null
    );
    if (hasActiveCall) throw new ContactHasActiveCallError(contactId);

    const updated: TrustedContact = { ...existing, archivedAt: this.nowIso() };
    this.store.contacts.set(contactId, updated);
    return updated;
  }

  async listEvents(personId: string, limit?: number): Promise<EventRecord[]> {
    const events = [...this.store.events.values()]
      .filter((event) => event.personId === personId)
      // Newest first. Ties within one millisecond fall back to the sequential
      // id, which is monotonic.
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return limit === undefined ? events : events.slice(0, limit);
  }

  async createEvent(personId: string): Promise<EventRecord> {
    this.store.sequences.event += 1;
    const id = `event_${String(this.store.sequences.event).padStart(3, "0")}`;
    const event: EventRecord = {
      id,
      // crypto.randomUUID(), not derived from the sequential `id`: it must
      // stay unique even after a process restart resets the counter to 0.
      runId: randomUUID(),
      personId,
      status: "SCHEDULED",
      priority: null,
      currentContactPriority: null,
      decision: null,
      decisionReason: null,
      createdAt: this.nowIso(),
      closedAt: null,
    };
    this.store.events.set(id, event);
    this.store.timeline.set(id, []);
    return event;
  }

  async getEvent(eventId: string): Promise<EventRecord | undefined> {
    return this.store.events.get(eventId);
  }

  async updateEvent(eventId: string, patch: Partial<EventRecord>): Promise<EventRecord> {
    const existing = this.store.events.get(eventId);
    if (!existing) throw new UnknownRecordError("event", eventId);
    const updated = { ...existing, ...patch };
    this.store.events.set(eventId, updated);
    return updated;
  }

  private insertTimelineEntry(
    eventId: string,
    operationId: number | null,
    status: EventStatus,
    message: string
  ): TimelineEntry {
    this.store.sequences.timeline += 1;
    const entry: TimelineEntry = {
      id: `timeline_${String(this.store.sequences.timeline).padStart(3, "0")}`,
      eventId,
      operationId,
      status,
      message,
      createdAt: this.nowIso(),
    };
    const entries = this.store.timeline.get(eventId) ?? [];
    entries.push(entry);
    this.store.timeline.set(eventId, entries);
    return entry;
  }

  async appendTimelineEntry(
    eventId: string,
    status: EventStatus,
    message: string
  ): Promise<TimelineEntry> {
    return this.insertTimelineEntry(eventId, null, status, message);
  }

  async listTimeline(eventId: string): Promise<TimelineEntry[]> {
    return [...(this.store.timeline.get(eventId) ?? [])];
  }

  async getCallEvent(callEventId: string): Promise<CallEventRecord | undefined> {
    return this.store.callEvents.get(callEventId);
  }

  async listCallEvents(eventId: string): Promise<CallEventRecord[]> {
    return [...this.store.callEvents.values()].filter((call) => call.eventId === eventId);
  }

  async findCallEventByIdempotencyKey(key: string): Promise<CallEventRecord | undefined> {
    return [...this.store.callEvents.values()].find((call) => call.idempotencyKey === key);
  }

  async updateCallEvent(
    callEventId: string,
    patch: Partial<CallEventRecord>
  ): Promise<CallEventRecord> {
    const existing = this.store.callEvents.get(callEventId);
    if (!existing) throw new UnknownRecordError("call event", callEventId);
    const updated = { ...existing, ...patch };
    this.store.callEvents.set(callEventId, updated);
    return updated;
  }

  async attachCalleCallId(callEventId: string, calleCallId: string): Promise<CallEventRecord> {
    const existing = this.store.callEvents.get(callEventId);
    if (!existing) throw new UnknownRecordError("call event", callEventId);
    // Conditional on calleCallId still being null: a caller that lost the race
    // gets the winner's row back and can compare ids for itself.
    if (existing.calleCallId !== null) return existing;
    const updated: CallEventRecord = {
      ...existing,
      calleCallId,
      status: existing.status === "starting" ? "in_progress" : existing.status,
    };
    this.store.callEvents.set(callEventId, updated);
    return updated;
  }

  // ── Processing lease ───────────────────────────────────────────────────────
  // The body is fully synchronous, so on JS's single thread it is atomic: no
  // other worker can observe a half-taken lease.
  async claimCallEventResult(
    callEventId: string,
    leaseSeconds: number
  ): Promise<CallEventLease | null> {
    const existing = this.store.callEvents.get(callEventId);
    if (!existing) return null;
    if (existing.resultProcessedAt !== null) return null;

    if (existing.processingToken !== null && existing.processingStartedAt !== null) {
      const ageSeconds = (this.now() - Date.parse(existing.processingStartedAt)) / 1000;
      if (ageSeconds < leaseSeconds) return null; // held by a live worker
    }

    const token = randomUUID();
    const updated: CallEventRecord = {
      ...existing,
      processingToken: token,
      processingStartedAt: this.nowIso(),
    };
    this.store.callEvents.set(callEventId, updated);
    return { callEvent: updated, token };
  }

  async finalizeCallEventResult(
    callEventId: string,
    token: string,
    outcome: Pick<CallEventRecord, "status" | "summary" | "structuredResult" | "endedAt">
  ): Promise<CallEventRecord | null> {
    const existing = this.store.callEvents.get(callEventId);
    if (!existing) return null;
    if (existing.processingToken !== token) return null; // lease lost
    if (existing.resultProcessedAt !== null) return null;

    const updated: CallEventRecord = {
      ...existing,
      ...outcome,
      resultProcessedAt: this.nowIso(),
      processingToken: null,
      processingStartedAt: null,
    };
    this.store.callEvents.set(callEventId, updated);
    return updated;
  }

  async releaseCallEventLease(callEventId: string, token: string): Promise<void> {
    const existing = this.store.callEvents.get(callEventId);
    if (!existing) return;
    if (existing.processingToken !== token) return;
    if (existing.resultProcessedAt !== null) return;
    this.store.callEvents.set(callEventId, {
      ...existing,
      processingToken: null,
      processingStartedAt: null,
    });
  }

  // ── Transitions ────────────────────────────────────────────────────────────
  async findAppliedOperation(eventId: string, operationKey: string): Promise<boolean> {
    return this.store.operations.has(operationId(eventId, operationKey));
  }

  private insertOperation(
    input: CommitTransitionInput,
    fromStatus: EventStatus,
    callEventId: string | null
  ): EventOperationRecord {
    this.store.sequences.operation += 1;
    const record: EventOperationRecord = {
      id: this.store.sequences.operation,
      eventId: input.eventId,
      operationKey: input.operationKey,
      transitionEvent: input.transitionEvent,
      fromStatus,
      toStatus: input.status,
      callEventId,
      createdAt: this.nowIso(),
    };
    this.store.operations.set(operationId(input.eventId, input.operationKey), record);
    return record;
  }

  private applyPatchAndMessages(input: CommitTransitionInput, operationId: number): EventRecord {
    const existing = this.store.events.get(input.eventId)!;
    const updated: EventRecord = { ...existing, ...(input.patch ?? {}), status: input.status };
    this.store.events.set(input.eventId, updated);

    for (const message of input.messages ?? []) {
      this.insertTimelineEntry(input.eventId, operationId, input.status, message);
    }
    return updated;
  }

  async commitTransition(input: CommitTransitionInput): Promise<CommitTransitionResult> {
    const event = this.store.events.get(input.eventId);
    if (!event) throw new UnknownRecordError("event", input.eventId);

    // Idempotent replay wins first, whatever the status is now.
    if (this.store.operations.has(operationId(input.eventId, input.operationKey))) {
      return { event, applied: false, conflict: false };
    }
    // Compare-and-set: a new operation may only be applied from the status the
    // caller reasoned about. Nothing is written on conflict, so a later
    // legitimate attempt from the correct status still succeeds.
    if (event.status !== input.expectedFromStatus) {
      return { event, applied: false, conflict: true };
    }

    const operation = this.insertOperation(input, event.status, null);
    return { event: this.applyPatchAndMessages(input, operation.id), applied: true, conflict: false };
  }

  async getAppliedTransitionWithCallIntent(
    eventId: string,
    operationKey: string
  ): Promise<{ event: EventRecord; callEvent: CallEventRecord } | null> {
    const operation = this.store.operations.get(operationId(eventId, operationKey));
    if (!operation) return null;

    if (operation.callEventId === null) {
      throw new CallIntentIntegrityError(eventId, operationKey, "the operation started no call");
    }
    const callEvent = this.store.callEvents.get(operation.callEventId);
    if (!callEvent) {
      throw new CallIntentIntegrityError(
        eventId,
        operationKey,
        `the recorded intent "${operation.callEventId}" no longer exists`
      );
    }
    return { event: this.store.events.get(eventId)!, callEvent };
  }

  private assertIntentInvariants(eventId: string, intent: CallIntentInput): void {
    const siblings = [...this.store.callEvents.values()].filter((c) => c.eventId === eventId);
    // Exactly one Companion intent per event.
    if (intent.agentType === "companion" && siblings.some((c) => c.agentType === "companion")) {
      throw new CallIntentIntegrityError(
        eventId,
        intent.idempotencyKey,
        "a companion call already exists for this event"
      );
    }
    // One Family attempt per contact per event (DEC-005).
    if (intent.contactId !== null && siblings.some((c) => c.contactId === intent.contactId)) {
      throw new CallIntentIntegrityError(
        eventId,
        intent.idempotencyKey,
        `a call to "${intent.contactId}" already exists for this event`
      );
    }
  }

  // Deliberately synchronous from the first read to the last write: the SQL
  // implementation gets this window from one transaction with the event row
  // locked, and an `await` anywhere inside here would let two concurrent
  // callers both observe "no intent yet" and both try to create one.
  async commitTransitionWithCallIntent(
    input: CommitTransitionInput & { intent: CallIntentInput }
  ): Promise<CommitTransitionWithCallIntentResult> {
    const event = this.store.events.get(input.eventId);
    if (!event) throw new UnknownRecordError("event", input.eventId);

    // Idempotent replay: read the intent from the LEDGER'S OWN link, never
    // re-created or re-recovered from the parameters this caller supplied.
    const existingOperation = this.store.operations.get(
      operationId(input.eventId, input.operationKey)
    );
    if (existingOperation) {
      if (existingOperation.callEventId === null) {
        throw new CallIntentIntegrityError(
          input.eventId,
          input.operationKey,
          "the operation started no call"
        );
      }
      const callEvent = this.store.callEvents.get(existingOperation.callEventId)!;
      assertIntentMatches(input.eventId, input.operationKey, callEvent, input.intent);
      return { event, applied: false, conflict: false, callEvent };
    }

    if (event.status !== input.expectedFromStatus) {
      return { event, applied: false, conflict: true, callEvent: null };
    }

    // Create or recover the exact intent FIRST, so the ledger row can name it.
    let callEvent = [...this.store.callEvents.values()].find(
      (call) => call.idempotencyKey === input.intent.idempotencyKey
    );
    if (callEvent) {
      // An intent already bound to a different operation must never be
      // adopted by this one (the unique index on call_event_id in SQL).
      for (const operation of this.store.operations.values()) {
        if (operation.callEventId === callEvent.id) {
          throw new CallIntentIntegrityError(
            input.eventId,
            input.operationKey,
            `intent "${callEvent.id}" is already bound to operation "${operation.operationKey}"`
          );
        }
      }
      assertIntentMatches(input.eventId, input.operationKey, callEvent, input.intent);
    } else {
      this.assertIntentInvariants(input.eventId, input.intent);
      this.store.sequences.callEvent += 1;
      callEvent = {
        id: `call_event_${String(this.store.sequences.callEvent).padStart(3, "0")}`,
        eventId: input.eventId,
        agentType: input.intent.agentType,
        contactId: input.intent.contactId,
        calleCallId: null,
        idempotencyKey: input.intent.idempotencyKey,
        status: "starting",
        summary: null,
        structuredResult: null,
        startedAt: this.nowIso(),
        endedAt: null,
        processingToken: null,
        processingStartedAt: null,
        resultProcessedAt: null,
      };
      this.store.callEvents.set(callEvent.id, callEvent);
    }

    const operation = this.insertOperation(input, event.status, callEvent.id);
    return {
      event: this.applyPatchAndMessages(input, operation.id),
      applied: true,
      conflict: false,
      callEvent,
    };
  }
}
