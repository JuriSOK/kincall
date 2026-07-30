import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/lib/database/store";
import { Card, PageHeader, PageShell } from "@/app/ui/surfaces";
import { PersonEditForm } from "./person-edit-form";

// Stage C (docs/DECISION_LOG.md DEC-015): the profile-edit route. Editable
// fields are exactly UpdatePersonInput's — firstName and phone are
// deliberately not editable here (see that type's own comment).
export default async function EditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const person = await getRepository().getPerson(id);

  if (!person) {
    notFound();
  }

  return (
    <PageShell width="narrow">
      <div className="flex flex-col gap-4">
        <Link href={`/people/${person.id}`} className="w-fit text-sm text-muted hover:text-accent">
          ← {person.firstName}
        </Link>
        <PageHeader title={`Edit ${person.firstName}`} />
      </div>

      <Card>
        <PersonEditForm person={person} />
      </Card>
    </PageShell>
  );
}
