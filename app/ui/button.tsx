import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-55";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink border border-transparent hover:bg-accent-hover " +
    "shadow-kc-sm",
  secondary:
    "bg-surface text-ink border border-line hover:border-line-strong hover:bg-sunken " +
    "shadow-kc-sm",
  ghost: "bg-transparent text-muted border border-transparent hover:bg-sunken hover:text-ink",
  danger: "bg-transparent text-danger border border-danger-line hover:bg-danger-bg",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1.5 rounded-kc-sm",
  md: "text-sm px-4 py-2 rounded-kc-sm",
};

function classesFor(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  // Always an explicit type: a <button> inside a form defaults to "submit",
  // which has silently submitted forms from unrelated controls before.
  return <button type={rest.type ?? "button"} className={classesFor(variant, size, className)} {...rest} />;
}

/**
 * A link that looks like a button. Deliberately a separate component rather
 * than a `as`/`href` prop on Button: navigation must stay a real anchor so it
 * keeps middle-click, "open in new tab", and the correct screen-reader role.
 */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <Link className={classesFor(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
