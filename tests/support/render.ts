import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

// A handful of pages under src/app/(app)/ compose client components that call
// next/navigation's useRouter() (delete/edit/toggle buttons) purely to
// redirect or refresh after a mutation — never during the initial render
// this test harness exercises. react-dom/server has no App Router to supply
// that context on its own, so useRouter() throws unless something provides
// it; a no-op stub is all render-only assertions need.
const stubRouter = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: async () => {},
};

export function renderServerComponent(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: stubRouter as never }, element)
  );
}
