-- KinCall Phase 5 — schema (docs/DECISION_LOG.md DEC-006).
--
-- Text primary keys throughout, not UUIDs: person_marie, contact_julie and
-- event_001 are the ids PRODUCT_SPECIFICATION.md §16 specifies, they appear in
-- URLs, and the dashboard renders them.

-- gen_random_uuid() for run_id and processing_token. Built in from PG13, but
-- declared explicitly so this migration is self-contained on any target.
create extension if not exists pgcrypto;

-- Durable id sequences, unlike the in-process counters they replace: an
-- in-memory counter restarts at 0 on every deploy, which is how a CALL-E
-- idempotency key came to be reused for a different request (DEC-004).
create sequence kincall_event_seq;
create sequence kincall_call_event_seq;
create sequence kincall_timeline_seq;

create table vulnerable_people (
  id                   text primary key,
  first_name           text not null,
  -- Always the reserved-for-fiction default. A consenting participant's real
  -- number is overlaid from KINCALL_*_PHONE when the row is READ, so it never
  -- lands in a table, a migration, or a backup (DEC-006).
  phone                text not null,
  preferred_language   text not null,
  conversation_profile text not null,
  preferred_call_time  text not null,
  interests            text[] not null default '{}',
  consent_status       text not null
                       check (consent_status in ('pending','confirmed','declined'))
);

create table trusted_contacts (
  id             text primary key,
  person_id      text not null references vulnerable_people(id) on delete cascade,
  first_name     text not null,
  phone          text not null,
  relationship   text not null,
  priority       integer not null check (priority > 0),
  consent_status text not null
                 check (consent_status in ('pending','confirmed','declined')),
  -- The cascade is strictly ordered, and the next contact is chosen by
  -- priority succession; a shared priority would make that non-deterministic.
  unique (person_id, priority)
);

create table events (
  id                       text primary key
                           default 'event_' || lpad(nextval('kincall_event_seq')::text, 3, '0'),
  -- The idempotency-key source (DEC-004). Kept even though the sequence is now
  -- durable, so a database reset cannot reissue a key CALL-E still holds.
  run_id                   uuid not null unique default gen_random_uuid(),
  person_id                text not null references vulnerable_people(id),
  -- Deliberately no CHECK enumerating the 13 EventStatus values: the
  -- TypeScript union in lib/orchestration/states.ts is the single source of
  -- truth, and adding a state must not require a lockstep migration.
  status                   text not null,
  priority                 text check (priority in ('low','medium','high')),
  current_contact_priority integer,
  decision                 text,
  decision_reason          text,
  created_at               timestamptz not null default now(),
  closed_at                timestamptz
);

create table call_events (
  id                    text primary key
                        default 'call_event_' || lpad(nextval('kincall_call_event_seq')::text, 3, '0'),
  -- Monotonic ordering key. listCallEvents order is load-bearing:
  -- describeFamilyCascade narrates attempts in call order.
  seq                   bigserial not null unique,
  event_id              text not null references events(id) on delete cascade,
  agent_type            text not null check (agent_type in ('companion','family')),
  contact_id            text references trusted_contacts(id),

  -- ── Outbound call intent ────────────────────────────────────────────────
  -- The row is created BEFORE the CALL-E request, so a crash can never leave
  -- a placed call with nothing locally to find it by. Until the request
  -- returns, status is 'starting' and calle_call_id is null.
  calle_call_id         text,
  status                text not null check (status in ('starting','in_progress','completed')),
  -- TECHNICAL_ARCHITECTURE.md §8: the database enforces this, not the app.
  -- It is also the intent's recovery key and the webhook's lookup key.
  idempotency_key       text not null unique,
  -- Biconditional, not one-directional: 'starting' means "no call placed yet"
  -- and MUST have a null id; any other status MUST have one. Rules out both a
  -- placed call with no id and an id on an unplaced call.
  constraint call_events_call_id_matches_status check (
    (status = 'starting'                  and calle_call_id is null) or
    (status in ('in_progress','completed') and calle_call_id is not null)
  ),

  summary               text,
  structured_result     jsonb,
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,

  -- ── Processing lease ────────────────────────────────────────────────────
  -- Who is working on this terminal result right now, and since when. A lease,
  -- not a claim: it expires, so a crashed worker's result is reclaimable
  -- rather than permanently consumed.
  processing_token      uuid,
  processing_started_at timestamptz,
  -- Terminal. Set ONLY after the whole result branch has succeeded.
  result_processed_at   timestamptz,
  constraint call_events_lease_paired check (
    (processing_token is null) = (processing_started_at is null)
  ),
  constraint call_events_no_lease_once_processed check (
    result_processed_at is null or processing_token is null
  ),

  constraint call_events_contact_matches_agent check (
    (agent_type = 'family'    and contact_id is not null) or
    (agent_type = 'companion' and contact_id is null)
  ),
  -- DEC-005: one attempt per contact per event. Family only in practice:
  -- Postgres treats NULLs as distinct in a unique constraint, so this does NOT
  -- constrain companion rows — see idx_call_events_one_companion below.
  unique (event_id, contact_id)
);

-- Exactly one Companion intent per event: the gap the constraint above leaves
-- open, because a null contact_id makes every companion row distinct. Without
-- this, a replay bug could persist two companion intents and place two
-- check-in calls to the same vulnerable person.
create unique index idx_call_events_one_companion on call_events (event_id)
  where agent_type = 'companion';

-- ── Transition idempotency ledger ────────────────────────────────────────────
-- One row per successfully applied transition. The unique operation key is
-- what makes a replayed transition a no-op instead of a duplicate timeline
-- entry. §9 specifies "minimum tables"; this is additive, required for crash
-- safety, and doubles as a state-machine audit trail.
create table event_operations (
  id               bigserial primary key,
  event_id         text not null references events(id) on delete cascade,
  operation_key    text not null,
  transition_event text not null,
  from_status      text not null,
  to_status        text not null,
  -- The permanent record of WHICH intent this operation created. Populated
  -- only for call-start operations; null for every ordinary transition. A
  -- replay reads the intent from HERE rather than re-deriving it from
  -- caller-supplied parameters, so a caller that has drifted cannot be
  -- silently accommodated.
  call_event_id    text references call_events(id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (event_id, operation_key)
);

-- Each intent was created by exactly one call-start operation. Prevents a
-- second operation ever binding an existing intent — which is how a replay
-- with drifted parameters would otherwise quietly acquire someone else's call.
create unique index idx_event_operations_call_event on event_operations (call_event_id)
  where call_event_id is not null;
-- Deliberately no CHECK on transition_event: enumerating the two call-start
-- literals in SQL would copy the TransitionEvent vocabulary out of
-- lib/orchestration/states.ts, which stays the single source of truth.

create table timeline_entries (
  id           text primary key
               default 'timeline_' || lpad(nextval('kincall_timeline_seq')::text, 3, '0'),
  -- Timeline order is asserted verbatim by several tests; created_at alone can
  -- tie at sub-millisecond resolution inside one cascade step.
  seq          bigserial not null unique,
  event_id     text not null references events(id) on delete cascade,
  -- Which applied transition wrote this entry, so a replay can never orphan or
  -- duplicate its entries.
  operation_id bigint references event_operations(id) on delete cascade,
  status       text not null,
  message      text not null,
  created_at   timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index idx_trusted_contacts_person_priority on trusted_contacts (person_id, priority);
create index idx_events_person_created            on events (person_id, created_at desc);
create index idx_call_events_event_seq            on call_events (event_id, seq);
create index idx_timeline_event_seq               on timeline_entries (event_id, seq);
create index idx_event_operations_event           on event_operations (event_id);

-- The poll route's hot query ("the one call still in flight"), fired every 5 s
-- per open event page by the automatic polling feature.
create index idx_call_events_pending on call_events (event_id)
  where result_processed_at is null;
-- Intents still awaiting a calle_call_id, and stale-lease diagnostics.
create index idx_call_events_starting on call_events (event_id)
  where calle_call_id is null;
create index idx_call_events_leased on call_events (processing_started_at)
  where processing_token is not null;
