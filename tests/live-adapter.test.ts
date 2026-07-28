import { afterEach, describe, expect, it, vi } from "vitest";
import { CalleApiError, LiveCalleAdapter } from "@/lib/calle/live-adapter";
import { RESERVED_FICTION_PHONES } from "@/lib/phone";
import type { VulnerablePerson } from "@/lib/database/types";

function person(overrides: Partial<VulnerablePerson> = {}): VulnerablePerson {
  return {
    id: "person_marie",
    firstName: "Marie",
    phone: "+33612345678",
    preferredLanguage: "fr-FR",
    conversationProfile: "cognitive_friendly",
    preferredCallTime: "09:00",
    interests: ["gardening"],
    consentStatus: "confirmed",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LiveCalleAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws if constructed without an API key", () => {
    expect(
      () =>
        new LiveCalleAdapter({
          apiKey: undefined,
          baseUrl: "https://api.heycall-e.com",
          webhookUrl: undefined,
        })
    ).toThrow(/CALLE_API_KEY/);
  });

  it("sends the expected request shape for startCompanionCall", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: "call_123",
          status: "queued",
          structured_result: null,
          failure_code: null,
          failure_message: null,
        },
        201
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveCalleAdapter({
      apiKey: "test_key",
      baseUrl: "https://api.heycall-e.com",
      webhookUrl: "https://kincall.example.com/api/webhooks/calle",
    });

    const reference = await adapter.startCompanionCall({
      eventId: "event_001",
      person: person(),
      idempotencyKey: "event_001_companion_attempt_1",
    });

    expect(reference).toEqual({
      callId: "call_123",
      idempotencyKey: "event_001_companion_attempt_1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.heycall-e.com/v1/calls");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test_key");
    expect(headers["Idempotency-Key"]).toBe("event_001_companion_attempt_1");

    const body = JSON.parse(init.body as string);
    expect(body.recipients).toEqual([
      { phones: ["+33612345678"], locale: "fr-FR", region: "FR" },
    ]);
    expect(body.webhook_url).toBe("https://kincall.example.com/api/webhooks/calle");
    expect(body.metadata).toEqual({
      kincall_event_id: "event_001",
      kincall_idempotency_key: "event_001_companion_attempt_1",
      kincall_agent_type: "companion",
    });
    expect(typeof body.task).toBe("string");
    expect(body.result_schema.required).toContain("fall_mentioned");
  });

  it("omits webhook_url when none is configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { id: "call_123", status: "queued", structured_result: null, failure_code: null, failure_message: null },
          201
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveCalleAdapter({
      apiKey: "test_key",
      baseUrl: "https://api.heycall-e.com",
      webhookUrl: undefined,
    });

    await adapter.startCompanionCall({
      eventId: "event_001",
      person: person(),
      idempotencyKey: "key",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.webhook_url).toBeUndefined();
  });

  it("refuses a non-E.164 number without calling CALL-E, and masks it in the error", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveCalleAdapter({
      apiKey: "test_key",
      baseUrl: "https://api.heycall-e.com",
      webhookUrl: undefined,
    });

    const call = adapter.startCompanionCall({
      eventId: "event_001",
      person: person({ phone: "+33 6 12 34 56 78" }),
      idempotencyKey: "key",
    });

    const error = (await call.catch((thrown: unknown) => thrown)) as Error;
    expect(error.message).toMatch(/KINCALL_DEMO_PHONE/);
    expect(error.message).toContain("+33");
    expect(error.message).not.toContain("612345678");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("omits region when the locale carries no region subtag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { id: "call_123", status: "queued", structured_result: null, failure_code: null, failure_message: null },
        201
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveCalleAdapter({
      apiKey: "test_key",
      baseUrl: "https://api.heycall-e.com",
      webhookUrl: undefined,
    });

    await adapter.startCompanionCall({
      eventId: "event_001",
      person: person({ preferredLanguage: "fr" }),
      idempotencyKey: "key",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.recipients[0].region).toBeUndefined();
  });

  it("maps a non-terminal call status through getCallResult", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: "call_123",
          status: "in_progress",
          structured_result: null,
          failure_code: null,
          failure_message: null,
          metadata: { kincall_agent_type: "companion" },
        })
      )
    );

    const adapter = new LiveCalleAdapter({
      apiKey: "test_key",
      baseUrl: "https://api.heycall-e.com",
      webhookUrl: undefined,
    });
    const result = await adapter.getCallResult("call_123");

    expect(result.status).toBe("in_progress");
    expect(result.structuredResult).toBeNull();
    expect(result.agentType).toBe("companion");
  });

  it("maps a completed call's structured_result through getCallResult", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: "call_123",
          status: "completed",
          structured_result: { fall_mentioned: "yes" },
          failure_code: null,
          failure_message: null,
          metadata: { kincall_agent_type: "companion" },
        })
      )
    );

    const adapter = new LiveCalleAdapter({
      apiKey: "test_key",
      baseUrl: "https://api.heycall-e.com",
      webhookUrl: undefined,
    });
    const result = await adapter.getCallResult("call_123");

    expect(result.status).toBe("completed");
    expect(result.structuredResult).toEqual({ fall_mentioned: "yes" });
  });

  it("throws a CalleApiError exposing the error envelope's code on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: "invalid_phone", message: "Bad phone number." } }, 422)
        )
    );

    const adapter = new LiveCalleAdapter({
      apiKey: "test_key",
      baseUrl: "https://api.heycall-e.com",
      webhookUrl: undefined,
    });

    const call = adapter.startCompanionCall({
      eventId: "event_001",
      person: person(),
      idempotencyKey: "key",
    });
    await expect(call).rejects.toBeInstanceOf(CalleApiError);
    await expect(call).rejects.toMatchObject({ code: "invalid_phone", message: "Bad phone number." });
  });

  it("does not retry a non-retryable 422 response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: "invalid_phone", message: "Bad phone number." } }, 422)
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveCalleAdapter({
      apiKey: "test_key",
      baseUrl: "https://api.heycall-e.com",
      webhookUrl: undefined,
    });

    await expect(
      adapter.startCompanionCall({ eventId: "event_001", person: person(), idempotencyKey: "key" })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a reserved-for-fiction number, which an unset env var leaves in place", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveCalleAdapter({
      apiKey: "test_key",
      baseUrl: "https://api.heycall-e.com",
      webhookUrl: undefined,
    });

    // Structurally valid E.164 — only the reserved-set check catches it.
    const call = adapter.startCompanionCall({
      eventId: "event_001",
      person: person({ phone: RESERVED_FICTION_PHONES.marie }),
      idempotencyKey: "key",
    });

    const error = (await call.catch((thrown: unknown) => thrown)) as Error;
    expect(error.message).toMatch(/reserved-for-fiction/);
    expect(error.message).toMatch(/KINCALL_DEMO_PHONE/);
    expect(error.message).not.toContain(RESERVED_FICTION_PHONES.marie);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
