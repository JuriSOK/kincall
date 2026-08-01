import type { InterventionSummary } from "@/lib/presentation/intervention-summary";

// Stage F (DEC-019): the confirmed-intervention card. Rendered ONLY when
// lib/presentation/intervention-summary.ts returned a model — that module's
// nullable return is what guarantees this card can never appear for an event
// with no valid trusted-contact confirmation, so this component performs no
// validity check of its own and has no "unconfirmed" branch to get wrong.
//
// Every fact here is already display-ready text. This component never touches
// a raw structured result, an enum, a contact id or a phone number.
export function InterventionCard({ summary }: { summary: InterventionSummary }) {
  // Ties the disclaimer to the card's own accessible name, so a screen-reader
  // user reaching this region is told what it is AND that it is unverified —
  // rather than meeting the caveat only if they happen to read to the end.
  const headingId = "intervention-heading";
  const disclaimerId = "intervention-disclaimer";

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={disclaimerId}
      className="rounded-kc border border-calm-line bg-calm-bg shadow-kc-sm"
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-sm font-semibold tracking-tight text-calm-ink">
            A trusted contact confirmed they would help
          </h2>
          {/* The one-line version, identical to what the dashboard and person
              page show for this same event — one model, one wording. */}
          <p className="text-sm text-calm-ink">{summary.concise}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Decorative only: the contact's name is rendered as text directly
              beside it, so announcing the letter as well would just repeat the
              first character of the name. */}
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-calm-line bg-surface text-sm font-semibold text-calm-ink"
          >
            {summary.initials}
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {summary.contactName}
              {summary.relationship ? (
                <span className="font-normal text-muted"> — {summary.relationship}</span>
              ) : null}
            </span>
            {/* Text, not a colour or an icon: the planned action has to be
                readable without perceiving either. */}
            <span className="text-sm text-muted">{summary.action}</span>
          </div>
        </div>

        <dl className="flex flex-col divide-y divide-calm-line/50">
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
            <dt className="text-xs text-subtle">Planned action</dt>
            <dd className="text-sm">{summary.action}</dd>
          </div>
          {summary.estimatedTimeText ? (
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
              <dt className="text-xs text-subtle">Estimated time</dt>
              {/* Shown exactly as the contact expressed it — never parsed into
                  a date, never treated as an appointment. */}
              <dd className="text-sm">{summary.estimatedTimeText}</dd>
            </div>
          ) : null}
        </dl>

        {summary.contactSummary.trim().length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-subtle">What they said</p>
            <p className="text-sm text-muted">{summary.contactSummary}</p>
          </div>
        ) : null}

        {summary.contactStateNote ? (
          <p className="text-xs text-subtle">{summary.contactStateNote}</p>
        ) : null}

        {summary.missingFields.length > 0 ? (
          <p className="text-xs text-subtle">
            This check-in did not record {formatMissingList(summary.missingFields)}.
          </p>
        ) : null}

        {/* Always present for a confirmed intervention — never conditional,
            never shortened. §7.5: KinCall must not assert that anything was
            actually done, only what somebody said they would do. */}
        <p id={disclaimerId} className="rounded-kc border border-line bg-surface px-3 py-2 text-xs text-muted">
          {summary.disclaimer}
        </p>
      </div>
    </section>
  );
}

// "a" / "a and b" / "a, b and c" — a readable list rather than a bare join,
// since this sentence is shown to a family member, not an operator.
function formatMissingList(fields: readonly string[]): string {
  if (fields.length === 1) return fields[0];
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}
