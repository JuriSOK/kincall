import { NextResponse } from "next/server";
import { getRepository } from "@/lib/database/store";
import { validatePersonInput } from "@/lib/validation/profile";

// Named in TECHNICAL_ARCHITECTURE.md §10's frozen repository structure.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { values, errors } = validatePersonInput(body);

  // Validated server-side even though the form validates too: the browser is
  // not a trusted source, and this is the boundary that keeps a phone number
  // out of the database (DEC-006).
  if (!values) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const person = await getRepository().createPerson(values);
  return NextResponse.json({ personId: person.id }, { status: 201 });
}
