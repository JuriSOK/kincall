import { NextResponse } from "next/server";
import { ContactHasActiveCallError, UnknownRecordError } from "@/lib/database/errors";
import { getRepository } from "@/lib/database/store";

// Soft deletion (DEC-009). Unfiltered getTrustedContacts is used to locate the
// contact here (not the active-only view): a contact already archived (or
// belonging to this person at all) must still resolve for a clean 404 vs. an
// idempotent re-archive, matching archiveTrustedContact's own idempotency.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
  const repository = getRepository();

  if (!(await repository.getPerson(id))) {
    return NextResponse.json({ error: "Unknown person." }, { status: 404 });
  }

  const contacts = await repository.getTrustedContacts(id);
  if (!contacts.some((contact) => contact.id === contactId)) {
    return NextResponse.json({ error: "Unknown contact." }, { status: 404 });
  }

  try {
    await repository.archiveTrustedContact(contactId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // A real safety-rule violation: an in-flight call must not be orphaned.
    // Nothing is changed when this fires.
    if (error instanceof ContactHasActiveCallError) {
      return NextResponse.json(
        {
          error:
            "This contact has an active call in progress and cannot be deleted until it finishes.",
        },
        { status: 409 }
      );
    }
    if (error instanceof UnknownRecordError) {
      return NextResponse.json({ error: "Unknown contact." }, { status: 404 });
    }
    throw error;
  }
}
