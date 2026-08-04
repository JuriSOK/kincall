import type { EventStatus } from "@/backend/orchestration/state-machine/states";

// Statuses where a Companion or Family call is in flight and CALL-E has not
// yet delivered a terminal result — i.e. exactly the states the poll route
// (src/app/api/events/[id]/poll/route.ts) exists to resume. PERSON_DID_NOT_ANSWER
// is deliberately excluded: per DEC-003 a retry there is "owed", not
// automated, so nothing external will ever change it on its own.
export const WAITING_STATUSES: ReadonlySet<EventStatus> = new Set([
  "CALLING_PERSON",
  "CONVERSATION_IN_PROGRESS",
  "ANALYSING_CONVERSATION",
  "ATTENTION_REQUIRED",
  "CALLING_TRUSTED_CONTACT",
  "CONTACT_DID_NOT_ANSWER",
  "CONTACT_DECLINED",
]);

export function isWaitingStatus(status: EventStatus): boolean {
  return WAITING_STATUSES.has(status);
}

export interface PollController {
  stop(): void;
  // Runs a poll now unless one is already in flight, then resumes the normal
  // cadence from this moment. Used when a hidden tab becomes visible again, so
  // a user coming back to a backgrounded page sees fresh state immediately
  // rather than after another full interval.
  pollNow(): void;
}

export interface StartPollingOptions {
  eventId: string;
  status: EventStatus;
  intervalMs?: number;
  // Fired once per successful poll with the fresh status. The caller uses
  // this to refresh the displayed event and timeline (e.g. router.refresh());
  // it is also how this module learns whether to keep going.
  onPollSuccess?: (status: EventStatus) => void;
  // Fired on a network failure or a non-2xx response. Never stops the
  // poller and never implies any particular event status — a temporary
  // failure here must not be read as, or turned into, HUMAN_REVIEW_REQUIRED
  // or any other terminal state. Only a later successful poll (which runs
  // the real, unmodified orchestration logic server-side) can change status.
  //
  // `consecutiveFailures` lets the caller show a proportionate inline message
  // (nothing on a single blip, a visible warning once it persists) without
  // having to track that count itself.
  onError?: (error: unknown, consecutiveFailures: number) => void;
  // Optional: defaults to defaultFetch below. If you DO supply one, it must
  // be a plain wrapper function — never the bare `fetch`/`window.fetch`
  // reference itself. Native fetch is a "legacy platform object" method:
  // browsers require it to be invoked as a plain top-level reference, and
  // assigning the captured reference to a variable or object property and
  // calling it from there detaches it from that requirement and throws
  // `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation.`
  // Node's fetch does not enforce this, which is exactly why that bug passes
  // every test yet breaks in every real browser.
  fetchImpl?: typeof fetch;
}

// DEC-022. Previously 5000ms with NO immediate first poll, which meant up to
// 5s of dead time on mount — and again after every status change, because the
// React effect re-creates the poller on each new status and so restarted the
// clock. A live test reported the event page "feels slow to update"; that dead
// time is the controllable half of it.
//
// 2000ms is deliberately not the fastest possible value: the brief sets a hard
// "never more than once per second" floor, and every poll costs a real CALL-E
// status request server-side, so halving this again would double that external
// load for a barely perceptible gain.
const DEFAULT_INTERVAL_MS = 2000;

// The hard floor, enforced here rather than trusted to callers so no future
// caller can accidentally hammer CALL-E.
const MIN_INTERVAL_MS = 1000;

// Bounded exponential backoff on consecutive failures: ×1, ×2, ×4, then capped.
// Bounded rather than unbounded so a transient outage cannot permanently starve
// an event that is still progressing server-side.
const MAX_BACKOFF_MULTIPLIER = 4;

// The safe default. This arrow function's body performs its own fresh, direct
// call to the literal `fetch` identifier every time it runs, so native
// fetch's receiver requirement is satisfied regardless of how THIS wrapper
// itself was invoked. Assigning `fetchImpl = fetch` directly instead of going
// through a wrapper like this one is exactly the mistake to never repeat.
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

// Framework-agnostic poller for src/app/api/events/[id]/poll.
//
// Guarantees, each covered by tests/event-poller.test.ts:
//   * polls IMMEDIATELY on start, then every intervalMs;
//   * never overlaps — a tick arriving while a request is in flight is dropped,
//     not queued, so a slow poll can never pile requests up;
//   * stops permanently the moment a successful poll reports a non-waiting
//     status, and does nothing at all if `status` was not waiting to begin with;
//   * backs off (bounded) after consecutive failures, and resets on success;
//   * NEVER starts a call and NEVER creates an event — the only request it can
//     issue is POST /api/events/{id}/poll, a resume-only route.
export function startPolling(options: StartPollingOptions): PollController {
  const {
    eventId,
    status,
    intervalMs = DEFAULT_INTERVAL_MS,
    onPollSuccess,
    onError,
    fetchImpl = defaultFetch,
  } = options;

  if (!isWaitingStatus(status)) {
    return { stop() {}, pollNow() {} };
  }

  const baseInterval = Math.max(intervalMs, MIN_INTERVAL_MS);

  let stopped = false;
  let inFlight = false;
  let consecutiveFailures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  }

  // A self-scheduling setTimeout rather than setInterval: the delay varies
  // between ticks under backoff, which an interval cannot express without
  // being torn down and rebuilt.
  function scheduleNext(): void {
    if (stopped) return;
    const multiplier = Math.min(2 ** consecutiveFailures, MAX_BACKOFF_MULTIPLIER);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(tick, baseInterval * multiplier);
  }

  function tick(): void {
    // A tick that lands while a request is still in flight is dropped. The
    // in-flight request's own `finally` reschedules, so the cadence is never
    // lost by skipping.
    if (stopped || inFlight) return;
    inFlight = true;

    fetchImpl(`/api/events/${eventId}/poll`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) {
          consecutiveFailures += 1;
          onError?.(new Error(`Poll failed with status ${response.status}`), consecutiveFailures);
          return;
        }
        const body = (await response.json()) as { status?: EventStatus };
        if (!body.status) return;

        consecutiveFailures = 0;
        onPollSuccess?.(body.status);
        if (!isWaitingStatus(body.status)) {
          stop();
        }
      })
      .catch((error: unknown) => {
        consecutiveFailures += 1;
        onError?.(error, consecutiveFailures);
      })
      .finally(() => {
        inFlight = false;
        scheduleNext();
      });
  }

  function pollNow(): void {
    if (stopped || inFlight) return;
    if (timer !== undefined) clearTimeout(timer);
    tick();
  }

  // The immediate first poll: an event's status can already have advanced
  // server-side between the page being rendered and this mounting.
  tick();

  return { stop, pollNow };
}
