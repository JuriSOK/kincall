# KinCall — Decision Log

This file records approved deviations from `docs/TECHNICAL_ARCHITECTURE.md`.

Do not record ordinary implementation details here. Record only decisions that change or clarify the frozen technical baseline.

---

## DEC-001 — Initial architecture baseline

**Date:** 28 July 2026  
**Status:** Approved

### Decision

Use:

- Next.js and TypeScript;
- Supabase PostgreSQL;
- CALL-E REST API;
- deterministic state-machine orchestration;
- fake and live CALL-E adapters;
- Claude Code as a development tool.

Do not use n8n, the Claude API or a generic agent framework in the MVP runtime.

### Reason

This is the smallest architecture that supports the frozen KinCall workflow while remaining testable, understandable and reliable during the hackathon.

### Consequences

- CALL-E handles calls and structured extraction.
- KinCall code handles decisions and contact selection.
- The complete workflow must work in fake mode before live integration.
- All future baseline changes require a new decision entry.

---

## DEC-002 — Flat categorical Companion result_schema

**Date:** 28 July 2026
**Status:** Approved (extended by DEC-003, which adds `person_reached` to the same schema)

### Context

Phase 3 (live Companion Agent integration) required reading CALL-E's actual OpenAPI spec (`calle.openapi.yaml` v0.2.0) rather than TECHNICAL_ARCHITECTURE.md §5's illustrative example. The spec documents real `result_schema` constraints: supported features are `type`/`properties`/`required`/`enum`/nested `object`/"simple" `array.items`; unsupported: `$ref`, `oneOf`, `anyOf`, `allOf`, recursive schemas, `additionalProperties: true`. It explicitly recommends "string enums over booleans... include an `unknown` enum value" for exactly this kind of extraction. PRODUCT_SPECIFICATION.md §9.1's example shows a nested `signals: [{type, value, confidence}]` array, which is both an array-of-objects (CALL-E's "simple array.items" support for this is undefined) and boolean-valued (against CALL-E's own stated preference).

### Decision

The Companion `result_schema` sent to CALL-E — and the corresponding `CompanionStructuredResult` TS type in `lib/calle/schemas.ts` — flattens the `signals[]` array into two top-level categorical fields (`fall_mentioned`, `mobility_difficulty`, each `yes`/`no`/`unknown`), matching TECHNICAL_ARCHITECTURE.md §5's own "Recommended categorical values" pattern. Every other field §9.1 describes (`person_requests_help`, `conversation_change.shorter_than_usual`, `conversation_change.unusual_confusion`) is kept, also flattened to top-level categorical fields rather than dropped. `call_status` is removed from the structured result because it is now redundant with the adapter-level `CallResult.status` field (sourced from CALL-E's own `CallTask.status`).

### What is and is not preserved

Preserved: every *signal* §9.1 describes. Fall mentioned, mobility difficulty, person requests help, does not want to disturb family, shorter-than-usual conversation, unusual confusion and the recommended attention level are all still collected, each as a `yes`/`no`/`unknown` field.

Not preserved: the per-signal numeric `confidence` value shown in §9.1's example (`0.96`, `0.91`). The flattened schema carries no confidence score.

`call_status` is also removed, as stated above, because the adapter-level `CallResult.status` now carries it.

### Product-scope check

This is a technical representation trade-off, not a removal of a product feature. The signals themselves — the information the product acts on — are all still gathered, and §17.5/§17.6's requirement to preserve uncertainty is met by the `unknown` enum value rather than by a numeric score. CALL-E's own `result_schema` guidance recommends categorical enums with an explicit `unknown` value over model-produced numbers for exactly this reason, and a deterministic orchestrator cannot act on a confidence float without inventing a threshold that appears nowhere in the frozen specification. No decision rule in §9.2 reads a confidence value.

Recorded honestly rather than described as lossless: if a future phase needs graded certainty, it should be re-added as a categorical field (for example `evidence_strength: explicit | implied | unclear`), which maps onto §17.6's fact/interpretation/uncertain distinction better than a float would.

### Consequences

- `lib/calle/schemas.ts`, `lib/calle/fake-adapter.ts`, and `prompts/companion-agent.ts`'s `companionResultSchema` all use the flat shape.
- Existing Phase 2 tests asserting the nested shape (`tests/state-machine.test.ts`, `tests/fake-adapter.test.ts`, `tests/engine.test.ts`) were updated to match.
- Fake mode and live mode now share one Companion result shape, rather than diverging.

### Approval

Project owner approval: approved (confirmed via explicit choice between the nested and flattened shape during Phase 3 planning).

---

## DEC-003 — `person_reached` and the unanswered check-in path

**Date:** 28 July 2026
**Status:** Approved

### Context

The first real live Companion call (event `event_001`, 28 July 2026) reached the participant's voicemail. CALL-E correctly returned `status: completed` with a schema-valid structured result — the call did connect — and the extraction model correctly reported no concerning signals, because no conversation had taken place. KinCall then read "no concerning signals" as "nothing is wrong", applied `LOG_AND_CLOSE`, and closed the event as `CASE_CLOSED`, with the dashboard stating "KinCall reviewed the check-in and found nothing unusual."

Nobody had spoken to the person. The product asserted safety it had never verified, which `PRODUCT_SPECIFICATION.md` §7.5 explicitly forbids ("affirmer qu'une personne est en sécurité"). §9.2 requires an unanswered call to schedule a new attempt, and §15 defines a `PERSON_DID_NOT_ANSWER` state — but no code path could reach it, because whether a human answered was not represented anywhere in the Companion result.

The existing baseline fails for the reason `TECHNICAL_ARCHITECTURE.md` §14 clause 2 anticipates: observed CALL-E runtime behaviour (a voicemail is a completed call with a valid result) requires the change.

### Decision

1. Add a required `person_reached` field (`yes` / `no` / `unknown`) to the Companion `result_schema` and to `CompanionStructuredResult`. Every field DEC-002 established is preserved; this is purely additive.
2. `decideCompanionAction` evaluates `person_reached === "no"` **first** and returns `RETRY_CHECK_IN` — with no conversation, any reported signal is not trustworthy.
3. `person_reached === "unknown"` returns `REQUEST_HUMAN_REVIEW`, but is evaluated **after** the escalation rules, so uncertainty about who was on the line can never weaken an escalation that concerning signals already justify.
4. Two transitions are added from `ANALYSING_CONVERSATION`: `COMPANION_PERSON_NO_ANSWER → PERSON_DID_NOT_ANSWER` and `COMPANION_RESULT_UNCERTAIN → HUMAN_REVIEW_REQUIRED`. A voicemail is only detectable from the structured result, so this state must be reachable from the analysis step and not only from `CALLING_PERSON`.
5. Neither new path sets `closedAt`. An event where the person was not reached stays open.
6. The event dashboard no longer falls back to "found nothing unusual" / "No intervention required" for these outcomes.

### Product-scope check

No product feature is added, removed or reinterpreted. `PERSON_DID_NOT_ANSWER` is a frozen §15 state and `RETRY_CHECK_IN` and `REQUEST_HUMAN_REVIEW` are frozen §9.2 decisions; all three were previously unreachable. This change makes existing specified behaviour reachable and removes a defect in which KinCall asserted a safety conclusion it had not established. `person_reached` is not a new product capability — it is the fact §9.2's no-answer branch always depended on, which was simply absent from the wire format.

### Retry scheduling is deliberately deferred

§9.2's full rule is "retry the call; if the maximum number of attempts is reached, contact the first trusted person." Only the detection and state half is implemented now. Automatic re-dialling is deferred to Phase 4, because its stopping condition is the trusted-contact cascade, which does not exist yet — shipping the retry half alone would produce events that loop with no terminal escalation, and would place real unattended outbound calls. The state machine already allows `PERSON_DID_NOT_ANSWER → COMPANION_CALL_STARTED`, so Phase 4 adds the trigger, not the states.

Consequently `RETRY_CHECK_IN` currently means **"a retry is owed"**, surfaced on the dashboard for a human to act on. It does not mean "a retry is scheduled". This must not be mistaken for automation later.

### Consequences

- `person_reached` is required, so a result omitting it fails validation and routes to human review. This is the safe direction, but it does mean results the extraction model cannot fill become human-review cases rather than silent closes.
- `prompts/companion-agent.ts` instructs the agent to leave only a short identifying message on voicemail, with no wellbeing questions and no situation detail (§17.3).
- Fake mode is unchanged: Marie answers (`person_reached: "yes"`), so the demo scenario and its timeline are identical.
- `TECHNICAL_ARCHITECTURE.md` §5's illustrative example is not edited, consistent with how DEC-002's divergence was recorded.
- New tests cover voicemail, a live answer with and without concerning signals, both `unknown` branches, and rejection of a result lacking the field.

### Approval

Project owner approval: approved (explicitly requested after reviewing the observed `event_001` failure and the proposed correction).

---

## DEC-004 — `runId`: a restart-proof idempotency key source

**Date:** 28 July 2026
**Status:** Approved

### Context

A live Companion call failed with CALL-E's `idempotency_conflict` error: "Idempotency key was reused with a different request." Root cause: `InMemoryRepository.createEvent`'s sequential, human-readable `id` (`event_001`, `event_002`, …) is generated from an in-process counter (`eventSequence`) that restarts at 0 every time the repository is recreated — which happens on every dev-server restart or redeploy, since there is no persistence yet (Supabase is still not wired up). Companion and Family idempotency keys were derived directly from that `id` (`${event.id}_companion_attempt_1`). After a restart, launching a new demo reproduces `event_001` again, and therefore the exact same idempotency key as some earlier run — but CALL-E's idempotency store is durable server-side across our restarts, so it still holds the *previous* request body under that key. A second, different request under the same key is correctly rejected as a conflict.

`TECHNICAL_ARCHITECTURE.md` §8 already requires "a stable unique key" per outbound action; the implementation did not actually satisfy that — `id` is only unique within one process lifetime, not globally. This is a bug in meeting an existing requirement, not a change to it.

### Decision

Add `runId: string` to `EventRecord`, generated once via `crypto.randomUUID()` in `createEvent()` and never regenerated for the life of that event. Companion and Family idempotency keys (`lib/orchestration/engine.ts`, `app/api/events/[id]/poll/route.ts`) are derived from `runId`, not `id`. The sequential `id` is unchanged and keeps its existing job: a short, human-readable identifier used in URLs and the dashboard.

This is additive only — no existing behavior that depends on `id`'s format changes.

### Product-scope check

No product feature changes. `runId` is not user-visible and does not appear in any URL, screen, or CALL-E-facing text; it exists purely to make the idempotency key genuinely unique, which `TECHNICAL_ARCHITECTURE.md` §8 already mandated.

### Consequences

- `lib/database/types.ts`'s `EventRecord` gains `runId`; `TECHNICAL_ARCHITECTURE.md` §9's `events` table listing is now one field behind the implementation, same handling as DEC-002/DEC-003 — recorded here rather than edited into the frozen document.
- A second `ensureCompanionCallStarted`/`ensureFamilyCallStarted` call for the same event (poll, webhook redelivery, or our own adapter-level HTTP retry) still computes the identical key, because `runId` is read from the already-persisted event rather than regenerated — duplicate-call protection is unchanged.
- `resultProcessedAt`-based duplicate-*processing* protection (`processCompanionResult`/`processFamilyResult`) is untouched by this change.
- If the server restarts mid-event, the in-memory event itself is lost (pre-existing limitation, unrelated to this fix) and any subsequent demo launch creates a brand-new event with a fresh `runId` — guaranteed not to collide with an orphaned prior call's key.
- New regression test: two separate `InMemoryRepository` instances (standing in for two process lifetimes) produce colliding `id`s but distinct `runId`s and distinct derived idempotency keys.

### Approval

Project owner approval: approved (fix requested directly after the `idempotency_conflict` error was observed on a real call).

---

## Decision template

Copy this section for future approved decisions.

### DEC-XXX — Title

**Date:** YYYY-MM-DD  
**Status:** Proposed / Approved / Rejected / Superseded

#### Context

Describe the technical issue and why the baseline may need to change.

#### Decision

State the approved choice precisely.

#### Product-scope check

Explain why the change does not add, remove or reinterpret a feature in the frozen product specification.

#### Consequences

List the implementation, testing, safety and documentation consequences.

#### Approval

Project owner approval: pending / approved.
