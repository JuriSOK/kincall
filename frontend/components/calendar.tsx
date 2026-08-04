import Link from "next/link";
import type { CalendarDayMarker } from "@/backend/history/calendar";

const WEEKDAY_LABELS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

export interface MonthCalendarProps {
  monthLabel: string;
  markers: CalendarDayMarker[];
  selectedDay?: string;
  prevMonthHref: string;
  nextMonthHref: string;
  // Builds a day cell's href from its dayKey — the caller owns how other
  // query params (e.g. a person filter) are preserved.
  dayHref: (dayKey: string) => string;
}

// A plain server-rendered grid of links: month navigation and day selection
// are both full navigations (no client state), which is what makes every
// cell keyboard-reachable via ordinary tab order with no special handling.
// `aria-live="polite"` on the month heading is the concession to a fully
// client-side calendar widget's "announce the month change" requirement —
// here the heading text itself changes on navigation, and the live region
// makes that change get spoken by assistive technology.
export function MonthCalendar({
  monthLabel,
  markers,
  selectedDay,
  prevMonthHref,
  nextMonthHref,
  dayHref,
}: MonthCalendarProps) {
  // Monday-first offset (0 = Monday .. 6 = Sunday) for the first day of the
  // month, so the grid aligns under the correct weekday column.
  const firstWeekday = markers.length > 0 ? (new Date(`${markers[0].dayKey}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={prevMonthHref}
          aria-label="Previous month"
          className="rounded-kc-sm border border-line px-2.5 py-1 text-sm hover:border-line-strong"
        >
          ←
        </Link>
        <h3 aria-live="polite" className="text-sm font-semibold">
          {monthLabel}
        </h3>
        <Link
          href={nextMonthHref}
          aria-label="Next month"
          className="rounded-kc-sm border border-line px-2.5 py-1 text-sm hover:border-line-strong"
        >
          →
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-subtle">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} aria-hidden>
            {label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden />
        ))}
        {markers.map((marker) => {
          const selected = marker.dayKey === selectedDay;
          return (
            <Link
              key={marker.dayKey}
              href={dayHref(marker.dayKey)}
              aria-current={selected ? "date" : undefined}
              className={
                "flex flex-col items-center gap-0.5 rounded-kc-sm border px-1 py-1.5 text-xs transition-colors " +
                (selected
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-transparent hover:border-line-strong hover:bg-sunken")
              }
            >
              <span>{marker.dayOfMonth}</span>
              {marker.hasEvents ? (
                <span className="flex gap-0.5" aria-hidden>
                  {marker.hasUnresolved ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-unresolved-line" />
                  ) : null}
                  {marker.hasCascade ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-attention-line" />
                  ) : null}
                  {marker.hasNormal ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-calm-line" />
                  ) : null}
                </span>
              ) : (
                <span className="h-1.5" aria-hidden />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
