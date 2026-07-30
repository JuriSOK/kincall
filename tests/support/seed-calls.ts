import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/database/repository";
import type { CallEventRecord, EventRecord } from "@/lib/database/types";

// Reproduces the state a live run leaves behind, at two depths:
//
//   *CallIntent  — the transition is applied and the intent row exists, but
//                  CALL-E has not answered yet (calleCallId is still null).
//   *Call        — the same, with a call id attached: a call genuinely in
//                  flight, waiting for a webhook or a poll.
//
// Intents are created through commitTransitionWithCallIntent because that is
// the only way a call_events row can be born — there is deliberately no
// createCallEvent, so an intent can never exist outside its transition's
// transaction (DEC-006).

interface Seeded {
  event: EventRecord;
  callEvent: CallEventRecord;
}

export async function seedPendingCompanionCallIntent(
  deps: { repository: Repository } | Repository
): Promise<Seeded> {
  const repository = "repository" in deps ? deps.repository : deps;
  const created = await repository.createEvent("person_marie");

  const started = await repository.commitTransitionWithCallIntent({
    eventId: created.id,
    operationKey: `${created.runId}:start:COMPANION_CALL_STARTED`,
    transitionEvent: "COMPANION_CALL_STARTED",
    expectedFromStatus: "SCHEDULED",
    status: "CALLING_PERSON",
    messages: ["Check-in call started"],
    intent: {
      agentType: "companion",
      contactId: null,
      attemptNumber: 1,
      idempotencyKey: `${created.runId}_companion_attempt_1`,
    },
  });

  const inProgress = await repository.commitTransition({
    eventId: created.id,
    operationKey: `${created.runId}:start:COMPANION_CONVERSATION_STARTED`,
    transitionEvent: "COMPANION_CONVERSATION_STARTED",
    expectedFromStatus: "CALLING_PERSON",
    status: "CONVERSATION_IN_PROGRESS",
  });

  return { event: inProgress.event, callEvent: started.callEvent! };
}

export async function seedPendingCompanionCall(repository: Repository): Promise<Seeded> {
  const { event, callEvent } = await seedPendingCompanionCallIntent(repository);
  return {
    event,
    callEvent: await repository.attachCalleCallId(
      callEvent.id,
      `fake_companion_person_marie_${randomUUID()}`
    ),
  };
}

// Mid-cascade: this contact has been called and KinCall is waiting on the
// result. The companion leg is fast-forwarded with updateEvent, since only the
// family call's own transition is under test.
export async function seedPendingFamilyCallIntent(
  deps: { repository: Repository } | Repository,
  contactId: string
): Promise<Seeded> {
  const repository = "repository" in deps ? deps.repository : deps;
  const created = await repository.createEvent("person_marie");
  const attention = await repository.updateEvent(created.id, { status: "ATTENTION_REQUIRED" });

  const started = await repository.commitTransitionWithCallIntent({
    eventId: attention.id,
    operationKey: `seed:advance:FAMILY_CALL_STARTED:${contactId}`,
    transitionEvent: "FAMILY_CALL_STARTED",
    expectedFromStatus: "ATTENTION_REQUIRED",
    status: "CALLING_TRUSTED_CONTACT",
    intent: {
      agentType: "family",
      contactId,
      attemptNumber: 1,
      idempotencyKey: `${attention.runId}_${contactId}_attempt_1`,
    },
  });

  return { event: started.event, callEvent: started.callEvent! };
}

export async function seedPendingFamilyCall(
  repository: Repository,
  contactId: string
): Promise<Seeded> {
  const { event, callEvent } = await seedPendingFamilyCallIntent(repository, contactId);
  return {
    event,
    callEvent: await repository.attachCalleCallId(
      callEvent.id,
      `fake_family_${contactId}_${randomUUID()}`
    ),
  };
}
