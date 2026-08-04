import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { EventStatus } from "@/backend/orchestration/state-machine/states";
import {
  ArchivedContactCannotBeReactivatedError,
  CallIntentIntegrityError,
  ContactHasActiveCallError,
  DuplicateIdempotencyKeyError,
  InvalidContactOrderError,
  InvalidPrimaryContactError,
  PersonHasActiveEventError,
  UnknownRecordError,
} from "./errors";
import { slugify } from "@/shared/validation/profile";
import type {
  CallEventLease,
  CallIntentInput,
  CommitTransitionInput,
  CommitTransitionResult,
  CommitTransitionWithCallIntentResult,
  CreatePersonInput,
  CreateTrustedContactInput,
  Repository,
  UpdatePersonInput,
  UpdateTrustedContactInput,
} from "./repository";
import {
  fromCallEventPatch,
  fromContactPatch,
  fromEventPatch,
  fromPersonPatch,
  toCallEvent,
  toContact,
  toEvent,
  toPerson,
  toTimelineEntry,
  type CallEventRow,
  type ContactRow,
  type EventRow,
  type PersonRow,
  type TimelineRow,
} from "./row-mappers";
import type {
  CallEventRecord,
  EventRecord,
  TimelineEntry,
  TrustedContact,
  VulnerablePerson,
} from "@/shared/domain/types";

const UNIQUE_VIOLATION = "23505";
const INTEGRITY_VIOLATION = "23000";
// Postgres's standard "check_violation" class — migration 0011's
// trusted_contacts_archived_not_primary_or_enabled constraint raises this,
// not the application's own '23000' convention (that class is reserved for
// hand-written `raise exception ... using errcode = '23000'` domain errors).
const CHECK_VIOLATION = "23514";

function fail(context: string, error: PostgrestError): never {
  throw new Error(`SupabaseRepository: ${context} failed — ${error.message} (${error.code}).`);
}

// PostgREST returns a zero-row `returns setof` as [] and a one-row result as
// [row]; a `returns table(...)` with a composite column arrives as a nested
// object. Normalising both here keeps the two drivers indistinguishable.
function firstRow<T>(data: unknown): T | null {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return data as T;
}

export class SupabaseRepository implements Repository {
  constructor(private readonly client: SupabaseClient) {}

  async getPerson(personId: string): Promise<VulnerablePerson | undefined> {
    const { data, error } = await this.client
      .from("vulnerable_people")
      .select("*")
      .eq("id", personId)
      .maybeSingle();
    if (error) fail("getPerson", error);
    return data ? toPerson(data as PersonRow) : undefined;
  }

  async listPeople(): Promise<VulnerablePerson[]> {
    const { data, error } = await this.client
      .from("vulnerable_people")
      .select("*")
      .is("archived_at", null)
      .order("id");
    if (error) fail("listPeople", error);
    return (data as PersonRow[]).map(toPerson);
  }

  async getTrustedContacts(personId: string): Promise<TrustedContact[]> {
    const { data, error } = await this.client
      .from("trusted_contacts")
      .select("*")
      .eq("person_id", personId)
      .order("priority", { ascending: true });
    if (error) fail("getTrustedContacts", error);
    return (data as ContactRow[]).map(toContact);
  }

  async getActiveTrustedContacts(personId: string): Promise<TrustedContact[]> {
    const { data, error } = await this.client
      .from("trusted_contacts")
      .select("*")
      .eq("person_id", personId)
      .is("archived_at", null)
      .order("priority", { ascending: true });
    if (error) fail("getActiveTrustedContacts", error);
    return (data as ContactRow[]).map(toContact);
  }

  // Slug-based ids matching the seeded convention, retrying with a numeric
  // suffix when the primary key is taken — two people called Marie must both
  // be creatable, and the collision is only detectable at insert time.
  private async insertWithSlugId<Row>(
    table: string,
    prefix: string,
    firstName: string,
    build: (id: string) => Record<string, unknown>
  ): Promise<Row> {
    const base = `${prefix}_${slugify(firstName)}`;
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const id = attempt === 1 ? base : `${base}_${attempt}`;
      const { data, error } = await this.client
        .from(table)
        .insert(build(id))
        .select()
        .maybeSingle();

      if (!error) return data as Row;
      if (error.code !== UNIQUE_VIOLATION) fail(`insert into ${table}`, error);
      // Primary key taken — try the next suffix.
    }
    throw new Error(`SupabaseRepository: could not allocate an id for "${base}".`);
  }

  async createPerson(input: CreatePersonInput): Promise<VulnerablePerson> {
    const row = await this.insertWithSlugId<PersonRow>(
      "vulnerable_people",
      "person",
      input.firstName,
      (id) => ({
        id,
        first_name: input.firstName,
        // Already a validated E.164 number (DEC-008) — stored as given.
        phone: input.phone,
        preferred_language: input.preferredLanguage,
        conversation_profile: input.conversationProfile,
        preferred_call_time: input.preferredCallTime,
        interests: input.interests,
        consent_status: input.consentStatus,
        // Defaulted identically to InMemoryRepository and to migration 0010's
        // own column defaults (DEC-015), rather than left for the database
        // default to apply — so both drivers return the exact same row
        // whether or not a caller supplied these optional fields.
        timezone: input.timezone ?? "Europe/Paris",
        avatar_key: input.avatarKey ?? null,
        conversation_notes: input.conversationNotes ?? null,
        check_in_days: input.checkInDays ?? [1, 2, 3, 4, 5, 6, 7],
        schedule_state: input.scheduleState ?? "active",
      })
    );
    return toPerson(row);
  }

  async updatePerson(personId: string, input: UpdatePersonInput): Promise<VulnerablePerson> {
    const { data, error } = await this.client
      .from("vulnerable_people")
      .update(fromPersonPatch(input))
      .eq("id", personId)
      .select()
      .maybeSingle();
    if (error) fail("updatePerson", error);
    if (!data) throw new UnknownRecordError("person", personId);
    return toPerson(data as PersonRow);
  }

  async createTrustedContact(
    personId: string,
    input: CreateTrustedContactInput
  ): Promise<TrustedContact> {
    // Appended after the highest ACTIVE priority: an archived contact's stale
    // priority is irrelevant, since only active contacts are ever renumbered
    // or dialled (DEC-009).
    const circle = await this.getActiveTrustedContacts(personId);
    const priority = circle.reduce((max, contact) => Math.max(max, contact.priority), 0) + 1;

    const row = await this.insertWithSlugId<ContactRow>(
      "trusted_contacts",
      "contact",
      input.firstName,
      (id) => ({
        id,
        person_id: personId,
        first_name: input.firstName,
        // Already a validated E.164 number (DEC-008) — stored as given.
        phone: input.phone,
        relationship: input.relationship,
        priority,
        consent_status: input.consentStatus,
        // Defaulted identically to InMemoryRepository and to migration 0011's
        // own column defaults (DEC-017), rather than left for the database
        // default to apply — so both drivers return the exact same row
        // whether or not a caller supplied these optional fields.
        is_primary: input.isPrimary ?? false,
        enabled: input.enabled ?? true,
        callable_from: input.callableFrom ?? null,
        callable_to: input.callableTo ?? null,
        timezone: input.timezone ?? null,
        max_attempts: input.maxAttempts ?? 2,
      })
    );
    return toContact(row);
  }

  // Stage E (DEC-017). A partial patch, mirroring updatePerson exactly.
  // Migration 0011's CHECK constraint refuses to enable an archived contact —
  // surfaced here as the same typed error InMemoryRepository throws, so the
  // two drivers never disagree about this rule.
  async updateTrustedContact(
    contactId: string,
    input: UpdateTrustedContactInput
  ): Promise<TrustedContact> {
    const { data, error } = await this.client
      .from("trusted_contacts")
      .update(fromContactPatch(input))
      .eq("id", contactId)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === CHECK_VIOLATION) {
        throw new ArchivedContactCannotBeReactivatedError(contactId);
      }
      fail("updateTrustedContact", error);
    }
    if (!data) throw new UnknownRecordError("trusted contact", contactId);
    return toContact(data as ContactRow);
  }

  // Stage E. Atomic via the RPC (one transaction): clears any previous
  // primary and sets the new one, so no interim state with zero or two
  // primaries is ever observable.
  async setPrimaryContact(personId: string, contactId: string): Promise<TrustedContact[]> {
    const { data, error } = await this.client.rpc("set_primary_contact", {
      p_person_id: personId,
      p_contact_id: contactId,
    });
    if (error) {
      if (error.code === INTEGRITY_VIOLATION) {
        throw new InvalidPrimaryContactError(personId, error.message);
      }
      fail("setPrimaryContact", error);
    }
    return ((data ?? []) as ContactRow[]).map(toContact);
  }

  async reorderTrustedContacts(
    personId: string,
    orderedIds: string[]
  ): Promise<TrustedContact[]> {
    // One transaction: `unique (person_id, priority)` rejects any interim
    // state where two contacts share a priority, so a naive swap fails halfway.
    const { data, error } = await this.client.rpc("reorder_trusted_contacts", {
      p_person_id: personId,
      p_ordered_ids: orderedIds,
    });
    if (error) {
      if (error.code === INTEGRITY_VIOLATION) {
        throw new InvalidContactOrderError(personId, error.message);
      }
      fail("reorderTrustedContacts", error);
    }
    return ((data ?? []) as ContactRow[]).map(toContact);
  }

  // ── Soft deletion (DEC-009) ─────────────────────────────────────────────────
  async archivePerson(personId: string): Promise<VulnerablePerson> {
    const { data, error } = await this.client.rpc("archive_person", {
      p_person_id: personId,
    });
    if (error) {
      if (error.code === INTEGRITY_VIOLATION) throw new PersonHasActiveEventError(personId);
      fail("archivePerson", error);
    }
    const row = firstRow<PersonRow>(data);
    if (!row) throw new UnknownRecordError("person", personId);
    return toPerson(row);
  }

  async archiveTrustedContact(contactId: string): Promise<TrustedContact> {
    const { data, error } = await this.client.rpc("archive_trusted_contact", {
      p_contact_id: contactId,
    });
    if (error) {
      if (error.code === INTEGRITY_VIOLATION) throw new ContactHasActiveCallError(contactId);
      fail("archiveTrustedContact", error);
    }
    const row = firstRow<ContactRow>(data);
    if (!row) throw new UnknownRecordError("trusted contact", contactId);
    return toContact(row);
  }

  async listEvents(personId: string, limit?: number): Promise<EventRecord[]> {
    let query = this.client
      .from("events")
      .select("*")
      .eq("person_id", personId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (limit !== undefined) query = query.limit(limit);

    const { data, error } = await query;
    if (error) fail("listEvents", error);
    return (data as EventRow[]).map(toEvent);
  }

  async listRecentEvents({
    since,
    limit,
  }: {
    since: string;
    limit: number;
  }): Promise<EventRecord[]> {
    // Unfiltered by person (the cross-person read the dashboard/history page
    // need). archivedAt on the PERSON is deliberately not checked here — an
    // archived person's past events must stay visible in history (DEC-009).
    const { data, error } = await this.client
      .from("events")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) fail("listRecentEvents", error);
    return (data as EventRow[]).map(toEvent);
  }

  async createEvent(personId: string): Promise<EventRecord> {
    // id and run_id come from column defaults: a durable sequence and
    // gen_random_uuid(), so neither can repeat after a restart (DEC-004).
    const { data, error } = await this.client
      .from("events")
      .insert({ person_id: personId, status: "SCHEDULED" as EventStatus })
      .select()
      .single();
    if (error) fail("createEvent", error);
    return toEvent(data as EventRow);
  }

  async getEvent(eventId: string): Promise<EventRecord | undefined> {
    const { data, error } = await this.client
      .from("events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle();
    if (error) fail("getEvent", error);
    return data ? toEvent(data as EventRow) : undefined;
  }

  async updateEvent(eventId: string, patch: Partial<EventRecord>): Promise<EventRecord> {
    const { data, error } = await this.client
      .from("events")
      .update(fromEventPatch(patch))
      .eq("id", eventId)
      .select()
      .maybeSingle();
    if (error) fail("updateEvent", error);
    if (!data) throw new UnknownRecordError("event", eventId);
    return toEvent(data as EventRow);
  }

  async appendTimelineEntry(
    eventId: string,
    status: EventStatus,
    message: string
  ): Promise<TimelineEntry> {
    const { data, error } = await this.client
      .from("timeline_entries")
      .insert({ event_id: eventId, status, message })
      .select()
      .single();
    if (error) fail("appendTimelineEntry", error);
    return toTimelineEntry(data as TimelineRow);
  }

  async listTimeline(eventId: string): Promise<TimelineEntry[]> {
    // Ordered by the monotonic seq, not created_at, which can tie at
    // sub-millisecond resolution inside one cascade step.
    const { data, error } = await this.client
      .from("timeline_entries")
      .select("*")
      .eq("event_id", eventId)
      .order("seq", { ascending: true });
    if (error) fail("listTimeline", error);
    return (data as TimelineRow[]).map(toTimelineEntry);
  }

  async getCallEvent(callEventId: string): Promise<CallEventRecord | undefined> {
    const { data, error } = await this.client
      .from("call_events")
      .select("*")
      .eq("id", callEventId)
      .maybeSingle();
    if (error) fail("getCallEvent", error);
    return data ? toCallEvent(data as CallEventRow) : undefined;
  }

  async listCallEvents(eventId: string): Promise<CallEventRecord[]> {
    const { data, error } = await this.client
      .from("call_events")
      .select("*")
      .eq("event_id", eventId)
      .order("seq", { ascending: true });
    if (error) fail("listCallEvents", error);
    return (data as CallEventRow[]).map(toCallEvent);
  }

  async listCallEventsForEvents(eventIds: string[]): Promise<CallEventRecord[]> {
    // No query for an empty list: `.in("event_id", [])` is a valid PostgREST
    // filter, but there's no reason to round-trip for a result that must be [].
    if (eventIds.length === 0) return [];
    // Ordered by the monotonic seq (as listCallEvents is per-event), which
    // determines both the global order AND the order within each event once
    // grouped by eventId at the call site.
    const { data, error } = await this.client
      .from("call_events")
      .select("*")
      .in("event_id", eventIds)
      .order("seq", { ascending: true });
    if (error) fail("listCallEventsForEvents", error);
    return (data as CallEventRow[]).map(toCallEvent);
  }

  async findCallEventByIdempotencyKey(key: string): Promise<CallEventRecord | undefined> {
    const { data, error } = await this.client
      .from("call_events")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) fail("findCallEventByIdempotencyKey", error);
    return data ? toCallEvent(data as CallEventRow) : undefined;
  }

  async updateCallEvent(
    callEventId: string,
    patch: Partial<CallEventRecord>
  ): Promise<CallEventRecord> {
    const { data, error } = await this.client
      .from("call_events")
      .update(fromCallEventPatch(patch))
      .eq("id", callEventId)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new DuplicateIdempotencyKeyError(callEventId);
      fail("updateCallEvent", error);
    }
    if (!data) throw new UnknownRecordError("call event", callEventId);
    return toCallEvent(data as CallEventRow);
  }

  async attachCalleCallId(callEventId: string, calleCallId: string): Promise<CallEventRecord> {
    // Conditional on calle_call_id still being null, so a caller that lost the
    // race gets the winner's row back rather than overwriting it.
    const { data, error } = await this.client
      .from("call_events")
      .update({ calle_call_id: calleCallId, status: "in_progress" })
      .eq("id", callEventId)
      .is("calle_call_id", null)
      .select()
      .maybeSingle();
    if (error) fail("attachCalleCallId", error);
    if (data) return toCallEvent(data as CallEventRow);

    const current = await this.getCallEvent(callEventId);
    if (!current) throw new UnknownRecordError("call event", callEventId);
    return current;
  }

  async claimCallEventResult(
    callEventId: string,
    leaseSeconds: number
  ): Promise<CallEventLease | null> {
    const { data, error } = await this.client.rpc("claim_call_event_result", {
      p_call_event_id: callEventId,
      p_lease_seconds: leaseSeconds,
    });
    if (error) fail("claimCallEventResult", error);

    const row = firstRow<CallEventRow>(data);
    if (!row) return null;
    const callEvent = toCallEvent(row);
    return { callEvent, token: callEvent.processingToken! };
  }

  async finalizeCallEventResult(
    callEventId: string,
    token: string,
    outcome: Pick<CallEventRecord, "status" | "summary" | "structuredResult" | "endedAt">
  ): Promise<CallEventRecord | null> {
    const { data, error } = await this.client.rpc("finalize_call_event_result", {
      p_call_event_id: callEventId,
      p_processing_token: token,
      p_status: outcome.status,
      p_summary: outcome.summary,
      p_structured_result: outcome.structuredResult ?? null,
      p_ended_at: outcome.endedAt,
    });
    if (error) fail("finalizeCallEventResult", error);

    const row = firstRow<CallEventRow>(data);
    return row ? toCallEvent(row) : null;
  }

  async releaseCallEventLease(callEventId: string, token: string): Promise<void> {
    const { error } = await this.client.rpc("release_call_event_lease", {
      p_call_event_id: callEventId,
      p_processing_token: token,
    });
    if (error) fail("releaseCallEventLease", error);
  }

  async findAppliedOperation(eventId: string, operationKey: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("event_operations")
      .select("id")
      .eq("event_id", eventId)
      .eq("operation_key", operationKey)
      .maybeSingle();
    if (error) fail("findAppliedOperation", error);
    return data !== null;
  }

  async commitTransition(input: CommitTransitionInput): Promise<CommitTransitionResult> {
    const { data, error } = await this.client.rpc("commit_transition", {
      p_event_id: input.eventId,
      p_operation_key: input.operationKey,
      p_transition_event: input.transitionEvent,
      p_expected_from_status: input.expectedFromStatus,
      p_status: input.status,
      p_messages: input.messages ?? [],
      p_patch: input.patch ?? {},
    });
    if (error) fail("commitTransition", error);

    const row = firstRow<{ event_row: EventRow; applied: boolean; status_conflict: boolean }>(data);
    if (!row) throw new UnknownRecordError("event", input.eventId);
    return {
      event: toEvent(row.event_row),
      applied: row.applied,
      conflict: row.status_conflict,
    };
  }

  async getAppliedTransitionWithCallIntent(
    eventId: string,
    operationKey: string
  ): Promise<{ event: EventRecord; callEvent: CallEventRecord } | null> {
    const { data, error } = await this.client
      .from("event_operations")
      .select("call_event_id")
      .eq("event_id", eventId)
      .eq("operation_key", operationKey)
      .maybeSingle();
    if (error) fail("getAppliedTransitionWithCallIntent", error);
    if (!data) return null;

    const callEventId = (data as { call_event_id: string | null }).call_event_id;
    if (callEventId === null) {
      throw new CallIntentIntegrityError(eventId, operationKey, "the operation started no call");
    }

    const [event, callEvent] = await Promise.all([
      this.getEvent(eventId),
      this.getCallEvent(callEventId),
    ]);
    if (!event) throw new UnknownRecordError("event", eventId);
    if (!callEvent) {
      throw new CallIntentIntegrityError(
        eventId,
        operationKey,
        `the recorded intent "${callEventId}" no longer exists`
      );
    }
    return { event, callEvent };
  }

  async commitTransitionWithCallIntent(
    input: CommitTransitionInput & { intent: CallIntentInput }
  ): Promise<CommitTransitionWithCallIntentResult> {
    const { data, error } = await this.client.rpc("commit_transition_with_call_intent", {
      p_event_id: input.eventId,
      p_operation_key: input.operationKey,
      p_transition_event: input.transitionEvent,
      p_expected_from_status: input.expectedFromStatus,
      p_status: input.status,
      p_messages: input.messages ?? [],
      p_patch: input.patch ?? {},
      p_agent_type: input.intent.agentType,
      p_contact_id: input.intent.contactId,
      p_attempt_number: input.intent.attemptNumber,
      p_idempotency_key: input.intent.idempotencyKey,
    });
    if (error) {
      // The SQL function raises 23000 when the ledger's recorded intent is not
      // the one the caller expected — never the same thing as a duplicate key.
      if (error.code === INTEGRITY_VIOLATION) {
        throw new CallIntentIntegrityError(input.eventId, input.operationKey, error.message);
      }
      if (error.code === UNIQUE_VIOLATION) {
        throw new DuplicateIdempotencyKeyError(input.intent.idempotencyKey);
      }
      fail("commitTransitionWithCallIntent", error);
    }

    const row = firstRow<{
      event_row: EventRow;
      applied: boolean;
      status_conflict: boolean;
      call_event: CallEventRow | null;
    }>(data);
    if (!row) throw new UnknownRecordError("event", input.eventId);

    return {
      event: toEvent(row.event_row),
      applied: row.applied,
      conflict: row.status_conflict,
      callEvent: row.call_event ? toCallEvent(row.call_event) : null,
    };
  }
}
