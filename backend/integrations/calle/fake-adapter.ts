import { randomUUID } from "node:crypto";
import type {
  AgentType,
  CalleAdapter,
  CallReference,
  CallResult,
  CompanionCallInput,
  FamilyCallInput,
  PersonNotificationCallInput,
} from "./adapter";
import type {
  CompanionStructuredResult,
  FamilyStructuredResult,
  PersonNotificationStructuredResult,
} from "./schemas";

// Canned scenarios for fake mode. Each one exercises a different autonomous path
// end to end without placing a single real call (DEC-011). They are DEMO DATA:
// nothing here is ever used in live mode, and CALLE_MODE=fake is what selects
// this adapter at all.
//
// Results are functions of (subject, attempt) because DEC-011 introduced bounded
// retries: "Julie did not answer" and "Julie did not answer again, and this time
// a voicemail was left" are different results for the same contact.

const FALL_AND_MOBILITY: CompanionStructuredResult = {
  neutral_summary:
    "Marie said she fell yesterday and is finding it difficult to walk today.",
  person_reached: "yes",
  explicit_help_requested: "no",
  fall_mentioned: "yes",
  mobility_difficulty: "yes",
  pain_or_injury_mentioned: "unknown",
  unusual_confusion: "no",
  distress_expressed: "no",
  conversation_ended_normally: "yes",
  does_not_want_to_disturb_family: "yes",
  other_attention_signal: "no",
  attention_required: "yes",
  attention_reasons: ["fall", "mobility_difficulty"],
  confidence: "high",
};

const EXPLICIT_HELP: CompanionStructuredResult = {
  neutral_summary: "Marie asked KinCall to let someone in her family know she needs help.",
  person_reached: "yes",
  explicit_help_requested: "yes",
  fall_mentioned: "no",
  mobility_difficulty: "no",
  pain_or_injury_mentioned: "no",
  unusual_confusion: "no",
  distress_expressed: "no",
  conversation_ended_normally: "yes",
  does_not_want_to_disturb_family: "no",
  other_attention_signal: "no",
  // Deliberately "no": the deterministic rule must still cascade on the
  // explicit request alone, overriding the model's own attention_required.
  attention_required: "no",
  attention_reasons: ["explicit_help_request"],
  confidence: "high",
};

const OTHER_INCIDENT: CompanionStructuredResult = {
  neutral_summary:
    "Marie said her shoulder is hurting since she knocked it, and that she has been feeling low about it.",
  person_reached: "yes",
  explicit_help_requested: "no",
  fall_mentioned: "no",
  mobility_difficulty: "no",
  pain_or_injury_mentioned: "yes",
  unusual_confusion: "no",
  distress_expressed: "yes",
  conversation_ended_normally: "yes",
  does_not_want_to_disturb_family: "yes",
  other_attention_signal: "no",
  attention_required: "yes",
  attention_reasons: ["pain_or_injury", "distress"],
  confidence: "medium",
};

// A voicemail: the call completed, but no conversation happened, so every signal
// is genuinely unknown rather than "no" (DEC-003's whole point).
const NOT_REACHED: CompanionStructuredResult = {
  neutral_summary: "The call reached voicemail rather than a conversation with Marie.",
  person_reached: "no",
  explicit_help_requested: "unknown",
  fall_mentioned: "unknown",
  mobility_difficulty: "unknown",
  pain_or_injury_mentioned: "unknown",
  unusual_confusion: "unknown",
  distress_expressed: "unknown",
  conversation_ended_normally: "unknown",
  does_not_want_to_disturb_family: "unknown",
  other_attention_signal: "unknown",
  attention_required: "unknown",
  attention_reasons: ["person_not_reached"],
  confidence: "low",
};

function noAnswer(contactId: string, voicemailLeft: "yes" | "no"): FamilyStructuredResult {
  return {
    contact_id: contactId,
    answered: "no",
    situation_understood: "unknown",
    can_intervene: "no",
    // Sentinels, not nulls (DEC-005): a no-answer must still be a schema-valid
    // result, otherwise an ordinary cascade step looks malformed.
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: voicemailLeft === "yes" ? "No answer; a voicemail was left." : "No answer.",
    voicemail_left: voicemailLeft,
  };
}

function confirms(
  contactId: string,
  firstName: string,
  time: string
): FamilyStructuredResult {
  return {
    contact_id: contactId,
    answered: "yes",
    situation_understood: "yes",
    can_intervene: "yes",
    intervention_type: "visit",
    estimated_time: time,
    contact_next_person: "no",
    summary: `${firstName} confirmed a visit to Marie at ${time}.`,
    voicemail_left: "no",
  };
}

function declines(contactId: string, firstName: string): FamilyStructuredResult {
  return {
    contact_id: contactId,
    answered: "yes",
    situation_understood: "yes",
    can_intervene: "no",
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: `${firstName} cannot check in today.`,
    voicemail_left: "no",
  };
}

// DEC-023. The three deterministic outcomes of the informational callback.
// Exported so a test can assert against the exact object the engine persisted
// rather than re-declaring it and drifting.
export const NOTIFICATION_DELIVERED: PersonNotificationStructuredResult = {
  person_reached: "yes",
  message_delivered: "yes",
  summary: "The follow-up message was passed on.",
};

export const NOTIFICATION_NOT_ANSWERED: PersonNotificationStructuredResult = {
  person_reached: "no",
  message_delivered: "no",
  summary: "The call was not answered.",
};

export interface FakeScenario {
  // Shown in the fake-mode scenario selector.
  label: string;
  description: string;
  // Whether THIS scenario's CALL-E integration is pretending to support
  // voicemail. Exposed as the adapter's capability so the unsupported-fallback
  // path is demonstrable without editing code.
  voicemail: boolean;
  companion(attemptNumber: number): CompanionStructuredResult;
  family(contactId: string, attemptNumber: number): FamilyStructuredResult;
  // DEC-023. The single informational callback to the monitored person. Every
  // scenario delivers it by default (`NOTIFICATION_DELIVERED`), because the
  // interesting demo outcome is the cascade, not this call. The unanswered and
  // technically-failed variants exist so tests can prove the terminal status is
  // reached regardless — see tests/person-notification.test.ts. Optional so a
  // scenario that says nothing about it keeps the delivered default.
  notification?(): PersonNotificationStructuredResult | "failed";
}

// Explicit union rather than `keyof typeof`: the annotation below is what gives
// `companion`/`family` their real call signatures (an `as const` object would
// narrow them to zero-argument functions).
export type FakeScenarioId =
  | "marie_baseline"
  | "explicit_help"
  | "other_incident"
  | "person_unreachable"
  | "all_contacts_unavailable";

export const FAKE_SCENARIOS: Record<FakeScenarioId, FakeScenario> = {
  // 1. The frozen §12 demo, updated for the bounded per-contact retry: Julie is
  //    now called twice before Marc, and the second call leaves a voicemail.
  marie_baseline: {
    label: "Marie baseline — fall and mobility difficulty",
    description:
      "Marie mentions a fall and difficulty walking. Julie does not answer twice (voicemail left on the second call), then Marc confirms a visit and the case closes.",
    voicemail: true,
    companion: () => FALL_AND_MOBILITY,
    family: (contactId, attempt) => {
      if (contactId === "contact_julie") return noAnswer(contactId, attempt >= 2 ? "yes" : "no");
      if (contactId === "contact_marc") return confirms(contactId, "Marc", "17:30");
      return noAnswer(contactId, "no");
    },
  },

  // 2. No fall at all: the person explicitly asks for someone to be contacted.
  explicit_help: {
    label: "Explicit help request — no fall",
    description:
      "Marie explicitly asks KinCall to contact someone, with no fall and no mobility difficulty. The cascade starts anyway and Julie confirms.",
    voicemail: true,
    companion: () => EXPLICIT_HELP,
    family: (contactId) =>
      contactId === "contact_julie"
        ? confirms(contactId, "Julie", "this afternoon")
        : noAnswer(contactId, "no"),
  },

  // 3. Something that is not a fall and not an explicit request.
  other_incident: {
    label: "Other incident — pain and distress",
    description:
      "Marie describes pain and feeling low, with no fall. The cascade starts because attention is needed, and Julie confirms.",
    voicemail: true,
    companion: () => OTHER_INCIDENT,
    family: (contactId) =>
      contactId === "contact_julie"
        ? confirms(contactId, "Julie", "this evening")
        : noAnswer(contactId, "no"),
  },

  // 4. The person cannot be reached at all: one retry, then the circle.
  person_unreachable: {
    label: "Person unreachable — two attempts",
    description:
      "Marie does not answer either check-in attempt. KinCall stops calling her and contacts the trusted circle instead.",
    voicemail: true,
    companion: () => NOT_REACHED,
    family: (contactId) =>
      contactId === "contact_julie"
        ? confirms(contactId, "Julie", "within the hour")
        : noAnswer(contactId, "no"),
  },

  // 5. The autonomous dead end: everybody is tried twice and nobody helps.
  //    Voicemail is unsupported here, so the fallback is demonstrable.
  all_contacts_unavailable: {
    label: "All contacts unavailable — unresolved",
    description:
      "Marie mentions a fall. Every trusted contact is called twice and either declines or does not answer; voicemail is unsupported in this scenario. The event ends as unresolved.",
    voicemail: false,
    companion: () => FALL_AND_MOBILITY,
    family: (contactId) =>
      contactId === "contact_marc"
        ? declines(contactId, "Marc")
        : noAnswer(contactId, "no"),
  },
};

export const DEFAULT_FAKE_SCENARIO: FakeScenarioId = "marie_baseline";

// The seeded demo person every scenario is written about (§12's Marie). A
// companion call to anyone else has no canned script and is refused.
const DEMO_PERSON_ID = "person_marie";

export function isFakeScenarioId(value: unknown): value is FakeScenarioId {
  return typeof value === "string" && value in FAKE_SCENARIOS;
}

// Scenario and attempt travel INSIDE the callId, so getCallResult stays stateless
// and a result can still be resolved after a restart by an adapter instance that
// shares none of this one's memory.
//
// The optional `<scenario>#<attempt>_` group keeps the pre-DEC-011 three-part
// form (`fake_companion_person_marie_<uuid>`) parseable, which several tests and
// any already-persisted fake call id still use — those default to attempt 1 and
// the default scenario.
const CALL_ID_PATTERN =
  /^fake_(companion|family|person_notification)_(?:([a-z_]+)#(\d+)_)?(.+)_([0-9a-f-]{36})$/;

function encodeCallId(
  agentType: AgentType,
  subjectId: string,
  scenario: FakeScenarioId,
  attemptNumber: number
): string {
  return `fake_${agentType}_${scenario}#${attemptNumber}_${subjectId}_${randomUUID()}`;
}

interface DecodedCallId {
  agentType: AgentType;
  subjectId: string;
  scenario: FakeScenarioId;
  attemptNumber: number;
}

function decodeCallId(callId: string): DecodedCallId {
  const match = CALL_ID_PATTERN.exec(callId);
  if (!match) {
    throw new Error(`FakeCalleAdapter: cannot parse callId "${callId}".`);
  }
  const [, agentType, scenario, attempt, subjectId] = match;
  return {
    agentType: agentType as AgentType,
    subjectId,
    scenario: isFakeScenarioId(scenario) ? scenario : DEFAULT_FAKE_SCENARIO,
    attemptNumber: attempt ? Number(attempt) : 1,
  };
}

export interface FakeCalleAdapterOptions {
  scenario?: FakeScenarioId;
}

// Stateless by design: the subject id, scenario and attempt are encoded directly
// in the callId, so getCallResult never depends on adapter-instance identity
// (safe across Next.js dev-server HMR reloads without any singleton caching).
export class FakeCalleAdapter implements CalleAdapter {
  private readonly scenario: FakeScenarioId;

  constructor(options: FakeCalleAdapterOptions = {}) {
    this.scenario = options.scenario ?? DEFAULT_FAKE_SCENARIO;
  }

  // Declared per scenario, so the voicemail-unsupported fallback is exercised by
  // real code rather than asserted in a comment. In live mode this is always
  // false — CALL-E's API cannot confirm a voicemail (see LiveCalleAdapter).
  get capabilities() {
    return { voicemail: FAKE_SCENARIOS[this.scenario].voicemail };
  }

  async startCompanionCall(input: CompanionCallInput): Promise<CallReference> {
    return {
      callId: encodeCallId("companion", input.person.id, this.scenario, input.attemptNumber),
      idempotencyKey: input.idempotencyKey,
    };
  }

  async startFamilyCall(input: FamilyCallInput): Promise<CallReference> {
    return {
      callId: encodeCallId("family", input.contact.id, this.scenario, input.attemptNumber),
      idempotencyKey: input.idempotencyKey,
    };
  }

  // DEC-023. Attempt is always 1 — there is exactly one, never retried — so it
  // is encoded as 1 rather than taken from an input field that does not exist.
  async startPersonNotificationCall(
    input: PersonNotificationCallInput
  ): Promise<CallReference> {
    return {
      callId: encodeCallId("person_notification", input.person.id, this.scenario, 1),
      idempotencyKey: input.idempotencyKey,
    };
  }

  async getCallResult(callId: string): Promise<CallResult> {
    const { agentType, subjectId, scenario, attemptNumber } = decodeCallId(callId);
    const definition = FAKE_SCENARIOS[scenario];

    // DEC-023. Handled before the companion guard below: a notification is
    // placed to whichever person the event belongs to, including profiles no
    // canned companion scenario was ever authored for.
    if (agentType === "person_notification") {
      const outcome = definition.notification?.() ?? NOTIFICATION_DELIVERED;
      if (outcome === "failed") {
        return {
          callId,
          agentType,
          status: "failed",
          structuredResult: null,
          failureCode: "fake_notification_failure",
          failureMessage: "Simulated technical failure on the informational callback.",
        };
      }
      return {
        callId,
        agentType,
        status: "completed",
        structuredResult: outcome,
        failureCode: null,
        failureMessage: null,
      };
    }

    // Every scenario is authored about the seeded demo person, so a companion
    // call to anyone else must fail loudly rather than reporting Marie's fall
    // for a profile somebody just created. (A trusted contact the scenario does
    // not name is different: `family` is total, and an unnamed contact simply
    // does not answer.)
    if (agentType === "companion" && subjectId !== DEMO_PERSON_ID) {
      throw new Error(
        `FakeCalleAdapter: no canned scenario for a companion call to "${subjectId}".`
      );
    }

    const structuredResult =
      agentType === "companion"
        ? definition.companion(attemptNumber)
        : definition.family(subjectId, attemptNumber);

    return {
      callId,
      agentType,
      status: "completed",
      structuredResult,
      failureCode: null,
      failureMessage: null,
    };
  }
}
