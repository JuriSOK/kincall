import { randomUUID } from "node:crypto";
import type { EventStatus } from "../orchestration/states";
import type { Repository } from "./repository";
import type {
  CallEventRecord,
  EventRecord,
  TimelineEntry,
  TrustedContact,
  VulnerablePerson,
} from "./types";

export class InMemoryRepository implements Repository {
  private readonly people = new Map<string, VulnerablePerson>();
  private readonly contacts = new Map<string, TrustedContact>();
  private readonly events = new Map<string, EventRecord>();
  private readonly callEvents = new Map<string, CallEventRecord>();
  private readonly timeline = new Map<string, TimelineEntry[]>();

  private eventSequence = 0;
  private callEventSequence = 0;
  private timelineSequence = 0;

  seedPerson(person: VulnerablePerson): void {
    this.people.set(person.id, person);
  }

  seedContact(contact: TrustedContact): void {
    this.contacts.set(contact.id, contact);
  }

  getPerson(personId: string): VulnerablePerson | undefined {
    return this.people.get(personId);
  }

  listPeople(): VulnerablePerson[] {
    return [...this.people.values()];
  }

  getTrustedContacts(personId: string): TrustedContact[] {
    return [...this.contacts.values()]
      .filter((contact) => contact.personId === personId)
      .sort((a, b) => a.priority - b.priority);
  }

  createEvent(personId: string): EventRecord {
    this.eventSequence += 1;
    const id = `event_${String(this.eventSequence).padStart(3, "0")}`;
    const event: EventRecord = {
      id,
      // crypto.randomUUID(), not derived from the sequential `id`: it must
      // stay unique even after a process restart resets eventSequence to 0.
      runId: randomUUID(),
      personId,
      status: "SCHEDULED",
      priority: null,
      currentContactPriority: null,
      decision: null,
      decisionReason: null,
      createdAt: new Date().toISOString(),
      closedAt: null,
    };
    this.events.set(id, event);
    this.timeline.set(id, []);
    return event;
  }

  getEvent(eventId: string): EventRecord | undefined {
    return this.events.get(eventId);
  }

  updateEvent(eventId: string, patch: Partial<EventRecord>): EventRecord {
    const existing = this.events.get(eventId);
    if (!existing) {
      throw new Error(`InMemoryRepository: unknown event "${eventId}".`);
    }
    const updated = { ...existing, ...patch };
    this.events.set(eventId, updated);
    return updated;
  }

  appendTimelineEntry(eventId: string, status: EventStatus, message: string): TimelineEntry {
    this.timelineSequence += 1;
    const entry: TimelineEntry = {
      id: `timeline_${String(this.timelineSequence).padStart(3, "0")}`,
      eventId,
      status,
      message,
      createdAt: new Date().toISOString(),
    };
    const entries = this.timeline.get(eventId) ?? [];
    entries.push(entry);
    this.timeline.set(eventId, entries);
    return entry;
  }

  listTimeline(eventId: string): TimelineEntry[] {
    return [...(this.timeline.get(eventId) ?? [])];
  }

  getCallEvent(callEventId: string): CallEventRecord | undefined {
    return this.callEvents.get(callEventId);
  }

  listCallEvents(eventId: string): CallEventRecord[] {
    return [...this.callEvents.values()].filter((call) => call.eventId === eventId);
  }

  findCallEventByIdempotencyKey(key: string): CallEventRecord | undefined {
    return [...this.callEvents.values()].find((call) => call.idempotencyKey === key);
  }

  createCallEvent(input: Omit<CallEventRecord, "id">): CallEventRecord {
    if (this.findCallEventByIdempotencyKey(input.idempotencyKey)) {
      throw new Error(
        `InMemoryRepository: duplicate idempotency key "${input.idempotencyKey}".`
      );
    }
    this.callEventSequence += 1;
    const callEvent: CallEventRecord = {
      id: `call_event_${String(this.callEventSequence).padStart(3, "0")}`,
      ...input,
    };
    this.callEvents.set(callEvent.id, callEvent);
    return callEvent;
  }

  updateCallEvent(callEventId: string, patch: Partial<CallEventRecord>): CallEventRecord {
    const existing = this.callEvents.get(callEventId);
    if (!existing) {
      throw new Error(`InMemoryRepository: unknown call event "${callEventId}".`);
    }
    const updated = { ...existing, ...patch };
    this.callEvents.set(callEventId, updated);
    return updated;
  }
}
