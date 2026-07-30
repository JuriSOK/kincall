import { FakeCalleAdapter, type FakeScenarioId } from "./fake-adapter";
import { LiveCalleAdapter } from "./live-adapter";
import type { TrustedContact, VulnerablePerson } from "../database/types";

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
  // 1 for the first check-in call, 2 for the bounded retry (DEC-011).
  attemptNumber: number;
}

export interface FamilyCallInput {
  eventId: string;
  // Full records for the same reason CompanionCallInput carries `person`:
  // LiveCalleAdapter needs the contact's phone and the person's name to build
  // the request, and has no repository access of its own.
  person: VulnerablePerson;
  contact: TrustedContact;
  idempotencyKey: string;
  // The complete set of facts this call is allowed to mention (§17.3).
  informationToShare: string[];
  // 1 for the first call to this contact, 2 for the bounded retry (DEC-011).
  attemptNumber: number;
  // Whether this call may leave a voicemail if it reaches one. True only on the
  // FINAL attempt to this contact AND only when the adapter declares voicemail
  // support — the orchestrator decides, so the agent is never left to guess.
  mayLeaveVoicemail: boolean;
}

// What this CALL-E integration can actually be relied on to do (DEC-011).
// Deliberately explicit rather than assumed: KinCall must never record that a
// voicemail was left unless the integration can genuinely establish it.
export interface CalleCapabilities {
  // True only if the integration can BOTH leave a voicemail and confirm through
  // a structured result that one was left. False makes the engine record
  // `voicemail_unavailable` and continue — never a claim that a message was left.
  voicemail: boolean;
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
  readonly capabilities: CalleCapabilities;
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

// `scenario` selects one of the fake-mode demo scenarios and is IGNORED in live
// mode — a live call's behaviour must never be steerable by a request parameter
// (DEC-011). The demo selector can only ever reach the fake branch, because
// CALLE_MODE is what decides which adapter exists at all.
export function getCalleAdapter(scenario?: FakeScenarioId): CalleAdapter {
  const mode = getCalleMode();
  if (mode === "live") {
    return new LiveCalleAdapter({
      apiKey: process.env.CALLE_API_KEY,
      baseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com",
      webhookUrl: process.env.CALLE_WEBHOOK_URL,
    });
  }
  return new FakeCalleAdapter({ scenario });
}
