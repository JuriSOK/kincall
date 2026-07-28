import type { EventStatus } from "../orchestration/states";
import type {
  CallEventRecord,
  EventRecord,
  TimelineEntry,
  TrustedContact,
  VulnerablePerson,
} from "./types";

// The seam a future Supabase-backed implementation would satisfy — engine
// code and the pure orchestration functions never touch storage directly.
export interface Repository {
  getPerson(personId: string): VulnerablePerson | undefined;
  listPeople(): VulnerablePerson[];
  getTrustedContacts(personId: string): TrustedContact[]; // sorted by priority ascending

  createEvent(personId: string): EventRecord;
  getEvent(eventId: string): EventRecord | undefined;
  updateEvent(eventId: string, patch: Partial<EventRecord>): EventRecord;

  appendTimelineEntry(eventId: string, status: EventStatus, message: string): TimelineEntry;
  listTimeline(eventId: string): TimelineEntry[];

  getCallEvent(callEventId: string): CallEventRecord | undefined;
  listCallEvents(eventId: string): CallEventRecord[];
  findCallEventByIdempotencyKey(key: string): CallEventRecord | undefined;
  createCallEvent(input: Omit<CallEventRecord, "id">): CallEventRecord;
  updateCallEvent(callEventId: string, patch: Partial<CallEventRecord>): CallEventRecord;
}
