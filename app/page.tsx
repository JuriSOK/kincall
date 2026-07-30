import Link from "next/link";
import { getRepository } from "@/lib/database/store";
import { ButtonLink } from "./ui/button";
import { Card, EmptyState, PageHeader, PageShell } from "./ui/surfaces";
import { DeletePersonButton } from "./people/delete-person-button";

export default async function Home() {
  const people = await getRepository().listPeople();

  return (
    <PageShell width="narrow">
      <PageHeader
        title="KinCall"
        lead="Because every vulnerable person deserves someone who checks in."
        actions={
          <ButtonLink href="/people/new" variant="primary">
            Add a loved one
          </ButtonLink>
        }
      />

      <Card title="Profiles" description={`${people.length} ${people.length === 1 ? "person" : "people"}`}>
        {people.length === 0 ? (
          <EmptyState
            title="No profiles yet"
            action={
              <ButtonLink href="/people/new" variant="primary" size="sm">
                Add a loved one
              </ButtonLink>
            }
          >
            Add the person you want KinCall to check in on, then build their trusted circle.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {people.map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center gap-3 rounded-kc border border-line bg-sunken px-4 py-3 transition-colors hover:border-line-strong"
              >
                <Link
                  href={`/people/${person.id}`}
                  className="flex-1 text-sm font-medium hover:text-accent"
                >
                  {person.firstName}
                </Link>
                <DeletePersonButton
                  personId={person.id}
                  personName={person.firstName}
                  mode="refresh"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageShell>
  );
}
