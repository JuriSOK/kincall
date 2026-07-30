// The three periods the dashboard's KPI strip can show (§8). "3m" is
// approximated as 90 days rather than a calendar-month walk: a fixed day
// count is deterministic and has no month-length or leap-year edge cases,
// which matters more here than calendar precision does.
export type PeriodKey = "7d" | "30d" | "3m";

export interface PeriodOption {
  key: PeriodKey;
  label: string;
  days: number;
}

export const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "3m", label: "Last 3 months", days: 90 },
];

export const DEFAULT_PERIOD: PeriodKey = "30d";

function isPeriodKey(value: string): value is PeriodKey {
  return PERIOD_OPTIONS.some((option) => option.key === value);
}

// Reads the `?period=` query parameter. Next.js's searchParams gives a single
// string, a string[] (repeated param) or undefined; anything not recognised —
// including a repeated param — falls back to the default rather than
// guessing, so a malformed or tampered URL can never silently compute a KPI
// over an unintended window.
export function parsePeriod(value: string | string[] | undefined): PeriodKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== undefined && isPeriodKey(candidate) ? candidate : DEFAULT_PERIOD;
}

export function periodOption(period: PeriodKey): PeriodOption {
  // PERIOD_OPTIONS is exhaustive over PeriodKey by construction, so this is
  // always found; the ?? is only to satisfy the type checker.
  return PERIOD_OPTIONS.find((option) => option.key === period) ?? PERIOD_OPTIONS[1];
}

// The inclusive lower bound of the period, as an ISO instant — what
// Repository.listRecentEvents's `since` expects.
export function periodSince(period: PeriodKey, now: Date = new Date()): string {
  const { days } = periodOption(period);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
