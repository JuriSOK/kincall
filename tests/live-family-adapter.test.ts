import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveCalleAdapter } from "@/lib/calle/live-adapter";
import type { TrustedContact, VulnerablePerson } from "@/lib/database/types";
import { RESERVED_FICTION_PHONES } from "@/lib/phone";

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
    archivedAt: null,
    ...overrides,
  };
}

function contact(overrides: Partial<TrustedContact> = {}): TrustedContact {
  return {
    id: "contact_julie",
    personId: "person_marie",
    firstName: "Julie",
    phone: "+33698765432",
    relationship: "daughter",
    priority: 1,
    consentStatus: "confirmed",
    archivedAt: null,
    ...overrides,
  };
}

function adapter(webhookUrl?: string): LiveCalleAdapter {
  return new LiveCalleAdapter({
    apiKey: "test_key",
    baseUrl: "https://api.heycall-e.com",
    webhookUrl,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function queuedCall() {
  return jsonResponse(
    { id: "call_fam_1", status: "queued", structured_result: null, failure_code: null, failure_message: null },
    201
  );
}

describe("LiveCalleAdapter.startFamilyCall", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the expected request shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(queuedCall());
    vi.stubGlobal("fetch", fetchMock);

    const reference = await adapter("https://kincall.example.com/api/webhooks/calle").startFamilyCall({
      eventId: "event_001",
      person: person(),
      contact: contact(),
      idempotencyKey: "run_abc_contact_julie_attempt_1",
      informationToShare: ["mentioned a fall", "described difficulty moving around"],
      attemptNumber: 1,
      mayLeaveVoicemail: false,
    });

    expect(reference).toEqual({
      callId: "call_fam_1",
      idempotencyKey: "run_abc_contact_julie_attempt_1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.heycall-e.com/v1/calls");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test_key");
    expect(headers["Idempotency-Key"]).toBe("run_abc_contact_julie_attempt_1");

    const body = JSON.parse(init.body as string);
    // One recipient per call, never a batch — cascade ordering and
    // stop-on-confirmation stay under KinCall's control.
    expect(body.recipients).toEqual([
      { phones: ["+33698765432"], locale: "fr-FR", region: "FR" },
    ]);
    expect(body.webhook_url).toBe("https://kincall.example.com/api/webhooks/calle");
    expect(body.metadata).toEqual({
      kincall_event_id: "event_001",
      kincall_idempotency_key: "run_abc_contact_julie_attempt_1",
      kincall_agent_type: "family",
      kincall_contact_id: "contact_julie",
    });
    expect(typeof body.task).toBe("string");
    expect(body.result_schema.required).toContain("can_intervene");
  });

  it("pins the result schema's contact_id to the KinCall-selected contact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(queuedCall());
    vi.stubGlobal("fetch", fetchMock);

    await adapter().startFamilyCall({
      eventId: "event_001",
      person: person(),
      contact: contact({ id: "contact_marc", firstName: "Marc" }),
      idempotencyKey: "key",
      informationToShare: [],
      attemptNumber: 1,
      mayLeaveVoicemail: false,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.result_schema.properties.contact_id.description).toContain("contact_marc");
  });

  it("never puts the contact's phone number in the task text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(queuedCall());
    vi.stubGlobal("fetch", fetchMock);

    await adapter().startFamilyCall({
      eventId: "event_001",
      person: person(),
      contact: contact(),
      idempotencyKey: "key",
      informationToShare: ["mentioned a fall"],
      attemptNumber: 1,
      mayLeaveVoicemail: false,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.task).not.toContain("+33698765432");
    expect(body.task).not.toContain("698765432");
  });

  it("refuses a non-E.164 contact number before calling CALL-E, and masks it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const call = adapter().startFamilyCall({
      eventId: "event_001",
      person: person(),
      contact: contact({ phone: "+33 6 98 76 54 32" }),
      idempotencyKey: "key",
      informationToShare: [],
      attemptNumber: 1,
      mayLeaveVoicemail: false,
    });

    const error = (await call.catch((thrown: unknown) => thrown)) as Error;
    expect(error.message).toMatch(/Julie/);
    expect(error.message).toMatch(/KINCALL_JULIE_PHONE/);
    expect(error.message).not.toContain("698765432");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a reserved-for-fiction contact number left by an unset env var", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const call = adapter().startFamilyCall({
      eventId: "event_001",
      person: person(),
      contact: contact({ phone: RESERVED_FICTION_PHONES.julie }),
      idempotencyKey: "key",
      informationToShare: [],
      attemptNumber: 1,
      mayLeaveVoicemail: false,
    });

    const error = (await call.catch((thrown: unknown) => thrown)) as Error;
    expect(error.message).toMatch(/reserved-for-fiction/);
    expect(error.message).toMatch(/KINCALL_JULIE_PHONE/);
    expect(error.message).not.toContain(RESERVED_FICTION_PHONES.julie);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves agentType 'family' from the echoed metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: "call_fam_1",
          status: "completed",
          structured_result: { contact_id: "contact_julie" },
          failure_code: null,
          failure_message: null,
          metadata: { kincall_agent_type: "family" },
        })
      )
    );

    const result = await adapter().getCallResult("call_fam_1");
    expect(result.agentType).toBe("family");
    expect(result.status).toBe("completed");
  });
});
