import { NextResponse } from "next/server";
import { getCalleAdapter } from "@/backend/integrations/calle/adapter";
import { parseCalleWebhookEvent, verifyCalleWebhookSignature } from "@/backend/integrations/calle/webhook";
import { getRepository } from "@/backend/persistence/store";
import {
  processCompanionResult,
  processFamilyResult,
  processPersonNotificationResult,
} from "@/backend/orchestration/engine";

export async function POST(request: Request) {
  const secret = process.env.CALLE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook receiver is not configured." }, { status: 400 });
  }

  const timestamp = request.headers.get("CALL-E-Timestamp");
  const signature = request.headers.get("CALL-E-Signature");
  if (!timestamp || !signature) {
    return NextResponse.json({ error: "Missing webhook signature headers." }, { status: 400 });
  }

  // Signature is computed over the raw body — verify before any JSON.parse.
  const rawBody = await request.text();
  if (!verifyCalleWebhookSignature(secret, timestamp, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let payload;
  try {
    payload = parseCalleWebhookEvent(rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Malformed webhook payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const idempotencyKey = payload.data.metadata.kincall_idempotency_key;
  if (typeof idempotencyKey !== "string") {
    return NextResponse.json(
      { error: "Webhook payload metadata is missing kincall_idempotency_key." },
      { status: 400 }
    );
  }

  const repository = getRepository();
  let callEvent = await repository.findCallEventByIdempotencyKey(idempotencyKey);

  // Unknown call event: acknowledge anyway so CALL-E doesn't retry forever
  // over something we'll never be able to process.
  if (!callEvent) {
    return NextResponse.json({ ok: true });
  }

  // The webhook can arrive before our own POST /v1/calls response did — the
  // row is then still an intent with no call id. Adopt the id rather than
  // rejecting on a mismatch against null: the payload was HMAC-verified above,
  // and the row was located by KinCall's own idempotency key, so this is the
  // same trust level as the matched case (DEC-006).
  if (callEvent.calleCallId === null) {
    callEvent = await repository.attachCalleCallId(callEvent.id, payload.data.id);
  }

  // A genuine mismatch: acknowledge without processing.
  if (callEvent.calleCallId !== payload.data.id) {
    return NextResponse.json({ ok: true });
  }

  const event = await repository.getEvent(callEvent.eventId);
  if (event) {
    const deps = { repository, calleAdapter: getCalleAdapter() };
    if (callEvent.agentType === "person_notification") {
      // DEC-023. Never retried and never recursive — it only applies the
      // terminal transition the cascade already earned.
      await processPersonNotificationResult(deps, event, callEvent.id);
    } else if (callEvent.agentType === "companion") {
      await processCompanionResult(deps, event, callEvent.id);
    } else {
      // Resumes the cascade: this contact's result is applied and, unless it
      // confirmed an intervention, the next contact is called.
      await processFamilyResult(deps, event, callEvent.id);
    }
  }

  return NextResponse.json({ ok: true });
}
