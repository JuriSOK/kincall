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

Requires **Node 20.9+ or 22+** (declared in `package.json`'s `engines`). Node 21
is excluded because Vitest does not support it.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the home page, select Marie, pick a **scenario**, and click **Launch demo**.
In fake mode (the default) this runs the whole scenario synchronously and the
event page shows the timeline and summary as they're produced.

The scenario selector is fake-mode only — it does not exist in live mode, and the
API ignores the parameter there, so a real call can never be steered from the UI.
Five scenarios cover the autonomous paths (DEC-011):

| Scenario | What it exercises |
|---|---|
| Marie baseline | Fall and mobility difficulty. Julie does not answer **twice** (voicemail left on the second call), then Marc confirms a visit at 17:30 → case closed |
| Explicit help request | No fall; Marie asks for someone to be contacted. The deterministic rule contacts the trusted circle regardless of the model's own report |
| Other incident | Pain and distress with no fall — attention detection beyond falls |
| Person unreachable | Marie misses both check-in attempts; KinCall stops calling her and contacts the circle |
| All contacts unavailable | Everyone is tried twice and nobody helps; voicemail is unsupported → the event ends at `ATTENTION_UNRESOLVED` |

KinCall's operational decision is binary — close the check-in, or contact the trusted circle. There
is no priority tier: an earlier design assigned a High/Medium/Low priority to every escalation, but
high and medium never triggered different cascade behaviour, so it was removed before shipping (see
`docs/DECISION_LOG.md` DEC-011, "Priority removed"). This is an operational decision, not medical
triage — KinCall never assesses severity.

Every trusted contact gets exactly one retry, and the vulnerable person gets
exactly one. Nothing waits for a human: an event that runs out of eligible
contacts ends at `ATTENTION_UNRESOLVED`, a visible terminal outcome, rather than
stalling in a review queue. KinCall never contacts emergency services, in any
mode.

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
KinCall refuses to dial: that contact is **skipped** with the missing variable
named on the timeline, no CALL-E request is made, and the cascade continues to
the next eligible contact. If none is eligible the event ends at
`ATTENTION_UNRESOLVED`. The cascade only needs as many contacts configured as you
intend it to reach.

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
deterministic orchestration state machine, the Marie/Julie/Marc demo flow with
dashboard timeline, `LiveCalleAdapter` for real Companion **and** Family Agent
calls with the trusted-contact cascade resumed by webhook or polling, and the
MVP interface — profile creation, trusted-circle configuration and ordering,
per-person status and call history.

Supabase persistence is not one of section 11's phases: it belongs to the
section 1 baseline and was delivered ahead of the interface. Both repository
drivers are implemented and interchangeable.

No recurring scheduling, and nothing deployed yet.

## Interface

| Route | What it is |
|---|---|
| `/` | Public marketing landing page — no repository access, no Nav. `Get started` leads to `/dashboard`. |
| `/dashboard` | The operational home: unresolved cases first, configuration gaps, a count-based KPI strip, schedule configuration counts, upcoming check-ins, every profile, and recent activity grouped by day. |
| `/history` | A monthly calendar (three neutral outcome categories, no medical-severity colour scale) plus a filterable, day-grouped list of every check-in. |
| `/people/new` | Create a profile — avatar, identity, check-in preferences, conversation preferences, consent. |
| `/people/[id]` | The profile page: avatar, language, timezone, masked phone state, consent, interests, conversation preferences and notes, a Schedule card (state, next planned check-in, Pause/Resume, Launch demo), trusted-circle summary, a person-specific KPI panel, and event history. |
| `/people/[id]/edit` | Edit the profile fields above (not first name or phone — see "Profiles" below). |
| `/people/[id]/contacts`, `/events/[id]` | Unchanged from earlier phases. |

All of the above share one Nav under `app/(app)/layout.tsx`. `/dashboard` and
`/history` are read-only: launching a check-in, editing a profile, or
reordering a trusted circle all still happen on the per-person pages.

### Profiles: enriched, editable, never a schedule that runs

A profile (`vulnerable_people`) now carries, beyond the original identity and
contact fields: a **preset avatar** (eight abstract, non-photographic marks —
`lib/avatars.ts` is the canonical key list; never an uploaded image or a URL),
a **timezone**, **conversation notes** (validated like `interests` — no phone
number, 280 characters), and a **check-in schedule configuration** (days of
the week, plus an `active`/`paused`/`inactive` state).

**None of this schedule configuration is executed.** `checkInDays` and
`scheduleState` are stored and displayed so the interface can collect an
intended schedule; nothing reads them to place a call automatically. The only
way a check-in happens is `Call now` / `Launch demo`, exactly as before. A
future phase would add the actual scheduler — see `docs/DECISION_LOG.md`
DEC-015 and DEC-016.

`conversation_notes` is stored and shown on the profile page, but is **not**
sent to CALL-E in this phase — the validator can mechanically guarantee "no
phone number" (the same check `interests` already gets), but not "no medical
content", so nothing here claims that guarantee to the Companion Agent. See
DEC-015 for the reasoning and what a future decision adding it would need to
weigh.

Editing (`/people/[id]/edit`) covers every field above except first name and
phone — phone in particular keeps DEC-008's own validation and masking rules,
which a general-purpose edit would bypass.

### KPIs are count-based only

The dashboard's KPI strip (7/30/90-day period, in the URL as `?period=`) shows
only what persisted data can actually support: check-in counts, the share that
closed normally, the share that reached the trusted circle, the unresolved
count, the person-answered rate, and the mean number of Family attempts before
a confirmation. Every rate shows its own sample size and reads "Not enough
data" rather than a fabricated 0% when nothing qualifies.

Deliberately **not** shown, in any form:

- **Any duration or response-time metric.** Fake-mode events run their whole
  cascade synchronously in one request, so a "time to confirmation" would
  read ~0 ms for every fake-mode event — a real number attached to a
  meaningless measurement, not an honest "no data".
- **False-positive rate or unnecessary-escalation rate.** Both would require
  knowing whether attention was *actually* warranted, which nothing in this
  product ever learns. See `docs/DECISION_LOG.md` DEC-014.

### Deterministic next-check-in calculation, and Pause/Resume — planned configuration, never an execution

`lib/schedule/next-check-in.ts`'s `computeNextCheckIn(schedule, now)` is a pure
function that turns a stored `{ timezone, preferredCallTime, checkInDays,
scheduleState }` into either a "no occurrence" result (`paused`, `inactive`, or
`no_days_selected`, when no valid day is selected) or the ISO instant of the
**first scheduled occurrence strictly after `now`**. It always uses the
**person's own persisted IANA timezone** — never the browser's or the server
process's default — built entirely from the platform's own `Intl.DateTimeFormat`
with an explicit `timeZone`; no timezone library was added, since Node's ICU
build already carries the full IANA database this needs.

DST is handled explicitly, not ignored: a spring-forward request for a
nonexistent local time (e.g. `02:30` on the night the clock jumps from 02:00 to
03:00) resolves forward to the first valid instant after the gap; a fall-back
request for a repeated local time resolves, deterministically, to the
**earlier** of the two UTC instants. Both are covered by dedicated tests
against real Europe/Paris 2026 transitions. See `docs/DECISION_LOG.md`
DEC-016 for the full reasoning.

**This is a calculation, not a scheduler.** Nothing anywhere reads its output
to place a call — no cron, no background job, no unattended calling exists in
this codebase. `Call now` / `Launch demo` remain the only trigger, and neither
one reads or writes any schedule field. The person page's Schedule card adds a
**Pause/Resume** control that flips `scheduleState` through the exact same
`PATCH /api/people/[id]` route and validation the full profile-edit form uses
— a minimal one-field patch, not a second write path — with no optimistic UI:
the control's label only changes once the server has confirmed the write.

Every date and time shown for **events** (`/dashboard`'s recent activity,
`/history`, the event page) still uses a fixed `Europe/Paris` display timezone,
explicitly — never the server's own region-dependent timezone and never the
visitor's browser timezone; see `lib/presentation/format-date.ts`. Schedule-
related text (next planned check-in, "Today"/"Tomorrow" wording) is the one
place that instead uses each **person's own** persisted timezone, since that is
what the schedule configuration is defined in.

## Before a public deployment

Every mutating route (`POST /api/people`, `POST .../contacts`, both
`DELETE`s, the contact-reorder route, and — in live mode — `POST
/api/events/start`) is currently unauthenticated. That is acceptable for local
development and a supervised demo, but **a public URL needs a write-protection
gate — a shared token, or real authentication — before any mutating route is
reachable by an arbitrary visitor.** `app/(app)/layout.tsx` is the one place
such a check (or full authentication) belongs; nothing about the routes or
data model needs to change to add it later.

## Persistence

`KINCALL_PERSISTENCE=memory` (the default) keeps everything in-process. It
needs no setup and is what the test suite runs against, but data is lost on
every restart — an event mid-cascade is orphaned, and its eventual result
cannot be matched to anything.

`KINCALL_PERSISTENCE=supabase` persists across restarts, redeploys and Vercel
instances. Apply **all** the migrations, in order — either with the Supabase CLI
against a linked project:

```bash
npx supabase db push
npx supabase migration list   # local and remote should match, with no drift
```

or directly, which is the full list and the required order:

```bash
# 0004 must run after 0002: it revokes EXECUTE on functions that must exist.
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql            # schema
psql "$DATABASE_URL" -f supabase/migrations/0002_functions.sql       # atomic RPCs
psql "$DATABASE_URL" -f supabase/migrations/0004_security.sql        # RLS + grants
psql "$DATABASE_URL" -f supabase/migrations/0005_seed.sql            # demo rows
psql "$DATABASE_URL" -f supabase/migrations/0006_reorder.sql         # cascade reordering
psql "$DATABASE_URL" -f supabase/migrations/0007_archive_entities.sql # soft deletion
psql "$DATABASE_URL" -f supabase/migrations/0008_call_attempts.sql   # bounded retries
psql "$DATABASE_URL" -f supabase/migrations/0009_drop_event_priority.sql
psql "$DATABASE_URL" -f supabase/migrations/0010_person_profile.sql  # avatar, timezone, schedule config
```

There is no `0003`: the number was skipped during Phase 5 and the gap is left as
it is, since renumbering an applied migration would break every project already
carrying it.

**`0010_person_profile.sql` is not yet applied to the linked remote project** —
`npx supabase migration list` will show it as the one pending migration until a
project owner applies it. It is additive and backward-compatible (every new
column is nullable or defaulted), reviewed for dependents before being written,
and safe to apply whenever that's decided; this repository does not apply it on
its own.

Then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (neither prefixed
`NEXT_PUBLIC_` — the service-role key bypasses Row Level Security and must
never reach client code) and set `KINCALL_PERSISTENCE=supabase`.

**Rolling back** is the environment variable, not a code change: set it back to
`memory` and redeploy. The schema is left untouched.
`supabase/rollback/0000_rollback.sql` is the full teardown, and destroys data —
it lives outside `migrations/` precisely so `supabase db push` can never pick it
up.

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
