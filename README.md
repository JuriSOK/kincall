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
against an in-memory repository. The CALL-E REST API is wired up for the
Companion Agent only (`LiveCalleAdapter`). There is one adapter per run, so in
live mode the Family Agent would be `LiveCalleAdapter` too — its
`startFamilyCall` throws until Phase 4, and the live flow stops before ever
reaching it (see below).

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
`dashboard.heycall-e.com/account/api-keys`) and `KINCALL_DEMO_PHONE` to place a
real Companion call. `KINCALL_DEMO_PHONE` must be the E.164 number of a
**consenting test participant** — the seeded profile otherwise carries a
reserved-for-fiction number that CALL-E rejects, and `LiveCalleAdapter` refuses
to send a non-E.164 number rather than waste a call credit.

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

Only the Companion Agent is live-capable so far. A live run therefore ends at
`ATTENTION_REQUIRED` once the Companion result arrives: the trusted-contact
cascade is Phase 4, so no Family call is attempted and
`LiveCalleAdapter.startFamilyCall` throws if one ever is. Fake mode is the only
path that runs the complete Marie → Julie → Marc → case-closed scenario.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Status

Phase 2 (fake-mode vertical slice, `docs/TECHNICAL_ARCHITECTURE.md` section
11) and Phase 3 (live Companion Agent integration) are implemented: the
deterministic orchestration state machine, an in-memory repository, the
Marie/Julie/Marc demo flow with dashboard timeline, and `LiveCalleAdapter`
for real Companion calls with webhook + polling result delivery. No
Supabase, and no live Family Agent / cascade yet (Phase 4+).
