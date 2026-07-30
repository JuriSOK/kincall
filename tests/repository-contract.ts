import { beforeEach, describe, expect, it } from "vitest";
import {
  CallIntentIntegrityError,
  ContactHasActiveCallError,
  PersonHasActiveEventError,
  UnknownRecordError,
} from "@/lib/database/errors";
import type { Repository } from "@/lib/database/repository";
import { seedPendingFamilyCallIntent } from "./support/seed-calls";

// The behaviours BOTH implementations must share. SupabaseRepository is held
// to InMemoryRepository's exact contract rather than to a hand-written mirror
// of it, so a divergence surfaces as a failing assertion in one shared suite.
export interface ContractHarness {
  // A fresh, seeded repository.
  make(): Promise<Repository>;
  // A second repository over the SAME data — a stand-in for a second process,
  // which is what makes restart recovery assertable.
  reopen(repository: Repository): Promise<Repository>;
  // Moves the clock forward so lease expiry is testable without waiting.
  advance(seconds: number): Promise<void>;
  // How long a lease lasts in this harness.
  leaseSeconds: number;
}

const COMPANION_KEY = "run:start:COMPANION_CALL_STARTED";

export function repositoryContract(name: string, harness: ContractHarness): void {
  describe(`${name} — repository contract`, () => {
    let repository: Repository;

    beforeEach(async () => {
      repository = await harness.make();
    });

    // Creates an event plus a companion intent through the only path that can.
    async function seedIntent(overrides: { idempotencyKey?: string } = {}) {
      const event = await repository.createEvent("person_marie");
      const result = await repository.commitTransitionWithCallIntent({
        eventId: event.id,
        operationKey: COMPANION_KEY,
        transitionEvent: "COMPANION_CALL_STARTED",
        expectedFromStatus: "SCHEDULED",
        status: "CALLING_PERSON",
        messages: ["Check-in call started"],
        intent: {
          agentType: "companion",
          contactId: null,
          attemptNumber: 1,
          idempotencyKey: overrides.idempotencyKey ?? `${event.runId}_companion_attempt_1`,
        },
      });
      return { event, result, callEvent: result.callEvent! };
    }

    describe("reads", () => {
      it("returns the trusted circle in priority order", async () => {
        const contacts = await repository.getTrustedContacts("person_marie");
        expect(contacts.map((contact) => contact.firstName)).toEqual(["Julie", "Marc", "Nicole"]);
        expect(contacts.map((contact) => contact.priority)).toEqual([1, 2, 3]);
      });

      it("creates events with a human-readable id and a distinct runId each time", async () => {
        const first = await repository.createEvent("person_marie");
        const second = await repository.createEvent("person_marie");

        expect(first.id).toMatch(/^event_\d{3,}$/);
        expect(first.status).toBe("SCHEDULED");
        expect(first.runId).not.toBe(second.runId);
        expect(first.id).not.toBe(second.id);
      });

      it("throws UnknownRecordError for an unknown event or call event", async () => {
        await expect(repository.updateEvent("event_nope", { status: "CASE_CLOSED" })).rejects.toThrow(
          UnknownRecordError
        );
        await expect(repository.updateCallEvent("call_event_nope", { summary: "x" })).rejects.toThrow(
          UnknownRecordError
        );
      });

      it("keeps timeline entries in insertion order even when written within one millisecond", async () => {
        const event = await repository.createEvent("person_marie");
        for (let index = 0; index < 10; index += 1) {
          await repository.appendTimelineEntry(event.id, "SCHEDULED", `entry ${index}`);
        }

        const timeline = await repository.listTimeline(event.id);
        expect(timeline.map((entry) => entry.message)).toEqual(
          Array.from({ length: 10 }, (_, index) => `entry ${index}`)
        );
      });

      it("round-trips a structured result deep-equal", async () => {
        const { callEvent } = await seedIntent();
        const structuredResult = {
          contact_id: "contact_marc",
          answered: "yes",
          nested: { list: [1, 2, 3], flag: false },
        };

        await repository.updateCallEvent(callEvent.id, { structuredResult });
        const reread = await repository.getCallEvent(callEvent.id);
        expect(reread?.structuredResult).toEqual(structuredResult);
      });

      it("round-trips array and nullable columns, with null staying null", async () => {
        const person = await repository.getPerson("person_marie");
        expect(person?.interests).toEqual(["gardening", "family"]);

        const event = await repository.createEvent("person_marie");
        expect(event.closedAt).toBeNull();
        expect(event.decision).toBeNull();
        expect(event.currentContactPriority).toBeNull();
      });
    });

    describe("transition + call intent atomicity", () => {
      it("creates the intent and the ledger link in one operation", async () => {
        const { result, callEvent } = await seedIntent();

        expect(result.applied).toBe(true);
        expect(result.conflict).toBe(false);
        expect(callEvent.status).toBe("starting");
        expect(callEvent.calleCallId).toBeNull();

        const byKey = await repository.findCallEventByIdempotencyKey(callEvent.idempotencyKey);
        expect(byKey?.id).toBe(callEvent.id);

        const linked = await repository.getAppliedTransitionWithCallIntent(
          result.event.id,
          COMPANION_KEY
        );
        expect(linked?.callEvent.id).toBe(callEvent.id);
      });

      it("returns the EXACT prior intent on a duplicate operation key, not merely applied:false", async () => {
        const { event, callEvent } = await seedIntent();

        const replay = await repository.commitTransitionWithCallIntent({
          eventId: event.id,
          operationKey: COMPANION_KEY,
          transitionEvent: "COMPANION_CALL_STARTED",
          // Deliberately stale: a replay must win before the status check.
          expectedFromStatus: "SCHEDULED",
          status: "CALLING_PERSON",
          messages: ["Check-in call started"],
          intent: {
            agentType: "companion",
            contactId: null,
            attemptNumber: 1,
            idempotencyKey: callEvent.idempotencyKey,
          },
        });

        expect(replay.applied).toBe(false);
        expect(replay.conflict).toBe(false);
        expect(replay.callEvent!.id).toBe(callEvent.id);
        // And no second timeline entry.
        expect(await repository.listTimeline(event.id)).toHaveLength(1);
      });

      it("writes nothing at all — not even an intent — on a status conflict", async () => {
        const event = await repository.createEvent("person_marie");
        await repository.updateEvent(event.id, { status: "CASE_CLOSED" });

        const conflicted = await repository.commitTransitionWithCallIntent({
          eventId: event.id,
          operationKey: COMPANION_KEY,
          transitionEvent: "COMPANION_CALL_STARTED",
          expectedFromStatus: "SCHEDULED",
          status: "CALLING_PERSON",
          messages: ["Check-in call started"],
          intent: {
            agentType: "companion",
            contactId: null,
            attemptNumber: 1,
            idempotencyKey: `${event.runId}_companion_attempt_1`,
          },
        });

        expect(conflicted.conflict).toBe(true);
        expect(conflicted.applied).toBe(false);
        expect(conflicted.callEvent).toBeNull();
        expect(await repository.listCallEvents(event.id)).toHaveLength(0);
        expect(await repository.listTimeline(event.id)).toHaveLength(0);
        expect(await repository.findAppliedOperation(event.id, COMPANION_KEY)).toBe(false);
      });

      it("raises CallIntentIntegrityError for drifted parameters, and creates no second intent", async () => {
        const { event } = await seedIntent();

        await expect(
          repository.commitTransitionWithCallIntent({
            eventId: event.id,
            operationKey: COMPANION_KEY,
            transitionEvent: "COMPANION_CALL_STARTED",
            expectedFromStatus: "SCHEDULED",
            status: "CALLING_PERSON",
            intent: {
              agentType: "companion",
              contactId: null,
              attemptNumber: 1,
              idempotencyKey: "a_completely_different_key",
            },
          })
        ).rejects.toThrow(CallIntentIntegrityError);

        expect(await repository.listCallEvents(event.id)).toHaveLength(1);
      });

      it("raises CallIntentIntegrityError when an applied operation started no call", async () => {
        const event = await repository.createEvent("person_marie");
        await repository.commitTransition({
          eventId: event.id,
          operationKey: "plain",
          transitionEvent: "COMPANION_CALL_STARTED",
          expectedFromStatus: "SCHEDULED",
          status: "CALLING_PERSON",
        });

        await expect(
          repository.getAppliedTransitionWithCallIntent(event.id, "plain")
        ).rejects.toThrow(CallIntentIntegrityError);
      });

      it("returns null from getAppliedTransitionWithCallIntent for a key never applied", async () => {
        const event = await repository.createEvent("person_marie");
        expect(await repository.getAppliedTransitionWithCallIntent(event.id, "nope")).toBeNull();
      });

      it("rejects a second companion intent for one event", async () => {
        const { event } = await seedIntent();
        await expect(
          repository.commitTransitionWithCallIntent({
            eventId: event.id,
            operationKey: "another:start:COMPANION_CALL_STARTED",
            transitionEvent: "COMPANION_CALL_STARTED",
            expectedFromStatus: "CALLING_PERSON",
            status: "CALLING_PERSON",
            intent: {
              agentType: "companion",
              contactId: null,
              attemptNumber: 1,
              idempotencyKey: `${event.runId}_companion_attempt_2`,
            },
          })
        ).rejects.toThrow();
      });
    });

    describe("attachCalleCallId", () => {
      it("attaches the id and flips the status out of 'starting'", async () => {
        const { callEvent } = await seedIntent();
        const attached = await repository.attachCalleCallId(callEvent.id, "calle_123");

        expect(attached.calleCallId).toBe("calle_123");
        expect(attached.status).toBe("in_progress");
      });

      it("leaves the first id in place when a second attach arrives", async () => {
        const { callEvent } = await seedIntent();
        await repository.attachCalleCallId(callEvent.id, "calle_first");
        const second = await repository.attachCalleCallId(callEvent.id, "calle_second");

        expect(second.calleCallId).toBe("calle_first");
      });
    });

    describe("processing lease", () => {
      async function leasable() {
        const { callEvent } = await seedIntent();
        return repository.attachCalleCallId(callEvent.id, "calle_lease");
      }

      it("grants the lease once and refuses a live second holder", async () => {
        const callEvent = await leasable();

        const first = await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);
        const second = await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);

        expect(first).not.toBeNull();
        expect(second).toBeNull();
      });

      it("NEVER sets resultProcessedAt when the lease is acquired", async () => {
        // This inversion — consuming the result at claim time — is precisely
        // what made a crash mid-branch strand the event permanently.
        const callEvent = await leasable();
        const lease = await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);

        expect(lease!.callEvent.resultProcessedAt).toBeNull();
        expect((await repository.getCallEvent(callEvent.id))?.resultProcessedAt).toBeNull();
      });

      it("lets another worker reclaim a stale lease with a different token", async () => {
        const callEvent = await leasable();
        const first = await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);

        await harness.advance(harness.leaseSeconds + 1);

        const second = await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);
        expect(second).not.toBeNull();
        expect(second!.token).not.toBe(first!.token);
      });

      it("finalizes with the holder's token and blocks any further lease", async () => {
        const callEvent = await leasable();
        const lease = await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);

        const finalized = await repository.finalizeCallEventResult(callEvent.id, lease!.token, {
          status: "completed",
          summary: "done",
          structuredResult: { ok: true },
          endedAt: new Date().toISOString(),
        });

        expect(finalized).not.toBeNull();
        expect(finalized!.resultProcessedAt).not.toBeNull();
        expect(finalized!.processingToken).toBeNull();
        expect(await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds)).toBeNull();
      });

      it("returns null and changes nothing when finalizing with a stale token", async () => {
        const callEvent = await leasable();
        const stale = await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);
        await harness.advance(harness.leaseSeconds + 1);
        await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);

        const finalized = await repository.finalizeCallEventResult(callEvent.id, stale!.token, {
          status: "completed",
          summary: "stale worker",
          structuredResult: null,
          endedAt: new Date().toISOString(),
        });

        expect(finalized).toBeNull();
        const current = await repository.getCallEvent(callEvent.id);
        expect(current?.resultProcessedAt).toBeNull();
        expect(current?.summary).not.toBe("stale worker");
      });

      it("releases for the holder and no-ops for a stale token", async () => {
        const callEvent = await leasable();
        const lease = await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);

        await repository.releaseCallEventLease(callEvent.id, "not-the-token");
        expect((await repository.getCallEvent(callEvent.id))?.processingToken).toBe(lease!.token);

        await repository.releaseCallEventLease(callEvent.id, lease!.token);
        expect((await repository.getCallEvent(callEvent.id))?.processingToken).toBeNull();
        // And it is immediately available again, without waiting out the lease.
        expect(
          await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds)
        ).not.toBeNull();
      });

      it("marks a superseded result processed with no ledger row for it", async () => {
        const callEvent = await leasable();
        const lease = await repository.claimCallEventResult(callEvent.id, harness.leaseSeconds);
        await repository.finalizeCallEventResult(callEvent.id, lease!.token, {
          status: "completed",
          summary: "superseded",
          structuredResult: { kept: true },
          endedAt: new Date().toISOString(),
        });

        const current = await repository.getCallEvent(callEvent.id);
        expect(current?.resultProcessedAt).not.toBeNull();
        expect(current?.processingToken).toBeNull();
        // The outcome stays inspectable even though it changed nothing.
        expect(current?.structuredResult).toEqual({ kept: true });
        // No result-stage operation was recorded: that absence IS "superseded".
        const resultKey = `${callEvent.id}:result:FAMILY_NO_ANSWER`;
        expect(await repository.findAppliedOperation(callEvent.eventId, resultKey)).toBe(false);
      });
    });

    describe("commitTransition", () => {
      it("applies the full patch and every message under one operation", async () => {
        const event = await repository.createEvent("person_marie");
        const result = await repository.commitTransition({
          eventId: event.id,
          operationKey: "op-1",
          transitionEvent: "COMPANION_CALL_STARTED",
          expectedFromStatus: "SCHEDULED",
          status: "CALLING_PERSON",
          patch: {
            decision: "CONTACT_TRUSTED_PERSON",
            decisionReason: "why",
            currentContactPriority: 1,
          },
          messages: ["first", "second"],
        });

        expect(result.applied).toBe(true);
        expect(result.event.status).toBe("CALLING_PERSON");
        expect(result.event.currentContactPriority).toBe(1);
        expect(result.event.decision).toBe("CONTACT_TRUSTED_PERSON");
        expect(result.event.decisionReason).toBe("why");
        expect((await repository.listTimeline(event.id)).map((e) => e.message)).toEqual([
          "first",
          "second",
        ]);
      });

      it("is a no-op on a duplicate key, even from a status that no longer matches", async () => {
        const event = await repository.createEvent("person_marie");
        const input = {
          eventId: event.id,
          operationKey: "op-1",
          transitionEvent: "COMPANION_CALL_STARTED" as const,
          expectedFromStatus: "SCHEDULED" as const,
          status: "CALLING_PERSON" as const,
          messages: ["only once"],
        };
        await repository.commitTransition(input);
        // The event has since moved on; the replay must still be a clean no-op.
        await repository.updateEvent(event.id, { status: "CASE_CLOSED" });

        const replay = await repository.commitTransition(input);

        expect(replay.applied).toBe(false);
        expect(replay.conflict).toBe(false);
        expect(await repository.listTimeline(event.id)).toHaveLength(1);
        expect(replay.event.status).toBe("CASE_CLOSED");
      });

      it("reports a conflict for a NEW key from the wrong status, then succeeds from the right one", async () => {
        const event = await repository.createEvent("person_marie");
        await repository.updateEvent(event.id, { status: "CALLING_PERSON" });

        const conflicted = await repository.commitTransition({
          eventId: event.id,
          operationKey: "op-2",
          transitionEvent: "COMPANION_CALL_STARTED",
          expectedFromStatus: "SCHEDULED",
          status: "CALLING_PERSON",
          messages: ["nope"],
        });
        expect(conflicted.conflict).toBe(true);
        expect(await repository.listTimeline(event.id)).toHaveLength(0);
        expect(await repository.findAppliedOperation(event.id, "op-2")).toBe(false);

        const applied = await repository.commitTransition({
          eventId: event.id,
          operationKey: "op-2",
          transitionEvent: "COMPANION_CONVERSATION_STARTED",
          expectedFromStatus: "CALLING_PERSON",
          status: "CONVERSATION_IN_PROGRESS",
          messages: ["yes"],
        });
        expect(applied.applied).toBe(true);
      });
    });

    describe("profile and trusted-circle creation", () => {
      const profile = {
        firstName: "Sophie",
        phone: "+33698765432",
        preferredLanguage: "fr-FR",
        conversationProfile: "standard",
        preferredCallTime: "09:00",
        interests: ["reading"],
        consentStatus: "confirmed" as const,
      };

      it("round-trips a created person", async () => {
        const created = await repository.createPerson(profile);
        expect(created.id).toMatch(/^person_sophie/);
        expect(await repository.getPerson(created.id)).toEqual(created);
        expect((await repository.listPeople()).map((p) => p.id)).toContain(created.id);
      });

      // DEC-008: the caller supplies a validated E.164 number and it is stored
      // exactly as given — no placeholder, no minting.
      it("stores the supplied phone number exactly as given", async () => {
        const created = await repository.createPerson(profile);
        expect(created.phone).toBe("+33698765432");
      });

      it("allocates a distinct id when the slug is already taken", async () => {
        const first = await repository.createPerson(profile);
        const second = await repository.createPerson(profile);
        expect(second.id).not.toBe(first.id);
        expect(await repository.getPerson(first.id)).toBeDefined();
        expect(await repository.getPerson(second.id)).toBeDefined();
      });

      it("appends contacts to the end of the circle", async () => {
        const person = await repository.createPerson(profile);
        const a = await repository.createTrustedContact(person.id, {
          firstName: "Ana",
          phone: "+33611111111",
          relationship: "daughter",
          consentStatus: "confirmed",
        });
        const b = await repository.createTrustedContact(person.id, {
          firstName: "Ben",
          phone: "+33622222222",
          relationship: "son",
          consentStatus: "confirmed",
        });

        expect([a.priority, b.priority]).toEqual([1, 2]);
        expect(b.phone).toBe("+33622222222");
        expect((await repository.getTrustedContacts(person.id)).map((c) => c.id)).toEqual([
          a.id,
          b.id,
        ]);
      });
    });

    describe("reorderTrustedContacts", () => {
      async function circleOf(size: number) {
        const person = await repository.createPerson({
          firstName: "Sophie",
          phone: "+33698765432",
          preferredLanguage: "fr-FR",
          conversationProfile: "standard",
          preferredCallTime: "09:00",
          interests: [],
          consentStatus: "confirmed",
        });
        const contacts = [];
        const phones = ["+33611111111", "+33622222222", "+33633333333"];
        const names = ["Ana", "Ben", "Cleo"].slice(0, size);
        for (const [index, name] of names.entries()) {
          contacts.push(
            await repository.createTrustedContact(person.id, {
              firstName: name,
              phone: phones[index],
              relationship: "friend",
              consentStatus: "confirmed",
            })
          );
        }
        return { person, contacts };
      }

      it("rewrites priorities to 1..n in the given order", async () => {
        const { person, contacts } = await circleOf(3);
        const reversed = [contacts[2].id, contacts[0].id, contacts[1].id];

        const result = await repository.reorderTrustedContacts(person.id, reversed);

        expect(result.map((c) => c.id)).toEqual(reversed);
        expect(result.map((c) => c.priority)).toEqual([1, 2, 3]);
        expect((await repository.getTrustedContacts(person.id)).map((c) => c.id)).toEqual(reversed);
      });

      it("handles an empty circle without error", async () => {
        const { person } = await circleOf(0);
        expect(await repository.reorderTrustedContacts(person.id, [])).toEqual([]);
      });

      // Each rejection below must leave the previous order completely intact:
      // applying a partial order could drop somebody out of the cascade, which
      // for a vulnerable person means nobody is called.
      it("rejects duplicate ids and preserves the previous order", async () => {
        const { person, contacts } = await circleOf(3);
        const before = await repository.getTrustedContacts(person.id);

        await expect(
          repository.reorderTrustedContacts(person.id, [
            contacts[0].id,
            contacts[0].id,
            contacts[1].id,
          ])
        ).rejects.toThrow();

        expect(await repository.getTrustedContacts(person.id)).toEqual(before);
      });

      it("rejects a missing id and preserves the previous order", async () => {
        const { person, contacts } = await circleOf(3);
        const before = await repository.getTrustedContacts(person.id);

        await expect(
          repository.reorderTrustedContacts(person.id, [contacts[0].id, contacts[1].id])
        ).rejects.toThrow();

        expect(await repository.getTrustedContacts(person.id)).toEqual(before);
      });

      it("rejects a foreign id and preserves the previous order", async () => {
        const { person, contacts } = await circleOf(3);
        const before = await repository.getTrustedContacts(person.id);

        await expect(
          repository.reorderTrustedContacts(person.id, [
            contacts[0].id,
            contacts[1].id,
            "contact_julie", // belongs to the seeded demo person
          ])
        ).rejects.toThrow();

        expect(await repository.getTrustedContacts(person.id)).toEqual(before);
      });

      it("rejects an over-long list and preserves the previous order", async () => {
        const { person, contacts } = await circleOf(2);
        const before = await repository.getTrustedContacts(person.id);

        await expect(
          repository.reorderTrustedContacts(person.id, [
            contacts[0].id,
            contacts[1].id,
            "contact_marc",
          ])
        ).rejects.toThrow();

        expect(await repository.getTrustedContacts(person.id)).toEqual(before);
      });
    });

    describe("listEvents", () => {
      it("returns a person's events newest first, and nobody else's", async () => {
        const first = await repository.createEvent("person_marie");
        const second = await repository.createEvent("person_marie");

        const other = await repository.createPerson({
          firstName: "Sophie",
          phone: "+33698765432",
          preferredLanguage: "fr-FR",
          conversationProfile: "standard",
          preferredCallTime: "09:00",
          interests: [],
          consentStatus: "confirmed",
        });
        await repository.createEvent(other.id);

        const events = await repository.listEvents("person_marie");
        expect(events.map((event) => event.id)).toEqual([second.id, first.id]);
      });

      it("honours the limit", async () => {
        await repository.createEvent("person_marie");
        await repository.createEvent("person_marie");
        expect(await repository.listEvents("person_marie", 1)).toHaveLength(1);
      });

      it("is empty for a person with no events", async () => {
        expect(await repository.listEvents("person_marie")).toEqual([]);
      });
    });

    describe("soft deletion (DEC-009) — listPeople / getActiveTrustedContacts", () => {
      it("listPeople excludes an archived person, but getPerson still resolves them", async () => {
        await repository.archivePerson("person_marie");

        expect((await repository.listPeople()).map((p) => p.id)).not.toContain("person_marie");
        // Historical resolution must be unaffected.
        expect((await repository.getPerson("person_marie"))?.archivedAt).not.toBeNull();
      });

      it("getActiveTrustedContacts excludes an archived contact, but getTrustedContacts (unfiltered) still includes them", async () => {
        await repository.archiveTrustedContact("contact_julie");

        const active = await repository.getActiveTrustedContacts("person_marie");
        expect(active.map((c) => c.id)).not.toContain("contact_julie");

        // The one list historical event/call-summary resolution depends on.
        const all = await repository.getTrustedContacts("person_marie");
        expect(all.map((c) => c.id)).toContain("contact_julie");
      });
    });

    describe("archivePerson", () => {
      it("sets archivedAt for a person with no events", async () => {
        const archived = await repository.archivePerson("person_marie");
        expect(archived.archivedAt).not.toBeNull();
      });

      it("is idempotent: archiving twice does not change the timestamp or error", async () => {
        const first = await repository.archivePerson("person_marie");
        const second = await repository.archivePerson("person_marie");
        expect(second.archivedAt).toBe(first.archivedAt);
      });

      it("refuses while a non-terminal event is open, and changes nothing", async () => {
        const event = await repository.createEvent("person_marie"); // SCHEDULED — not terminal

        await expect(repository.archivePerson("person_marie")).rejects.toThrow(
          PersonHasActiveEventError
        );

        expect((await repository.getPerson("person_marie"))?.archivedAt).toBeNull();
        expect((await repository.getEvent(event.id))?.status).toBe("SCHEDULED");
      });

      it("succeeds once the open event reaches a terminal status", async () => {
        const event = await repository.createEvent("person_marie");
        await repository.updateEvent(event.id, { status: "CASE_CLOSED" });

        const archived = await repository.archivePerson("person_marie");
        expect(archived.archivedAt).not.toBeNull();
      });

      it("throws UnknownRecordError for an unknown person", async () => {
        await expect(repository.archivePerson("person_does_not_exist")).rejects.toThrow(
          UnknownRecordError
        );
      });
    });

    describe("archiveTrustedContact", () => {
      it("sets archivedAt for a contact with no active call", async () => {
        const archived = await repository.archiveTrustedContact("contact_julie");
        expect(archived.archivedAt).not.toBeNull();
      });

      it("is idempotent: archiving twice does not change the timestamp or error", async () => {
        const first = await repository.archiveTrustedContact("contact_julie");
        const second = await repository.archiveTrustedContact("contact_julie");
        expect(second.archivedAt).toBe(first.archivedAt);
      });

      it("refuses while the contact has an active (unprocessed) call, and changes nothing", async () => {
        const { callEvent } = await seedPendingFamilyCallIntent(repository, "contact_julie");

        await expect(repository.archiveTrustedContact("contact_julie")).rejects.toThrow(
          ContactHasActiveCallError
        );

        expect((await repository.getTrustedContacts("person_marie")).find(
          (c) => c.id === "contact_julie"
        )?.archivedAt).toBeNull();
        expect((await repository.getCallEvent(callEvent.id))?.resultProcessedAt).toBeNull();
      });

      it("succeeds once that call's result has been processed", async () => {
        const { callEvent } = await seedPendingFamilyCallIntent(repository, "contact_julie");
        await repository.updateCallEvent(callEvent.id, {
          resultProcessedAt: new Date().toISOString(),
        });

        const archived = await repository.archiveTrustedContact("contact_julie");
        expect(archived.archivedAt).not.toBeNull();
      });

      it("throws UnknownRecordError for an unknown contact", async () => {
        await expect(repository.archiveTrustedContact("contact_does_not_exist")).rejects.toThrow(
          UnknownRecordError
        );
      });
    });

    describe("reorderTrustedContacts operates only on active contacts", () => {
      it("rejects a supplied list that includes an archived contact", async () => {
        const before = await repository.getTrustedContacts("person_marie");
        await repository.archiveTrustedContact("contact_julie");

        // The full pre-archive circle no longer matches "exactly the active
        // circle" — it must be rejected, not silently accepted.
        await expect(
          repository.reorderTrustedContacts(
            "person_marie",
            before.map((c) => c.id)
          )
        ).rejects.toThrow();
      });

      it("succeeds when supplied exactly the active circle", async () => {
        await repository.archiveTrustedContact("contact_julie");
        const active = await repository.getActiveTrustedContacts("person_marie");

        const reversed = [...active].reverse().map((c) => c.id);
        const result = await repository.reorderTrustedContacts("person_marie", reversed);
        expect(result.map((c) => c.id)).toEqual(reversed);
      });
    });

    describe("createTrustedContact priority ignores archived siblings", () => {
      it("appends after the highest ACTIVE priority, not the highest overall", async () => {
        // Nicole is priority 3, the highest in the seeded circle. Archiving her
        // must not force the next contact to priority 4.
        await repository.archiveTrustedContact("contact_nicole");

        const created = await repository.createTrustedContact("person_marie", {
          firstName: "Paul",
          phone: "+33644444444",
          relationship: "neighbour",
          consentStatus: "confirmed",
        });

        expect(created.priority).toBe(3);
      });
    });

    describe("restart recovery — archived state persists", () => {
      it("survives a reopen through a second repository instance", async () => {
        await repository.archivePerson("person_marie");
        await repository.archiveTrustedContact("contact_julie");

        const reopened = await harness.reopen(repository);

        expect((await reopened.getPerson("person_marie"))?.archivedAt).not.toBeNull();
        const contact = (await reopened.getTrustedContacts("person_marie")).find(
          (c) => c.id === "contact_julie"
        );
        expect(contact?.archivedAt).not.toBeNull();
      });
    });

    describe("restart recovery", () => {
      it("reads an event, an unprocessed call event and a starting intent back through a second instance", async () => {
        const { event, callEvent } = await seedIntent();

        const reopened = await harness.reopen(repository);

        const recoveredEvent = await reopened.getEvent(event.id);
        const recoveredCall = await reopened.getCallEvent(callEvent.id);

        expect(recoveredEvent?.status).toBe("CALLING_PERSON");
        expect(recoveredEvent?.runId).toBe(event.runId);
        expect(recoveredCall?.status).toBe("starting");
        expect(recoveredCall?.calleCallId).toBeNull();
        expect(recoveredCall?.resultProcessedAt).toBeNull();
        expect(recoveredCall?.idempotencyKey).toBe(callEvent.idempotencyKey);
        // And the ledger link survives, so a replay can still find the intent.
        const linked = await reopened.getAppliedTransitionWithCallIntent(event.id, COMPANION_KEY);
        expect(linked?.callEvent.id).toBe(callEvent.id);
      });
    });
  });
}
