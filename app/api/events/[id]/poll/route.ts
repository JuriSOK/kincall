import { NextResponse } from "next/server";
import { getCalleAdapter } from "@/lib/calle/adapter";
import { getRepository } from "@/lib/database/store";
import { processCompanionResult, processFamilyResult } from "@/lib/orchestration/engine";

// Recovery mechanism (TECHNICAL_ARCHITECTURE.md §4): fetches whichever call is
// currently in flight — Companion or a trusted-contact call — and processes its
// result if terminal. Primary path for local dev, where CALL-E cannot reach a
// plain http://localhost webhook URL.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const event = repository.getEvent(id);

  if (!event) {
    return NextResponse.json({ error: "Unknown event." }, { status: 404 });
  }

  // At most one call is ever in flight per event, so the single unprocessed
  // call event is the one to resume. Derived rather than reconstructed from an
  // idempotency-key pattern, so it works for every contact in the cascade.
  const pending = repository
    .listCallEvents(event.id)
    .find((call) => call.resultProcessedAt === null);

  if (!pending) {
    return NextResponse.json({ status: event.status });
  }

  const deps = { repository, calleAdapter: getCalleAdapter() };
  const updated =
    pending.agentType === "companion"
      ? await processCompanionResult(deps, event, pending.id)
      : await processFamilyResult(deps, event, pending.id);

  return NextResponse.json({ status: updated.status });
}
