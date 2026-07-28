import { FakeCalleAdapter } from "./fake-adapter";
import { LiveCalleAdapter } from "./live-adapter";
import type { VulnerablePerson } from "../database/types";

export type AgentType = "companion" | "family";

// Verbatim from CALL-E's CallStatus enum (calle.openapi.yaml v0.2.0).
export type CallStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

export interface CompanionCallInput {
  eventId: string;
  // Full record (not just an id) — LiveCalleAdapter needs the phone number,
  // language and profile to build the CALL-E request; the adapter has no
  // repository access of its own.
  person: VulnerablePerson;
  idempotencyKey: string;
}

export interface FamilyCallInput {
  personId: string;
  contactId: string;
  idempotencyKey: string;
  informationToShare: string[];
}

export interface CallReference {
  callId: string;
  idempotencyKey: string;
}

export interface CallResult {
  callId: string;
  agentType: AgentType;
  status: CallStatus;
  // Raw structured result as CALL-E would return it over the wire — validate
  // with lib/calle/schemas.ts before use (TECHNICAL_ARCHITECTURE.md §5: the
  // orchestrator must not freely reinterpret an unvalidated result). null
  // while status is not "completed".
  structuredResult: unknown;
  failureCode: string | null;
  failureMessage: string | null;
}

// Per TECHNICAL_ARCHITECTURE.md §7. FakeCalleAdapter is the only
// implementation in Phase 2; LiveCalleAdapter is added in Phase 3 behind
// this same interface.
export interface CalleAdapter {
  startCompanionCall(input: CompanionCallInput): Promise<CallReference>;
  startFamilyCall(input: FamilyCallInput): Promise<CallReference>;
  getCallResult(callId: string): Promise<CallResult>;
}

export type CalleMode = "fake" | "live";

export function getCalleMode(): CalleMode {
  const mode = process.env.CALLE_MODE ?? "fake";
  if (mode !== "fake" && mode !== "live") {
    throw new Error(`Invalid CALLE_MODE "${mode}". Expected "fake" or "live".`);
  }
  return mode;
}

export function getCalleAdapter(): CalleAdapter {
  const mode = getCalleMode();
  if (mode === "live") {
    return new LiveCalleAdapter({
      apiKey: process.env.CALLE_API_KEY,
      baseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com",
      webhookUrl: process.env.CALLE_WEBHOOK_URL,
    });
  }
  return new FakeCalleAdapter();
}
