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

## DEC-005 — Live Family Agent: categorical result, resumable cascade, and untrusted `contact_id`

**Date:** 28 July 2026
**Status:** Approved

### Context

Phase 4 connects the live Family Agent and the trusted-contact cascade. Three things in the existing implementation could not survive contact with the real API, and a fourth was a latent safety gap:

1. **The cascade was synchronous.** `runFamilyCascade` was a `while` loop that started a call and read its result in the same request. That works only because `FakeCalleAdapter` returns `completed` instantly. A real CALL-E call returns `queued`, and `processFamilyResult` had no status branching, so the first live family call would have read `structured_result: null`, judged it malformed, and dumped the event into `HUMAN_REVIEW_REQUIRED` — the same "pending is not malformed" defect DEC-003 fixed for the Companion path.
2. **`FamilyStructuredResult` used booleans.** CALL-E's own `result_schema` guidance prefers string enums with an explicit `unknown` for decisions that may be unclear, which is why DEC-002 flattened the Companion schema. A boolean `can_intervene` forces the extraction model to guess `true` or `false` when a contact is vague, and a wrong `true` stops the cascade while asserting that somebody is intervening.
3. **`intervention_type` and `estimated_time` were nullable**, but CALL-E's `result_schema` has no null support. A perfectly ordinary no-answer has neither value, so the result would have failed validation and diverted a normal cascade step to human review.
4. **`contact_id` came from the model.** Nothing checked it against the contact KinCall actually called.

Additionally, trusted-contact phone numbers were seeded as reserved-for-fiction defaults with no way to configure real ones — and those defaults are structurally valid E.164, so an `isE164` check alone would have let them be dialled.

### Decision

1. **Resumable cascade.** `runFamilyCascade` becomes `advanceFamilyCascade`, handling one contact per inbound event. `processFamilyResult` gains status branching (`queued`/`in_progress` → no-op and wait; terminal → apply and advance) and recurses into `advanceFamilyCascade`. Which contact is next is **derived** from the `CallEventRecord`s already created, never stored, so a webhook redelivery or a poll cannot lose the cascade's place. `processCompanionResult` starts the cascade when it reaches `ATTENTION_REQUIRED`, giving `startDemoEvent`, the webhook route and the poll route one shared trigger. Fake mode is unaffected: results are instant, so the whole cascade still completes in one request.
2. **Categorical Family result.** `answered`, `situation_understood`, `can_intervene` and `contact_next_person` become `yes`/`no`/`unknown`. **Only `can_intervene === "yes"` stops the cascade**; `"unknown"` is treated as not-confirmed and the cascade continues, so a hesitant answer can never be recorded as a confirmed intervention (§7.5).
3. **Total sentinels instead of nulls.** `intervention_type` is `"other"` and `estimated_time` is `""` when they do not apply, so a no-answer or decline produces a schema-valid result rather than a malformed one.
4. **A failed or canceled Family call continues the cascade.** CALL-E documents no `failure_code` values, so the reason is unknowable; the contact simply was not reached, and the next one is called with the failure recorded verbatim in the timeline. Halting instead would let one bad phone number strand the vulnerable person with nobody called.
5. **`contact_id` is untrusted input.** The contact is always resolved from `callEvent.contactId`. `structured_result.contact_id` is verified to equal it, and a mismatch routes to `HUMAN_REVIEW_REQUIRED` — never to whichever contact the model named.
6. **Per-contact live phone configuration.** `KINCALL_JULIE_PHONE` / `KINCALL_MARC_PHONE` / `KINCALL_NICOLE_PHONE`, defaulting to the reserved-for-fiction numbers. Both the orchestrator (pre-flight) and `LiveCalleAdapter` (defence in depth) reject a number that is non-E.164 **or** reserved-for-fiction, always masked and always naming the variable to set.
7. **A configuration error must never strand an event.** The pre-flight runs *before* any transition, so no misleading "Calling Julie" entry is written for a call that never happens; it applies the new `FAMILY_CALL_NOT_POSSIBLE` transition to `HUMAN_REVIEW_REQUIRED` and makes no CALL-E request. Any other failure while starting a call is caught, recorded in the timeline, and routed to `HUMAN_REVIEW_REQUIRED` — so the webhook and poll routes always respond and no event is left at `CALLING_TRUSTED_CONTACT` with nothing in flight.

### Product-scope check

No product feature is added, removed or reinterpreted. §9.3's fields are preserved exactly — only their wire representation changes, as in DEC-002. `FAMILY_CALL_NOT_POSSIBLE` reaches the existing frozen §15 state `HUMAN_REVIEW_REQUIRED`; no new state exists. The cascade's observable behaviour — call the trusted circle in priority order, stop when someone confirms, escalate to human review when nobody does — is exactly what §9.3 and §11.4 specify. Deriving `information_to_share` from the validated Companion result is §9.2's own field, and fixes a defect in which a hardcoded list stated facts to a family member that the check-in had never established (§17.3, §17.5).

### Consequences

- `lib/orchestration/handle-family-result.ts` reads enums; `FamilyOutcome` is unchanged.
- `FamilyCallInput` widens to carry `eventId`, the full `person` and the full `contact`, mirroring the Phase 3 Companion widening.
- `TrustedContact` has no language field in the frozen §16 schema, so a Family call inherits the vulnerable person's `locale`/`region`. Revisit if a contact ever speaks another language.
- `EventRecord.currentContactPriority` — a frozen §9 column that was dead — is now populated, but only for display; the cascade reads the derived already-called set.
- Fake mode is byte-identical: the Marie → Julie → Marc demo produces the same nine timeline entries and the same `CASE_CLOSED` outcome.
- Recursion depth is bounded by the number of trusted contacts.
- One attempt per contact. Per-contact re-dialling is recurring retry scheduling, still out of scope (see DEC-003).

### Approval

Project owner approval: approved, with two mandatory corrections (per-contact phone environment variables, and never trusting the model-returned `contact_id`) and two additional safeguards (a configuration error must not strand the event or crash the route; no-answer and decline must produce valid results via the sentinels) all specified before implementation.

---

## DEC-006 — Supabase persistence: processing leases, an operation ledger, and intent-before-CALL-E

**Date:** 28 July 2026
**Status:** Approved

### Context

Phases 1–4 are validated, but every row lives in `globalThis.__kincallRepository` and is lost on every restart, redeploy or cold start. `TECHNICAL_ARCHITECTURE.md` §1 already names Supabase PostgreSQL as the frozen baseline, so this implements the baseline rather than deviating from it. The failure it removes is not cosmetic:

- An event mid-cascade at `CALLING_TRUSTED_CONTACT` is orphaned by a restart. A real call is in flight for a vulnerable person and nothing remains that can process its result.
- The inbound webhook then finds no `CallEventRecord` for its idempotency key and acknowledges without processing, silently discarding the result.
- DEC-004 exists because the restart-unstable `event_001` counter reused a CALL-E idempotency key. `runId` treated the symptom; missing persistence was the cause.
- On Vercel each serverless instance has its own `globalThis`, so a webhook landing on instance B cannot see an event created on instance A **even without a restart**.

Making the repository durable also makes three latent concurrency defects reachable, all of which had to be solved together:

1. `resultProcessedAt` was a read-then-write check with an `await getCallResult()` in the middle — safe only because one process is single-threaded.
2. Nothing made a *transition* idempotent, so any retry would duplicate timeline entries.
3. `ensure*CallStarted` called CALL-E first and inserted the row second, so a crash in that window left CALL-E holding a call KinCall could not find.

### Decision

1. **Async `Repository` interface.** `@supabase/supabase-js` is HTTP-based and there is no synchronous Postgres client for the Vercel runtime, so every method returns a `Promise`. `InMemoryRepository` is kept and remains the default.
2. **Opt-in driver.** `KINCALL_PERSISTENCE` defaults to `memory`, so fake mode and `npm test` need zero configuration and cannot reach the network, and rollback is an environment-variable flip rather than a code change.
3. **Atomicity in SQL functions.** PostgREST cannot span a transaction across HTTP calls, so multi-statement atomicity lives in five `SECURITY INVOKER` functions. The deterministic state machine stays entirely in TypeScript: `nextStatus()` computes the status and SQL only writes it.
4. **Processing lease, not a claim.** `processing_token` + `processing_started_at` grant a time-bounded exclusive right to process a terminal result; `result_processed_at` is set **only after the whole branch succeeds**. A crash therefore expires rather than permanently consuming the result. The lease is taken *after* the result is known terminal, so a still-queued call never burns one.
5. **Operation-key ledger.** `event_operations` records every applied transition under `UNIQUE (event_id, operation_key)`, making a replay a no-op instead of a duplicate timeline entry. Keys are `${trigger}:${stage}:${transitionEvent}`, derived only from durable facts (`call_events.id` or `runId`).
6. **Compare-and-set on `events.status`.** The lease is scoped to one call event, not to the event, so two call events can race one `EventRecord`. A *new* operation may only be applied from the status the caller reasoned about; a *duplicate key* is an idempotent no-op regardless of current status.
7. **Superseded, not abandoned.** When a terminal result can never be applied because the event has moved on, it is finalized under the current lease with its outcome stored and nothing else touched — otherwise the lease would expire and the same dead result would be reclaimed every lease period forever.
8. **Call intent before CALL-E.** `call_events` rows are created with `status='starting'` and a null `calle_call_id` **in the same transaction as the transition that decided to place the call**. `createCallEvent` and any standalone intent-creation method are absent from the interface, so an intent cannot exist outside its transition. A webhook arriving before our own response *adopts* the returned id rather than rejecting on a null mismatch.
9. **The ledger names its intent.** `event_operations.call_event_id` permanently records which intent a call-start transition created. A replay reads the intent from that foreign key and verifies its `eventId`/`agentType`/`contactId`/`idempotencyKey`, raising `CallIntentIntegrityError` on a mismatch rather than creating a second intent.
10. **Replays never evaluate `nextStatus()`.** A replayed `FAMILY_CALL_STARTED` arrives when the event is already at `CALLING_TRUSTED_CONTACT`, from which that edge is illegal, so the applied-operation lookup runs first and short-circuits.
11. **Cascade order by priority succession.** The next contact is chosen from the contact whose result triggered the step, not from "who has not been called yet" — the latter reads the answer out of which rows exist, so a replay would skip the intended contact and dial the one after them.
12. **Phone numbers overlaid on read.** Rows store only the reserved-for-fiction default; `KINCALL_*_PHONE` is applied when a person or contact is read, so a consenting participant's real number never enters a table, a migration, or a backup.
13. **RLS enabled and forced with no policies**, all privileges revoked from `anon`/`authenticated` including on future objects, and `EXECUTE` on every RPC granted only to `service_role`.

### Product-scope check

No product feature is added, removed or reinterpreted. No state, transition, decision rule, prompt or screen changes, and `lib/calle/` is untouched. The Marie → Julie → Marc demo produces the identical nine-entry timeline. §9's five tables are implemented as specified; `event_operations` is a sixth, which §9 permits by specifying *minimum* tables, and it is required for crash safety rather than for any product behaviour.

### Consequences

- `CallEventRecord` gains `processingToken`, `processingStartedAt`, and a nullable `calleCallId`; `status` gains `"starting"`. `TimelineEntry` gains `operationId`. As with DEC-002/003/004, `TECHNICAL_ARCHITECTURE.md` §9's column listing is recorded as behind the implementation here rather than edited.
- `ensureCompanionCallStarted` / `ensureFamilyCallStarted` are replaced by `placeCallForIntent`, which can only be called with an already-persisted intent.
- A failure *starting* a call (`CallStartFailedError`, meaning CALL-E refused and no call is in flight) is escalated to human review per DEC-005. A failure to *record* a call CALL-E already accepted is deliberately **not** escalated: the event must stay in a state its eventual result can be applied from, so that error propagates and a later poll or webhook re-drives the same idempotency key.
- Recovery assumes repeating `POST /v1/calls` under an already-used `Idempotency-Key` returns the original call rather than erroring. DEC-004 established that CALL-E rejects a *different* body under the same key; that an *identical* body replays cleanly is inferred and should be confirmed before the next live run.
- Automated coverage grows from 181 to 260 tests, including a shared repository contract suite run against both implementations, a fourteen-point crash-injection matrix, and concurrency tests for lease races and superseded results. The Supabase lane is gated on four credentials and runs serially.
- Local development and the whole default test run require no Supabase project at all.

### Approval

Project owner approval: approved, after five rounds of mandated corrections — the processing lease replacing an irreversible early claim; idempotent transition persistence; event-status compare-and-set with side effects gated on a newly-applied transition; call intent persisted before CALL-E, atomically with its transition; and the ledger-to-intent foreign key with a replay path that bypasses `nextStatus()`.

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
