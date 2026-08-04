import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/events/[id]/poll/route";
import { getRepository } from "@/backend/persistence/store";
import { seedPendingCompanionCall } from "../support/seed-calls";

function pollRequest(id: string) {
  return POST(new Request(`https://kincall.test/api/events/${id}/poll`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
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
    const event = await getRepository().createEvent("person_marie");

    const response = await pollRequest(event.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "SCHEDULED" });
  });

  it("processes a terminal companion call and drives the cascade to a close", async () => {
    const { event, callEvent } = await seedPendingCompanionCall(getRepository());

    const response = await pollRequest(event.id);

    expect(response.status).toBe(200);
    // In fake mode every family result is instant, so one poll carries the
    // event all the way from the companion result to a confirmed intervention.
    await expect(response.json()).resolves.toEqual({ status: "CASE_CLOSED" });

    const repository = getRepository();
    expect((await repository.getCallEvent(callEvent.id))?.resultProcessedAt).not.toBeNull();
    expect((await repository.listTimeline(event.id)).map((entry) => entry.message)).toEqual([
      // Written by the seed helper, which now drives the real
      // COMPANION_CALL_STARTED transition rather than forcing the status.
      "Check-in call started",
      "Check-in call completed",
      "The person mentioned a fall, difficulty moving around.",
      "Calling Julie",
      // DEC-011: Julie gets one bounded retry before the cascade moves to Marc.
      "No answer from Julie (attempt 1)",
      "No voicemail attempted — one more attempt is owed",
      "Calling Julie again (attempt 2)",
      "No answer from Julie (attempt 2)",
      "Voicemail left",
      "Calling Marc",
      "Marc confirmed they could help.",
      "Visit confirmed — 17:30",
      "KinCall called Marie to share the outcome.",
      "The outcome was shared with Marie.",
      "Case closed",
    ]);
  });

  it("is a no-op when polled again after the result was already processed", async () => {
    const { event } = await seedPendingCompanionCall(getRepository());

    await pollRequest(event.id);
    const timelineAfterFirst = await getRepository().listTimeline(event.id);

    const response = await pollRequest(event.id);

    await expect(response.json()).resolves.toEqual({ status: "CASE_CLOSED" });
    expect(await getRepository().listTimeline(event.id)).toEqual(timelineAfterFirst);
  });
});
