import { NextResponse } from "next/server";
import { getCalleAdapter, getCalleMode } from "@/lib/calle/adapter";
import { isFakeScenarioId } from "@/lib/calle/fake-adapter";
import { getRepository } from "@/lib/database/store";
import { startDemoEvent } from "@/lib/orchestration/engine";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { personId?: unknown; scenario?: unknown }
    | null;
  const personId = typeof body?.personId === "string" ? body.personId : null;

  if (!personId) {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }

  // The demo scenario selector is fake-mode only (DEC-011). In live mode the
  // parameter is IGNORED rather than rejected, so live behaviour is byte-for-byte
  // what it was before the selector existed: a request parameter must never be
  // able to steer a real call to a real person.
  const scenario =
    getCalleMode() === "fake" && isFakeScenarioId(body?.scenario) ? body.scenario : undefined;

  try {
    const event = await startDemoEvent(personId, {
      repository: getRepository(),
      calleAdapter: getCalleAdapter(scenario),
    });
    return NextResponse.json({ eventId: event.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start demo event.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
