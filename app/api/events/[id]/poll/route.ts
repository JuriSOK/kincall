import { NextResponse } from "next/server";
import { getCalleAdapter } from "@/lib/calle/adapter";
import { getRepository } from "@/lib/database/store";
import { processCompanionResult } from "@/lib/orchestration/engine";

// Recovery mechanism (TECHNICAL_ARCHITECTURE.md §4): fetches the companion
// call by id and processes its result if terminal. Primary path for local
// dev, where CALL-E cannot reach a plain http://localhost webhook URL.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const event = repository.getEvent(id);

  if (!event) {
    return NextResponse.json({ error: "Unknown event." }, { status: 404 });
  }

  // Derived from runId, not id: see EventRecord.runId and DEC-004.
  const companionIdempotencyKey = `${event.runId}_companion_attempt_1`;
  const callEvent = repository.findCallEventByIdempotencyKey(companionIdempotencyKey);

  if (!callEvent) {
    return NextResponse.json({ status: event.status });
  }

  const updated = await processCompanionResult(
    { repository, calleAdapter: getCalleAdapter() },
    event,
    callEvent.id
  );

  return NextResponse.json({ status: updated.status });
}
