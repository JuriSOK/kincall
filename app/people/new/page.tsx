import Link from "next/link";
import { PersonForm } from "./person-form";

// PRODUCT_SPECIFICATION.md §13.1 "création d'un profil de personne vulnérable",
// reached from §14.1's "Add a loved one".
export default function NewPersonPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-8 p-8">
      <div className="flex flex-col gap-1">
        <Link href="/" className="text-sm opacity-60 hover:underline">
          ← Profiles
        </Link>
        <h1 className="text-3xl font-semibold">Add a loved one</h1>
        <p className="text-sm opacity-70">
          You can add their trusted circle on the next screen.
        </p>
      </div>

      <PersonForm />
    </main>
  );
}
