import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWaitingStatus, startPolling, WAITING_STATUSES } from "@/app/events/[id]/event-poller";
import type { EventStatus } from "@/lib/orchestration/states";

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

  it("does not poll immediately — waits a full interval first", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "ATTENTION_REQUIRED" }));
    const controller = startPolling({
      eventId: "event_001",
      status: "ATTENTION_REQUIRED",
      fetchImpl,
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

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

    // Three interval ticks elapse before the first request ever resolves.
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    calls[0].resolve(jsonResponse({ status: "CALLING_TRUSTED_CONTACT" }));
    await vi.advanceTimersByTimeAsync(0);

    // Now that the first request settled, the next tick may fire.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

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

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

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

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    controller.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stop() is safe to call more than once", () => {
    const fetchImpl = vi.fn();
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

    await vi.advanceTimersByTimeAsync(5000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onPollSuccess).not.toHaveBeenCalled();

    // The next tick still fires — a transient failure never stops the poller.
    await vi.advanceTimersByTimeAsync(5000);
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

    await vi.advanceTimersByTimeAsync(5000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onPollSuccess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
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
