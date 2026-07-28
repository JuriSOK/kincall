import { NextResponse } from "next/server";
import { getCalleAdapter } from "@/lib/calle/adapter";
import { parseCalleWebhookEvent, verifyCalleWebhookSignature } from "@/lib/calle/webhook";
import { getRepository } from "@/lib/database/store";
import { processCompanionResult } from "@/lib/orchestration/engine";

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
  const callEvent = repository.findCallEventByIdempotencyKey(idempotencyKey);

  // Unknown call event or mismatched call id: acknowledge anyway so CALL-E
  // doesn't retry forever over something we'll never be able to process.
  if (!callEvent || callEvent.calleCallId !== payload.data.id) {
    return NextResponse.json({ ok: true });
  }

  // Family Agent webhooks aren't dispatched until Phase 4.
  if (callEvent.agentType === "companion") {
    const event = repository.getEvent(callEvent.eventId);
    if (event) {
      await processCompanionResult(
        { repository, calleAdapter: getCalleAdapter() },
        event,
        callEvent.id
      );
    }
  }

  return NextResponse.json({ ok: true });
}
