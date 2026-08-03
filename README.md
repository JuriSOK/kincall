<p align="center">
  <img src="./docs/assets/kincall-logo.svg" alt="KinCall" width="240" />
</p>

<h1 align="center">KinCall</h1>

<p align="center">
  <strong>AI voice agents that turn every check-in into coordinated human support.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/CALL--E-Hackathon%202026-8b5cf6" alt="CALL-E Hackathon 2026" />
  <img src="https://img.shields.io/badge/status-functional%20MVP-2fc6c6" alt="Functional MVP" />
  <img src="https://img.shields.io/badge/tests-925%20passing-163f6b" alt="925 tests passing" />
  <img src="https://img.shields.io/badge/Next.js-16-000000" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ecf8e" alt="Supabase PostgreSQL" />
</p>

<p align="center">
  Built for <strong>CALL-E: Your Code Is Calling</strong>.
</p>

---

## Overview

KinCall is an AI-powered phone check-in and family coordination system.

Specialized voice agents talk with the monitored person, understand what was said, and return structured information. An orchestration engine then follows a clear decision tree to close the check-in or contact the person’s trusted circle.

> **Agents understand the conversation. KinCall orchestrates the response.**

KinCall is not a medical device or an emergency service.

---

## The idea

A phone call can reveal that someone needs help.

The challenge is what happens next:

- understanding the real situation;
- deciding whether someone should be contacted;
- reaching the right trusted person;
- sharing the correct context;
- confirming who can help;
- informing the monitored person of the outcome.

KinCall turns this process into one coordinated agent workflow.

---

## How it works

1. A **Companion Agent** calls the monitored person.
2. The conversation becomes a factual structured output.
3. The **Decision Engine** evaluates the result.
4. When attention is needed, **Family Agents** contact the trusted circle.
5. The cascade stops when someone confirms they can help or nobody is available.
6. A **Notification Agent** calls the monitored person back with the outcome.
7. The full event is recorded in the dashboard.

```mermaid
flowchart TD
    A["Companion Agent<br/>calls the monitored person"] --> B["Structured conversation output"]

    B --> C{"Decision tree"}

    C -->|"No attention needed"| D["Close the check-in"]
    C -->|"Attention needed"| E["Activate trusted circle"]

    E --> F["Family Agent<br/>calls the next contact"]
    F --> G{"Can they help?"}

    G -->|"Yes"| H["Support confirmed"]
    G -->|"No / No answer"| I{"More contacts?"}

    I -->|"Yes"| F
    I -->|"No"| J["No confirmed support"]

    H --> K["Notification Agent<br/>shares the outcome"]
    J --> K

    K --> L["Event recorded"]
    D --> L
```

---

## Agent system

KinCall uses three specialized voice agents.

| Agent | Role |
|---|---|
| **Companion Agent** | Conducts the check-in and converts the conversation into structured facts. |
| **Family Agent** | Contacts a trusted person and asks whether they can help with the specific situation. |
| **Notification Agent** | Calls the monitored person back and communicates the final outcome. |

The agents interpret natural language, but they do not control the workflow.

Operational decisions remain inside KinCall’s orchestration engine.

---

## From conversation to action

The Companion Agent may return:

```json
{
  "person_reached": "yes",
  "explicit_help_requested": "yes",
  "neutral_summary": "Claire would like help completing an administrative document."
}
```

The decision engine then applies a rule:

```text
explicit_help_requested = yes
            │
            ▼
    ATTENTION_REQUIRED
            │
            ▼
Activate trusted-circle cascade
```

The AI interprets the conversation.

The decision tree transforms that interpretation into a controlled action.

---

## Context propagation

KinCall preserves the specific context throughout the full workflow.

```text
Claire:

“I need help completing an administrative document.”
```

The Family Agent receives:

```text
“Claire told KinCall that she would like help completing
an administrative document.”
```

Trusted contacts do not receive a vague message such as:

```text
“Claire needs help.”
```

The same factual context is shared with every contact involved in the event.

This works with new situations without hardcoded scenarios.

---

## Trusted-circle orchestration

When attention is required, contacts are reached one at a time.

```text
Julie
  │
  ├── Confirms support → stop the cascade
  │
  └── Declines / no answer
                    │
                    ▼
                  Marc
                    │
                    ├── Confirms support → stop the cascade
                    │
                    └── Declines / no answer
                                      │
                                      ▼
                                  Next contact
```

The orchestration engine manages:

- contact priority;
- availability;
- consent;
- retry limits;
- confirmed commitments;
- unresolved outcomes;
- the final callback.

---

## Core features

| Feature | Description |
|---|---|
| **AI voice agents** | Three specialized agents manage the complete phone workflow. |
| **Structured outputs** | Conversations become validated facts and factual summaries. |
| **Decision tree** | Explicit rules transform conversation results into workflow actions. |
| **Trusted-circle cascade** | Contacts are called sequentially until support is confirmed. |
| **Context-aware calls** | Every trusted contact receives the relevant context from the original conversation. |
| **Availability-aware ordering** | Available contacts can be prioritized without excluding the rest of the circle. |
| **Bounded retries** | Call attempts follow clear and controlled limits. |
| **Outcome callback** | The monitored person receives a final call with the result. |
| **Intervention summary** | KinCall records who offered to help, how and when. |
| **No confirmed support** | Unresolved situations remain clearly visible. |
| **Dashboard and history** | Profiles, activity, timelines and outcomes are available in one interface. |
| **Reliable orchestration** | Duplicate processing cannot create duplicate workflow actions. |

> [!NOTE]
> Schedule preferences are already stored and displayed. Automatic scheduled check-ins are not yet enabled.

---

## Architecture

KinCall combines conversational AI with a controlled orchestration layer.

```mermaid
flowchart LR
    UI["Next.js application"]

    subgraph CORE["KinCall Core"]
        AGENTS["Specialized AI agents"]
        ENGINE["Orchestration engine"]
        TREE["Decision tree"]

        AGENTS --> ENGINE
        ENGINE --> TREE
    end

    DATABASE[("Supabase / PostgreSQL")]
    CALLE["CALL-E Voice Platform"]

    UI --> CORE
    CORE <--> DATABASE
    CORE --> CALLE
```

```text
Phone conversation
        │
        ▼
AI interpretation
        │
        ▼
Structured output
        │
        ▼
Decision tree
        │
        ▼
Orchestrated action
```

---

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Voice agents | CALL-E |
| Orchestration | State machine and decision tree |
| Database | Supabase / PostgreSQL |
| Testing | Vitest |
| Runtime | Node.js |

---

## Getting started

### Prerequisites

- Node.js
- npm
- Supabase
- A CALL-E account for real calls

### Installation

```bash
git clone <your-repository-url>
cd kincall

npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

### Database

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase migration list
npx supabase db push
```

### Quality checks

```bash
npm run typecheck
npm test
npm run build
```

---

## Testing

KinCall currently includes **925 passing automated tests**.

The test suite covers:

- decision-tree rules;
- agent structured outputs;
- trusted-circle orchestration;
- contact ordering;
- retry policies;
- context propagation;
- outcome callbacks;
- concurrent processing;
- workflow recovery;
- scheduling calculations;
- dashboard logic.

---

## Safety and limitations

- KinCall is not an emergency service.
- KinCall does not diagnose or perform medical triage.
- KinCall never contacts emergency services.
- A confirmed intervention is a commitment, not proof that it happened.
- Automatic scheduled calls are not implemented yet.
- Call delivery time depends on CALL-E and the telephone carrier.
- Voicemail cannot always be identified reliably.
- Authentication and additional security are required before public deployment.

---

## Hackathon status

KinCall is currently being built for
[CALL-E: Your Code Is Calling](https://call-e.devpost.com/).

The current hackathon MVP includes:

- specialized AI voice agents;
- real phone calls;
- structured conversational outputs;
- a decision tree;
- trusted-circle orchestration;
- context propagation between agents;
- outcome notification calls;
- persistent event histories;
- a complete operational dashboard.

Development and live testing are still ongoing.

Before the final submission, the main remaining work includes:

- completing the final live scenarios;
- refining the user experience;
- preparing the demo video;
- finalizing the Devpost submission.

---

## Documentation

- [`Product specification`](docs/PRODUCT_SPECIFICATION.md)
- [`Technical architecture`](docs/TECHNICAL_ARCHITECTURE.md)
- [`Decision log`](docs/DECISION_LOG.md)

---

## CALL-E hackathon

KinCall is an independent submission for
[CALL-E: Your Code Is Calling](https://call-e.devpost.com/), an ongoing hackathon focused on AI agents that make real phone calls and complete real-world tasks.

KinCall is not affiliated with, endorsed by or sponsored by CALL-E.
