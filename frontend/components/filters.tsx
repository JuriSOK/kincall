import { controlClasses } from "@/frontend/design-system/form-field";
import { Button } from "@/frontend/design-system/button";

export interface HistoryFilterValues {
  personId?: string;
  category?: string;
  from?: string;
  to?: string;
  query?: string;
  // Carried through as a hidden field so filtering never resets the period
  // the KPI strip and this page share.
  period?: string;
}

export interface HistoryFiltersProps {
  action: string;
  people: { id: string; firstName: string }[];
  categoryOptions: { value: string; label: string }[];
  values: HistoryFilterValues;
}

// A plain `<form method="get">` — filtering needs no client JavaScript at
// all: submitting re-navigates to the same page with the chosen values as
// query params, which is also what makes every filter's state shareable and
// survive a refresh (§9's "query parameters represent filters where
// practical"). Every control has a visible, associated <label>.
export function HistoryFilters({ action, people, categoryOptions, values }: HistoryFiltersProps) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      {values.period ? <input type="hidden" name="period" value={values.period} /> : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted">Profile</span>
        <select name="person" defaultValue={values.personId ?? ""} className={controlClasses}>
          <option value="">All profiles</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.firstName}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted">Outcome</span>
        <select name="category" defaultValue={values.category ?? ""} className={controlClasses}>
          <option value="">All outcomes</option>
          {categoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted">From</span>
        <input type="date" name="from" defaultValue={values.from ?? ""} className={controlClasses} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted">To</span>
        <input type="date" name="to" defaultValue={values.to ?? ""} className={controlClasses} />
      </label>

      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted">Search</span>
        <input
          type="search"
          name="q"
          defaultValue={values.query ?? ""}
          placeholder="Name or summary"
          className={controlClasses}
        />
      </label>

      <Button type="submit" variant="secondary" size="sm">
        Filter
      </Button>
    </form>
  );
}
