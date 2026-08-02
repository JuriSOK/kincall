import { buildCompanionTask, companionResultSchema } from "@/prompts/companion-agent";
import { buildFamilyResultSchema, buildFamilyTask } from "@/prompts/family-agent";
import { phoneEnvVarFor } from "../database/seed";
import { describeUnusablePhone } from "../phone";
import type {
  AgentType,
  CalleAdapter,
  CallReference,
  CallResult,
  CallStatus,
  CompanionCallInput,
  FamilyCallInput,
} from "./adapter";

export interface LiveCalleAdapterConfig {
  apiKey: string | undefined;
  baseUrl: string;
  webhookUrl: string | undefined;
}

// Distinguishes CALL-E's documented error codes (idempotency_conflict,
// rate_limit_exceeded, etc.) from a generic thrown Error.
export class CalleApiError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details: unknown) {
    super(message);
    this.name = "CalleApiError";
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: unknown }).error !== null
  );
}

interface CallTaskResponse {
  id: string;
  status: CallStatus;
  structured_result: unknown;
  failure_code: string | null;
  failure_message: string | null;
  metadata?: Record<string, unknown>;
}

// 429/5xx only — everything else (4xx validation errors, idempotency
// conflicts, etc.) is not safe or useful to retry.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// CALL-E's `locale` is a BCP 47 tag (fr-FR); its `region` is the country code
// used for routing and compliance checks (FR). Derive rather than hardcode so
// a person configured in another locale routes correctly.
function regionFromLocale(locale: string): string | undefined {
  const region = locale.split("-")[1];
  return region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : undefined;
}

// Implements CalleAdapter against CALL-E's real REST API
// (calle.openapi.yaml v0.2.0) via the platform fetch — no SDK dependency,
// staying literal to CLAUDE.md's "CALL-E REST API" baseline.
export class LiveCalleAdapter implements CalleAdapter {
  // Voicemail support is NOT claimed, because CALL-E's own API contract does not
  // provide it (DEC-011). Checked against calle.openapi.yaml v0.2.0:
  //
  //   * `CallStatus` is queued | in_progress | completed | failed | canceled,
  //     and `AttemptStatus` adds only `dialing` — neither has a voicemail or
  //     answering-machine state, so a voicemail is indistinguishable from a
  //     no-answer at the platform level.
  //   * There is no answering-machine-detection field anywhere in the schema.
  //   * `failure_code` is an untyped free-form string with no documented
  //     enumeration, so it cannot be relied on to mean "voicemail".
  //   * Nothing in the API confirms that a message was recorded.
  //
  // The agent can still be *told* to leave a message if it hears a voicemail —
  // and the Companion prompt does exactly that — but a model self-report is not
  // a confirmation, and KinCall must never assert something it cannot establish
  // (§7.5). So the engine records `voicemail_unavailable` in live mode and
  // continues deterministically to the next contact. Flip this to true only when
  // CALL-E genuinely documents a voicemail-confirmation mechanism.
  readonly capabilities = { voicemail: false } as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly webhookUrl: string | undefined;

  constructor(config: LiveCalleAdapterConfig) {
    if (!config.apiKey) {
      throw new Error(
        "CALLE_MODE=live requires CALLE_API_KEY. Obtain a key from " +
          "dashboard.heycall-e.com/account/api-keys."
      );
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.webhookUrl = config.webhookUrl;
  }

  async startCompanionCall(input: CompanionCallInput): Promise<CallReference> {
    // Last line of defence — the orchestrator pre-flights the same check before
    // transitioning, so reaching this throw means something bypassed it. Fails
    // before any fetch, so no call credit is spent and no unconsenting number
    // is ever dialled. The number stays masked in the message.
    this.assertDialable(input.person.phone, input.person.id, input.person.firstName, "Companion");

    const region = regionFromLocale(input.person.preferredLanguage);
    const recipient: Record<string, unknown> = {
      phones: [input.person.phone],
      locale: input.person.preferredLanguage,
    };
    if (region) {
      recipient.region = region;
    }

    const body: Record<string, unknown> = {
      task: buildCompanionTask(input.person),
      recipients: [recipient],
      result_schema: companionResultSchema,
      metadata: {
        kincall_event_id: input.eventId,
        kincall_idempotency_key: input.idempotencyKey,
        kincall_agent_type: "companion",
      },
    };
    if (this.webhookUrl) {
      body.webhook_url = this.webhookUrl;
    }

    const callTask = await this.request<CallTaskResponse>(
      "POST",
      "/v1/calls",
      body,
      input.idempotencyKey
    );
    return { callId: callTask.id, idempotencyKey: input.idempotencyKey };
  }

  async startFamilyCall(input: FamilyCallInput): Promise<CallReference> {
    this.assertDialable(
      input.contact.phone,
      input.contact.id,
      input.contact.firstName,
      "Family"
    );

    // TrustedContact has no language field in the frozen §16 schema, so the
    // call inherits the vulnerable person's locale (see DEC-005).
    const region = regionFromLocale(input.person.preferredLanguage);
    const recipient: Record<string, unknown> = {
      phones: [input.contact.phone],
      locale: input.person.preferredLanguage,
    };
    if (region) {
      recipient.region = region;
    }

    const body: Record<string, unknown> = {
      task: buildFamilyTask(
        input.person,
        input.contact,
        input.informationToShare,
        {
          // Always false here in practice: `capabilities.voicemail` is false, so
          // the orchestrator never sets this. Passed through rather than
          // hardcoded so the decision stays in one place.
          mayLeaveVoicemail: input.mayLeaveVoicemail,
          attemptNumber: input.attemptNumber,
        },
        // DEC-022. Undefined for a caller that predates the brief; the prompt
        // then renders exactly as it did before.
        input.contextBrief
      ),
      recipients: [recipient],
      result_schema: buildFamilyResultSchema(input.contact.id),
      metadata: {
        kincall_event_id: input.eventId,
        kincall_idempotency_key: input.idempotencyKey,
        kincall_agent_type: "family",
        kincall_contact_id: input.contact.id,
      },
    };
    if (this.webhookUrl) {
      body.webhook_url = this.webhookUrl;
    }

    const callTask = await this.request<CallTaskResponse>(
      "POST",
      "/v1/calls",
      body,
      input.idempotencyKey
    );
    return { callId: callTask.id, idempotencyKey: input.idempotencyKey };
  }

  private assertDialable(
    phone: string,
    subjectId: string,
    firstName: string,
    agent: "Companion" | "Family"
  ): void {
    const problem = describeUnusablePhone(phone, phoneEnvVarFor(subjectId));
    if (problem) {
      throw new Error(`Cannot place a live ${agent} call to ${firstName}: ${problem}`);
    }
  }

  async getCallResult(callId: string): Promise<CallResult> {
    const callTask = await this.request<CallTaskResponse>("GET", `/v1/calls/${callId}`);
    const agentType: AgentType =
      callTask.metadata?.kincall_agent_type === "family" ? "family" : "companion";

    return {
      callId: callTask.id,
      agentType,
      status: callTask.status,
      structuredResult: callTask.structured_result,
      failureCode: callTask.failure_code,
      failureMessage: callTask.failure_message,
    };
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const payload: unknown = await response.json().catch(() => null);
      const envelope = isErrorEnvelope(payload) ? payload.error : null;
      const error = new CalleApiError(
        envelope?.code ?? "unknown_error",
        envelope?.message ?? `CALL-E request failed with status ${response.status}.`,
        envelope?.details
      );

      const retryable = RETRYABLE_STATUS_CODES.has(response.status);
      if (!retryable || attempt === MAX_RETRIES) {
        throw error;
      }
      lastError = error;
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    }

    throw lastError instanceof Error ? lastError : new Error("CALL-E request failed.");
  }
}
