import type { ReactNode } from "react";
import { Nav } from "@/app/ui/nav";

// Every route under this group — /dashboard, /history, /people/*, /events/*
// — shares this layout. This is deliberately the ONE place a future
// authentication check would go (Stage B does not add one; §14 of that
// stage's brief covers a smaller, non-auth write-protection gate instead —
// see README's "Before a public deployment" section). Adding real auth later
// means a single check here, with no change to any page's own code and no
// URL changes, since the (app) segment itself never appears in a URL.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Nav />
      <div className="flex-1">{children}</div>
    </div>
  );
}
