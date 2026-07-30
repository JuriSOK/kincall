import { readCompanionResult } from "@/lib/calle/schemas";
import type { CallEventRecord, EventRecord } from "@/lib/database/types";
import { describeAction } from "@/lib/presentation/event-summary";
import { formatDayKey } from "@/lib/presentation/format-date";
import { describePersonStatus } from "@/lib/orchestration/person-status";
import type { EventStatus } from "@/lib/orchestration/states";
import { STATUS_TONE } from "@/lib/presentation/status-tone";
import type { Tone } from "@/app/ui/tone";

// One of the three neutral outcome categories the history calendar marks
// (§9). Priority order when more than one could apply: unresolved is always
// shown over cascade, and cascade over normal, because it is the one a family
// member most needs to notice. `null` means no decision has been reached yet
// (still mid check-in) — deliberately not shown as any of the three, rather
// than guessed at. This is the product's own binary-decision vocabulary
// (DEC-011) — "outcome", not "internal status" — which is why the history
// page filters by this rather than by the raw EventStatus.
export type EventOutcomeCategory = "unresolved" | "cascade" | "normal" | null;

export function categorizeEventOutcome(event: EventRecord): EventOutcomeCategory {
  if (event.status === "ATTENTION_UNRESOLVED") return "unresolved";
  if (event.decision === "CONTACT_TRUSTED_PERSON") return "cascade";
  if (event.decision === "LOG_AND_CLOSE" || event.decision === "NO_ACTION") return "normal";
  return null;
}

// A single, reusable "one row" view of an event, built once and shared by the
// dashboard's "Recent activity" section and the history page's day-grouped
// list and search — so the two never describe the same event differently.
export interface HistoryEventView {
  eventId: string;
  personId: string;
  personName: string;
  // Null when nobody selected one, or when the person could not be resolved
  // at all (an id with no matching row — see the callers' own fallback name
  // "Unknown profile"). Avatar rendering always falls back to initials.
  avatarKey: string | null;
  createdAt: string;
  dayKey: string;
  // Carried for partitioning/sorting only (e.g. lib/dashboard/partition-
  // unresolved.ts's ATTENTION_UNRESOLVED check) — never rendered as text.
  // `statusLabel` below is what every screen actually displays.
  status: EventStatus;
  statusLabel: string;
  statusTone: Tone;
  // The history page's filter axis — see categorizeEventOutcome above.
  category: EventOutcomeCategory;
  // A concise, factual, one-line summary — the Companion's own neutral
  // summary when a usable one exists, falling back to the plain-language
  // action description (never a raw enum, never fabricated detail).
  summary: string;
  href: string;
}

export function buildHistoryEventView(
  event: EventRecord,
  personName: string,
  callEvents: CallEventRecord[],
  avatarKey: string | null = null
): HistoryEventView {
  const status = describePersonStatus(event);
  const companionCalls = callEvents.filter((call) => call.agentType === "companion");
  const lastCompanion = companionCalls[companionCalls.length - 1];
  const attention =
    lastCompanion && lastCompanion.resultProcessedAt !== null
      ? readCompanionResult(lastCompanion.structuredResult)
      : null;

  return {
    eventId: event.id,
    personId: event.personId,
    personName,
    avatarKey,
    createdAt: event.createdAt,
    dayKey: formatDayKey(event.createdAt),
    status: event.status,
    statusLabel: status.label,
    statusTone: STATUS_TONE[status.tone],
    category: categorizeEventOutcome(event),
    summary: attention?.neutralSummary || lastCompanion?.summary || describeAction(event),
    href: `/events/${event.id}`,
  };
}
