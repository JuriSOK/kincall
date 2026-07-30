import { describe, expect, it } from "vitest";
import { submitScheduleToggle } from "@/app/(app)/people/[id]/schedule-toggle-submit";

describe("submitScheduleToggle — pause and resume, both as success", () => {
  it("succeeds when pausing (scheduleState: paused)", async () => {
    let sentBody: unknown;
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const result = await submitScheduleToggle("paused", { personId: "person_marie", fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(sentBody).toEqual({ scheduleState: "paused" });
  });

  it("succeeds when resuming (scheduleState: active), sending exactly one field", async () => {
    let sentBody: unknown;
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const result = await submitScheduleToggle("active", { personId: "person_marie", fetchImpl });

    expect(result.ok).toBe(true);
    // Exactly the one field this control ever changes — never a second,
    // divergent write path touching anything else.
    expect(sentBody).toEqual({ scheduleState: "active" });
  });
});

describe("submitScheduleToggle — server rejection", () => {
  it("surfaces the server's field errors on a non-2xx response", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ errors: { scheduleState: "Invalid state." } }), { status: 400 });

    const result = await submitScheduleToggle("paused", { personId: "person_marie", fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ scheduleState: "Invalid state." });
  });
});

describe("submitScheduleToggle — a thrown fetch is a reported outcome, not an escape", () => {
  it("reports a network failure via networkError, restoring the caller's control", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };

    const result = await submitScheduleToggle("paused", { personId: "person_marie", fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.networkError).toMatch(/could not reach the server/i);
    expect(result.errors).toEqual({});
  });
});
