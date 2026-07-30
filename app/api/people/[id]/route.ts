import { NextResponse } from "next/server";
import { PersonHasActiveEventError, UnknownRecordError } from "@/lib/database/errors";
import { getRepository } from "@/lib/database/store";
import { validateUpdatePersonInput } from "@/lib/validation/profile";

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

// Stage C (docs/DECISION_LOG.md DEC-015): the profile-edit route. Validated
// server-side even though the edit form validates too — the browser is not a
// trusted source, and this is the boundary that keeps an unrecognised avatar
// key, an invalid IANA timezone, or a phone number smuggled into
// conversationNotes from ever reaching the database. Deliberately cannot
// change firstName or phone — see UpdatePersonInput's own comment for why.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Unlike POST /api/people, an empty patch ({}) is a legitimate, valid
  // no-op here — so malformed JSON cannot be left to fall through to
  // validateUpdatePersonInput the way POST's required-field checks catch it
  // for free. A parse failure is detected and rejected explicitly instead.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { errors: { body: "Malformed request body." } },
      { status: 400 }
    );
  }

  const { values, errors } = validateUpdatePersonInput(body);

  if (!values) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  try {
    const person = await getRepository().updatePerson(id, values);
    return NextResponse.json({ personId: person.id });
  } catch (error) {
    if (error instanceof UnknownRecordError) {
      return NextResponse.json({ error: "Unknown person." }, { status: 404 });
    }
    throw error;
  }
}
