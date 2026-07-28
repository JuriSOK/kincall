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

Next.js App Router, TypeScript, Tailwind CSS, Vitest, Supabase PostgreSQL. The
CALL-E REST API is wired up for both the Companion Agent and the Family Agent
cascade (`LiveCalleAdapter`).

Persistence has two interchangeable drivers behind one `Repository` interface.
`KINCALL_PERSISTENCE` selects between them and defaults to `memory`, so fake
mode and the test suite need no configuration and make no network calls.

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

Phases 2–5 of `docs/TECHNICAL_ARCHITECTURE.md` section 11 are implemented: the
deterministic orchestration state machine, both repository drivers, the
Marie/Julie/Marc demo flow with dashboard timeline, and `LiveCalleAdapter` for
real Companion **and** Family Agent calls, with the trusted-contact cascade
resumed by webhook or polling. No recurring scheduling.

## Persistence

`KINCALL_PERSISTENCE=memory` (the default) keeps everything in-process. It
needs no setup and is what the test suite runs against, but data is lost on
every restart — an event mid-cascade is orphaned, and its eventual result
cannot be matched to anything.

`KINCALL_PERSISTENCE=supabase` persists across restarts, redeploys and Vercel
instances. Apply the migrations in order:

```bash
# 0004 must run after 0002: it revokes EXECUTE on functions that must exist.
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_functions.sql
psql "$DATABASE_URL" -f supabase/migrations/0004_security.sql
psql "$DATABASE_URL" -f supabase/migrations/0005_seed.sql
```

Then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (neither prefixed
`NEXT_PUBLIC_` — the service-role key bypasses Row Level Security and must
never reach client code) and set `KINCALL_PERSISTENCE=supabase`.

**Rolling back** is the environment variable, not a code change: set it back to
`memory` and redeploy. The schema is left untouched.
`supabase/migrations/0000_rollback.sql` is the full teardown, and destroys data.

### How a crash is survived

A worker takes a time-bounded **lease** on a call result and only marks it
processed once the whole branch has succeeded, so a crash expires rather than
consumes it. Every transition is recorded under a deterministic operation key,
so a replay is a no-op instead of a duplicate timeline entry. And the
`call_events` row is written **before** the CALL-E request, in the same
transaction as the transition that decided to place the call — so a crash can
never leave CALL-E holding a call KinCall cannot find. See
`docs/DECISION_LOG.md` DEC-006.

### Supabase integration tests

`npm test` never touches a database. The Supabase-backed repository is held to
the same shared contract suite by an opt-in lane:

```bash
npm run test:integration
```

It requires all four of `KINCALL_TEST_SUPABASE_URL`,
`KINCALL_TEST_SUPABASE_SERVICE_ROLE_KEY`, `KINCALL_TEST_SUPABASE_ANON_KEY` and
`KINCALL_TEST_SUPABASE_ALLOW_DESTRUCTIVE=1` — a partially-configured run fails
loudly rather than skipping and looking green.

Point it at a disposable project or a local `supabase start`. It truncates
every event table, and it also needs `supabase/testing/9999_test_helpers.sql`,
which must **never** be applied to production: that file's absence is what
makes the suite structurally incapable of running there.
