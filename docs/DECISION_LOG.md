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

## DEC-007 — Consent is enforced before any call, and phone numbers stay out of the database

**Date:** 29 July 2026
**Status:** Approved

### Context

Phase 5 completes the frozen MVP interface: profile creation, trusted-circle creation and
ordering, per-person status, and call history (`PRODUCT_SPECIFICATION.md` §13.1, §14). Building
it surfaced two problems that did not exist while every row came from `lib/database/seed.ts`.

**1. `consentStatus` was stored but read nowhere** — zero references in `lib/orchestration` and
`lib/calle`. That was inert only because all four seeded rows are `"confirmed"`. A form with a
consent checkbox makes it reachable: leave it unticked and the demo button would place a call to
someone who has not agreed, which §17.1 explicitly forbids ("Les personnes appelées doivent avoir
accepté de recevoir des appels automatisés").

**2. A profile form necessarily wants to collect a phone number**, which DEC-006 exists to keep
out of the database entirely. `CONTACT_PHONE_ENV_VARS` was also a static four-key map, so a
user-created contact could never have been configured for a live call at all.

### Decision

**Consent (§17.1).** Enforced in **every mode**, because consent is a property of the person, not
of whether the dialling is real:

- `startDemoEvent` raises `ConsentNotConfirmedError` when the person's consent is not
  `"confirmed"`, **before** the event is created, so an unconsented profile leaves no orphaned
  event behind.
- A trusted contact whose consent is not confirmed is treated exactly like an unusable phone: the
  existing `FAMILY_CALL_NOT_POSSIBLE` → `HUMAN_REVIEW_REQUIRED` edge, with the reason in the
  timeline. **No new state or transition** — that edge exists precisely for "this contact cannot
  be called" (DEC-005). The cascade escalates rather than silently skipping to the next contact,
  because a circle nobody consented to is a situation a human should see.

**Phone numbers.** DEC-006 is preserved and strengthened:

- `phone` is **absent from every create input type**, so a real number cannot reach the database
  even by mistake. The repository mints a reserved-for-fiction number instead. The guarantee is
  enforced by the type signature rather than by reviewer discipline.
- `isReservedFictionPhone` becomes **range-based** over the ARCEP block (`/^\+3363998\d{4}$/`)
  rather than a four-entry set, so a minted number is also recognised as undialable.
- `CONTACT_PHONE_ENV_VARS` becomes `phoneEnvVarFor(entityId)`, deriving `KINCALL_PHONE_<ID>` for
  ids nobody hardcoded while keeping the four published names so existing configuration works.
- Every free-text field rejects phone-like digit runs. `interests` and `relationship` are spoken
  aloud by the agents and are the one place a real number could be smuggled in, so the guarantee
  is enforced rather than merely structural.
- A profile without server-side phone configuration stays fully usable in the interface and shows
  a "phone configuration missing" state; it simply cannot place a live call. Fake mode is
  unaffected, since nothing is dialled and the fiction numbers are expected there.

### Product-scope check

No product feature is added, removed or reinterpreted. Consent enforcement implements §17.1,
which the specification already requires; it was simply unreachable. `ConsentStatus` is a frozen
§16 field and `FAMILY_CALL_NOT_POSSIBLE` reaches the frozen §15 state `HUMAN_REVIEW_REQUIRED`.
The screens implement §13.1 and §14 exactly, following §16's data model rather than §11.1's
prose superset — §11.1 mentions escalation rules, call frequency and consent records that
`VulnerablePerson` does not carry, and adding them would extend a frozen schema.

### Consequences

- `startDemoEvent` can now fail for a reason the caller must surface; the demo button disables
  itself with an explanation rather than failing after the click.
- A seeded demo person is unaffected: all four rows are `"confirmed"`, so the Marie → Julie → Marc
  timeline is byte-identical.
- `reorder_trusted_contacts` (migration `0006`) is a new SQL function: `unique (person_id,
  priority)` rejects any interim state where two contacts share a priority, so the whole reorder
  must be one transaction. It validates that the supplied ids are exactly that person's circle —
  no duplicates, nothing missing, nothing foreign — before writing anything, because a partial
  order could drop somebody out of the cascade.
- Slug-based ids retry with a numeric suffix on collision, so two people called Marie are both
  creatable.
- The conversation-profile allowlist is exactly what `prompts/companion-agent.ts` understands
  (`standard`, `cognitive_friendly`, `speech_difficulty`); an unknown value is rejected rather
  than silently falling back to the standard script.

### Approval

Project owner approval: approved — consent enforcement and the phone rules were both specified
before implementation, with the reorder-validation corrections mandated at plan approval.

---

## DEC-008 — Store a validated real phone number for interface-created profiles

**Date:** 29 July 2026
**Status:** Approved — revises the phone-storage rule from DEC-006/DEC-007

### Context

DEC-006 kept phone numbers out of the database entirely: every stored row held a
reserved-for-fiction placeholder, and a real number lived only in an environment variable. That
was the right call while every profile came from `lib/database/seed.ts` — there were only four
entities, all hardcoded, and no interface existed that needed to collect a number from anyone.

Phase 5 made profile and trusted-contact creation a real user-facing workflow
(`app/people/new/`, `app/people/[id]/contacts/`). Requiring an environment variable per
UI-created entity does not scale to an operator who wants to add a person and their circle in
one sitting: they would need to create the profile, find its generated id, then go edit server
environment variables outside the application before the contact could ever be called live.
That is not "usable in the interface" — it is the interface deferring its own job to a
deployment step.

### Decision

**Person and trusted-contact creation now require a phone number, validated server-side, and
store it directly in the database.**

- `lib/validation/profile.ts` gains a `phone` field on both `PersonInput` and `ContactInput`:
  required, normalized (tolerates spaces/dots/dashes/parentheses the way people actually type a
  number), must satisfy `isE164`, and must **not** be `isReservedFictionPhone` — a real
  participant cannot be assigned a number `LiveCalleAdapter` already refuses to dial.
- `CreatePersonInput` and `CreateTrustedContactInput` (`lib/database/repository.ts`) include
  `phone` again. Both repository implementations store `input.phone` exactly as validated;
  neither mints a placeholder any more. `mintFictionPhone` is removed as dead code.
- **The override mechanism from DEC-006/DEC-007 is unchanged and still layered on top:**
  `resolveConfiguredPhone` still checks `phoneEnvVarFor(entityId)` first and falls back to the
  stored value only when no override is set. For the four legacy demo entities the stored value
  remains the committed reserved-for-fiction default, so they are unaffected — a live number for
  them still only ever comes from `KINCALL_DEMO_PHONE` / `KINCALL_JULIE_PHONE` /
  `KINCALL_MARC_PHONE` / `KINCALL_NICOLE_PHONE`. For an interface-created entity, the fallback is
  now the real number the operator entered, so it is usable for a live call the moment it is
  created — with an environment-variable override still available if a specific test run needs
  to redirect that entity's number temporarily without editing the row.
- `isReservedFictionPhone` stays range-based (unchanged from DEC-007) and remains the safety net
  in `describeUnusablePhone` / `LiveCalleAdapter`'s own pre-flight check, regardless of whether
  the resolved number came from the database or an override.
- **Masking, everywhere the phone is displayed.** The person page and the trusted-circle page
  render only `maskPhone(...)`. The one place this was not previously true: `ContactManager`
  (`app/people/[id]/contacts/contact-manager.tsx`) is a Client Component, and its props are
  serialized into the page payload sent to the browser — passing it a full `TrustedContact[]`
  would have shipped the real number to the client even though nothing rendered it. The contacts
  page now computes a masked-only summary server-side and passes that instead; the real `phone`
  field never crosses into that component's props at all.
- **Never logged unmasked.** Validation error messages describe the required shape ("Must be a
  valid E.164 number, for example +33612345678.") and never echo the submitted value, so an
  invalid number a user typed cannot end up in a string this module produces.
- Consent enforcement (DEC-007) is untouched: a stored, valid, non-fiction number does not bypass
  the consent check, and `startDemoEvent` / the family cascade still refuse to call anyone whose
  `consentStatus` is not `"confirmed"`, in every mode.
- Fake mode is untouched: `FakeCalleAdapter` never reads `phone` at all, so nothing about this
  change affects it.

### Product-scope check

No product feature is added, removed or reinterpreted. §16's `VulnerablePerson` and
`TrustedContact` already specify a `phone` field; this decision changes where a *live* value for
an interface-created entity is sourced from, not the schema. The database already had the phone
columns (added under DEC-004/§9 baseline) — no migration is needed.

### Consequences

- A profile or trusted contact created through the interface can be called live the moment it is
  created, without any separate environment-variable configuration step — configuration remains
  available for the override case, but is no longer required.
- `mintFictionPhone` and its dedicated tests are removed; `tests/validation.test.ts` gains
  coverage for the new required `phone` field (missing, malformed, reserved-fiction all rejected;
  a valid number normalizes and passes); `tests/repository-contract.ts` and
  `tests/people-routes.test.ts` are updated to supply and assert a real stored phone instead of a
  minted one.
- `describeCallReadiness` (`lib/orchestration/person-status.ts`) needed no logic change: it
  already asked "is the resolved phone usable?" via `describeUnusablePhone`, and that question is
  answered identically whether the resolved number came from a database column or an environment
  variable.

### Approval

Project owner approval: approved, with the explicit requirement that database access stays
server-side, phone numbers are masked wherever displayed, unmasked numbers are never logged, the
four legacy demo entities keep their environment-variable-only behavior, reserved-fiction numbers
stay blocked in live mode, consent stays required before any live call, and fake mode never
places a real call.

---

## DEC-009 — Soft deletion for people and trusted contacts

**Date:** 29 July 2026
**Status:** Approved

### Context

This is **optional interface administration, not a core orchestration feature**: nothing in
`PRODUCT_SPECIFICATION.md` §13.1's mandatory feature list requires deleting a profile or a
contact, and the frozen state machine, cascade logic and CALL-E adapters are untouched by this
work. It exists so a profile or contact created by mistake, or no longer needed, can be removed
from view without corrupting the historical record §14.3/§14.4 depend on.

Physically deleting a `vulnerable_people` or `trusted_contacts` row was never an option: every
historical `events` row, `call_events` row and timeline entry references a `person_id` /
`contact_id`, and the event page (`app/events/[id]/page.tsx`) resolves names from those tables
live, on every view. A hard delete would either cascade-destroy history or leave the event page
unable to resolve a name for an old, perfectly valid event — either outcome breaks "historical
events and call summaries must still resolve and display archived people/contact names
correctly."

### Decision

**Soft deletion via a nullable `archived_at` timestamp** on both tables (migration
`0007_archive_entities.sql`). Rows are never physically removed.

- `Repository.getPerson` / `Repository.getTrustedContacts` stay **unfiltered** — they are the
  historical reads the event page depends on, and continue to resolve an archived row by id
  exactly as before.
- `Repository.listPeople` and the new `Repository.getActiveTrustedContacts` are the **active**
  reads: `archivedAt === null` only. `listPeople` backs the home page; `getActiveTrustedContacts`
  backs the person page's circle display, the contacts-management page, and — critically — every
  cascade decision point in `lib/orchestration/engine.ts` (`placeCallForIntent`,
  `startNextFamilyCall`, `processFamilyResult`). An archived contact is therefore structurally
  incapable of being selected for a new cascade step: the list the cascade reasons over simply
  does not contain them.
- `archivePerson(personId)` and `archiveTrustedContact(contactId)` are new repository methods,
  implemented identically in both drivers and covered by the shared contract suite:
  - **Idempotent.** Archiving an already-archived row is a no-op, not an error.
  - **Refuse, don't silently skip.** `archivePerson` throws `PersonHasActiveEventError` while any
    of the person's events is not yet terminal (`isTerminalEventStatus`:
    `CASE_CLOSED`/`HUMAN_REVIEW_REQUIRED`). `archiveTrustedContact` throws
    `ContactHasActiveCallError` while the contact has a call whose result is not yet processed —
    the same "in flight" definition the poll route already uses
    (`resultProcessedAt === null`). Both checks run inside the same atomic operation as the write
    (`for update` locked in Supabase), so there is no window between checking and archiving.
- `reorderTrustedContacts` and `createTrustedContact`'s priority assignment are both restricted to
  the **active** circle: reordering validates the supplied ids against active contacts only (an
  archived contact supplied in the list is rejected as "not an active contact in this trusted
  circle"), and a new contact is appended after the highest **active** priority, so archived
  contacts' stale priority values never resurface or collide.
- The two archive RPCs are `SECURITY INVOKER`, with `EXECUTE` revoked from
  `public`/`anon`/`authenticated` and granted only to `service_role`, matching every other RPC in
  this schema (`0004_security.sql`'s pattern). `reorder_trusted_contacts` is redefined
  (`create or replace`, identical signature) to exclude archived contacts from its own validation;
  its existing grants are untouched by the replacement.
- **No CALL-E call is ever placed by archiving.** The operation only ever writes a timestamp (or,
  on refusal, writes nothing at all) — there is no path from either archive method to
  `CalleAdapter`.

### UI

- A small trash-icon button (🗑, matching the existing Unicode-glyph convention already used for
  the ↑/↓ reorder buttons — no icon library is introduced) appears next to each profile name on
  the home page and next to each trusted contact in the circle-management screen, each with an
  `aria-label` naming who it deletes.
- Confirmation is the browser's native `window.confirm()` — deliberate, since no modal component
  exists in this codebase yet and a native dialog needs no dependency.
- On refusal (409) or an unknown id (404), the button shows the server's message inline and
  changes nothing else — no optimistic removal, so a refused deletion can never appear to have
  silently succeeded.
- On success: the home page and the contacts-management page call `router.refresh()`; the
  person's own detail page, when deleting the profile it is currently displaying, redirects to
  `/` instead, since refreshing the same page after deleting its own subject makes no sense.

### Product-scope check

No product feature is added, removed or reinterpreted, and no frozen document is touched. Soft
deletion is infrastructure for the Phase 5 interface, not a new workflow: the cascade, the state
machine and CALL-E integration behave identically for every currently-active person/contact:
their behaviour is entirely unchanged by this decision. §16's `VulnerablePerson`/`TrustedContact`
gain one bookkeeping field, the same way `DEC-004`'s `runId` and `DEC-006`'s lease fields were
added without being product features.

### Consequences

- `CreatePersonInput` / `CreateTrustedContactInput` both exclude `archivedAt` — it is never
  caller-supplied, only ever set by the two archive methods.
- `app/events/[id]/page.tsx` is untouched: it already used the unfiltered `getTrustedContacts`,
  so historical resolution for an archived contact works with zero changes to that file.
- `app/people/[id]/contacts/contact-manager.tsx` gained a small, directly-motivated fix alongside
  this feature: its `order` state was derived from the `contacts` prop only at mount
  (`useState`'s initializer is ignored on subsequent renders), so a deleted — or newly added —
  contact would not actually disappear from view after `router.refresh()` without it. A `useEffect`
  keyed on the joined id list resyncs `order` whenever the active contact set changes, without
  resetting an in-progress local reorder on an unrelated re-render.

### Approval

Project owner approval: approved, with the explicit requirements that rows are never physically
deleted, active-event and active-call protection are enforced server-side and tested, contact
ordering and cascade selection operate only on active contacts, historical display keeps working
unchanged, and no CALL-E call is ever placed as part of deletion.

---

## DEC-010 — `person_requests_help` and `unusual_confusion`: two collected Companion signals the decision rule never read

**Date:** 30 July 2026
**Status:** Approved

### Context

An audit of whether KinCall should gain an "Emergency feature" (requested separately from this
change) surfaced a live defect rather than a case for a new feature. `prompts/companion-agent.ts`
instructs the extraction model to set `person_requests_help: "yes"` only "if the person explicitly
asked for help or for someone to be contacted." `lib/calle/schemas.ts` has validated and normalized
this field since DEC-002 (`personRequestsHelp` on `NormalizedCompanionResult`). But
`lib/orchestration/decide-companion-action.ts` never read it, and never read `unusualConfusion`
either.

Concretely: `person_reached: "yes", person_requests_help: "yes", fall_mentioned: "no",
mobility_difficulty: "no"` fell through every branch to `LOG_AND_CLOSE` / `priority: "low"` /
`reason: "No unusual signal detected."` — closing the event as `CASE_CLOSED` and stating on the
dashboard "KinCall reviewed the check-in and found nothing unusual", to someone who had explicitly
asked for help. This is the same class of defect DEC-003 fixed for an unanswered call: a signal
`PRODUCT_SPECIFICATION.md` §9.1 requires collecting was collected, validated and normalized, and
then read by nothing. §9.2's "Exemple de logique simplifiée" predates this rule and does not
enumerate `person_requests_help`; it is illustrative, not exhaustive, and §9.1 already mandates
collecting the field. Zero tests exercised `person_requests_help` or `unusual_confusion` as a
non-`"no"` decision input before this change.

### Decision

1. `decideCompanionAction` gains two new branches, in this exact order:
   - `personRequestsHelp === "yes"` → `CONTACT_TRUSTED_PERSON`, `priority: "high"`. Checked
     immediately after the existing `personReached === "no"` guard and **before** the fall /
     mobility-difficulty rules — an explicit request for help outranks an inferred one. `"yes"`
     means the person explicitly asked, per the prompt's own instruction to the extraction model;
     `"unknown"` is deliberately excluded from this branch and falls through to the ordinary rules
     instead of escalating on a guess, so an ambiguous call never floods the trusted circle.
   - `unusualConfusion === "yes"` → `REQUEST_HUMAN_REVIEW`, `priority: "medium"`. Placed after the
     fall rules and before the existing `personReached === "unknown"` check. Confusion is an
     *interpretation*, not a stated fact (§17.6), so it routes to human review rather than the
     trusted-contact cascade — it must never escalate to the family on a guess.
2. The full rule order is now: `personReached === "no"` → `personRequestsHelp === "yes"` →
   (`fallMentioned === "yes" && mobilityDifficulty === "yes"`) → `fallMentioned === "yes"` alone →
   `unusualConfusion === "yes"` → `personReached === "unknown"` → `LOG_AND_CLOSE`.
3. No change to `collectInformationToShare` (`lib/orchestration/engine.ts`): it already mapped
   `person_requests_help === "yes"` → `"asked for help"` in the Family Agent's `informationToShare`
   regardless of which decision rule fired, so the family already hears the right thing, worded
   with preserved uncertainty (§17.5), once the decision reaches them.
4. `event.priority` — already persisted, already a valid enum value, previously displayed nowhere —
   is now shown on the event page. A static, unconditional safety notice ("KinCall is not an
   emergency service and does not contact emergency services...") is added to both the event page
   and the person page. It does not vary with detected severity, decision or priority, so it can
   never itself function as a severity signal.
5. `ACTIVATE_CONFIGURED_ESCALATION` (declared in `lib/orchestration/states.ts`'s
   `OrchestrationDecision` union) remains deliberately unproduced. §9.4's configured-escalation
   procedures (professional carer, teleassistance, designated manager) require escalation rules
   that do not exist in §16's data model; building them means new tables and new product scope,
   which is out of bounds for a decision-rule correction. It stays a dead enum value, same as
   `PERSON_DID_NOT_ANSWER` was pre-DEC-003, until a future decision explicitly takes it on.

### Why this is not an emergency-service feature

No code path added or touched by this change calls, offers to call, or routes toward any emergency
service, in any mode. `CONTACT_TRUSTED_PERSON` is the same trusted-circle cascade the fall rules
already used — same consent enforcement (DEC-007), same untrusted-`contact_id` handling (DEC-005),
same stop-on-confirmation behaviour, same one-attempt-per-contact. This is a decision-rule
correction that makes an already-collected, already-required signal reachable, not a new workflow,
not a new state, and not broadened scope. `PRODUCT_SPECIFICATION.md` §13.3, §17.4 and §9.4's
prohibition on real emergency-service calls, and `CLAUDE.md`'s equivalent rule, are untouched.

### Product-scope check

No product feature is added, removed or reinterpreted, no product concept is renamed, no new
workflow is introduced, and no out-of-scope feature moves into the MVP. `CONTACT_TRUSTED_PERSON` and
`REQUEST_HUMAN_REVIEW` are both frozen §9.2 decisions, already implemented and already reachable
from other rules; this change adds two more, already-specified inputs that reach them.
`git diff lib/orchestration/states.ts lib/orchestration/transitions.ts` is empty: no new
`EventStatus`, no new `TransitionEvent`. No migration: `priority` and `decision` are existing,
already-valid columns and enum members.

### Consequences

- Six new unit tests on `decideCompanionAction` (`tests/state-machine.test.ts`) cover: help-only
  signal escalates at high priority rather than closing; help request wins over the fall rules;
  help request is not trusted when the person was not reached; `"unknown"` does not escalate;
  unusual confusion requests human review rather than the cascade; help request wins over mere
  confusion.
- Five new engine-level tests (`tests/engine.test.ts`) cover: the full Julie→Marc cascade running
  and closing at high priority on a help-only signal; the Family Agent receiving "asked for help" in
  `informationToShare`; unusual confusion alone routing to human review with no family call placed;
  an `"unknown"` help-request value not auto-escalating; and DEC-007 consent enforcement still
  holding (an unconsented contact escalates the whole event to `HUMAN_REVIEW_REQUIRED` with zero
  family calls placed, unaffected by the help-request trigger).
- The existing Marie → Julie → Marc fall-and-mobility-difficulty scenario is unchanged: its
  branch, priority and timeline wording are untouched by this change.
- No database migration. No CALL-E prompt/schema field is added; both fields were already required
  and normalized.

### Approval

Project owner approval: approved (explicitly requested as "the approved safety fix identified
during the Emergency-feature audit... not a new Emergency feature... a correction to the existing
Companion decision logic"), with the explicit constraints that no emergency-service calling, no new
emergency state, no `ACTIVATE_CONFIGURED_ESCALATION` implementation and no database migration be
introduced.

---

## DEC-011 — Autonomous attention detection, bounded retries, and `ATTENTION_UNRESOLVED`

**Date:** 30 July 2026
**Status:** Approved

### Context

KinCall's orchestration was fall-shaped and, at three points, human-shaped. The Companion result
enumerated `fall_mentioned` / `mobility_difficulty` and little else, so a person describing pain, an
injury, distress, or any other unusual event produced no signal the decision rule could act on.
`recommended_attention_level` existed but was described to the model in fall terms
("high when a fall and mobility difficulty are both present") and was read by nothing. And three
paths ended at `HUMAN_REVIEW_REQUIRED` — a malformed result, a contact who could not lawfully be
called, and an exhausted circle — each of which stopped the workflow until a person intervened.
`RETRY_CHECK_IN` had the same shape: DEC-003 deliberately left it meaning "a retry is owed", with
no code to place one.

This is an approved **product evolution**, not a defect fix: the objective is that KinCall handles
more situations than falls, estimates an operational level of attention, and runs to a terminal
state on its own. It is recorded here in full because it changes frozen behaviour.

### Decision

**1. A generic operational attention model.** `CompanionStructuredResult` is widened to carry
`explicit_help_requested`, `fall_mentioned`, `mobility_difficulty`, `pain_or_injury_mentioned`,
`unusual_confusion`, `distress_expressed`, `conversation_ended_normally`, `other_attention_signal`,
`does_not_want_to_disturb_family`, a `neutral_summary`, a `confidence`, a binary
`attention_required` of `yes | no | unknown`, and `attention_reasons` from a **closed** list of
reason codes. The closed list is deliberate: a free-text reason could smuggle in a medical
interpretation.

`attention_required` is explicitly **operational, not medical**: "should somebody check in", never
"how serious is this". The prompt asks for short neutral clarification questions (whether something
unusual happened, whether they can move around as usual, whether anyone is with them, whether they
want their circle told) and forbids symptom questions, severity ratings and medical checklists.

*(Revision, applied before this decision shipped — see "Priority removed" below: the field was
initially a four-value `attention_level` of `none | attention | high | unknown`. It is documented
here in its final, binary form.)*

**2. The AI interprets; the state machine decides.** `decideCompanionAction` evaluates, in order:

1. `personReached === "no"` and the retry not yet used → `RETRY_CHECK_IN`
2. `personReached === "no"` after the bounded retry → `CONTACT_TRUSTED_PERSON`
3. `explicitHelpRequested === "yes"` → `CONTACT_TRUSTED_PERSON`
4. any explicitly stated signal (fall, mobility difficulty, pain or injury, unusual confusion,
   distress, an abnormal ending, another unusual signal) → `CONTACT_TRUSTED_PERSON`
5. `attentionRequired === "yes"` → `CONTACT_TRUSTED_PERSON`
6. `attentionRequired === "unknown"` → `CONTACT_TRUSTED_PERSON` (by precaution)
7. reached **and** ended normally **and** `attentionRequired === "no"` **and** no stated signal →
   `LOG_AND_CLOSE`

There is no priority tier anywhere in this order — see "Priority removed" below. Rules 2 and 3
**override** the model's own report, because failing to reach someone and being explicitly asked
for help are operational facts, not judgements. Rule 7 is the only closure path and requires
positive evidence on every axis; everything else — including unknown reachability, an unconfirmed
ending, and a result that fails validation — reaches the trusted circle. Ambiguity is never
presented as "nothing unusual" (§7.5).

**3. No operational human-review dependency.** No transition reaches `HUMAN_REVIEW_REQUIRED` any
more. The three former paths now:

- a malformed/failed Companion result → `COMPANION_RESULT_MALFORMED` → **`ATTENTION_REQUIRED`** and
  the cascade runs (an unreadable check-in is exactly when someone should look in);
- a malformed Family result → `FAMILY_RESULT_MALFORMED` → **`CONTACT_DID_NOT_ANSWER`**, so the
  contact still gets their retry and everyone after them is still called;
- an exhausted or entirely ineligible circle → `NO_CONTACTS_REMAINING` → **`ATTENTION_UNRESOLVED`**.

A result naming the wrong contact is still never acted on (DEC-005 / CLAUDE.md: a model must never
select who is called) — it is disregarded, and the cascade continues past it without redialling.

**4. `ATTENTION_UNRESOLVED`.** A new terminal state, because no existing one expresses "KinCall
detected, or could not rule out, a need for attention, and no trusted contact accepted or could be
reached". `CASE_CLOSED` would assert somebody is handling it; `NO_ACTION_REQUIRED` would assert
nothing was wrong; `HUMAN_REVIEW_REQUIRED` meant "KinCall is waiting". This one waits for nobody:
it is a finished event with an unresolved outcome, kept visible so a human can act on their own
initiative. `closedAt` is never set. `isTerminalEventStatus` includes it.

**5. Bounded retries, persisted.** Exactly one retry of the vulnerable person
(`MAX_COMPANION_ATTEMPTS = 2`) and exactly one per trusted contact (`MAX_CONTACT_ATTEMPTS = 2`). A
contact who **answered and declined** is not retried — a definitive no needs no second call. A
no-answer, a technical failure and an unreadable result all are. The attempt number is read from the
persisted `call_events.attempt_number`, never from a counter in memory, so a restart resumes at the
correct attempt; the uniqueness rules would reject a duplicate intent even if the engine asked for
one. Idempotency keys are `<runId>_companion_attempt_<n>` and `<runId>_<contactId>_attempt_<n>`, and
operation keys gained an attempt discriminator — without it, "call Julie again" and "call Marc" are
the same key and the second would silently no-op.

**6. Consent still absolute; the consequence changed.** DEC-007's rule is untouched: no call is
placed to anyone whose consent is not `confirmed`, in **any** mode. What changed is what happens
next — the cascade **skips** them, records the skip and its reason on the timeline, and calls the
next eligible contact, instead of the whole event stopping. This reverses DEC-007's cascade
behaviour, deliberately: stopping meant one unconsented first contact could leave a vulnerable
person with nobody called at all. If every contact is skipped, the event still ends visibly, at
`ATTENTION_UNRESOLVED`.

**7. Voicemail: capability-gated, and NOT proven for CALL-E.** `CalleAdapter` gained
`capabilities.voicemail`, true only if the integration can both leave a voicemail and confirm through
a structured result that it did. `LiveCalleAdapter` declares **false**, verified against
`calle.openapi.yaml` v0.2.0:

- `CallStatus` is `queued | in_progress | completed | failed | canceled`, and `AttemptStatus` adds
  only `dialing` — neither has a voicemail or answering-machine state, so a voicemail is
  indistinguishable from a no-answer at the platform level;
- there is no answering-machine-detection field anywhere in the schema;
- `failure_code` is an untyped free-form string with no documented enumeration;
- nothing in the API confirms a message was recorded.

`FamilyStructuredResult.voicemail_left` is therefore a **model self-report**, and optional so
historical results stay valid. KinCall concludes a voicemail was left only when the report says yes
**and** the adapter declares support. Otherwise it records `voicemail_unavailable` verbatim, claims
nothing, and continues to the next contact. A voicemail is only ever attempted on the final attempt
to a contact, and the orchestrator — not the agent — decides. Its content is a single fixed string
(`VOICEMAIL_MESSAGE`) with no incident detail, no health detail, no interpretation, not the
vulnerable person's name, and not any other contact's identity; when voicemail is unsupported the
agent is instructed to leave nothing at all rather than a paraphrase.

**8. Interface.** The event page shows the binary operational outcome in plain language — "No
attention needed", "Trusted circle contacted", or "Attention unresolved" (with an explicit "not a
medical assessment" caveat) — the neutral summary, the detected attention reasons as labels, the
current workflow step, per-attempt check-in and trusted-circle histories, the voicemail outcome,
contacts never called, who accepted, and `ATTENTION_UNRESOLVED` as a visible terminal result. No raw
enum value and no priority label is rendered where a plain-language outcome exists; every label
switch is exhaustive with a `never` default. The unconditional safety notice (DEC-010) is unchanged.

**9. Fake-mode demo scenarios.** Five selectable scenarios (`marie_baseline`, `explicit_help`,
`other_incident`, `person_unreachable`, `all_contacts_unavailable`), each labelled as demo data. The
selector renders **only** when `CALLE_MODE=fake`, and `/api/events/start` **ignores** the parameter
in live mode rather than rejecting it, so live behaviour is byte-for-byte what it was before the
selector existed. A companion call to any person other than the seeded demo person still throws
rather than reporting Marie's script for someone else.

### Priority removed — no distinguishable behaviour

Applied as a revision before this decision shipped, once the priority tiers were reviewed against
what the cascade actually did with them.

The initial design carried a four-value `attention_level` (`none | attention | high | unknown`) and
assigned a matching `event.priority` (`low | medium | high`) on every decision. On review, **`high`
and `medium` triggered the identical trusted-circle cascade** — same contacts, same order, same
retries, same stop-on-confirmation. Nothing in the engine ever branched on priority; it was a label
attached to an outcome, not an input to one. Displaying it invited a reading of "high priority" as a
materially different, more urgent situation, when no such distinction existed anywhere in the code —
closer to false reassurance (or false alarm) than to precision, and in tension with §7.5's rule
against asserting more than KinCall has established.

**KinCall's operational decision is binary: close the check-in, or contact the trusted circle.**
`attention_required` (`yes | no | unknown`) replaced `attention_level` in the Companion result (see
clause 1); `decideCompanionAction` no longer computes or returns a priority (see clause 2); and
`event.priority` is simply never set on a new event (see "Interface impact" below). Two rules remain
deterministic cascade triggers regardless of this simplification — an explicit request for help, and
failure to reach the person after the bounded retry — because those are operational facts the model
cannot talk KinCall out of, not judgements a tier could grade. **This is not medical triage**:
KinCall still makes no severity assessment in either direction: not before the simplification (it
never asked "how bad is this"), and not after it (it does not ask "should this be graded" either).

**Interface impact.** `event.priority` is a **pre-existing, already-nullable** column
(`0001_init.sql`); no migration is added or altered for this simplification (see "Migration
reviewed" below). New events simply never populate it — `decideCompanionAction`'s result carries no
`priority` field, so the engine's patch object never includes the key, and the column keeps its
column-default `NULL`. Historical rows that do carry a value (from this same session's earlier,
unshipped `attention_level` design) are untouched and still render: the event page never reads
`event.priority` for any decision or display, so a historical value neither breaks anything nor
appears.

### Backward compatibility

- `HUMAN_REVIEW_REQUIRED` and `REQUEST_HUMAN_REVIEW` are **retained** in `EventStatus` /
  `OrchestrationDecision`, and `COMPANION_RESULT_UNCERTAIN` / `FAMILY_CALL_NOT_POSSIBLE` in
  `TransitionEvent`. Nothing produces them; historical events keep type-checking and rendering. No
  enum value and no historical record is deleted to simplify code.
- The pre-DEC-011 Companion shape is readable but never produced.
  `isCompanionStructuredResult` validates the current shape **strictly** and rejects the legacy one
  outright, so a fresh incomplete result degrades to the attention cascade rather than reading
  uncollected signals as absent. `readCompanionResult` accepts either and is what every display path
  uses. The legacy mapping is conservative: fields v1 never collected become `unknown`, not `no` — an
  absence of evidence is not evidence of absence — and v1's fall-centric `low` maps to
  `attentionRequired: "no"`, its `medium`/`high` both to `"yes"` (the same collapse applied going
  forward — see "Priority removed" below).
- `call_events.attempt_number` defaults to 1, which is what every pre-existing row was under the old
  one-call-per-contact constraint.

### The updated Marie timeline

§12's demo now has thirteen entries rather than nine, because Julie gets her bounded retry and the
second unanswered call leaves the voicemail. The outcome is unchanged — Marc confirms, the case
closes, Nicole is never called:

```text
Check-in call started
Check-in call completed
The person mentioned a fall, difficulty moving around.
Calling Julie
No answer from Julie (attempt 1)
No voicemail attempted — one more attempt is owed
Calling Julie again (attempt 2)
No answer from Julie (attempt 2)
Voicemail left
Calling Marc
Marc answered
Visit confirmed — 17:30
Case closed
```

### Conflicts with the frozen specification

Flagged explicitly rather than silently rewritten:

1. **§15 enumerates thirteen event states; `ATTENTION_UNRESOLVED` is a fourteenth.** A genuine
   addition to a frozen list. Justified because §15's states cannot express the autonomous dead end,
   and the alternative — reusing `CASE_CLOSED` or `NO_ACTION_REQUIRED` — would assert something
   false about a vulnerable person's situation, which §7.5 forbids.
2. **§9.4 requires "une validation humaine … avant toute action critique", and §7.5 keeps the human
   responsible.** Reconciled, not overridden: the actions KinCall takes autonomously are calls to a
   consented trusted circle, which §9.3's own cascade already performs without human validation. The
   critical actions §9.4 gates are emergency-service actions, and KinCall still performs none. The
   human remains responsible and informed — `ATTENTION_UNRESOLVED` is a visible, actionable end
   state — but the workflow no longer *blocks* on them.
3. **§9.1's expected output is fall-centric.** DEC-002 already recorded that KinCall diverges from
   §9.1's nested `signals[]` shape; this widens the same flat categorical result. §9.1's
   `person_requests_help` survives as `explicit_help_requested`, and `does_not_want_to_disturb_family`
   is retained rather than dropped.
4. **§9.2's "Exemple de logique simplifiée" is superseded** by the seven-rule order above. It is
   labelled an example, and its own no-answer clause ("si le nombre maximal de tentatives est
   atteint : contacter le premier proche") is what rule 2 finally implements — DEC-003 deferred only
   the bound.
5. **DEC-007's cascade consequence is reversed** (clause 6 above). Its consent *rule* is untouched.
6. **DEC-003's "`RETRY_CHECK_IN` means a retry is owed, not scheduled"** no longer holds: it is now
   placed automatically. That note warned against mistaking it for automation later; this entry is
   that later, made explicit.
7. **DEC-010's `unusual_confusion` → `REQUEST_HUMAN_REVIEW` rule is superseded.** With no
   operational human-review path, confusion reaches the trusted circle like any other stated signal.
   DEC-010's other half — an explicit help request outranking the fall rules — is preserved as rule 3.

No conflict with §13.3, §17.4, or `CLAUDE.md`'s emergency prohibition: nothing added here calls,
offers to call, or routes toward any emergency service, in any mode, and
`ACTIVATE_CONFIGURED_ESCALATION` remains deliberately unproduced (DEC-010).

### Migration

`0008_call_attempts.sql`. **Genuinely unavoidable**, and the only schema change: `unique (event_id,
contact_id)` and `idx_call_events_one_companion` make a second call to the same subject structurally
impossible, so no application logic can express a retry. It adds
`attempt_number integer not null default 1`, replaces both uniqueness rules with per-attempt
equivalents, and drop-and-recreates `commit_transition_with_call_intent` with a `p_attempt_number`
parameter (a new parameter changes the signature), reapplying 0004's revoke/grant pair for the new
signature. Additive and backward-compatible; the replacement rules are strictly weaker than the ones
they drop, so no existing row can violate them. Attention signals, the neutral summary and the
attention requirement need no schema change — they live in the existing `structured_result` jsonb —
and `events.status` deliberately carries no CHECK constraint, so `ATTENTION_UNRESOLVED` needs none
either. **Not applied remotely by this change.**

**Migration reviewed after the priority simplification, above, and found unaffected.** The
migration never touches `events.priority` or `events.decision` in any way beyond the generic
`commit_transition_with_call_intent` patch mechanism both already had (the `case when p_patch ?
'priority' then … else priority end` clause, unchanged from `0002_functions.sql`) — a mechanism
that already tolerated a patch omitting `priority` entirely, which is exactly what the engine now
always does. No column, constraint, or function signature needed any change for this
simplification, and none was made.

### Consequences

- Every trusted contact is now called up to twice, so a cascade places up to 2n calls rather than n.
  In live mode that doubles the worst-case call volume to a consenting circle.
- A person who does not answer is called twice rather than once.
- `LiveCalleAdapter.capabilities.voicemail` should be flipped to `true` only when CALL-E documents a
  voicemail-confirmation mechanism — not when it merely appears to work.
- No new event is ever assigned a priority; `event.priority` reads `NULL` for everything created
  from this decision onward. A pre-existing historical value, if a test or a prior local run left
  one, still renders unchanged (see "Priority removed" above).
- Test count is 474, including `tests/autonomous-cascade.test.ts` (bounded retries, the voicemail
  capability gate, restart points at each attempt, all five demo scenarios) and new coverage in
  `tests/state-machine.test.ts` / `tests/event-summary.test.ts` for the binary decision and the
  three plain-language operational outcomes.

### Approval

Project owner approval: approved as a deliberate product evolution, with the explicit requirements
that KinCall remain autonomous with no operational human-review dependency, that the deterministic
state machine control all actions, that voicemail capability not be invented, and that KinCall never
diagnose, never assess medical severity, and never contact emergency services in any mode. The
priority simplification above was requested and approved before this decision shipped, once review
showed the tiers had no distinguishable effect on the cascade.

---

## DEC-012 — `events.priority` column removed entirely

**Date:** 30 July 2026
**Status:** Approved

### Context

DEC-011 ("Priority removed") had already stopped the application from ASSIGNING a priority to any
new event, once review showed that "high" and "medium" always triggered the identical
trusted-circle cascade — the column carried a label with no distinguishable operational effect.
That change kept the `events.priority` column itself (nullable, pre-existing) purely so historical
rows and the TypeScript type didn't need touching at the time.

With the application now confirmed to never read or write it, and migration 0008 not yet applied
remotely, this is the natural follow-through: remove the column, and its patch-handling logic, so
nothing in the schema, the RPCs, or the domain types carries an unused field forward indefinitely.

### Decision

**1. `EventRecord` no longer has a `priority` field.** Removed from `lib/database/types.ts`, along
with the now-unused `Priority` type (`lib/orchestration/states.ts`). Removed from
`lib/database/row-mappers.ts` (`EventRow`, `toEvent`, `fromEventPatch`), from
`CommitTransitionInput`'s patch `Pick` (`lib/database/repository.ts`), and from
`InMemoryRepository.createEvent`'s literal (`lib/database/in-memory-repository.ts`). No UI ever
displayed it after DEC-011; the informational comments explaining that omission were simplified to
state the column no longer exists.

**2. Migration 0008 edited before it shipped.** `0008_call_attempts.sql` is not yet applied
remotely, so its recreation of `commit_transition_with_call_intent` (needed anyway, for the new
`p_attempt_number` parameter) was edited in place to drop the `priority = case when p_patch ?
'priority' …` line from that function's `UPDATE events SET …`. This is not an edit to an applied
migration — it is a correction to a file that has never run against any database — and it means
0008, once applied, creates a function that never references the column migration 0009 removes.

**3. New migration: `0009_drop_event_priority.sql`.** Redefines `commit_transition` (`create or
replace function`, identical signature to `0002_functions.sql`'s original — so every existing grant
from `0004_security.sql` carries over untouched) with the same `priority` line removed, **then**
`alter table public.events drop column priority;`. Dependency check performed before writing the
drop: no view, trigger, or index in this schema references `events.priority` — its only
dependents were the two `UPDATE … SET priority = …` clauses in `commit_transition` (0002) and
`commit_transition_with_call_intent` (0008), both eliminated in this same change before the column
is actually dropped. `DROP COLUMN` cascades to remove the column's own inline `CHECK (priority in
('low','medium','high'))` constraint automatically; there is no separately named constraint or
index on it.

**4. `trusted_contacts.priority` is untouched.** A different column entirely — the trusted-circle
cascade ordering field, checked `> 0`, unique per person, maintained by
`reorder_trusted_contacts`/`archive_trusted_contact`/`create_trusted_contact`. Nothing about this
decision changes it; `events.current_contact_priority` (a denormalized copy of a *contact's*
priority number, for display of "whose turn it is") is likewise untouched — it is a different
column from the one being removed and continues to work exactly as before.

### Product-scope check

No product feature is added, removed or reinterpreted. `events.priority` was never a
frozen-specification field — it was purely an internal artifact of DEC-011's original attention
model, already superseded by that same decision's own revision before this cleanup. Removing an
already-unused column changes no observable behaviour.

### Historical data

Before this migration is applied, the remote `events` table may contain rows with a non-null
`priority` value, written before DEC-011's revision stopped assigning one. **Those values are
permanently lost once `0009_drop_event_priority.sql` runs** — there is no replacement field and no
export step, because nothing in the product reads that value today and the column has nowhere left
to live once dropped. See the accompanying report for the exact row count captured immediately
before this decision, obtained with a read-only `count`-only query that returned no event content,
no phone numbers, and no other person-identifying data.

Every other column on those rows — `id`, `status`, `decision`, `decision_reason`,
`current_contact_priority`, `created_at`, `closed_at`, every `call_events` row, every
`timeline_entries` row — is entirely unaffected. Historical events remain fully readable: the row
mapper and `EventRecord` type no longer reference `priority` at all, so a row that no longer has the
column maps identically to one that always lacked it.

### Migrations reviewed together

**0008 and 0009 are safe to apply in that order, in the same session or separately.** 0008 adds
`call_events.attempt_number`, moves its uniqueness rules to per-attempt, and recreates
`commit_transition_with_call_intent` — already without any `events.priority` reference, per clause 2
above. 0009 redefines `commit_transition` and then drops `events.priority`. Neither migration's
statements depend on the other completing first: 0008 touches only `call_events` and its own RPC;
0009 touches only `commit_transition` and the `events` table. Applying 0009 without 0008 first
would work identically for the column removal (0008 has no bearing on `events.priority` after its
own edit); applying 0008 without 0009 leaves the column in place, unused, exactly as it is today.

### Consequences

- `event.priority` cannot be read, written, or displayed anywhere in the application — there is no
  field left to hold a value even if some future code tried.
- Tests that constructed an `EventRecord`/patch with a `priority` value no longer compile as
  written; they were updated to drop the field entirely rather than pass `null` or `undefined` for
  a property that no longer exists on the type.
- Any future reintroduction of an operational priority tier would require a new migration adding
  the column back, plus a new decision-log entry — it is not "commented out" or soft-disabled
  anywhere.

### Approval

Project owner approval: approved as a direct follow-through from DEC-011's own "Priority removed"
revision, with the explicit requirements that `trusted_contacts.priority` and
`events.current_contact_priority` remain untouched, that migrations 0001–0007 are never edited,
that the remote historical row count be reported before any migration runs, and that neither 0008
nor 0009 be applied in this change.

---

## DEC-013 — Pre-release resilience, a shared design system, and error boundaries

**Date:** 30 July 2026
**Status:** Approved

### Context

The autonomous cascade was validated (fake mode, five scenarios, migrations 0001–0009 applied, 471
tests green) but nothing had been built *around* it. An audit before any public deployment found one
class of genuine defect and several silent-failure hazards:

**1. Five of six interactive components could permanently disable themselves.** `PersonForm`,
`ContactManager` (add and reorder), `DeletePersonButton`, `DeleteContactButton` and the shared
`submitContactForm` all did `setBusy(true)` and then `await fetch(...)` with no `try`/`catch`. A
network-level rejection — offline, DNS failure, a dropped connection — propagated out of the click
handler and left the busy flag `true` for the rest of the session: the button stayed disabled with
no route back but a full page reload. `LaunchDemoButton` was the only one that handled it. The
`catch` calls a grep found in the others were all `response.json().catch(() => ({}))`, which
protects the body parse, not the request. `PersonForm` additionally called `await response.json()`
on its *success* path with no guard, so a 200 with an unexpected body threw the same way.

**2. Two safety-net files carried a stale function signature.**
`supabase/rollback/0000_rollback.sql` dropped `commit_transition_with_call_intent` with the
pre-0008 ten-parameter signature. `DROP FUNCTION IF EXISTS` with a non-matching argument list is a
silent no-op, so a teardown would have reported success while leaving the current eleven-parameter
function in place. `tests/integration/supabase-security.test.ts` called the same RPC with the same
stale ten-argument shape, so PostgREST could not resolve the function at all — its
`expect(error).not.toBeNull()` passed on *"function does not exist"* rather than on a denied
`EXECUTE` grant, meaning that one privilege check had not actually been running since 0008.

**3. No error boundaries existed at all.** `app/error.tsx`, `app/global-error.tsx` and
`app/not-found.tsx` were all absent, so any unhandled server error or unmatched route fell through
to Next.js's own default screen.

**4. There was no design system.** `app/globals.css` was the untouched `create-next-app` starter
(`--background`/`--foreground` only). Every page hand-rolled its own `border-black/10`,
`opacity-70`, `text-amber-700` utilities independently. There were five `aria-*` attributes in the
whole of `app/`, zero `aria-invalid`, zero `aria-describedby`, no `focus-visible` styling and no
`prefers-reduced-motion` handling.

### Decision

**1. Every client fetch is wrapped.** All six components now use one pattern: `try` around the
request, a `catch` that records a message, and a `finally` guarded by a `navigating` flag — so a
successful redirect keeps the control disabled through the route transition while every other exit,
including a thrown request, releases it. `submitContactForm` gained an additive optional
`networkError` field on `SubmitContactResult`, deliberately separate from `errors`: a transport
failure belongs to no field, and reporting it as one ("First name: could not add this contact")
tells the user to fix something that is not wrong. Every response body read — success paths
included — is now guarded.

**2. The two stale signatures are corrected**, both to the current post-0008 eleven-parameter form
with `p_attempt_number integer` in position 10. Neither file has ever run against a database, so
this is not an edit to an applied migration.

**3. `app/error.tsx`, `app/global-error.tsx` and `app/not-found.tsx` are added.** None renders
`error.message`, which can carry internal detail; they surface `error.digest` for log correlation
instead. `global-error.tsx` is styled with **inline styles only** and imports no component: it
replaces the root layout, so it is reached when the layout itself failed — possibly because the
stylesheet or font never loaded — and a recovery screen that depends on the thing that just broke
is not a recovery screen. All three state that nothing has been changed or deleted, and none of
them implies anything about whether a check-in is in flight, since any route can reach them.

**4. A shared design system in `app/ui/`**: `tokens.css` (imported once from `globals.css`;
Tailwind v4 is CSS-first and this project has no `tailwind.config.*`), plus `button.tsx`,
`surfaces.tsx` (`PageShell`, `PageHeader`, `Card`, `Badge`, `Notice`, `EmptyState`, `Skeleton`,
`DetailRow`), `form-field.tsx`, `confirm-delete-button.tsx` and `tone.ts`. All five existing pages
were migrated onto it; no page hand-rolls button or card markup any more.

**5. `FormField` wires accessibility structurally rather than by convention.** `aria-invalid` and
`aria-describedby` have to be set on the *control* while the message they point at lives outside
it, which is why doing it by hand in every form had resulted in it being done in none of them. The
component uses a render prop so the generated ids reach whichever control the caller uses, and it
only references message ids that are actually rendered. `tokens.css` adds one `:focus-visible`
treatment for every interactive element, and disables motion outright under
`prefers-reduced-motion` rather than merely shortening it.

**6. `ConfirmDeleteButton` consolidates the two near-identical archive buttons**, which now
delegate to it. Confirmation stays the browser's native `window.confirm()` (DEC-009's reasoning is
unchanged: no modal component exists, and a native dialog is keyboard- and screen-reader-operable
with no dependency), but the trigger gained a **visible text label** instead of being an emoji
glyph whose only textual identity was an `aria-label`.

**7. `ATTENTION_UNRESOLVED` gets its own visual tone.** `StatusTone`
(`lib/orchestration/person-status.ts`) gains `"unresolved"`, and that status returns it instead of
`"attention"`. "We are currently contacting the circle" and "we finished the cascade and reached
nobody" are different outcomes and were rendering identically. This remains an **operational**
distinction: no severity is expressed in either direction (§7.5).

**8. Documentation corrected to the current state**, without rewriting any decision history:
`README.md`'s migration list showed only `0001, 0002, 0004, 0005` and now lists all eight files
through `0009`, notes the deliberate `0003` gap, documents the required Node version, and points at
`supabase/rollback/` rather than the `supabase/migrations/` path the script left in commit
`be4b321`. `START_HERE.md`, which was entirely pre-implementation bootstrap instructions ("commit
the frozen documentation before writing application code"), now orients a reader around the
documents and names the specification clauses that approved decisions have superseded.

**9. Repository hygiene.** `.DS_Store` and all eight `supabase/.temp/*` files (Supabase CLI session
cache, regenerated by `supabase link`) were tracked; both are untracked and `supabase/.temp/` is
now ignored. `package.json` declares `engines.node` as `^20.9.0 || >=22.0.0` — Next 16 requires
20.9+, and Vitest excludes 21.

### Product-scope check

No product feature is added, removed or reinterpreted, and no frozen document is edited. No new
`EventStatus`, no new `TransitionEvent`, no new decision rule, no migration, and no change to any
prompt or CALL-E schema: `git diff` on `lib/orchestration/engine.ts`,
`decide-companion-action.ts`, `states.ts`, `transitions.ts`, `lib/database/*`, `lib/calle/*`,
`prompts/*` and `supabase/migrations/*` is empty. The five fake scenarios produce their existing
timelines and terminal statuses unchanged.

`person-status.ts`'s new tone is presentation only — it changes which colour a label renders in,
not which label, and nothing branches on it. The one behavioural change is that requests which
previously threw now report a failure, which is strictly a repair.

### Consequences

- Test count grows from 471 to 479: four new cases on `submitContactForm` (a rejected request is a
  reported outcome and does not reset the form; a rejection after the connection opens; a 4xx is
  *not* reported as a connectivity problem) and a new `tests/person-status.test.ts` covering the
  unresolved tone's distinctness, that an unresolved event is never calm, that a check-in closed
  after the circle stepped in is labelled differently from one that was simply fine, and that every
  `EventStatus` — including the retained legacy ones — still yields a label and a known tone.
- `SubmitContactResult.networkError` is optional and additive, so the existing regression suite for
  the `currentTarget` and "Illegal invocation" bugs was unaffected.
- The `--background`/`--foreground` theme colours are gone. Nothing referenced `bg-foreground` or
  `text-background` any more, verified before removal.
- Accessibility is **improved, not audited**: no WCAG conformance is claimed.
- The Supabase integration lane still cannot run — no `KINCALL_TEST_SUPABASE_*` variables are
  configured, and pointing it at the live `SUPABASE_URL` would truncate real event history via
  `kincall_test_reset()`. The security-test correction above is therefore verified by inspection of
  the migration's own signature, not by execution.

### Approval

Project owner approval: approved as a pre-release readiness phase, with three design forks resolved
before implementation — a contact's confirmation stays **terminal** (no human-blocking
intervention state, preserving DEC-011's autonomy and `archivePerson`'s active-event refusal);
contact availability will **order but never exclude** when it is built; and analytics will ship
**count-based only**, with duration metrics omitted rather than shown as ~0 ms in fake mode and
with false-positive and unnecessary-escalation rates rejected outright as unsupportable by any data
KinCall holds.

---

## DEC-014 — Landing page, dashboard, history, and count-based KPIs

**Date:** 30 July 2026
**Status:** Approved

### Context

DEC-013 made the existing five pages resilient and gave them a shared design system, but the
product still had no cross-person view at all: there was no dashboard, no history/calendar, no
KPI of any kind, and `/` was simultaneously the marketing pitch and the operational profile list.
This phase adds those, without touching the validated cascade.

Two things this phase does are genuine extensions beyond `PRODUCT_SPECIFICATION.md`'s frozen MVP
feature list, flagged per `CLAUDE.md`'s change-control rule rather than absorbed silently:

**1. A cross-person KPI dashboard.** §18 lists "taux d'appels répondus", "temps moyen avant
confirmation d'un proche" and similar metrics explicitly under **"Indicateurs produit futurs"** —
future, not MVP. Approved here as a deliberate, bounded extension: **count-based metrics only**,
with every duration metric rejected outright (see below).

**2. Splitting the "page d'accueil" into two pages.** §14.1 describes one page holding both the
product's presentation and the profile list. `/` is now a marketing-only landing page and
`/dashboard` is the operational home; every element §14.1 requires is still present, on
`/dashboard`, not lost.

### Decision

**1. Route groups, not new URLs for existing pages.** `app/(marketing)/page.tsx` → `/`;
`app/(app)/layout.tsx` wraps `/dashboard`, `/history`, and the existing `/people/*` and
`/events/*` pages (moved under `app/(app)/` with `git mv`, so their history is preserved and no
URL changed). A route group's parenthesised segment never appears in the URL — this is the
mechanism, not a workaround. `app/(app)/layout.tsx` is documented as the one place a future
authentication check would go; none is added now.

**2. `DeletePersonButton`'s `redirect-home` mode is renamed `redirect-dashboard`** and now pushes
to `/dashboard`. `/` is no longer a sensible place to land after deleting a profile, since it no
longer shows the profile list at all.

**3. Presentation helpers move out of route files.** `describeAction`, `describeAttentionOutcome`,
`describeAttentionReason`, `describeConfidence`, `describeFamilyAttempt`, `describeFamilyCascade`,
`describeOwnership`, `describeWorkflowStep`, `findConfirmation` and the `Confirmation` type move
from `app/(app)/events/[id]/page.tsx` into `lib/presentation/event-summary.ts`, unchanged in
behaviour. `tests/event-summary.test.ts` and `tests/archive.test.ts` now import from the library
module instead of a Next.js route file — the dashboard and history page needed these same
functions, and importing from a `page.tsx` is fragile (it pulls in the whole route module) and
was only ever true by accident. The event page itself is now purely presentational glue over this
module; `STATUS_TONE` (previously duplicated identically on the person and event pages) is
likewise centralised in `lib/presentation/status-tone.ts`.

**4. Two additive repository methods, on both drivers**: `listRecentEvents({ since, limit })`
(cross-person, bounded by both a time window and a row limit — there is deliberately no unbounded
"all events" read) and `listCallEventsForEvents(eventIds)` (a batched form of `listCallEvents`, so
displaying N events' call history costs one query rather than N). Both are covered by the shared
`tests/repository-contract.ts` suite, including that an archived person's historical events remain
visible through the cross-person read (DEC-009's guarantee extends to it) and that batched call
events preserve the same per-event order `listCallEvents` already guarantees.

**5. Count-based KPIs only** (`lib/kpi/dashboard-kpis.ts`): total check-ins, normal check-ins
(rate), cascades triggered (rate), attention-unresolved count, person-reached (rate, over usable
completed Companion results only), and mean Family attempts before confirmation. Every rate carries
its own sample size and reads `null` rather than a fabricated `0%` when the denominator is zero —
never a divide-by-zero, never a silently invented number.

**Rejected outright, not merely deferred:**

- **Every duration or response-time metric** ("average time before a trusted contact confirmed",
  "average number of attempts" as a *time*-based figure). Fake-mode events run their entire
  cascade synchronously inside one request (`lib/orchestration/engine.ts`'s `startDemoEvent`), so
  any such duration measures ~0 ms for every fake-mode event today — a number that is technically
  computable but operationally meaningless, and visually indistinguishable from a genuinely fast
  real confirmation. Showing it would be a fabricated metric wearing the clothes of a real one, not
  an honestly-labelled "not enough data" state.
- **False-positive rate and unnecessary-escalation rate**, both present in §18's own
  "indicateurs produit futurs" list. Both require ground truth about whether attention was
  *actually* warranted — a judgement KinCall never receives from anyone and never makes itself
  (§7.5, §17.6). No version of this phase implements either, in any form.

**6. A history page filters by outcome *category*, not raw `EventStatus`.** §9's three neutral
categories — "normal check-in", "trusted circle contacted", "attention unresolved" — are the
product's own binary-decision vocabulary (DEC-011), and are what
`lib/presentation/history-view.ts`'s `categorizeEventOutcome` computes and what the history page's
filter and calendar both key on. Raw internal statuses like `CALLING_TRUSTED_CONTACT` or
`CONTACT_DID_NOT_ANSWER` are transient/internal and were never a sensible axis to filter completed
history by. `HistoryEventView` still carries the raw `status` for internal partitioning use (e.g.
the dashboard's "needs attention now" section, which must key on the literal
`ATTENTION_UNRESOLVED` value) — the rule this respects is DEC-011's "no raw enum value is ever
*rendered*", not a ban on holding one internally.

**7. One fixed display timezone, `Europe/Paris`, everywhere.** No person has a persisted timezone
yet — that is explicitly Stage D's job, not this one's — so `lib/presentation/format-date.ts`
fixes one zone for every date and time shown anywhere in the interface, deliberately **neither**
the server process's timezone (which on Vercel is whichever region the function runs in, making
output depend on infrastructure rather than the product) **nor** the visitor's browser timezone
(which would make the same URL render differently for two people, and would mismatch between
server-rendered and client-hydrated output). Every formatter passes `timeZone` explicitly, so
output is identical regardless of the ambient process timezone — verified in
`tests/format-date.test.ts` by flipping `process.env.TZ` mid-test and asserting no change, and by
asserting the correct, *different* UTC offsets for a summer and a winter instant. Marked with a
`STAGE D TODO` in the module itself: once a person's timezone is persisted, a caller that knows
whose event it is should pass that timezone instead of relying on this fallback.

**8. The person page's "Next check-in: daily at {time}" wording is corrected** to "Preferred
check-in time: daily at {time}" (`app/(app)/people/[id]/page.tsx`, and the same honest phrasing in
`app/ui/profile-card.tsx`). No occurrence has ever been computed anywhere in this codebase — the
field is a bare `"HH:MM"` string with no persisted timezone or day-of-week (Stage D's job) — so the
former wording asserted a fact the product could not back up. This is a wording correction, not new
scope: nothing about scheduling is implemented in this phase.

**9. Public-demo write safety is a known, documented gap, not fixed here.** Every mutating route
(`POST /api/people`, `POST .../contacts`, both `DELETE`s, the reorder route, and — in live mode
only — `POST /api/events/start`) remains unauthenticated, exactly as before this phase; nothing new
and unsafe was added (the two new routes, `/dashboard` and `/history`, are read-only). README now
states explicitly that a shared write-token gate (or real authentication) is required before any
public deployment, per `CLAUDE.md`'s "no authentication unless a concrete current requirement
proves it necessary" — Stage B's own requirements do not.

### Product-scope check

No product feature is removed or reinterpreted, and the validated cascade is untouched:
`git diff` on `lib/orchestration/engine.ts`, `decide-companion-action.ts`, `states.ts`,
`transitions.ts`, `lib/database/{in-memory,supabase}-repository.ts`'s existing methods, `lib/calle/*`,
`prompts/*` and `supabase/migrations/*` is empty (the two new repository methods are additive
interface members, not changes to existing ones). All five fake scenarios produce their existing
timelines and terminal statuses, confirmed by launching two of them manually against the linked
Supabase project and inspecting the result. No migration was added or needed — every new read is
built from already-persisted columns.

The two scope extensions (the KPI dashboard, and splitting `/` into two pages) are recorded above
specifically because they are extensions, not because they are believed to be problems; §13.2's
"planification récurrente" is not touched by this phase at all (no scheduler, no cron, no
unattended calling — `Call now`/launching a demo remains the only trigger).

### Consequences

- Test count grows from 479 to 539: repository-contract coverage for the two new methods (running
  against `InMemoryRepository`; the Supabase-backed contract suite exists but is skipped without a
  dedicated test project, per DEC-013's already-recorded gap), `tests/kpi.test.ts` (period parsing,
  zero-denominator handling, every formula), `tests/dashboard.test.ts` (configuration-gap
  detection, day-grouping order, unresolved-first partitioning), `tests/history.test.ts` (outcome
  categorisation, view-building, filtering, calendar-day marking, month-key arithmetic), and
  `tests/format-date.test.ts` (timezone-fixedness, both DST offsets, day-key boundary crossing).
- `app/(app)/people/delete-person-button.tsx` and `app/ui/confirm-delete-button.tsx`'s
  `onSuccess` union changes from `"refresh" | "redirect-home"` to `"refresh" |
  "redirect-dashboard"` — an internal prop rename with one call site, not a behaviour change beyond
  the redirect target described above.
- The build now produces 15 routes (previously 5 pages + API routes): `/`, `/dashboard`,
  `/history`, plus the pre-existing `/people/new`, `/people/[id]`, `/people/[id]/contacts`,
  `/events/[id]`, `/_not-found`, and the unchanged API routes.
- Manual verification against the linked Supabase project (the same one DEC-013 and earlier
  sessions verified fake-mode persistence against) added two new, ordinary, non-destructive
  fake-mode events — no migration, reset, or live call occurred.

### Approval

Project owner approval: approved for exactly the scope above — landing page, dashboard, history,
and count-based KPIs — with Stage C (profile enrichment), Stage D (scheduling), Stage E (contact
availability), Stage F (intervention display) and Stage G (fake SMS) explicitly out of scope for
this phase and not begun. The two scope extensions (KPI dashboard, `/` split from `/dashboard`)
were approved together with this phase; false-positive/unnecessary-escalation rates and every
duration metric were rejected outright rather than deferred.

---

## DEC-015 — Editable, enriched profiles: preset avatars, timezone, and stored (not executed) schedule configuration

**Date:** 30 July 2026
**Status:** Approved

### Context

`VulnerablePerson` had exactly eight fields (`PRODUCT_SPECIFICATION.md` §16), and — beyond soft
deletion — no update path existed at all: `Repository` had `createPerson` and `archivePerson`, but
no way to change a single field of an existing profile without archiving and recreating it. Stage
C's brief asks for the profile page to show a preset avatar, timezone, conversation notes, and a
check-in schedule configuration, and for all of it to be editable. None of this is Stage D's
scheduler — Stage D is what would eventually *read* the stored days/time/timezone/state to decide
when to place a call; this phase only stores the configuration and displays it honestly.

### Decision

**1. Five additive columns on `vulnerable_people`** (`supabase/migrations/0010_person_profile.sql`):
`timezone` (`not null default 'Europe/Paris'`), `avatar_key` (nullable), `conversation_notes`
(nullable), `check_in_days` (`smallint[] not null default '{1,2,3,4,5,6,7}'`, constrained to ISO
weekdays 1–7 via `<@ array[1..7]`), `schedule_state` (`not null default 'active'`, checked against
`active`/`paused`/`inactive`). Every column is nullable or defaulted, so `0005_seed.sql` and
`supabase/testing/9999_test_helpers.sql` — neither of which names these columns — remain valid
unedited. No RPC function is added: `vulnerable_people` is not written by any `commit_transition*`
function, and the new `updatePerson` method is a direct `UPDATE` via the service-role client, the
same pattern `updateEvent` already uses. **Not applied remotely by this change.**

**2. `Repository.updatePerson(personId, input)`**, on both drivers, added to the shared contract
suite. `UpdatePersonInput` covers exactly `avatarKey`, `preferredLanguage`, `timezone`,
`preferredCallTime`, `checkInDays`, `scheduleState`, `interests`, `conversationProfile`,
`conversationNotes`, `consentStatus` — **not** `firstName` or `phone`, which the Stage C brief's own
edit-field list never named, and which for `phone` in particular carries DEC-008's validation and
masking rules a general-purpose patch would bypass. An absent key preserves the existing value; a
nullable field (`avatarKey`, `conversationNotes`) must be sent explicitly as `null` to be cleared.

**3. Preset avatars, never an upload.** `lib/avatars.ts` is the single source of truth for the
eight keys (`sunrise`, `olive`, `terracotta`, `lavender`, `ocean`, `meadow`, `amber`, `rose`),
imported by both the server-side validator and the UI registry so the two can never recognise
different sets. Each is a flat, two-tone, abstract SVG mark — distinguished by shape as well as by
colour, so meaning is never colour-only — carrying no information about age, gender, ethnicity or
health, because an abstract shape has none to carry. `avatarKey` is `null` or an unrecognised value
falls back to an initials display (`app/ui/avatars/avatar.tsx`) rather than an error or a broken-
image icon; a stored value need never be re-validated to be safely rendered. Selection
(`AvatarPicker`) is a native radio group, not a custom ARIA widget — keyboard operation and
"selected" announcement come from the browser's own radio semantics, and it needs no client
JavaScript.

**4. `conversation_notes` is stored and validated, but deliberately NOT sent to CALL-E this
phase.** The brief permits including it in the Companion prompt "only when… no medical diagnosis
or emergency instruction" — a condition this validator cannot mechanically enforce. What it *can*
enforce, and does, mirrors `interests` exactly: the same phone-digit rejection (`lib/validation/
profile.ts`'s `containsPhoneLikeSequence`) and a 280-character limit. Claiming to also detect
medical or diagnostic content would be a false promise no code here makes good on, so rather than
silently wire an unenforceable guarantee into a live prompt, this phase stores the field, displays
it on the person page, and leaves `prompts/companion-agent.ts` untouched. Wiring it into
`buildCompanionTask` — the same way `interests` already is — is a small, well-scoped follow-up a
future decision can take on explicitly, once (if) that boundary is deliberately accepted rather
than assumed. `lib/calle/live-adapter.ts`'s request bodies are built field-by-field, never a spread
of the whole `VulnerablePerson` object, so none of this phase's five new fields (timezone,
avatarKey, conversationNotes, checkInDays, scheduleState) can reach CALL-E by accident either.

**5. Schedule configuration is stored, not executed.** `checkInDays` and `scheduleState` exist so
the interface can collect and display an intended schedule; nothing reads them to place a call.
The person page's existing "Preferred check-in time" wording (corrected in DEC-014) is unchanged
by this phase, and the new "Check-in days" / "Schedule state" fields are captioned the same way:
configuration, not a computed occurrence. No cron, no scheduler, no unattended calling exists
anywhere in this codebase after this change, same as before it.

**6. Avatars reach the dashboard and history rows.** `ProfileCard` and the shared `ActivityRow`
(dashboard "Recent activity", history's day-grouped list) both render the resolved avatar via one
`Avatar` component, so a stale or archived person's avatar is either correctly resolved (DEC-009's
guarantee, extended here) or cleanly falls back to initials — never broken. The history page's
profile *filter* is a native `<select>`, which cannot render inline SVG per option; it lists names
only, same as before this phase. That is a genuine HTML constraint, not an oversight.

### Product-scope check

No product feature is added, removed or reinterpreted, and the validated cascade, retry bounds,
consent rules, phone masking, `ATTENTION_UNRESOLVED` semantics and Stage-B KPI formulas are
untouched: `git diff` on `lib/orchestration/*`, `lib/calle/*`, `prompts/*`, `lib/kpi/dashboard-
kpis.ts` and `supabase/migrations/0001–0009` is empty. `VulnerablePerson` already had a `phone`
field families could set per §16; this phase adds bookkeeping/preference fields alongside it, the
same way DEC-004's `runId` and DEC-009's `archivedAt` were added without being product features in
their own right. Avatars, timezone and schedule configuration are presentation and preference data,
not a new workflow — the one thing that could have made this a workflow change (an actual
scheduler) is explicitly not built here.

### Consequences

- `VulnerablePerson` gained five required fields (`timezone`, `avatarKey`, `conversationNotes`,
  `checkInDays`, `scheduleState`); `CreatePersonInput` makes all five optional with defaults
  identical to migration 0010's own column defaults, applied identically by both repository
  drivers — so every pre-existing fixture, test, and caller that predates this decision keeps
  compiling and keeps behaving the same way with no changes beyond adding the new fields where a
  full `VulnerablePerson` literal (not a `CreatePersonInput`) is constructed directly.
- `validatePersonInput` gained the same five fields; `validateUpdatePersonInput` is new, and —
  unlike the create validator — treats every field as present-or-absent (`"key" in body`) rather
  than defaulting an absent one, so a partial PATCH never silently resets a field.
- `PATCH /api/people/[id]` is new, alongside the existing `DELETE`.
- `/people/[id]/edit` is new. The create form (`/people/new`) gained the same five fields, grouped
  into Identity / Check-in preferences / Conversation preferences / Consent sections rather than
  one long list.
- The person page now shows the avatar, language, timezone, consent state, interests, conversation
  profile, conversation notes (when present), check-in days, schedule state, and a person-specific
  KPI panel using the exact same `computeCheckInKpis` function the dashboard's KPI strip calls, over
  that person's own full event history rather than a period-bounded window.
- Test count grows from 539 to (reported in the final verification below): repository-contract
  coverage for `updatePerson` on both drivers, validation tests for every new field's rejection
  cases, avatar registry/fallback/keyboard-selection tests, and profile create/edit route tests
  covering success, validation failure, and a thrown `fetch`.

### Approval

Project owner approval: approved for exactly this scope — editable enriched profiles and preset
avatars — with Stage D (schedule execution), Stage E (contact availability), Stage F (intervention
display) and Stage G (fake SMS) explicitly out of scope and not begun, migration 0010 not applied
remotely, and `conversation_notes` deliberately withheld from the CALL-E prompt pending a future,
explicit decision to wire it in.

---

## DEC-016 — Deterministic next-check-in calculation, and pause/resume — planned configuration only, never an execution

**Date:** 30 July 2026
**Status:** Approved

### Context

DEC-015 stored a schedule configuration (`timezone`, `preferredCallTime`, `checkInDays`,
`scheduleState`) but never computed anything from it: the person page rendered the static string
"Preferred check-in time: daily at {preferredCallTime}", never an actual next occurrence, and there
was no way to pause a schedule short of a full profile edit. Stage D's brief asks for a real,
deterministic "next planned check-in" computation, presentation of it across the person page and
dashboard, and a lightweight pause/resume control — explicitly **not** a scheduler: no cron, no
background job, and no code path that places a call other than the existing `Call now` / `Launch
demo` trigger.

### Decision

**1. `computeNextCheckIn` (`lib/schedule/next-check-in.ts`), pure and dependency-free.** Given a
person's stored `{ timezone, preferredCallTime, checkInDays, scheduleState }` and an explicit `now`
(never the ambient clock), it returns one of four kinds: `"paused"` and `"inactive"` when
`scheduleState` is not `"active"`; `"no_days_selected"` when `checkInDays` is empty; otherwise
`"scheduled"` with the ISO instant of the first occurrence strictly after `now`. It scans 8
consecutive calendar days in the person's **own** IANA timezone (never the browser's or server
process's default), which both covers every possible ISO weekday at least once and correctly
handles "week wrap" (e.g. only Monday selected, evaluated on a Tuesday). No timezone library was
added: every conversion is built from `Intl.DateTimeFormat` with an explicit `timeZone`, the same
built-in guarantee `lib/presentation/format-date.ts` already relies on for the fixed Europe/Paris
event timestamps elsewhere — Node's ICU build ships the full IANA database, so a library would add
a dependency without adding a capability this codebase doesn't already have safe access to.

**2. DST is resolved explicitly, not ignored.** `zonedWallClockToUtc` samples the zone's UTC offset
at hourly resolution across a ±26-hour window around a naive guess, builds one UTC candidate per
distinct offset, and keeps only the candidates whose formatted wall-clock actually matches the
target: zero matches means the requested local time falls in a spring-forward **gap** (resolved
forward to the first valid instant, found by binary-searching the transition boundary to
sub-second precision and rounding to the exact whole-minute transition); more than one match means
an autumn **fall-back ambiguity** (resolved, deterministically, to the **earlier** of the two UTC
instants — a documented choice, not an arbitrary one, and covered by explicit tests against the
real Europe/Paris 2026 transitions, 29 March and 25 October).

**3. Pause/Resume reuses the existing PATCH route, not a second write path.**
`ScheduleToggleButton` (`app/(app)/people/[id]/schedule-toggle-button.tsx`) sends exactly
`{ scheduleState }` through `submitScheduleToggle` to the same `PATCH /api/people/[id]` route and
the same `validateUpdatePersonInput` that the full profile-edit form already uses (DEC-015) — a
minimal one-field patch, never a duplicate schedule-configuration surface. The control shows no
optimistic state: its own label does not change until the server confirms the write and
`router.refresh()` re-reads the authoritative `scheduleState`; a thrown `fetch` or a non-2xx
response restores the control to its previous label with an inline error, never leaving it stuck
mid-save.

**4. Presentation never states a computed occurrence as guaranteed.** `formatNextCheckIn` /
`formatOccurrence` (`lib/schedule/format-schedule.ts`) always prefix a resolved occurrence with
"Next planned check-in", never bare "Next check-in", and the dashboard's new sections are captioned
"Scheduled configuration, not a guarantee" / "no automatic scheduler places these calls yet". A
paused, inactive, or unconfigured (`no_days_selected`) profile renders an explicit fallback string
("Schedule paused" / "Schedule inactive" / "No check-in days selected") and is excluded entirely —
never shown with a placeholder occurrence — from the dashboard's "Upcoming check-ins" list
(`lib/dashboard/upcoming-check-ins.ts`). Raw values are never rendered directly: not the bare
`scheduleState` string, not the raw `checkInDays` array, not a timezone identifier without the local
time it belongs with — local time and timezone are always one text node, so assistive technology
announces them together.

**5. Nothing here creates an event.** `computeNextCheckIn`, `computeUpcomingCheckIns`, and every
presentation helper are pure functions of already-loaded data; none calls `createEvent` or any
repository write. Rendering a "next planned check-in" on the dashboard or the person page is exactly
that — a render — and a planned occurrence never appears in `/history` or on any event timeline,
which continue to show only persisted, actually-occurred events. `Call now` / `Launch demo` remain
the only code path anywhere in this product that starts a check-in, and neither reads nor writes
any schedule field: `launch-demo-button.tsx` posts to `/api/events/start` exactly as before this
change.

### Product-scope check

No feature is added, removed, or reinterpreted: §13.2's "planification récurrente" remains
optional and unbuilt — this phase computes and displays what a stored configuration *would* mean,
it does not execute it. No cron, background job, or orchestration-framework dependency was
introduced. `git diff` on `lib/orchestration/*`, `lib/calle/*`, `prompts/*`,
`lib/kpi/dashboard-kpis.ts`, and `supabase/migrations/0001–0010` is empty, and no migration 0011 was
created — every column this phase reads (`timezone`, `preferredCallTime`, `checkInDays`,
`scheduleState`) already exists from DEC-015.

### Consequences

- New: `lib/schedule/next-check-in.ts`, `lib/schedule/format-schedule.ts` (moved `WEEKDAYS`,
  `formatCheckInDays`, `SCHEDULE_STATE_LABEL` here from `profile-form-constants.ts`, now the single
  source of truth for schedule-domain presentation), `lib/dashboard/upcoming-check-ins.ts`,
  `app/(app)/people/[id]/schedule-toggle-submit.ts`, `app/(app)/people/[id]/schedule-toggle-
  button.tsx`.
- `app/(app)/people/[id]/page.tsx` gained a "Schedule" card (state badge, next planned check-in,
  timezone/time/days, Pause/Resume, Launch demo) replacing the old static "Preferred check-in time"
  line.
- `app/(app)/dashboard/page.tsx` gained a "Schedule configuration" card (active / paused /
  incomplete counts, partitioned directly from each person's own `computeNextCheckIn` kind — never
  a second, divergent count) and an "Upcoming check-ins" card, both visually separate from the
  existing period-based "Operational activity" KPI strip, since these are current-configuration
  snapshots, not 7/30/90-day metrics.
- `app/ui/profile-card.tsx`'s `preferredCallTime: string` prop became `scheduleSummary: string`, a
  pre-formatted line built by the caller via `formatNextCheckIn` — the component itself computes no
  schedule.
- No migration added; no existing migration edited.
- Test count grows from 589 to (reported in the final verification below): `next-check-in.ts`'s DST
  gap/ambiguity/week-wrap/cross-process-timezone behaviour, `format-schedule.ts`'s formatting,
  `upcoming-check-ins.ts`'s sort/bound/exclusion, and `schedule-toggle-submit.ts`'s success/
  network-failure paths.

### Approval

Project owner approval: approved for exactly this scope — deterministic next-check-in computation,
its presentation on the person page and dashboard, and pause/resume — with an actual scheduler
(cron or any unattended calling), Stage E (contact availability), and Stage G (fake SMS) explicitly
out of scope and not begun.

---

## DEC-017 — Richer trusted-contact configuration: primary, enabled, availability windows, per-contact attempt limits, and availability-aware cascade ordering

**Date:** 30 July 2026
**Status:** Approved

### Context

A trusted contact (`trusted_contacts`) had seven fields: identity, `relationship`, `priority`,
`consent_status`, and `archived_at`. There was no way to mark a preferred contact, no way to
temporarily pause one without archiving them, no notion of "usually reachable in the evening", and
no per-contact override of the two-attempt retry bound. The cascade itself (`selectCascadeTarget`,
unchanged since DEC-011) walked the active circle strictly in `priority` order — correct, but blind
to when a contact actually tends to be reachable.

This is the one stage in the KinCall roadmap that touches the validated autonomous cascade
directly, so the design was deliberately conservative: add configuration and a new ordering layer,
but change nothing about what the cascade already guarantees.

### Decision

**1. Six additive columns on `trusted_contacts`** (`supabase/migrations/0011_contact_availability.sql`):
`is_primary boolean not null default false`, `enabled boolean not null default true`,
`callable_from time`, `callable_to time` (both null or both set — `check ((callable_from is null) =
(callable_to is null))`), `timezone text` (null inherits the person's own), `max_attempts smallint
not null default 2` (`check (max_attempts between 1 and 2)`). A partial unique index
(`idx_trusted_contacts_one_primary`, `where is_primary and archived_at is null`) enforces one
primary per person among non-archived contacts at the database layer. A further check
(`trusted_contacts_archived_not_primary_or_enabled`) forbids an archived row from carrying either
flag true — there is no "unarchive" action anywhere in this codebase, so a stale primary/enabled
flag on an archived row would be a silent, permanent inconsistency nothing could ever surface or
fix. Every default matches CURRENT behaviour exactly (enabled, two attempts, no window), so the
default-preservation rule below holds by construction, not by special-casing. **Not applied
remotely by this change.**

**2. `archive_trusted_contact` redefined** (`create or replace`, same signature — the precedent
0007_archive_entities.sql itself set when it redefined `reorder_trusted_contacts`) to also clear
`is_primary` and `enabled` on archival, so the new CHECK constraint above never blocks an ordinary
archive of a contact who happened to be primary or enabled. **`set_primary_contact(person_id,
contact_id)`, new**: one transaction that clears any previous primary and sets the new one, so no
caller can ever observe an interim state with zero or two primaries. Refuses for an archived or
foreign contact, changing nothing.

**3. `Repository.updateTrustedContact` / `setPrimaryContact`**, on both drivers, added to the shared
contract suite. `UpdateTrustedContactInput` covers `relationship`, `enabled`, `callableFrom`,
`callableTo`, `timezone`, `maxAttempts` — **not** `isPrimary`, which changes only through
`setPrimaryContact`, never a plain field patch, because only that path can atomically clear the
previous primary. An absent key preserves the existing value. `lib/validation/profile.ts`'s
`validateUpdateContactInput` mirrors the database's own rules in TypeScript before any write:
`callableFrom`/`callableTo` must be supplied as a pair (both a valid "HH:MM" or both null) since the
validator cannot see what is currently stored and so cannot safely reconcile a single supplied
side against it; `maxAttempts` accepts only 1 or 2.

**4. `lib/orchestration/contact-order.ts`, a new pure module — `orderContactsForCascade(contacts,
eventCreatedAt, personTimezone)`.** It removes archived and disabled contacts (silently, the same
treatment archived contacts already received — no timeline message of their own, because none ever
existed for archival either), then partitions the remainder into "inside their callable window at
`eventCreatedAt`" and "not", preserving each partition's own configured `priority` order. A null
window means always available; a window where `callableFrom > callableTo` crosses midnight (e.g.
`22:00`–`07:00`); a degenerate `callableFrom === callableTo` is treated as always-available rather
than a zero-width exclusion nothing asked for. The contact's own `timezone` is used when configured,
otherwise the person's persisted one — never the browser's or the server's default, and never
`Date.now()` — `eventCreatedAt` is always the event's own persisted, immutable `created_at`, so a
webhook replay, a poll, or a process restart recomputes the identical partition every time (rule 8
of the brief: replay-stability).

**Consent is deliberately NOT filtered by this module.** `lib/orchestration/engine.ts`'s
`contactBlockedReason`/`selectCascadeTarget` (unchanged since DEC-011) already filters consent and
(in live mode) phone-usability, and is what produces the "Skipped Julie — has not confirmed consent
(§17.1)" timeline entry `tests/consent.test.ts` and `tests/engine.test.ts` already depend on. Moving
that filter earlier, into `orderContactsForCascade`, would silently swallow that message for any
consent-missing contact it removed before `selectCascadeTarget` ever saw them. The engine therefore
calls `orderContactsForCascade` first (availability ordering, disabled/archived removed) and feeds
its result — still consent-inclusive — into the unchanged `selectCascadeTarget`, which performs its
own consent/phone filtering exactly as it always has, on whatever order it is handed.

**5. Cascade integration is a re-ordering, not a rewrite.** `startNextFamilyCall` and
`processFamilyResult` (`lib/orchestration/engine.ts`) now fetch the person and call
`orderContactsForCascade` before `selectCascadeTarget`, instead of passing the raw
`getActiveTrustedContacts` result straight through. `selectCascadeTarget`'s own successor logic
(retry-same-contact-if-owed, else walk forward from the previous contact's position) is completely
unchanged — it already worked purely in terms of "the array it was given," so handing it an
availability-ordered array instead of a priority-ordered one was sufficient; nothing about *how* it
walks needed to change. **Per-contact attempt bound**: `effectiveMaxAttempts(contact) =
min(contact.maxAttempts, MAX_CONTACT_ATTEMPTS)`, applied everywhere an attempt number was compared
against "the last attempt to this contact" — the retry-eligibility check in `selectCascadeTarget`,
and both voicemail-eligibility call sites (a contact configured for a single attempt has no attempt
2 at all, so attempt 1 is already their last, including for voicemail purposes). Configuration can
only lower this ceiling, never raise it, even if a stored value somehow exceeded 2 — the engine
re-derives the effective bound itself rather than trusting the stored number.

**6. Default preservation, proved rather than asserted.** When every contact is enabled and has no
availability window, every contact is "in window" (an empty exclusion), so the single partition
sorts by `priority` and the result is byte-identical to the pre-Stage-E order — not a special case,
a direct consequence of the algorithm. `tests/contact-order-cascade.test.ts` hand-derives the exact
call order, attempt numbers, and terminal status/decision for all five fake scenarios independently
from `lib/calle/fake-adapter.ts`'s own definitions and asserts them unchanged; all 638 pre-Stage-E
tests continue to pass with zero modification to their assertions.

**7. Per-contact operational statistics** (`lib/kpi/contact-stats.ts`, `computeContactStats` /
`computeContactStatsByContact`) — reuses `lib/kpi/dashboard-kpis.ts`'s own `RateMetric`/`MeanMetric`
shapes, computed purely from persisted Family `call_events`, nothing invented. Answer rate is
against every call placed; acceptance and decline rates are against *answered* calls only (their
denominators always sum to the answered count); a malformed/unreadable structured result counts as
unanswered, never as a decline. No duration metric (matching `dashboard-kpis.ts`'s own exclusion —
fake-mode calls complete synchronously), no "reliable"/"unreliable" label, no ranking contacts
against each other — a rate is shown with its own sample size and left for a human to read.

**8. Trusted-circle interface** (`app/(app)/people/[id]/contacts/`) redesigned: each contact is one
row carrying a drag handle, primary/enabled/consent badges, the masked phone, the callable window
and timezone, maximum attempts, the Stage-E statistics above, and Edit/Make-primary/Enable-disable/
Archive actions. Reordering is Pointer-Events-based (mouse, touch and pen in one API — chosen over
native HTML5 drag-and-drop specifically because that does not reliably support touch, and no drag
library was added) plus a full keyboard path on the same drag handle (Space lifts, arrow keys move,
Enter drops, Escape cancels, announced through a polite live region) — the existing ↑/↓ buttons are
retained unchanged as the accessible fallback, never removed. Enable/disable and "Make primary" are
each their own single-purpose control reusing the general PATCH route/validation (Enable/disable)
or the dedicated `set_primary_contact` route (primary) — mirroring DEC-016's own established pattern
of a lightweight dedicated toggle beside the full edit panel, never a second divergent write path.
The dashboard's configuration gaps gained `no_eligible_contact`, `all_contacts_disabled`, and
`no_primary_contact` — the last marked `severity: "informational"` and rendered in a neutral tone,
never presented as a blocking error, per the brief's explicit instruction.

### Product-scope check

No product feature is added, removed or reinterpreted: §10's "cercle de confiance ordonné" already
described ordering and configuration; this phase adds richer configuration and a smarter ordering
signal, not a new workflow. §9.3's cascade-failure behaviour (retry-then-advance, bounded twice
over) is unchanged. `git diff` on `lib/orchestration/decide-companion-action.ts`,
`lib/orchestration/handle-family-result.ts`, `lib/orchestration/states.ts`,
`lib/orchestration/transitions.ts`, `lib/orchestration/operation-keys.ts`,
`lib/kpi/dashboard-kpis.ts`, and `supabase/migrations/0001–0010` is empty. `lib/orchestration/
engine.ts` and `lib/database/*` changed only to thread the new ordering step and the per-contact
attempt bound through, never to alter a transition, a retry count, an idempotency key, a lease, or
`ATTENTION_UNRESOLVED`'s terminal meaning. No migration 0011 was applied remotely.

### Consequences

- New: `lib/orchestration/contact-order.ts`, `lib/kpi/contact-stats.ts`,
  `supabase/migrations/0011_contact_availability.sql`, `app/api/people/[id]/contacts/
  [contactId]/primary/route.ts`, `app/(app)/people/[id]/contacts/{contact-edit-submit,
  contact-toggle-submit,contact-primary-submit}.ts`.
- `TrustedContact` gained six required fields (`isPrimary`, `enabled`, `callableFrom`, `callableTo`,
  `timezone`, `maxAttempts`); `CreateTrustedContactInput` makes all six optional with defaults
  identical to migration 0011's own column defaults, applied identically by both repository
  drivers — every fixture and caller that predates this decision was updated to supply them
  explicitly where a full `TrustedContact` literal (not a `CreateTrustedContactInput`) is
  constructed directly, matching exactly how DEC-015 handled the same situation for
  `VulnerablePerson`.
- `PATCH /api/people/[id]/contacts/[contactId]` gained five updatable fields; `POST
  /api/people/[id]/contacts/[contactId]/primary` is new, alongside the existing `DELETE`.
- The person page's "Trusted circle" card gained a circle-health summary line (primary contact,
  how many would actually be tried, and why not for the rest) computed from the same active circle
  everything else on that page already reads.
- `lib/dashboard/configuration-gaps.ts`'s `detectConfigurationGaps` signature widened
  (`activeContacts` now also needs `enabled`/`isPrimary`); every existing caller already passes full
  `TrustedContact` records, so only its own test fixtures needed updating.
- Test count grows from 638 to (reported in the final verification below): the ordering algorithm
  in isolation (availability, cross-midnight, timezone inheritance/override, disabled/archived
  exclusion, default preservation, replay stability), the explicit five-scenario regression net, new
  availability/maxAttempts/disabled cascade-integration scenarios, the new repository-contract
  coverage for `updateTrustedContact`/`setPrimaryContact`, the new route tests, the new
  `contact-stats` unit tests, and the new dashboard configuration-gap tests.

### Approval

Project owner approval: approved for exactly this scope — richer trusted-contact configuration,
availability-aware (never delaying, never excluding-by-time) cascade ordering, per-contact attempt
limits clamped to the existing global bound, and operational contact statistics — with Stage F
(intervention display), Stage G (fake SMS), and the final global UI-polish phase explicitly out of
scope and not begun, and migration 0011 not applied remotely.

---

## DEC-018 — Stage G (SMS notification) cancelled permanently

**Date:** 1 August 2026
**Status:** Approved

### Context

Every prior stage's approval section listed Stage G — a fake, simulated SMS notification sent when
an event reaches `ATTENTION_UNRESOLVED` — as future, out-of-scope work, tracked but never begun (see
DEC-015, DEC-016, DEC-017's own approval sections, and the original phased roadmap). The project
owner has now decided not to build it at all, in any form.

### Decision

Stage G is cancelled permanently, not merely deferred. Concretely, none of the following will be
built: a fake SMS adapter, a real SMS integration, Twilio or any other SMS provider, a
`NotificationAdapter` abstraction, a `notifications` table, or a `0012_notifications.sql` migration.
`ATTENTION_UNRESOLVED` keeps its existing, unchanged meaning and visibility: a terminal, autonomous
outcome (DEC-011) shown on the dashboard's "Needs attention now" section and on the event's own
history/timeline — visible to whoever next opens KinCall, never pushed to anyone by any automatic
external channel. No code in this repository sends or has ever sent a notification of any kind; this
decision simply closes the possibility rather than changing present behaviour.

### Product-scope check

This removes a feature that was always listed as optional/future (`PRODUCT_SPECIFICATION.md` §13.2's
"résumé envoyé par email ou SMS") and never implemented — no shipped behaviour changes. It does not
touch orchestration: `ATTENTION_UNRESOLVED`'s terminal semantics, the autonomous cascade, and every
retry/consent/idempotency rule are exactly as DEC-011 and DEC-017 left them.

### Consequences

- No new files, migration, dependency, or orchestration hook of any kind.
- Every earlier "Stage G... explicitly out of scope and not begun" line in DEC-015 through DEC-017
  remains accurate as written and is not rewritten — this entry only records that the deferral
  became a cancellation.
- Any future revival of SMS notification (or any external-channel notification) requires a new
  decision-log entry and explicit project-owner approval, per `CLAUDE.md`'s change-control rule —
  this entry is not that approval.

### Approval

Project owner approval: approved. Stage G will not be implemented in any form.

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
