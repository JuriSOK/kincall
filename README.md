# KinCall

> Because every vulnerable person deserves someone who checks in.

KinCall is a multi-agent phone care coordinator. A Companion Agent calls a
vulnerable person for a natural check-in, a deterministic orchestrator analyses
the structured result, and a Family Agent contacts the trusted circle in order
until someone confirms they can intervene.

KinCall does not replace families, health professionals or emergency services.

## Documentation

The product and architecture are frozen. Read these before contributing:

- [`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md) — frozen product scope
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — frozen implementation baseline
- [`docs/DECISION_LOG.md`](docs/DECISION_LOG.md) — approved deviations
- [`CLAUDE.md`](CLAUDE.md) — Claude Code working rules

## Stack

Next.js App Router, TypeScript, Tailwind CSS, Vitest. Supabase PostgreSQL is
part of the frozen baseline but not wired up yet — persistence runs entirely
against an in-memory repository. The CALL-E REST API is wired up for both the
Companion Agent and the Family Agent cascade (`LiveCalleAdapter`).

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the home page, select Marie, and click **Launch demo**. In fake mode
(the default) this runs the full scenario synchronously: Companion call to
Marie → fall and mobility difficulty detected → Family call to Julie (no
answer) → Family call to Marc (confirms a visit at 17:30) → case closed. The
event page shows the timeline and summary as they're produced.

## Live Companion Agent mode

Set `CALLE_MODE=live`, `CALLE_API_KEY` (from
`dashboard.heycall-e.com/account/api-keys`) and the phone numbers to place real
calls. Every number must be the E.164 number of a **consenting test
participant**:

| Variable | Who it calls |
|---|---|
| `KINCALL_DEMO_PHONE` | Marie — the Companion check-in |
| `KINCALL_JULIE_PHONE` | Julie — trusted contact #1 |
| `KINCALL_MARC_PHONE` | Marc — trusted contact #2 |
| `KINCALL_NICOLE_PHONE` | Nicole — trusted contact #3 |

Leaving one unset keeps a reserved-for-fiction default (`+336399800xx`), which
KinCall refuses to dial: that contact's step goes to `HUMAN_REVIEW_REQUIRED`
naming the missing variable, and no CALL-E request is made. The cascade only
needs as many contacts configured as you intend it to reach.

The API key is a **separate credential** from `calle auth login`'s browser OAuth
session — that login is for the CALL-E MCP skill, a Claude-Code-only
development tool (`plan_call`/`run_call`/`get_call_run`), explicitly not the
production path (CLAUDE.md). Nothing from the MCP/CLI install ships with the
deployed app.

CALL-E requires an HTTPS `webhook_url` to deliver terminal results — plain
`http://localhost` cannot receive webhooks. For local development, leave
`CALLE_WEBHOOK_URL` unset and use the recovery/poll endpoint instead:

```bash
curl -X POST http://localhost:3000/api/events/EVENT_ID/poll
```

In a deployed environment, set `CALLE_WEBHOOK_URL` to
`https://<your-domain>/api/webhooks/calle` and `CALLE_WEBHOOK_SECRET` to the
account's webhook signing secret (exact provisioning to be confirmed — see
`docs/DECISION_LOG.md` / the Phase 3 plan's open uncertainties).

A live run is asynchronous end to end: each call returns immediately as
`queued`, and the webhook (or a poll) delivers the result that advances the
event. A concerning Companion result starts the cascade, and each trusted
contact's result either closes the case or triggers the next call — so a full
run takes several deliveries, one per call. Poll repeatedly until the status
stops changing.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Status

Phases 2–4 of `docs/TECHNICAL_ARCHITECTURE.md` section 11 are implemented: the
deterministic orchestration state machine, an in-memory repository, the
Marie/Julie/Marc demo flow with dashboard timeline, and `LiveCalleAdapter` for
real Companion **and** Family Agent calls, with the trusted-contact cascade
resumed by webhook or polling. No Supabase yet, and no recurring scheduling.
