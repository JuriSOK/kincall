import type { EventStatus } from "@/lib/orchestration/states";

// Statuses where a Companion or Family call is in flight and CALL-E has not
// yet delivered a terminal result — i.e. exactly the states the poll route
// (app/api/events/[id]/poll/route.ts) exists to resume. PERSON_DID_NOT_ANSWER
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
  onError?: (error: unknown) => void;
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

const DEFAULT_INTERVAL_MS = 5000;

// The safe default. This arrow function's body performs its own fresh, direct
// call to the literal `fetch` identifier every time it runs, so native
// fetch's receiver requirement is satisfied regardless of how THIS wrapper
// itself was invoked. Assigning `fetchImpl = fetch` directly instead of going
// through a wrapper like this one is exactly the mistake to never repeat.
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

// Framework-agnostic poller for app/api/events/[id]/poll. Ticks every
// intervalMs; a tick is skipped entirely (not queued) while the previous
// request is still in flight, so requests never overlap. Stops itself the
// moment a successful response reports a non-waiting status. Does nothing at
// all if `status` isn't a waiting status to begin with.
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
    return { stop() {} };
  }

  let stopped = false;
  let inFlight = false;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  }

  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;

    fetchImpl(`/api/events/${eventId}/poll`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) {
          onError?.(new Error(`Poll failed with status ${response.status}`));
          return;
        }
        const body = (await response.json()) as { status?: EventStatus };
        if (!body.status) return;

        onPollSuccess?.(body.status);
        if (!isWaitingStatus(body.status)) {
          stop();
        }
      })
      .catch((error: unknown) => {
        onError?.(error);
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);

  return { stop };
}
