import type { EventOutcomeCategory, HistoryEventView } from "@/backend/presentation/history-view";

export interface HistoryFilters {
  personId?: string;
  // The product's own outcome vocabulary (DEC-011), not a raw EventStatus —
  // see backend/presentation/history-view.ts's categorizeEventOutcome.
  category?: EventOutcomeCategory;
  // "YYYY-MM-DD", inclusive, compared against each view's own dayKey (already
  // in the display timezone) — so a from/to boundary means the same calendar
  // day a user sees on the page, not a UTC day.
  from?: string;
  to?: string;
  query?: string;
}

// Pure filtering over already-built views (backend/presentation/history-view.ts),
// so this has no repository or Next.js dependency and is directly unit
// testable. Search is over exactly the "safe display fields" the spec names:
// the person's first name and the event's own neutral/factual summary —
// never raw structured_result, never a phone number.
export function filterHistoryEvents(
  views: HistoryEventView[],
  filters: HistoryFilters
): HistoryEventView[] {
  const query = filters.query?.trim().toLowerCase();

  return views.filter((view) => {
    if (filters.personId && view.personId !== filters.personId) return false;
    if (filters.category && view.category !== filters.category) return false;
    if (filters.from && view.dayKey < filters.from) return false;
    if (filters.to && view.dayKey > filters.to) return false;
    if (
      query &&
      !(
        view.personName.toLowerCase().includes(query) ||
        view.summary.toLowerCase().includes(query)
      )
    ) {
      return false;
    }
    return true;
  });
}
