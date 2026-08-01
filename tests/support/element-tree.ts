import type { ReactElement, ReactNode } from "react";

export interface CollectedNode {
  type: unknown;
  props: Record<string, unknown>;
}

// The app/ui/surfaces.tsx primitives (Card, PageHeader, EmptyState, ...)
// pass nested content through several differently-named ReactNode props, not
// only `children` — a period selector or an action button commonly arrives
// via `actions`/`action`, a subtitle via `description`/`lead`. These are the
// only prop names walked as potential element trees, so an unrelated string
// prop (className, href, aria-label) is never mistaken for rendered content.
const CONTENT_PROP_NAMES = ["children", "actions", "action", "description", "lead"] as const;

function contentProps(props: Record<string, unknown> | undefined): unknown[] {
  if (!props) return [];
  return CONTENT_PROP_NAMES.filter((name) => props[name] !== undefined).map((name) => props[name]);
}

// Walks a tree of already-constructed React elements — exactly what a Server
// Component returns when called directly, before anything actually renders
// it — without ever invoking a component function. Nested Client Components
// (several call next/navigation's useRouter(), and the landing page imports
// next/image, neither of which resolves correctly outside a real Next.js
// request in this test environment) stay as inert {type, props}
// descriptors, which is all these tests need: element identity and the text
// literals already baked into props by the Server Component itself.
export function collectElements(node: ReactNode, out: CollectedNode[] = []): CollectedNode[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child as ReactNode, out);
    return out;
  }
  if (typeof node === "object" && "type" in node && "props" in node) {
    const element = node as ReactElement<Record<string, unknown>>;
    out.push({ type: element.type, props: element.props });
    for (const value of contentProps(element.props)) collectElements(value as ReactNode, out);
    return out;
  }
  return out;
}

// Every string/number leaf anywhere in the tree, for "is this text rendered
// anywhere on the page" substring assertions. Props outside the content
// allowlist above (e.g. an <img alt>) are deliberately excluded — an
// accessible-only attribute is not "displayed text" in the sense these tests
// care about.
export function collectText(node: ReactNode, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child as ReactNode, out);
    return out;
  }
  if (typeof node === "object" && "props" in node) {
    const element = node as ReactElement<Record<string, unknown>>;
    for (const value of contentProps(element.props)) collectText(value as ReactNode, out);
    return out;
  }
  return out;
}
