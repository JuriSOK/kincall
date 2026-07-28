import { NextResponse } from "next/server";
import { InvalidContactOrderError } from "@/lib/database/errors";
import { getRepository } from "@/lib/database/store";
import { validateOrderedIds } from "@/lib/validation/profile";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();

  if (!(await repository.getPerson(id))) {
    return NextResponse.json({ error: "Unknown person." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { orderedIds?: unknown } | null;
  const { values, errors } = validateOrderedIds(body?.orderedIds);
  if (!values) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  try {
    // Atomic: `unique (person_id, priority)` rejects any interim state where
    // two contacts share a priority, so a partial apply is impossible.
    const contacts = await repository.reorderTrustedContacts(id, values);
    return NextResponse.json({ contacts: contacts.map((contact) => contact.id) });
  } catch (error) {
    // The order did not describe exactly this circle. Rejected whole — a
    // partial order could drop somebody out of the cascade.
    if (error instanceof InvalidContactOrderError) {
      return NextResponse.json({ errors: { orderedIds: error.message } }, { status: 400 });
    }
    throw error;
  }
}
