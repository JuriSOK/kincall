import { createHmac, timingSafeEqual } from "node:crypto";

// Matches calle.openapi.yaml's WebhookEvent schema. `data` is the terminal
// CallTask snapshot — only the fields KinCall needs are typed here.
export interface CalleWebhookCallData {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  structured_result: unknown;
  failure_code: string | null;
  failure_message: string | null;
  metadata: Record<string, unknown>;
}

export interface CalleWebhookEvent {
  id: string;
  type: "call.completed" | "call.failed" | "call.result_validation_failed";
  created_at: string;
  data: CalleWebhookCallData;
}

const SIGNATURE_PATTERN = /^v1=([0-9a-f]+)$/i;

// Rejects timestamps too far from now to block replay of an old, otherwise
// validly-signed payload. 5 minutes is a generous, standard tolerance.
const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

// Per calle.openapi.yaml: HMAC-SHA256 over `${timestamp}.${rawBody}`,
// header format `v1=<hex digest>`. Verify before JSON.parse.
export function verifyCalleWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string
): boolean {
  const match = SIGNATURE_PATTERN.exec(signatureHeader.trim());
  if (!match) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const skewSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (skewSeconds > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(match[1], "hex");
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Structural validation only (required top-level fields present with the
// right shapes) — the nested structured_result is validated separately by
// lib/calle/schemas.ts once the caller knows which agent type it belongs to.
export function parseCalleWebhookEvent(rawBody: string): CalleWebhookEvent {
  const parsed: unknown = JSON.parse(rawBody);
  if (!isRecord(parsed)) {
    throw new Error("CALL-E webhook payload is not a JSON object.");
  }
  if (typeof parsed.id !== "string") {
    throw new Error("CALL-E webhook payload is missing 'id'.");
  }
  if (
    parsed.type !== "call.completed" &&
    parsed.type !== "call.failed" &&
    parsed.type !== "call.result_validation_failed"
  ) {
    throw new Error("CALL-E webhook payload has an unrecognized 'type'.");
  }
  if (typeof parsed.created_at !== "string") {
    throw new Error("CALL-E webhook payload is missing 'created_at'.");
  }
  if (!isRecord(parsed.data)) {
    throw new Error("CALL-E webhook payload is missing 'data'.");
  }

  const data = parsed.data;
  if (typeof data.id !== "string") {
    throw new Error("CALL-E webhook payload's 'data.id' is missing.");
  }
  if (
    data.status !== "queued" &&
    data.status !== "in_progress" &&
    data.status !== "completed" &&
    data.status !== "failed" &&
    data.status !== "canceled"
  ) {
    throw new Error("CALL-E webhook payload's 'data.status' is invalid.");
  }
  if (!isRecord(data.metadata)) {
    throw new Error("CALL-E webhook payload's 'data.metadata' is missing.");
  }

  return {
    id: parsed.id,
    type: parsed.type,
    created_at: parsed.created_at,
    data: {
      id: data.id,
      status: data.status,
      structured_result: data.structured_result ?? null,
      failure_code: typeof data.failure_code === "string" ? data.failure_code : null,
      failure_message: typeof data.failure_message === "string" ? data.failure_message : null,
      metadata: data.metadata,
    },
  };
}
