import { buildCompanionTask, companionResultSchema } from "@/prompts/companion-agent";
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

// Implements CalleAdapter against CALL-E's real REST API
// (calle.openapi.yaml v0.2.0) via the platform fetch — no SDK dependency,
// staying literal to CLAUDE.md's "CALL-E REST API" baseline.
export class LiveCalleAdapter implements CalleAdapter {
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
    const body: Record<string, unknown> = {
      task: buildCompanionTask(input.person),
      recipients: [
        {
          phones: [input.person.phone],
          locale: input.person.preferredLanguage,
        },
      ],
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

  async startFamilyCall(_input: FamilyCallInput): Promise<CallReference> {
    throw new Error("LiveCalleAdapter.startFamilyCall is not implemented until Phase 4.");
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
