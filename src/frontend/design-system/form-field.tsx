"use client";

import { useId, type ReactNode } from "react";

/**
 * A labelled form control with its error and hint wired up for assistive
 * technology.
 *
 * The reason this is a component rather than a convention: `aria-invalid` and
 * `aria-describedby` have to be set on the *control*, while the message they
 * point at lives outside it. Doing that by hand in every form is how it ends up
 * being done in none of them — before this existed there were zero
 * `aria-invalid` and zero `aria-describedby` attributes in the whole app.
 *
 * `children` is a render prop so the ids can be handed to whatever control the
 * caller uses — input, select or textarea.
 */
export function FormField({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  // Point at whichever messages actually exist. An id referencing a node that
  // is not rendered is worse than none: some screen readers announce nothing.
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The shared control styling, so inputs and selects match without each form
 *  restating a class string. */
export const controlClasses =
  "w-full rounded-kc-sm border border-line bg-surface px-3 py-2 text-sm text-ink " +
  "transition-colors hover:border-line-strong aria-[invalid=true]:border-danger-line " +
  "aria-[invalid=true]:bg-danger-bg";
