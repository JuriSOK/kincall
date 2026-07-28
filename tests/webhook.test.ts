import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCalleWebhookEvent, verifyCalleWebhookSignature } from "@/lib/calle/webhook";

const SECRET = "test_webhook_secret";

function sign(timestamp: string, rawBody: string): string {
  const digest = createHmac("sha256", SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
  return `v1=${digest}`;
}

describe("verifyCalleWebhookSignature", () => {
  it("accepts a validly signed payload", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ id: "evt_1" });
    const signature = sign(timestamp, rawBody);

    expect(verifyCalleWebhookSignature(SECRET, timestamp, rawBody, signature)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ id: "evt_1" });
    const signature = sign(timestamp, rawBody);
    const tamperedBody = JSON.stringify({ id: "evt_2" });

    expect(verifyCalleWebhookSignature(SECRET, timestamp, tamperedBody, signature)).toBe(false);
  });

  it("rejects a stale timestamp even with a matching signature", () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const rawBody = JSON.stringify({ id: "evt_1" });
    const signature = sign(staleTimestamp, rawBody);

    expect(verifyCalleWebhookSignature(SECRET, staleTimestamp, rawBody, signature)).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(verifyCalleWebhookSignature(SECRET, timestamp, "{}", "not-a-signature")).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ id: "evt_1" });
    const signature = sign(timestamp, rawBody);

    expect(verifyCalleWebhookSignature("wrong_secret", timestamp, rawBody, signature)).toBe(false);
  });
});

describe("parseCalleWebhookEvent", () => {
  const validPayload = {
    id: "evt_1",
    type: "call.completed",
    created_at: "2026-06-01T17:01:00Z",
    data: {
      id: "call_123",
      status: "completed",
      structured_result: { fall_mentioned: "yes" },
      failure_code: null,
      failure_message: null,
      metadata: { kincall_idempotency_key: "event_001_companion_attempt_1" },
    },
  };

  it("parses a well-formed payload", () => {
    const parsed = parseCalleWebhookEvent(JSON.stringify(validPayload));
    expect(parsed.data.id).toBe("call_123");
    expect(parsed.data.metadata.kincall_idempotency_key).toBe("event_001_companion_attempt_1");
  });

  it("rejects malformed JSON", () => {
    expect(() => parseCalleWebhookEvent("not json")).toThrow();
  });

  it("rejects a payload missing data.metadata", () => {
    const { metadata, ...dataWithoutMetadata } = validPayload.data;
    void metadata;
    const malformed = { ...validPayload, data: dataWithoutMetadata };

    expect(() => parseCalleWebhookEvent(JSON.stringify(malformed))).toThrow(/metadata/);
  });

  it("rejects an unrecognized event type", () => {
    const malformed = { ...validPayload, type: "call.unknown" };
    expect(() => parseCalleWebhookEvent(JSON.stringify(malformed))).toThrow(/type/);
  });

  it("rejects a payload missing the top-level id", () => {
    const { id, ...rest } = validPayload;
    void id;
    expect(() => parseCalleWebhookEvent(JSON.stringify(rest))).toThrow(/id/);
  });
});
