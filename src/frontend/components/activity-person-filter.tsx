import { controlClasses } from "@/frontend/design-system/form-field";
import { Button } from "@/frontend/design-system/button";

export interface ActivityPersonFilterProps {
  action: string;
  people: { id: string; firstName: string }[];
  selectedPersonId?: string;
  // Any other query params to preserve untouched (e.g. the selected period) —
  // filtering by person must never silently reset a filter already set,
  // matching PeriodSelector's own preserveParams contract.
  preserveParams?: Record<string, string | undefined>;
}

// A plain `<form method="get">`, same pattern as HistoryFilters: no client
// JavaScript needed, keyboard-accessible by construction, and the selection
// is shareable/refresh-proof because it always WAS the URL (?person=), never
// client-only state. Narrows "Operational activity" only — every other
// dashboard section keeps showing every person, unaffected by this filter.
export function ActivityPersonFilter({
  action,
  people,
  selectedPersonId,
  preserveParams = {},
}: ActivityPersonFilterProps) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-2">
      {Object.entries(preserveParams).map(([key, value]) =>
        value !== undefined ? <input key={key} type="hidden" name={key} value={value} /> : null
      )}
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted">Person</span>
        <select
          name="person"
          defaultValue={selectedPersonId ?? ""}
          className={`${controlClasses} py-1.5 text-xs`}
        >
          <option value="">All people</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.firstName}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary" size="sm">
        Apply
      </Button>
    </form>
  );
}
