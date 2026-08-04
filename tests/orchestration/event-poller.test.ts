import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWaitingStatus, startPolling, WAITING_STATUSES } from "@/app/(app)/events/[id]/event-poller";
import type { EventStatus } from "@/backend/orchestration/state-machine/states";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response;
}

// A controllable fetch mock: each call returns a promise we can resolve or
// reject on demand, so tests can assert what happens *before* a response
// arrives (overlap) as well as after (stop/continue).
function deferredFetch() {
  const calls: Array<{ resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];
  const fetchImpl = vi.fn(() => {
    return new Promise<Response>((resolve, reject) => {
      calls.push({ resolve, reject });
    });
  });
  return { fetchImpl, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WAITING_STATUSES / isWaitingStatus", () => {
  const waiting: EventStatus[] = [
    "CALLING_PERSON",
    "CONVERSATION_IN_PROGRESS",
    "ANALYSING_CONVERSATION",
    "ATTENTION_REQUIRED",
    "CALLING_TRUSTED_CONTACT",
    "CONTACT_DID_NOT_ANSWER",
    "CONTACT_DECLINED",
  ];

  it.each(waiting)("treats %s as a waiting state", (status) => {
    expect(isWaitingStatus(status)).toBe(true);
  });

  const terminal: EventStatus[] = [
    "SCHEDULED",
    "PERSON_DID_NOT_ANSWER",
    "NO_ACTION_REQUIRED",
    "CONTACT_CONFIRMED",
    "HUMAN_REVIEW_REQUIRED",
    "CASE_CLOSED",
  ];

  it.each(terminal)("does not treat %s as a waiting state", (status) => {
    expect(isWaitingStatus(status)).toBe(false);
  });

  it("PERSON_DID_NOT_ANSWER is deliberately excluded (DEC-003: a retry is owed, not automated)", () => {
    expect(WAITING_STATUSES.has("PERSON_DID_NOT_ANSWER")).toBe(false);
  });
});

describe("startPolling — starts only for waiting states", () => {
  it("polls for every waiting state", async () => {
    for (const status of WAITING_STATUSES) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status }));
      const controller = startPolling({ eventId: "event_001", status, fetchImpl });

      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchImpl).toHaveBeenCalledWith("/api/events/event_001/poll", { method: "POST" });

      controller.stop();
    }
  });

  it("never polls for a terminal status", async () => {
    const fetchImpl = vi.fn();
    const controller = startPolling({ eventId: "event_001", status: "CASE_CLOSED", fetchImpl });

    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchImpl).not.toHaveBeenCalled();

    controller.stop();
  });

  // DEC-022 REVERSED THIS. The previous version of this test asserted "does
  // not poll immediately — waits a full interval first", which meant the page
  // showed stale state for up to a full interval on mount, and again after
  // every status change (the React effect rebuilds the poller on each new
  // status, restarting the clock). A live test reported the event page felt
  // slow to update; that dead time was the controllable half of it.
  it("polls immediately on start, then on the interval", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "ATTENTION_REQUIRED" }));
    const controller = startPolling({
      eventId: "event_001",
      status: "ATTENTION_REQUIRED",
      fetchImpl,
    });

    // Before any timer has advanced at all.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("never polls faster than once per second, however small the requested interval", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "ATTENTION_REQUIRED" }));
    const controller = startPolling({
      eventId: "event_001",
      status: "ATTENTION_REQUIRED",
      intervalMs: 10,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1); // the immediate one
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    controller.stop();
  });
});

describe("startPolling — no overlapping requests", () => {
  it("skips a tick while the previous request is still in flight", async () => {
    const { fetchImpl, calls } = deferredFetch();
    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_TRUSTED_CONTACT",
      fetchImpl,
    });

    // The immediate poll fires and never resolves; several intervals elapse.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    calls[0].resolve(jsonResponse({ status: "CALLING_TRUSTED_CONTACT" }));
    await vi.advanceTimersByTimeAsync(0);

    // Now that the first request settled, the next tick may fire.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("pollNow() does not start a second overlapping request", async () => {
    const { fetchImpl, calls } = deferredFetch();
    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_TRUSTED_CONTACT",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    controller.pollNow();
    controller.pollNow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    calls[0].resolve(jsonResponse({ status: "CALLING_TRUSTED_CONTACT" }));
    await vi.advanceTimersByTimeAsync(0);

    // Once settled, an explicit pollNow runs straight away rather than
    // waiting out the interval — this is the tab-became-visible path.
    controller.pollNow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("pollNow() is inert once the poller has stopped", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "CASE_CLOSED" }));
    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_TRUSTED_CONTACT",
      fetchImpl,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // terminal, so it stopped itself

    controller.pollNow();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("startPolling — bounded backoff after failures (DEC-022)", () => {
  it("widens the delay on consecutive failures and reports the running count", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const onError = vi.fn();
    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_PERSON",
      fetchImpl,
      onError,
    });

    // Immediate poll fails → 1st failure, next delay ×2 = 4000ms.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenLastCalledWith(expect.anything(), 1);

    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(expect.anything(), 2);

    controller.stop();
  });

  it("caps the backoff rather than growing without bound", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_PERSON",
      fetchImpl,
      onError: vi.fn(),
    });

    // Drive well past the cap (×4 → 8000ms).
    for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(8000);
    const callsAfter = fetchImpl.mock.calls.length;

    // Still polling at the capped rate, not stalled forever.
    await vi.advanceTimersByTimeAsync(8000);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(callsAfter);

    controller.stop();
  });

  it("resets the backoff as soon as a poll succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(jsonResponse({ status: "CALLING_PERSON" }));
    const onError = vi.fn();
    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_PERSON",
      fetchImpl,
      onError,
    });

    await vi.advanceTimersByTimeAsync(0); // fail 1
    await vi.advanceTimersByTimeAsync(4000); // fail 2
    expect(onError).toHaveBeenLastCalledWith(expect.anything(), 2);

    await vi.advanceTimersByTimeAsync(8000); // success — resets
    const afterSuccess = fetchImpl.mock.calls.length;

    // Back to the base 2000ms cadence.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl.mock.calls.length).toBe(afterSuccess + 1);

    controller.stop();
  });
});

describe("startPolling — never starts a call or creates an event (DEC-022)", () => {
  it("only ever issues POST to the resume-only poll route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "CALLING_PERSON" }));
    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_PERSON",
      fetchImpl,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toBe("/api/events/event_001/poll");
      expect(init).toEqual({ method: "POST" });
      // Structurally incapable of reaching the endpoints that create work.
      expect(url).not.toContain("/api/events/start");
      expect(url).not.toContain("/api/people");
    }

    controller.stop();
  });
});

describe("startPolling — the UI refresh hook", () => {
  it("calls onPollSuccess with the fresh status after a successful poll", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "CALLING_TRUSTED_CONTACT" }));
    const onPollSuccess = vi.fn();

    const controller = startPolling({
      eventId: "event_001",
      status: "ATTENTION_REQUIRED",
      fetchImpl,
      onPollSuccess,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(onPollSuccess).toHaveBeenCalledWith("CALLING_TRUSTED_CONTACT");

    controller.stop();
  });
});

describe("startPolling — stops at terminal statuses", () => {
  it("stops after the response reports CASE_CLOSED", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "CASE_CLOSED" }));
    const onPollSuccess = vi.fn();

    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_TRUSTED_CONTACT",
      fetchImpl,
      onPollSuccess,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onPollSuccess).toHaveBeenCalledWith("CASE_CLOSED");

    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    controller.stop();
  });

  it("stops after the response reports HUMAN_REVIEW_REQUIRED", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "HUMAN_REVIEW_REQUIRED" }));

    const controller = startPolling({
      eventId: "event_001",
      status: "ANALYSING_CONVERSATION",
      fetchImpl,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    controller.stop();
  });

  it("keeps polling when the status is still a waiting one (cascade continuing)", async () => {
    // Models "Julie did not answer, so Marc is called automatically": the
    // status stays in the waiting set (CALLING_TRUSTED_CONTACT), so the
    // poller must not stop.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "CALLING_TRUSTED_CONTACT" }));

    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_TRUSTED_CONTACT",
      fetchImpl,
    });

    // One immediate poll (DEC-022), then one per interval.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchImpl).toHaveBeenCalledTimes(3);

    controller.stop();
  });
});

describe("startPolling — cleanup", () => {
  it("stop() prevents any further request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "ATTENTION_REQUIRED" }));

    const controller = startPolling({
      eventId: "event_001",
      status: "ATTENTION_REQUIRED",
      fetchImpl,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    controller.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stop() is safe to call more than once", () => {
    // Resolves, because the immediate first poll (DEC-022) fires during
    // startPolling itself — a bare vi.fn() returning undefined would make the
    // poller's own `.then` throw before this test could reach `stop()`.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "ATTENTION_REQUIRED" }));
    const controller = startPolling({ eventId: "event_001", status: "ATTENTION_REQUIRED", fetchImpl });
    expect(() => {
      controller.stop();
      controller.stop();
    }).not.toThrow();
  });
});

describe("startPolling — temporary errors never terminate the workflow", () => {
  it("a network rejection is reported but does not stop polling or fabricate a status", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const onError = vi.fn();
    const onPollSuccess = vi.fn();

    const controller = startPolling({
      eventId: "event_001",
      status: "ATTENTION_REQUIRED",
      fetchImpl,
      onError,
      onPollSuccess,
    });

    // The immediate poll (DEC-022) fails right away.
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onPollSuccess).not.toHaveBeenCalled();

    // The next tick still fires — a transient failure never stops the poller.
    // It arrives one backoff step later (×2), not at the base interval.
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("a non-2xx response is reported as an error, not as HUMAN_REVIEW_REQUIRED or any other status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, false));
    const onError = vi.fn();
    const onPollSuccess = vi.fn();

    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_TRUSTED_CONTACT",
      fetchImpl,
      onError,
      onPollSuccess,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onPollSuccess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("does not let a stuck in-flight request block recovery after it eventually errors", async () => {
    const { fetchImpl, calls } = deferredFetch();
    const onError = vi.fn();

    const controller = startPolling({
      eventId: "event_001",
      status: "CALLING_TRUSTED_CONTACT",
      fetchImpl,
      onError,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    calls[0].reject(new Error("network down"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    controller.stop();
  });
});

// Regression coverage for "TypeError: Failed to execute 'fetch' on 'Window':
// Illegal invocation" — the identical bug fixed in submitContactForm
// (app/people/[id]/contacts/contact-form-submit.ts), here in startPolling's
// own default. A real browser's native fetch only works when invoked as a
// plain top-level reference; assigning the captured reference to a variable
// (as the old `fetchImpl = fetch` default did) and calling it from there
// detaches it from that requirement. Node's fetch does not enforce this,
// which is why the bug passed every existing test above yet broke live.
//
// Node cannot reproduce the browser's exact internal receiver check, but it
// can faithfully reproduce the one distinction that matters: a property call
// (`obj.fn()`) supplies `obj` as `this`, while a call through a plain
// top-level reference — a bare call, or one made from inside a wrapper
// function's own body — supplies `undefined` in strict mode. That is exactly
// the difference between the buggy assignment and the fixed one, so this
// fixture requires `this === undefined` to succeed and throws otherwise.
function nativeLikeFetch(): typeof fetch {
  const impl = function (this: unknown) {
    if (this !== undefined) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(jsonResponse({ status: "CASE_CLOSED" }));
  };
  return impl as unknown as typeof fetch;
}

describe("startPolling — regression: native fetch must never be passed unbound", () => {
  it("reproduces the bug: invoking the raw reference as obj.fetchImpl(...) throws", () => {
    // Standalone proof of the root cause, independent of startPolling: this
    // is the call shape a detached assignment eventually produces elsewhere,
    // and it detaches the reference from the plain top-level call native
    // fetch requires.
    const holder = { fetchImpl: nativeLikeFetch() };
    expect(() => holder.fetchImpl("/x")).toThrow("Illegal invocation");
  });

  it("is safe by default: omitting fetchImpl entirely still succeeds against a receiver-sensitive global fetch", async () => {
    // Replaces the actual global fetch with the receiver-checking fixture, so
    // this proves startPolling's OWN internal default (defaultFetch) never
    // calls it in a detached way.
    vi.stubGlobal("fetch", nativeLikeFetch());
    const onPollSuccess = vi.fn();

    try {
      const controller = startPolling({
        eventId: "event_001",
        status: "ATTENTION_REQUIRED",
        onPollSuccess,
        // fetchImpl deliberately omitted.
      });

      await vi.advanceTimersByTimeAsync(5000);

      expect(onPollSuccess).toHaveBeenCalledWith("CASE_CLOSED");
      controller.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a caller-supplied wrapper survives detachment even when passed through another layer", async () => {
    const native = nativeLikeFetch();
    // The recommended wrapper: its body performs a fresh, direct reference to
    // `native`, so it stays safe regardless of how the wrapper itself gets
    // invoked.
    const fetchImpl: typeof fetch = (input, init) => native(input, init);
    const onPollSuccess = vi.fn();

    const controller = startPolling({
      eventId: "event_001",
      status: "ATTENTION_REQUIRED",
      fetchImpl,
      onPollSuccess,
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(onPollSuccess).toHaveBeenCalledWith("CASE_CLOSED");
    controller.stop();
  });
});
