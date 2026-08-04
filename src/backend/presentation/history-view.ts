import { readCompanionResult } from "@/backend/integrations/calle/schemas";
import type { CallEventRecord, EventRecord, TrustedContact } from "@/shared/domain/types";
import { describeAction } from "@/backend/presentation/event-summary";
import { buildInterventionSummary } from "@/backend/presentation/intervention-summary";
import { formatDayKey } from "@/shared/presentation/format-date";
import { describePersonStatus } from "@/backend/presentation/person-status";
import type { EventStatus } from "@/backend/orchestration/state-machine/states";
import { STATUS_TONE } from "@/backend/presentation/status-tone";
import type { Tone } from "@/shared/presentation/tone";

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
  // Carried for partitioning/sorting only (e.g. src/backend/dashboard/partition-
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
  // Stage F (DEC-019): the one-line confirmed-intervention sentence ("Marc
  // will visit at 17:30."), or null when this event has no valid
  // trusted-contact confirmation — which is every case where a card must not
  // appear either. Built by the SAME model the event page's card uses, so a
  // row and the page it links to can never describe the intervention
  // differently.
  //
  // When the caller passes no contact records (see `contacts` below) a
  // confirmed event still yields a line, using the same neutral "A trusted
  // contact …" wording the event page's card falls back to — the commitment
  // genuinely happened, and reporting it without a name is honest, whereas
  // suppressing it would hide a real fact.
  interventionSummary: string | null;
  href: string;
}

export function buildHistoryEventView(
  event: EventRecord,
  personName: string,
  callEvents: CallEventRecord[],
  avatarKey: string | null = null,
  // Optional so every pre-Stage-F caller keeps compiling and behaving
  // identically (they simply get interventionSummary: null). Callers that can
  // resolve this person's circle without an extra query — the dashboard
  // already fetches it per person — pass it and get the intervention line.
  contacts: TrustedContact[] = []
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
    interventionSummary:
      buildInterventionSummary(event, callEvents, contacts)?.concise ?? null,
    href: `/events/${event.id}`,
  };
}
