export interface DayGroup<T> {
  dayKey: string;
  items: T[];
}

// Groups already-ordered items (newest first, as Repository.listRecentEvents
// returns) into per-day buckets, preserving that order at both levels: the
// day groups themselves come out newest-day-first (a Map's iteration order
// follows first-insertion order, and the first item of the newest day is
// always seen before any item of an older day), and each group's own items
// keep their original relative order.
export function groupByDay<T extends { dayKey: string }>(items: T[]): DayGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.dayKey);
    if (list) {
      list.push(item);
    } else {
      map.set(item.dayKey, [item]);
    }
  }
  return [...map.entries()].map(([dayKey, groupItems]) => ({ dayKey, items: groupItems }));
}
