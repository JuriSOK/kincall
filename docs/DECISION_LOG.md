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
**Status:** Approved

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
