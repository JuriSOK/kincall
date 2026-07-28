import Link from "next/link";
import { getRepository } from "@/lib/database/store";

export default async function Home() {
  const people = await getRepository().listPeople();

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-8 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">KinCall</h1>
        <p className="text-balance opacity-80">
          Because every vulnerable person deserves someone who checks in.
        </p>
      </div>

      <Link
        href="/people/new"
        className="w-fit rounded-md border border-black/20 px-4 py-2 text-sm hover:border-black/40 dark:border-white/20 dark:hover:border-white/40"
      >
        Add a loved one
      </Link>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Profiles</h2>
        <ul className="flex flex-col gap-2">
          {people.map((person) => (
            <li key={person.id}>
              <Link
                href={`/people/${person.id}`}
                className="block rounded-md border border-black/10 px-4 py-3 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30"
              >
                {person.firstName}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
