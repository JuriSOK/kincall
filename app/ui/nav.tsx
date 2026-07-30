"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface NavLink {
  href: string;
  label: string;
}

const LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/history", label: "History" },
  { href: "/people/new", label: "Add profile" },
];

function isActive(pathname: string, href: string): boolean {
  // Exact match only: /people/new is a distinct destination from
  // /people/[id] or /people/[id]/contacts, which are reached from a profile
  // card rather than from this nav and should not light up "Add profile".
  return pathname === href;
}

// The shared navigation for every route under app/(app) (Stage B). No login
// UI yet — the brand link and this bar together are the ONE place a future
// "Sign in" action would be added, per the layout's own doc comment; nothing
// about this component assumes a signed-in user.
export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight hover:text-accent">
          KinCall
        </Link>

        {/* Desktop: a plain, always-visible row — every link is keyboard-
            reachable via normal tab order, with no disclosure to open first. */}
        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          <NavLinks pathname={pathname} />
        </nav>

        {/* Mobile: a native <details>/<summary> disclosure. Zero JavaScript
            needed for the toggle itself (unlike a client-state-driven menu),
            and it is keyboard-operable and has a correct implicit role out of
            the box. */}
        <details className="relative sm:hidden">
          <summary className="cursor-pointer list-none rounded-kc-sm border border-line px-3 py-1.5 text-sm marker:content-none">
            Menu
          </summary>
          <nav
            aria-label="Main"
            className="absolute right-0 z-10 mt-2 flex w-44 flex-col gap-1 rounded-kc border border-line bg-surface p-2 shadow-kc"
          >
            <NavLinks pathname={pathname} />
          </nav>
        </details>
      </div>
    </header>
  );
}

function NavLinks({ pathname }: { pathname: string }): ReactNode {
  return (
    <>
      {LINKS.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={
              "rounded-kc-sm px-3 py-1.5 text-sm font-medium transition-colors " +
              (active ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink")
            }
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
