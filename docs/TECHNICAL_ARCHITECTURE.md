# KinCall — Technical Architecture Baseline

> **Status:** FROZEN BASELINE  
> **Date:** 28 July 2026  
> **Product source of truth:** `docs/PRODUCT_SPECIFICATION.md`

This document freezes the technical implementation choices for the KinCall hackathon MVP. It does not modify the product specification. Product functionality must remain exactly within the scope defined in `docs/PRODUCT_SPECIFICATION.md`.

---

## 1. Core architecture decision

KinCall will use:

- **Next.js App Router**
- **TypeScript**
- **Tailwind CSS**
- **Supabase PostgreSQL**
- **CALL-E REST API**
- **Vercel**
- **Vitest**
- **Claude Code for development**
- a deterministic TypeScript state machine for orchestration
- a fake CALL-E adapter for development and testing
- a live CALL-E adapter for real calls

KinCall will not use in the MVP runtime:

- n8n
- the Claude API
- LangChain
- CrewAI
- a generic multi-agent framework
- CALL-E MCP as the production orchestrator

---

## 2. Responsibility boundaries

### Claude Code

Claude Code is a development tool. It may:

- generate and edit code;
- create tests;
- help integrate CALL-E;
- inspect errors;
- write documentation;
- prepare the GitHub contribution.

The deployed KinCall application must not depend on an active Claude Code session.

### CALL-E

CALL-E is responsible for:

- placing the telephone calls;
- conducting the Companion Agent conversation;
- conducting the Family Agent conversation;
- returning call status, summaries, transcripts and structured results.

### KinCall orchestrator

The KinCall orchestrator is deterministic TypeScript code. It is responsible for:

- validating CALL-E structured results;
- applying allowed transition rules;
- deciding whether to close the case or contact a trusted person;
- selecting contacts from the configured trusted circle;
- running the ordered contact cascade;
- preventing duplicate calls;
- stopping the cascade after a confirmed intervention;
- sending uncertain cases to human review.

A language model must never freely invent or select a phone number.

---

## 3. Main runtime flow

```text
Manual demo launch
        ↓
Create KinCall event
        ↓
CALL-E Companion Agent calls the vulnerable person
        ↓
CALL-E returns a structured result
        ↓
KinCall deterministic orchestrator validates the result
        ↓
No action required ───────────────→ Close case
        │
        └── Attention required
                    ↓
          Select trusted contact #1
                    ↓
        CALL-E Family Agent calls contact
                    ↓
        Contact confirms intervention?
             │                 │
            Yes               No / no answer
             │                 │
        Close case       Select next contact
                               ↓
                         Repeat cascade
```

---

## 4. CALL-E integration

The production workflow uses the asynchronous CALL-E REST API.

Required integration capabilities:

- create a Companion Agent call;
- create a Family Agent call;
- attach metadata to every call;
- provide a strict `result_schema`;
- receive terminal results through a webhook;
- fetch a call by ID as a recovery mechanism;
- use idempotency keys for all outbound call actions.

The CALL-E MCP may be used from Claude Code for manual development tests only. It is not the production execution path.

---

## 5. Structured-result principle

CALL-E must return constrained structured results. The orchestrator must not make decisions by freely reinterpreting an entire transcript.

Recommended categorical values:

```text
yes
no
unknown
```

Example Companion result:

```json
{
  "conversation_summary": "Marie states that she fell yesterday and has difficulty walking.",
  "fall_mentioned": "yes",
  "mobility_difficulty": "yes",
  "does_not_want_to_disturb_family": "yes",
  "attention_level": "high"
}
```

Example deterministic rule:

```ts
if (
  result.fall_mentioned === "yes" &&
  result.mobility_difficulty === "yes"
) {
  return "CONTACT_TRUSTED_PERSON";
}
```

---

## 6. State machine

The event statuses must remain aligned with the frozen product specification:

```ts
type EventStatus =
  | "SCHEDULED"
  | "CALLING_PERSON"
  | "PERSON_DID_NOT_ANSWER"
  | "CONVERSATION_IN_PROGRESS"
  | "ANALYSING_CONVERSATION"
  | "NO_ACTION_REQUIRED"
  | "ATTENTION_REQUIRED"
  | "CALLING_TRUSTED_CONTACT"
  | "CONTACT_DID_NOT_ANSWER"
  | "CONTACT_DECLINED"
  | "CONTACT_CONFIRMED"
  | "HUMAN_REVIEW_REQUIRED"
  | "CASE_CLOSED";
```

All state transitions must be explicit and testable.

---

## 7. CALL-E adapter

Create one provider contract with two implementations:

```ts
interface CalleAdapter {
  startCompanionCall(input: CompanionCallInput): Promise<CallReference>;
  startFamilyCall(input: FamilyCallInput): Promise<CallReference>;
  getCallResult(callId: string): Promise<CallResult>;
}
```

Implementations:

- `FakeCalleAdapter`
- `LiveCalleAdapter`

Environment selection:

```env
CALLE_MODE=fake
```

or:

```env
CALLE_MODE=live
```

The fake adapter is the default for development and public exploration. Live mode must require explicit configuration.

---

## 8. Idempotency

Every outbound action must have a stable unique key.

Examples:

```text
case_001_companion_attempt_1
case_001_contact_julie_attempt_1
case_001_contact_marc_attempt_1
```

The database must enforce uniqueness so that retries or duplicate webhook processing cannot trigger the same call twice.

Webhook processing must also be idempotent.

---

## 9. Persistence

Minimum tables:

### `vulnerable_people`

- id
- first_name
- phone
- preferred_language
- conversation_profile
- preferred_call_time
- interests
- consent_status

### `trusted_contacts`

- id
- person_id
- first_name
- phone
- relationship
- priority
- consent_status

### `events`

- id
- person_id
- status
- priority
- current_contact_priority
- decision
- decision_reason
- created_at
- closed_at

### `call_events`

- id
- event_id
- agent_type
- contact_id
- calle_call_id
- idempotency_key
- status
- summary
- structured_result
- started_at
- ended_at

### `timeline_entries`

- id
- event_id
- status
- message
- created_at

---

## 10. Initial repository structure

```text
kincall/
├── CLAUDE.md
├── docs/
│   ├── PRODUCT_SPECIFICATION.md
│   ├── TECHNICAL_ARCHITECTURE.md
│   └── DECISION_LOG.md
├── app/
│   ├── page.tsx
│   ├── people/
│   ├── events/[id]/
│   └── api/
│       ├── events/start/route.ts
│       ├── webhooks/calle/route.ts
│       ├── people/route.ts
│       └── events/[id]/route.ts
├── lib/
│   ├── calle/
│   │   ├── adapter.ts
│   │   ├── fake-adapter.ts
│   │   ├── live-adapter.ts
│   │   └── schemas.ts
│   ├── orchestration/
│   │   ├── states.ts
│   │   ├── transitions.ts
│   │   ├── decide-companion-action.ts
│   │   └── handle-family-result.ts
│   └── database/
├── prompts/
│   ├── companion-agent.ts
│   └── family-agent.ts
├── tests/
│   ├── state-machine.test.ts
│   └── cascade.test.ts
└── .env.example
```

---

## 11. Implementation order

### Phase 1 — Frozen documentation

Commit:

- `docs/PRODUCT_SPECIFICATION.md`
- `docs/TECHNICAL_ARCHITECTURE.md`
- `docs/DECISION_LOG.md`
- `CLAUDE.md`

No application code should be written before this commit.

### Phase 2 — Fully simulated vertical slice

Build the complete scenario in fake mode:

```text
Launch demo
→ Marie result
→ decision
→ Julie no answer
→ Marc confirms
→ case closed
→ dashboard timeline updated
```

### Phase 3 — Real Companion call

Connect the live CALL-E adapter for the Companion Agent.

### Phase 4 — Real Family call and cascade

Connect real Family Agent calls and the ordered cascade.

### Phase 5 — Product interface and configuration

Complete the screens already required by the frozen product specification.

### Phase 6 — Tests, GitHub contribution and demo

Prepare the public app contribution, documentation and video.

---

## 12. Safety constraints

KinCall must:

- call only consenting test participants;
- identify itself as an automated assistant;
- transmit only necessary information;
- avoid medical diagnosis and advice;
- never call real emergency services in the MVP;
- require human review for uncertain critical situations;
- mask telephone numbers in public logs and documentation;
- use fake or reserved numbers in examples.

---

## 13. Rejected alternatives

### n8n

Rejected for the MVP core because it adds a new tool, hosting, workflow state and debugging surface without improving the frozen product scope.

### Claude API in the runtime

Rejected because CALL-E already returns structured results and the deterministic orchestrator can apply the required rules without a second language-model dependency.

### CALL-E MCP as production orchestration

Rejected because it is appropriate for user-confirmed development operations, not autonomous call cascades.

### Generic agent frameworks

Rejected because the product requires two CALL-E call roles and one deterministic orchestrator, not a general-purpose autonomous-agent framework.

---

## 14. Change policy

The product specification is frozen.

A technical decision may change only when:

1. the current choice is technically impossible;
2. CALL-E documentation or runtime behavior requires the change;
3. the change does not add, remove or reinterpret a product feature;
4. the change is recorded in `docs/DECISION_LOG.md`;
5. the project owner explicitly approves it.

When documentation conflicts:

1. `docs/PRODUCT_SPECIFICATION.md` controls product behavior;
2. this document controls implementation architecture;
3. `CLAUDE.md` controls Claude Code working rules;
4. the decision log records approved deviations.
