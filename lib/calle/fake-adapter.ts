import { randomUUID } from "node:crypto";
import type {
  AgentType,
  CalleAdapter,
  CallReference,
  CallResult,
  CompanionCallInput,
  FamilyCallInput,
} from "./adapter";
import type { CompanionStructuredResult, FamilyStructuredResult } from "./schemas";

// Canned scenarios matching the Marie / Julie / Marc demo
// (PRODUCT_SPECIFICATION.md §12, §14.3, §22). Companion shape is the flat
// categorical result_schema (DEC-002), not §9.1's nested signals[] array.
const COMPANION_SCENARIOS: Record<string, CompanionStructuredResult> = {
  person_marie: {
    conversation_summary:
      "Marie mentioned that she fell yesterday and currently has difficulty walking.",
    person_reached: "yes",
    fall_mentioned: "yes",
    mobility_difficulty: "yes",
    person_requests_help: "no",
    person_does_not_want_to_disturb_family: "yes",
    conversation_shorter_than_usual: "no",
    unusual_confusion: "no",
    recommended_attention_level: "high",
  },
};

const FAMILY_SCENARIOS: Record<string, FamilyStructuredResult> = {
  contact_julie: {
    contact_id: "contact_julie",
    answered: "no",
    situation_understood: "unknown",
    can_intervene: "no",
    // Sentinels, not nulls (DEC-005): a no-answer must still be a schema-valid
    // result, otherwise an ordinary cascade step looks malformed.
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: "Julie did not answer.",
  },
  contact_marc: {
    contact_id: "contact_marc",
    answered: "yes",
    situation_understood: "yes",
    can_intervene: "yes",
    intervention_type: "visit",
    estimated_time: "17:30",
    contact_next_person: "no",
    summary: "Marc confirmed that he will visit Marie at 17:30.",
  },
};

const CALL_ID_PATTERN = /^fake_(companion|family)_(.+)_([0-9a-f-]{36})$/;

function encodeCallId(agentType: AgentType, subjectId: string): string {
  return `fake_${agentType}_${subjectId}_${randomUUID()}`;
}

function decodeCallId(callId: string): { agentType: AgentType; subjectId: string } {
  const match = CALL_ID_PATTERN.exec(callId);
  if (!match) {
    throw new Error(`FakeCalleAdapter: cannot parse callId "${callId}".`);
  }
  return { agentType: match[1] as AgentType, subjectId: match[2] };
}

// Stateless by design: the subject id is encoded directly in the callId, so
// getCallResult never depends on adapter-instance identity (safe across
// Next.js dev-server HMR reloads without any singleton/global caching).
export class FakeCalleAdapter implements CalleAdapter {
  async startCompanionCall(input: CompanionCallInput): Promise<CallReference> {
    return {
      callId: encodeCallId("companion", input.person.id),
      idempotencyKey: input.idempotencyKey,
    };
  }

  async startFamilyCall(input: FamilyCallInput): Promise<CallReference> {
    return {
      callId: encodeCallId("family", input.contact.id),
      idempotencyKey: input.idempotencyKey,
    };
  }

  async getCallResult(callId: string): Promise<CallResult> {
    const { agentType, subjectId } = decodeCallId(callId);
    const structuredResult =
      agentType === "companion" ? COMPANION_SCENARIOS[subjectId] : FAMILY_SCENARIOS[subjectId];

    if (!structuredResult) {
      throw new Error(
        `FakeCalleAdapter: no canned scenario for ${agentType} call to "${subjectId}".`
      );
    }

    return { callId, agentType, status: "completed", structuredResult, failureCode: null, failureMessage: null };
  }
}
