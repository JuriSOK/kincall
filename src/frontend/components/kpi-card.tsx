export interface KpiCardProps {
  label: string;
  // A pre-formatted display value, e.g. "12 (46%)" or "3" — see
  // src/backend/presentation/kpi-display.ts, the single place that decides this
  // string. This component never rounds, divides, or decides what an empty
  // denominator should read as.
  value: string;
  caption?: string;
}

// One count-based metric (§8 of the Stage B brief). Never a duration, never a
// rate presented as a medical outcome — both of those are the caller's
// responsibility to have already excluded, this component only lays out
// whatever it's given.
export function KpiCard({ label, value, caption }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-kc border border-line bg-surface p-4 shadow-kc-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</p>
      <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {caption ? <p className="text-xs text-subtle">{caption}</p> : null}
    </div>
  );
}
