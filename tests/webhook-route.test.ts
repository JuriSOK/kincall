import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/calle/route";
import { getRepository } from "@/lib/database/store";
import { seedPendingCompanionCall, seedPendingFamilyCall } from "./support/seed-calls";
import type { CallEventRecord, EventRecord } from "@/lib/database/types";

const SECRET = "whsec_test_secret";

function sign(rawBody: string, secret: string): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return { timestamp, signature: `v1=${digest}` };
}

function webhookPayload(callId: string, idempotencyKey: string, agentType = "companion") {
  return {
    id: `evt_${randomUUID()}`,
    type: "call.completed",
    created_at: new Date().toISOString(),
    data: {
      id: callId,
      status: "completed",
      structured_result: null,
      failure_code: null,
      failure_message: null,
      metadata: {
        kincall_idempotency_key: idempotencyKey,
        kincall_agent_type: agentType,
      },
    },
  };
}

function request(payload: unknown, options: { secret?: string; headers?: boolean } = {}): Request {
  const rawBody = JSON.stringify(payload);
  const headers: Record<string, string> = {};

  if (options.headers !== false) {
    const { timestamp, signature } = sign(rawBody, options.secret ?? SECRET);
    headers["CALL-E-Timestamp"] = timestamp;
    headers["CALL-E-Signature"] = signature;
    headers["CALL-E-Event-Id"] = `evt_${randomUUID()}`;
  }

  return new Request("https://kincall.test/api/webhooks/calle", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

// Seeds a call event on the shared (globalThis-cached) repository, with the
// event already parked the way a live run leaves it while CALL-E is still on
// the phone.
async function seedPendingCall(
  agentType: "companion" | "family" = "companion"
): Promise<{ event: EventRecord; callEvent: CallEventRecord; idempotencyKey: string }> {
  const repository = getRepository();
  const { event, callEvent } =
    agentType === "companion"
      ? await seedPendingCompanionCall(repository)
      : await seedPendingFamilyCall(repository, "contact_marc");

  return { event, callEvent, idempotencyKey: callEvent.idempotencyKey };
}

describe("POST /api/webhooks/calle", () => {
  beforeEach(() => {
    vi.stubEnv("CALLE_MODE", "fake");
    vi.stubEnv("CALLE_WEBHOOK_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects with 400 when no webhook secret is configured", async () => {
    vi.stubEnv("CALLE_WEBHOOK_SECRET", "");
    const { callEvent, idempotencyKey } = await seedPendingCall();

    const response = await POST(request(webhookPayload(callEvent.calleCallId!, idempotencyKey)));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook receiver is not configured.",
    });
    expect((await getRepository().getCallEvent(callEvent.id))?.resultProcessedAt).toBeNull();
  });

  it("rejects with 400 when the signature headers are missing", async () => {
    const { callEvent, idempotencyKey } = await seedPendingCall();

    const response = await POST(
      request(webhookPayload(callEvent.calleCallId!, idempotencyKey), { headers: false })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing webhook signature headers.",
    });
    expect((await getRepository().getCallEvent(callEvent.id))?.resultProcessedAt).toBeNull();
  });

  it("rejects with 400 when the signature was produced with the wrong secret", async () => {
    const { callEvent, idempotencyKey } = await seedPendingCall();

    const response = await POST(
      request(webhookPayload(callEvent.calleCallId!, idempotencyKey), { secret: "wrong_secret" })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid webhook signature." });
    expect((await getRepository().getCallEvent(callEvent.id))?.resultProcessedAt).toBeNull();
  });

  it("acknowledges an unknown idempotency key without processing anything", async () => {
    const response = await POST(request(webhookPayload("fake_companion_person_marie_x", "no_such_key")));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("acknowledges without processing when the call id does not match the stored one", async () => {
    const { event, callEvent, idempotencyKey } = await seedPendingCall();

    const response = await POST(
      request(webhookPayload("call_someone_elses_call", idempotencyKey))
    );

    expect(response.status).toBe(200);
    const repository = getRepository();
    expect((await repository.getCallEvent(callEvent.id))?.resultProcessedAt).toBeNull();
    expect((await repository.getEvent(event.id))?.status).toBe("CONVERSATION_IN_PROGRESS");
  });

  it("resumes the cascade when a family-agent webhook arrives", async () => {
    const repository = getRepository();
    // Mid-cascade: Julie has been called and KinCall is waiting on her result.
    const { event, callEvent } = await seedPendingFamilyCall(repository, "contact_julie");
    const idempotencyKey = callEvent.idempotencyKey;

    const response = await POST(
      request(webhookPayload(callEvent.calleCallId!, idempotencyKey, "family"))
    );

    expect(response.status).toBe(200);
    expect((await repository.getCallEvent(callEvent.id))?.resultProcessedAt).not.toBeNull();
    // Julie did not answer, so the webhook drives her bounded retry and then the
    // cascade to Marc, who confirms — all from one inbound delivery (DEC-011).
    expect((await repository.getEvent(event.id))?.status).toBe("CASE_CLOSED");
    expect((await repository.listTimeline(event.id)).map((entry) => entry.message)).toEqual([
      "No answer from Julie (attempt 1)",
      "No voicemail attempted — one more attempt is owed",
      "Calling Julie again (attempt 2)",
      "No answer from Julie (attempt 2)",
      "Voicemail left",
      "Calling Marc",
      "Marc confirmed they could help.",
      "Visit confirmed — 17:30",
      "KinCall called Marie to share Marc's commitment.",
      "The follow-up message was delivered.",
      "Case closed",
    ]);
  });

  it("processes a valid companion webhook and advances the event", async () => {
    const { event, callEvent, idempotencyKey } = await seedPendingCall();

    const response = await POST(request(webhookPayload(callEvent.calleCallId!, idempotencyKey)));

    expect(response.status).toBe(200);
    const repository = getRepository();
    // Fake-mode family results are instant, so the companion webhook carries
    // the event through the whole cascade in one delivery.
    expect((await repository.getEvent(event.id))?.status).toBe("CASE_CLOSED");
    expect((await repository.getCallEvent(callEvent.id))?.resultProcessedAt).not.toBeNull();
  });

  it("does not apply a second transition when the same webhook is delivered twice", async () => {
    const { event, callEvent, idempotencyKey } = await seedPendingCall();
    const payload = webhookPayload(callEvent.calleCallId!, idempotencyKey);

    await POST(request(payload));
    const repository = getRepository();
    const timelineAfterFirst = await repository.listTimeline(event.id);

    const second = await POST(request(payload));

    expect(second.status).toBe(200);
    expect(await repository.listTimeline(event.id)).toEqual(timelineAfterFirst);
    expect((await repository.getEvent(event.id))?.status).toBe("CASE_CLOSED");
  });
});
