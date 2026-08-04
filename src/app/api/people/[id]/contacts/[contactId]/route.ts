import { NextResponse } from "next/server";
import {
  ArchivedContactCannotBeReactivatedError,
  ContactHasActiveCallError,
  UnknownRecordError,
} from "@/backend/persistence/errors";
import { getRepository } from "@/backend/persistence/store";
import { validateUpdateContactInput } from "@/shared/validation/profile";

// Stage E (DEC-017): a partial patch for the editable trusted-contact fields —
// relationship, enabled, callableFrom/callableTo, timezone, maxAttempts.
// `isPrimary` is deliberately never accepted here; see
// POST .../[contactId]/primary/route.ts, the only place that changes it.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
  const repository = getRepository();

  if (!(await repository.getPerson(id))) {
    return NextResponse.json({ error: "Unknown person." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const { values, errors } = validateUpdateContactInput(body);
  if (!values) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  try {
    const updated = await repository.updateTrustedContact(contactId, values);
    return NextResponse.json({ contactId: updated.id });
  } catch (error) {
    if (error instanceof ArchivedContactCannotBeReactivatedError) {
      return NextResponse.json({ errors: { enabled: error.message } }, { status: 400 });
    }
    if (error instanceof UnknownRecordError) {
      return NextResponse.json({ error: "Unknown contact." }, { status: 404 });
    }
    throw error;
  }
}

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
