-- KinCall — allow the informational callback to the monitored person
-- (docs/DECISION_LOG.md DEC-023).
--
-- WHY THIS MIGRATION IS UNAVOIDABLE
--
-- After the trusted-circle cascade reaches its outcome, KinCall now places ONE
-- informational call back to the monitored person: either "Marc confirmed he
-- will visit this afternoon", or "nobody in your trusted circle confirmed they
-- were available". That call is a third, distinct purpose — it is neither a
-- check-in (it asks nothing and makes no attention decision) nor a Family call
-- (it is placed to the monitored person, not to a contact), and disguising it
-- as either would corrupt every count, every KPI and every screen that filters
-- on `agent_type`.
--
-- Two constraints in 0001_init.sql make the value structurally impossible, so
-- no amount of application code can express it:
--
--   * the inline `check (agent_type in ('companion','family'))` on the column;
--   * `call_events_contact_matches_agent`, whose two branches BOTH name one of
--     those literals, so a third value satisfies neither and every insert is
--     rejected outright.
--
-- Nothing else is missing. `attempt_number` (0008) already exists and is always
-- 1 for this call; the notification's own minimal result lives in the existing
-- `structured_result` jsonb; no new column is required.
--
-- CONSTRAINT NAMES ARE INTROSPECTED, NOT GUESSED
--
-- `call_events_contact_matches_agent` was named explicitly in 0001, but the
-- agent_type CHECK is an INLINE column constraint, so Postgres generated its
-- name. The conventional result is `call_events_agent_type_check`, but that is
-- a convention rather than a guarantee (a name collision at creation time would
-- have produced a suffixed variant). Dropping the wrong name would be a SILENT
-- no-op that leaves the old restriction in place and makes every notification
-- insert fail at runtime — so this finds the constraint by its definition
-- instead, and raises loudly if it cannot.
--
-- SAFETY
--
-- Purely widening. Every existing row keeps satisfying both replacement
-- constraints unchanged: a 'companion' row still requires a null contact_id, a
-- 'family' row still requires a non-null one, and no existing row has any other
-- agent_type. No data is read, written, moved or deleted. Applying this to a
-- database that already holds live-test call history changes none of it.
--
-- Idempotent: every drop is `if exists`, and the index is `if not exists`, so a
-- re-run is a no-op rather than an error.

-- ── 1. Widen the agent_type CHECK ───────────────────────────────────────────
do $$
declare
  v_name text;
begin
  select con.conname into v_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'call_events'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%agent_type%'
     and pg_get_constraintdef(con.oid) not ilike '%contact_id%'
   limit 1;

  if v_name is null then
    raise exception
      '0014: could not find the agent_type CHECK constraint on call_events — refusing to continue, because widening it is the whole point of this migration';
  end if;

  execute format('alter table call_events drop constraint %I', v_name);
end;
$$;

alter table call_events
  add constraint call_events_agent_type_check
  check (agent_type in ('companion', 'family', 'person_notification'));

-- ── 2. Teach the contact/agent pairing rule about the new purpose ───────────
-- Same rule as before for the two existing purposes, plus: a person
-- notification is placed to the monitored person, so it carries NO contact id —
-- exactly like a companion call, and enforced rather than assumed.
alter table call_events drop constraint if exists call_events_contact_matches_agent;

alter table call_events
  add constraint call_events_contact_matches_agent check (
    (agent_type = 'family'             and contact_id is not null) or
    (agent_type = 'companion'          and contact_id is null)     or
    (agent_type = 'person_notification' and contact_id is null)
  );

-- ── 3. At most ONE informational callback per event ─────────────────────────
-- The product rule is exactly one attempt, never retried (DEC-023). The engine
-- enforces it through the operation ledger, but Postgres treats NULLs as
-- distinct in a unique constraint, so 0008's
-- `unique (event_id, contact_id, attempt_number)` does NOT bound a row whose
-- contact_id is null — it would happily accept a second notification.
--
-- This partial unique index is the structural guarantee: a replaying worker, a
-- duplicate webhook and a second process cannot between them create two
-- callbacks, however the application behaves. Mirrors
-- idx_call_events_one_companion_attempt's pattern from 0008, but keyed on the
-- event alone, because there is only ever one attempt.
create unique index if not exists idx_call_events_one_person_notification
  on call_events (event_id)
  where agent_type = 'person_notification';

comment on index idx_call_events_one_person_notification is
  'Exactly one informational callback per event (DEC-023). One attempt, never retried — so this is keyed on event_id alone, unlike the companion index which also keys on attempt_number.';
