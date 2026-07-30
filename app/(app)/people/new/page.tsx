import Link from "next/link";
import { Card, PageHeader, PageShell } from "@/app/ui/surfaces";
import { PersonForm } from "./person-form";

// PRODUCT_SPECIFICATION.md §13.1 "création d'un profil de personne vulnérable",
// reached from §14.1's "Add a loved one".
export default function NewPersonPage() {
  return (
    <PageShell width="narrow">
      <div className="flex flex-col gap-4">
        <Link href="/" className="w-fit text-sm text-muted hover:text-accent">
          ← Profiles
        </Link>
        <PageHeader
          title="Add a loved one"
          lead="You can add their trusted circle on the next screen."
        />
      </div>

      <Card>
        <PersonForm />
      </Card>
    </PageShell>
  );
}
