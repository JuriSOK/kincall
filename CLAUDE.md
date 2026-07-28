# CLAUDE.md — KinCall Working Rules

## Mandatory reading before every task

Read these files before modifying the project:

1. `docs/PRODUCT_SPECIFICATION.md`
2. `docs/TECHNICAL_ARCHITECTURE.md`
3. `docs/DECISION_LOG.md`

At the beginning of a new session, briefly restate:

- the requested task;
- the product constraints it touches;
- the files that will be modified.

Do not start implementation until those constraints are understood.

---

## Frozen product rule

The KinCall product specification is frozen.

Do not:

- add a feature;
- remove a feature;
- rename a product concept in a way that changes its meaning;
- broaden the target users;
- introduce a new workflow;
- reinterpret an optional feature as mandatory;
- move an out-of-scope feature into the MVP.

When a requested implementation appears to conflict with the specification, stop and identify the conflict instead of silently changing the product.

---

## Frozen technical baseline

Use:

- Next.js App Router;
- TypeScript;
- Tailwind CSS;
- Supabase PostgreSQL;
- CALL-E REST API;
- Vercel;
- Vitest;
- a deterministic TypeScript state machine;
- `FakeCalleAdapter` and `LiveCalleAdapter`.

Do not introduce without explicit approval:

- n8n;
- the Claude API in the runtime;
- LangChain;
- CrewAI;
- another orchestration framework;
- CALL-E MCP as the production workflow;
- real emergency-service calls.

---

## Architectural responsibilities

CALL-E:

- places calls;
- conducts Companion and Family conversations;
- returns constrained structured results.

KinCall code:

- validates results;
- decides allowed actions;
- selects contacts from the database;
- runs the ordered cascade;
- enforces idempotency;
- updates event state and timeline;
- stops after confirmed intervention;
- routes uncertain cases to human review.

Claude Code:

- develops and tests the application;
- is not a production dependency.

A model must never freely invent or select a telephone number.

---

## Development order

1. Documentation baseline committed.
2. Complete fake-mode vertical slice.
3. Live Companion Agent integration.
4. Live Family Agent integration and cascade.
5. Remaining frozen MVP interface.
6. Tests, documentation, contribution and demo.

Do not begin with visual polish, recurring scheduling or optional features before the fake-mode vertical slice works end to end.

---

## Testing rules

Every orchestration transition must be tested.

Minimum scenarios:

- no concerning signal → close;
- fall plus mobility difficulty → contact trusted person;
- first contact does not answer → call next contact;
- contact declines → call next contact;
- contact confirms → stop cascade and close;
- no contacts remaining → human review;
- duplicate webhook → no duplicate transition;
- duplicate retry → no duplicate outbound call;
- malformed structured result → human review.

Use fake mode for the majority of development and automated tests.

---

## Safety rules

- Use only consenting test participants in live mode.
- Identify KinCall as an automated assistant.
- Never diagnose or give medical advice.
- Never call real emergency services in the MVP.
- Share only the minimum necessary facts with trusted contacts.
- Preserve uncertainty in wording.
- Mask phone numbers in public output.
- Never commit API keys or credentials.

---

## Change-control rule

Before changing an architecture decision:

1. explain why the existing choice fails;
2. verify that product functionality remains unchanged;
3. obtain explicit project-owner approval;
4. add an entry to `docs/DECISION_LOG.md`;
5. update the technical architecture only after approval.

Do not silently override the baseline.
