import { NextResponse } from "next/server";
import { startDemoEvent } from "@/lib/orchestration/engine";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { personId?: unknown } | null;
  const personId = typeof body?.personId === "string" ? body.personId : null;

  if (!personId) {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }

  try {
    const event = await startDemoEvent(personId);
    return NextResponse.json({ eventId: event.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start demo event.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
