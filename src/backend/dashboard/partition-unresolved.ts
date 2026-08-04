import type { EventRecord } from "@/shared/domain/types";

export interface UnresolvedPartition<T extends { status: EventRecord["status"] }> {
  unresolved: T[];
  rest: T[];
}

// The dashboard's "Needs attention now" section (§7A) is exactly the
// ATTENTION_UNRESOLVED events, always shown first regardless of how the input
// was ordered — DEC-011's autonomous dead end is the one outcome the product
// wants impossible to miss on a skim. Generic over T so it works on plain
// EventRecords or on a richer per-row view, as long as `status` is present.
export function partitionUnresolvedEvents<T extends { status: EventRecord["status"] }>(
  events: T[]
): UnresolvedPartition<T> {
  const unresolved: T[] = [];
  const rest: T[] = [];
  for (const event of events) {
    (event.status === "ATTENTION_UNRESOLVED" ? unresolved : rest).push(event);
  }
  return { unresolved, rest };
}
