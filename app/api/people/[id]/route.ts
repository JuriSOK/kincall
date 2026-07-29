import { NextResponse } from "next/server";
import { PersonHasActiveEventError, UnknownRecordError } from "@/lib/database/errors";
import { getRepository } from "@/lib/database/store";

// Soft deletion (optional interface administration, not core orchestration —
// see docs/DECISION_LOG.md DEC-009). The row is archived, never physically
// removed, so historical events keep resolving this person's name.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repository = getRepository();

  if (!(await repository.getPerson(id))) {
    return NextResponse.json({ error: "Unknown person." }, { status: 404 });
  }

  try {
    await repository.archivePerson(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // A real safety-rule violation: refuse rather than orphan a live cascade.
    // Nothing is changed when this fires.
    if (error instanceof PersonHasActiveEventError) {
      return NextResponse.json(
        {
          error:
            "This person has an active check-in in progress and cannot be deleted until it closes.",
        },
        { status: 409 }
      );
    }
    if (error instanceof UnknownRecordError) {
      return NextResponse.json({ error: "Unknown person." }, { status: 404 });
    }
    throw error;
  }
}
