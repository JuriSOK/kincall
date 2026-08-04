import { NextResponse } from "next/server";
import { getCalleAdapter } from "@/backend/integrations/calle/adapter";
import { getRepository } from "@/backend/persistence/store";
import { startTimer } from "@/backend/observability/timing";
import {
  processCompanionResult,
  processFamilyResult,
  processPersonNotificationResult,
} from "@/backend/orchestration/engine";

// Recovery mechanism (TECHNICAL_ARCHITECTURE.md §4): fetches whichever call is
// currently in flight — Companion or a trusted-contact call — and processes its
// result if terminal. Primary path for local dev, where CALL-E cannot reach a
// plain http://localhost webhook URL.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const event = await repository.getEvent(id);

  if (!event) {
    return NextResponse.json({ error: "Unknown event." }, { status: 404 });
  }

  // At most one call is ever in flight per event, so the single unprocessed
  // call event is the one to resume. Derived rather than reconstructed from an
  // idempotency-key pattern, so it works for every contact in the cascade —
  // and it includes a "starting" intent whose CALL-E request never completed,
  // which processCompanionResult/processFamilyResult re-drive on the same key.
  const pending = (await repository.listCallEvents(event.id)).find(
    (call) => call.resultProcessedAt === null
  );

  if (!pending) {
    return NextResponse.json({ status: event.status });
  }

  const deps = { repository, calleAdapter: getCalleAdapter() };
  // Timing only (DEC-022) — see backend/observability/timing.ts. Off unless
  // KINCALL_TIMING=1; never persisted, never logs call content.
  const stopTimer = startTimer(event.id, "poll_result_processed");
  // DEC-023 adds the third purpose. Dispatched explicitly rather than by an
  // else-branch, so a value this route does not understand fails loudly at the
  // type level instead of silently being processed as a family result.
  const updated =
    pending.agentType === "companion"
      ? await processCompanionResult(deps, event, pending.id)
      : pending.agentType === "person_notification"
        ? await processPersonNotificationResult(deps, event, pending.id)
        : await processFamilyResult(deps, event, pending.id);
  stopTimer();

  return NextResponse.json({ status: updated.status });
}
