import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/events/[id]/poll/route";
import { getRepository } from "@/lib/database/store";

function pollRequest(id: string) {
  return POST(new Request(`https://kincall.test/api/events/${id}/poll`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

// Mirrors the state a live run leaves behind: the companion call is started
// and the event waits at CONVERSATION_IN_PROGRESS for a webhook or a poll.
function seedPendingCompanionCall() {
  const repository = getRepository();
  const created = repository.createEvent("person_marie");
  repository.updateEvent(created.id, { status: "CALLING_PERSON" });
  const event = repository.updateEvent(created.id, { status: "CONVERSATION_IN_PROGRESS" });

  const callEvent = repository.createCallEvent({
    eventId: event.id,
    agentType: "companion",
    contactId: null,
    calleCallId: `fake_companion_person_marie_${randomUUID()}`,
    idempotencyKey: `${event.runId}_companion_attempt_1`,
    status: "in_progress",
    summary: null,
    structuredResult: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    resultProcessedAt: null,
  });

  return { event, callEvent };
}

describe("POST /api/events/[id]/poll", () => {
  beforeEach(() => {
    vi.stubEnv("CALLE_MODE", "fake");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 for an unknown event", async () => {
    const response = await pollRequest("event_does_not_exist");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Unknown event." });
  });

  it("returns the current status when no companion call has been started yet", async () => {
    const event = getRepository().createEvent("person_marie");

    const response = await pollRequest(event.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "SCHEDULED" });
  });

  it("processes a terminal companion call and drives the cascade to a close", async () => {
    const { event, callEvent } = seedPendingCompanionCall();

    const response = await pollRequest(event.id);

    expect(response.status).toBe(200);
    // In fake mode every family result is instant, so one poll carries the
    // event all the way from the companion result to a confirmed intervention.
    await expect(response.json()).resolves.toEqual({ status: "CASE_CLOSED" });

    const repository = getRepository();
    expect(repository.getCallEvent(callEvent.id)?.resultProcessedAt).not.toBeNull();
    expect(repository.listTimeline(event.id).map((entry) => entry.message)).toEqual([
      "Check-in call completed",
      "Fall and mobility difficulty detected",
      "Calling Julie",
      "No answer",
      "Calling Marc",
      "Marc answered",
      "Visit confirmed — 17:30",
      "Case closed",
    ]);
  });

  it("is a no-op when polled again after the result was already processed", async () => {
    const { event } = seedPendingCompanionCall();

    await pollRequest(event.id);
    const timelineAfterFirst = getRepository().listTimeline(event.id);

    const response = await pollRequest(event.id);

    await expect(response.json()).resolves.toEqual({ status: "CASE_CLOSED" });
    expect(getRepository().listTimeline(event.id)).toEqual(timelineAfterFirst);
  });
});
