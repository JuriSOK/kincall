import { NextResponse } from "next/server";
import { InvalidPrimaryContactError } from "@/lib/database/errors";
import { getRepository } from "@/lib/database/store";

// Stage E (DEC-017): the ONLY route that changes isPrimary. Kept separate
// from the general PATCH .../[contactId] route — like Stage D's schedule
// pause/resume — because setting a new primary must atomically clear the
// previous one (Repository.setPrimaryContact), never a plain field patch.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
  const repository = getRepository();

  if (!(await repository.getPerson(id))) {
    return NextResponse.json({ error: "Unknown person." }, { status: 404 });
  }

  try {
    const contacts = await repository.setPrimaryContact(id, contactId);
    return NextResponse.json({ contacts: contacts.map((contact) => contact.id) });
  } catch (error) {
    if (error instanceof InvalidPrimaryContactError) {
      return NextResponse.json({ errors: { makePrimary: error.message } }, { status: 400 });
    }
    throw error;
  }
}
