import Link from "next/link";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/kpi/period";

export interface PeriodSelectorProps {
  current: PeriodKey;
  basePath: string;
  // Any other query params to keep untouched (e.g. a person filter) — the
  // period selector must never silently drop a filter the user already set.
  preserveParams?: Record<string, string | undefined>;
}

// A segmented control built entirely from plain links. Each option's own
// query string is baked in server-side, so: no client JS is needed for it to
// work; every option is keyboard-reachable via normal tab order; the
// selection survives a refresh or a shared URL, because it always WAS the
// URL (the ?period= param), never client-only state.
export function PeriodSelector({ current, basePath, preserveParams = {} }: PeriodSelectorProps) {
  return (
    <div role="group" aria-label="Period" className="inline-flex overflow-hidden rounded-kc-sm border border-line">
      {PERIOD_OPTIONS.map((option, index) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(preserveParams)) {
          if (value !== undefined) params.set(key, value);
        }
        params.set("period", option.key);
        const active = option.key === current;

        return (
          <Link
            key={option.key}
            href={`${basePath}?${params.toString()}`}
            aria-current={active ? "page" : undefined}
            className={
              "px-3 py-1.5 text-xs font-medium transition-colors " +
              (index > 0 ? "border-l border-line " : "") +
              (active ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:bg-sunken")
            }
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
