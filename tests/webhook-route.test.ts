import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/calle/route";
import { getRepository } from "@/lib/database/store";
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

// Seeds a companion call event on the shared (globalThis-cached) repository,
// with the event already parked at CONVERSATION_IN_PROGRESS the way a live
// run leaves it while CALL-E is still on the phone.
function seedPendingCompanionCall(agentType: "companion" | "family" = "companion"): {
  event: EventRecord;
  callEvent: CallEventRecord;
  idempotencyKey: string;
} {
  const repository = getRepository();
  const created = repository.createEvent("person_marie");
  repository.updateEvent(created.id, { status: "CALLING_PERSON" });
  const event = repository.updateEvent(created.id, { status: "CONVERSATION_IN_PROGRESS" });

  const idempotencyKey = `${event.runId}_${agentType}_attempt_1`;
  const subjectId = agentType === "companion" ? "person_marie" : "contact_marc";
  const callEvent = repository.createCallEvent({
    eventId: event.id,
    agentType,
    contactId: agentType === "family" ? "contact_marc" : null,
    calleCallId: `fake_${agentType}_${subjectId}_${randomUUID()}`,
    idempotencyKey,
    status: "in_progress",
    summary: null,
    structuredResult: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    resultProcessedAt: null,
  });

  return { event, callEvent, idempotencyKey };
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
    const { callEvent, idempotencyKey } = seedPendingCompanionCall();

    const response = await POST(request(webhookPayload(callEvent.calleCallId, idempotencyKey)));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook receiver is not configured.",
    });
    expect(getRepository().getCallEvent(callEvent.id)?.resultProcessedAt).toBeNull();
  });

  it("rejects with 400 when the signature headers are missing", async () => {
    const { callEvent, idempotencyKey } = seedPendingCompanionCall();

    const response = await POST(
      request(webhookPayload(callEvent.calleCallId, idempotencyKey), { headers: false })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing webhook signature headers.",
    });
    expect(getRepository().getCallEvent(callEvent.id)?.resultProcessedAt).toBeNull();
  });

  it("rejects with 400 when the signature was produced with the wrong secret", async () => {
    const { callEvent, idempotencyKey } = seedPendingCompanionCall();

    const response = await POST(
      request(webhookPayload(callEvent.calleCallId, idempotencyKey), { secret: "wrong_secret" })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid webhook signature." });
    expect(getRepository().getCallEvent(callEvent.id)?.resultProcessedAt).toBeNull();
  });

  it("acknowledges an unknown idempotency key without processing anything", async () => {
    const response = await POST(request(webhookPayload("fake_companion_person_marie_x", "no_such_key")));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("acknowledges without processing when the call id does not match the stored one", async () => {
    const { event, callEvent, idempotencyKey } = seedPendingCompanionCall();

    const response = await POST(
      request(webhookPayload("call_someone_elses_call", idempotencyKey))
    );

    expect(response.status).toBe(200);
    const repository = getRepository();
    expect(repository.getCallEvent(callEvent.id)?.resultProcessedAt).toBeNull();
    expect(repository.getEvent(event.id)?.status).toBe("CONVERSATION_IN_PROGRESS");
  });

  it("acknowledges a family-agent webhook as a no-op (live cascade is Phase 4)", async () => {
    const { event, callEvent, idempotencyKey } = seedPendingCompanionCall("family");

    const response = await POST(
      request(webhookPayload(callEvent.calleCallId, idempotencyKey, "family"))
    );

    expect(response.status).toBe(200);
    const repository = getRepository();
    expect(repository.getCallEvent(callEvent.id)?.resultProcessedAt).toBeNull();
    expect(repository.getEvent(event.id)?.status).toBe("CONVERSATION_IN_PROGRESS");
  });

  it("processes a valid companion webhook and advances the event", async () => {
    const { event, callEvent, idempotencyKey } = seedPendingCompanionCall();

    const response = await POST(request(webhookPayload(callEvent.calleCallId, idempotencyKey)));

    expect(response.status).toBe(200);
    const repository = getRepository();
    expect(repository.getEvent(event.id)?.status).toBe("ATTENTION_REQUIRED");
    expect(repository.getCallEvent(callEvent.id)?.resultProcessedAt).not.toBeNull();
  });

  it("does not apply a second transition when the same webhook is delivered twice", async () => {
    const { event, callEvent, idempotencyKey } = seedPendingCompanionCall();
    const payload = webhookPayload(callEvent.calleCallId, idempotencyKey);

    await POST(request(payload));
    const repository = getRepository();
    const timelineAfterFirst = repository.listTimeline(event.id);

    const second = await POST(request(payload));

    expect(second.status).toBe(200);
    expect(repository.listTimeline(event.id)).toEqual(timelineAfterFirst);
    expect(repository.getEvent(event.id)?.status).toBe("ATTENTION_REQUIRED");
  });
});
