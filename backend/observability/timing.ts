// Development-only stage timing for the check-in path (DEC-022).
//
// WHY THIS IS SAFE TO ADD TO THE ORCHESTRATION PATH
//
// Two standing rules constrain anything that reads a clock here:
//
//   1. Replay-stability (engine.ts, contact-order.ts): orchestration must never
//      BRANCH on `Date.now()`, because a replayed transition has to recompute
//      the identical decision. This module only measures and prints; nothing it
//      returns is ever persisted, compared, or used in a decision. Timing a
//      step cannot change what that step does.
//   2. The logging safety rule (CLAUDE.md): never log a phone number, an API
//      key, a transcript, a structured result, or conversation notes. This
//      module's `record` takes an event id, a stage name and a duration —
//      there is deliberately no free-form payload parameter, so there is no
//      channel through which a caller could pass sensitive content even by
//      accident.
//
// Off unless explicitly enabled, so production never pays for it and never
// emits noise: set KINCALL_TIMING=1. Absent that, `record` returns immediately.

// Read per call rather than cached at module load: a test (or a script) can
// flip the variable between runs, and this is not a hot path — one env read
// per measured stage is irrelevant next to the DB and HTTP work being measured.
function enabled(): boolean {
  return process.env.KINCALL_TIMING === "1";
}

// The stages of one check-in, named once here so a log line from the route and
// one from the engine can be correlated without matching free text.
export type TimingStage =
  | "start_route_total"
  | "start_person_read"
  | "start_event_created"
  | "start_transition_committed"
  | "start_calle_request"
  | "start_companion_processed"
  | "poll_route_total"
  | "poll_calle_result"
  | "poll_result_processed";

export interface TimingRecord {
  eventId: string;
  stage: TimingStage;
  elapsedMs: number;
}

// One structured line per measured stage. `console.info` rather than `log` so
// it can be filtered separately, and a fixed prefix so it can be grepped.
export function record(eventId: string, stage: TimingStage, elapsedMs: number): void {
  if (!enabled()) return;
  const payload: TimingRecord = { eventId, stage, elapsedMs: Math.round(elapsedMs) };
  console.info(`[kincall:timing] ${JSON.stringify(payload)}`);
}

// Measures one awaited stage and returns its value untouched.
//
// The stage is recorded on the SUCCESS path only. A stage that throws is
// already surfaced as a real error by the caller, and emitting a duration for
// work that did not complete would make the log misleading — a failed CALL-E
// request is not a "CALL-E request took 1200ms" data point.
export async function timed<T>(
  eventId: string,
  stage: TimingStage,
  operation: () => Promise<T>
): Promise<T> {
  if (!enabled()) return operation();
  const startedAt = performance.now();
  const result = await operation();
  record(eventId, stage, performance.now() - startedAt);
  return result;
}

// For a stage whose start and end are not a single awaited call (e.g. a whole
// route handler). Returns a function that records when invoked.
export function startTimer(eventId: string, stage: TimingStage): () => void {
  if (!enabled()) return () => {};
  const startedAt = performance.now();
  return () => record(eventId, stage, performance.now() - startedAt);
}
