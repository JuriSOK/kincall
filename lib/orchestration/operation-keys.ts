import type { TransitionEvent } from "./states";

// Which phase of handling one durable cause a transition belongs to.
//
// `stage` is load-bearing, not decorative: FAMILY_RESULT_MALFORMED is emitted
// both by the malformed-result branch ("result") and by DEC-005's "could not
// start the next call" safety net ("advance"), and both are attributable to
// the same triggering call event. Without the stage they would collide on one
// key and the second would silently no-op.
export type CascadeStage = "start" | "result" | "advance";

// An operation key must be recomputable byte-identically by a replaying worker
// that shares none of the crashed worker's memory, so it is derived only from
// durable facts:
//
//   trigger  — the callEventId whose result is being handled, or (in
//              startDemoEvent, where no call exists yet) the event's runId.
//              `call_events.id` is assigned on insert and never changes;
//              `runId` is generated once at event creation (DEC-004) and never
//              regenerated. UNIQUE (event_id, contact_id) means one call event
//              per contact, so the call event id *is* the cascade step.
//   stage    — reached at a fixed point in one code path, so a replay of that
//              path derives the same stage.
//   event    — chosen by a deterministic branch over the persisted structured
//              result, so a replay picks the identical literal.
export function operationKey(
  trigger: string,
  stage: CascadeStage,
  transitionEvent: TransitionEvent
): string {
  return `${trigger}:${stage}:${transitionEvent}`;
}
