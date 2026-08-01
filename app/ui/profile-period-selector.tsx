import Link from "next/link";
import { PROFILE_PERIOD_OPTIONS, type ProfilePeriodKey } from "@/lib/kpi/period";

// Mirrors period-selector.tsx's zero-JS Link pattern but reads the person
// page's Day/Week/Month/Year vocabulary. Kept as a separate component (not a
// generic parameterised one) so each stays simple to read and neither has to
// carry a branch for the other's option shape.
export interface ProfilePeriodSelectorProps {
  current: ProfilePeriodKey;
  basePath: string;
  preserveParams?: Record<string, string | undefined>;
}

export function ProfilePeriodSelector({
  current,
  basePath,
  preserveParams = {},
}: ProfilePeriodSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Period"
      className="inline-flex overflow-hidden rounded-kc-sm border border-line"
    >
      {PROFILE_PERIOD_OPTIONS.map((option, index) => {
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
