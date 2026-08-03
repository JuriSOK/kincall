import type { ReactNode } from "react";
import { TONE_BADGE, TONE_PANEL, type Tone } from "./tone";

/** The page frame: consistent max width, gutters and vertical rhythm. */
export function PageShell({
  children,
  width = "wide",
}: {
  children: ReactNode;
  width?: "narrow" | "wide";
}) {
  const max = width === "narrow" ? "max-w-2xl" : "max-w-5xl";
  return (
    <main className={`mx-auto w-full ${max} px-5 py-10 sm:px-8 sm:py-14`}>
      <div className="flex flex-col gap-8">{children}</div>
    </main>
  );
}

/**
 * The one place a page title is defined, so heading order stays correct: this
 * renders the single <h1>, and every section below uses <h2> via Card.
 */
export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {lead ? <p className="max-w-prose text-sm text-muted">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  tone = "neutral",
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  tone?: Tone;
}) {
  // A toned card keeps the tone on its border only — a fully tinted card at
  // this size reads as an alert, which most cards are not.
  const border = tone === "neutral" ? "border-line" : TONE_PANEL[tone].split(" ")[1];
  return (
    <section className={`rounded-kc border ${border} bg-surface shadow-kc-sm`}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex flex-col gap-1">
            {title ? <h2 className="text-sm font-semibold tracking-tight">{title}</h2> : null}
            {description ? <p className="text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children ? <div className="px-5 py-4">{children}</div> : null}
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-kc-full border px-2.5 py-0.5 text-xs font-medium ${TONE_BADGE[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A callout. `assertive` marks it as something that just went wrong and needs
 * announcing — used for request failures, so a screen-reader user is told
 * without having to go looking for the message.
 */
export function Notice({
  children,
  tone = "neutral",
  title,
  assertive = false,
}: {
  children: ReactNode;
  tone?: Tone | "danger";
  title?: string;
  assertive?: boolean;
}) {
  const classes =
    tone === "danger"
      ? "bg-danger-bg border-danger-line text-danger"
      : TONE_PANEL[tone];
  return (
    <div
      role={assertive || tone === "danger" ? "alert" : undefined}
      className={`rounded-kc border px-4 py-3 text-sm ${classes}`}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-kc border border-dashed border-line bg-sunken px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <p className="max-w-sm text-sm text-muted">{children}</p> : null}
      {action}
    </div>
  );
}

/** A labelled key/value row, for the many "field: value" lines across pages. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
