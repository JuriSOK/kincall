import { NextResponse } from "next/server";
import { getRepository } from "@/backend/persistence/store";
import { validateContactInput } from "@/shared/validation/profile";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();

  if (!(await repository.getPerson(id))) {
    return NextResponse.json({ error: "Unknown person." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const { values, errors } = validateContactInput(body);
  if (!values) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  // Appended at the end of the circle, so adding a contact never silently
  // reorders the cascade.
  const contact = await repository.createTrustedContact(id, values);
  return NextResponse.json({ contactId: contact.id }, { status: 201 });
}
