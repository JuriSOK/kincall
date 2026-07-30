-- KinCall — bounded per-subject call attempts (docs/DECISION_LOG.md DEC-011).
--
-- WHY THIS MIGRATION IS UNAVOIDABLE
--
-- DEC-011 requires exactly one retry of the vulnerable person and exactly one
-- retry of each trusted contact. Two constraints in 0001_init.sql make a second
-- call to the same subject *structurally impossible*, so no amount of
-- application logic can express the retry:
--
--   * call_events.unique (event_id, contact_id)  — one row per contact per event
--   * idx_call_events_one_companion              — one companion row per event
--
-- Nothing else is missing. Attention signals, the neutral summary and the
-- attention level all live in the existing `structured_result` jsonb column;
-- `events.decision` and `events.decision_reason` already exist; and
-- `events.status` deliberately carries no CHECK constraint (see
-- 0001_init.sql), so ATTENTION_UNRESOLVED needs no schema change at all. This
-- migration therefore does exactly one thing: it makes the attempt number part
-- of a call's identity.
--
-- `commit_transition_with_call_intent` below no longer patches `events.priority`
-- (docs/DECISION_LOG.md DEC-012: the column is dropped by migration 0009, which
-- runs after this one — the operational decision is binary, close or contact
-- the trusted circle, and the column never distinguished any behaviour).
--
-- BACKWARD COMPATIBILITY
--
-- Additive and safe to run against populated data: every existing row is by
-- definition the first (and, under the old constraints, only) attempt to its
-- subject, which is exactly what the DEFAULT 1 backfill records. The replacement
-- uniqueness rules are strictly weaker than the ones they drop, so no existing
-- row can violate them.
--
-- NOT APPLIED REMOTELY by this change. Run locally, or via the Supabase SQL
-- editor against a database you intend to migrate.

-- ── 1. The attempt number ────────────────────────────────────────────────────
-- NOT NULL with a default, so the backfill is the same statement: existing rows
-- become attempt 1 atomically.
alter table call_events
  add column attempt_number integer not null default 1
  check (attempt_number > 0);

comment on column call_events.attempt_number is
  'Which attempt to this subject this call is: 1 for the first, 2 for the bounded retry (DEC-011). Persisted, not counted in memory, so a restart mid-cascade resumes at the correct attempt.';

-- ── 2. Uniqueness moves from "per subject" to "per subject per attempt" ──────
-- The guarantee that matters is unchanged in kind: a replaying worker still
-- cannot create a second intent for work that already exists. The unit of that
-- work is now (subject, attempt) rather than (subject).
--
-- The engine, not the database, is what keeps this bounded: it derives the next
-- attempt number from the persisted count and refuses to exceed
-- MAX_COMPANION_ATTEMPTS / MAX_CONTACT_ATTEMPTS. The constraint below would
-- permit attempt 3; the state machine never asks for one.
alter table call_events drop constraint call_events_event_id_contact_id_key;

alter table call_events
  add constraint call_events_event_contact_attempt_key
  unique (event_id, contact_id, attempt_number);

-- Same reasoning for the companion side. Postgres treats NULLs as distinct in a
-- unique constraint, so the constraint above still does not constrain companion
-- rows (contact_id is null for all of them) — this partial index is what bounds
-- them, exactly as idx_call_events_one_companion did before.
drop index idx_call_events_one_companion;

create unique index idx_call_events_one_companion_attempt
  on call_events (event_id, attempt_number)
  where agent_type = 'companion';

-- ── 3. commit_transition_with_call_intent gains p_attempt_number ─────────────
-- A new parameter changes the signature, so this is a drop-and-recreate rather
-- than a CREATE OR REPLACE. Everything else in the body is byte-identical to
-- 0002_functions.sql's version except the two places attempt_number appears:
-- the intent INSERT, and the drifted-caller integrity check.
--
-- Dropping also drops its grants, so 0004_security.sql's revoke/grant pair is
-- reapplied for the new signature at the end of this file. The old signature no
-- longer exists, so its grants cannot be left dangling.
drop function commit_transition_with_call_intent(
  text, text, text, text, text, text[], jsonb, text, text, text);

create function commit_transition_with_call_intent(
  p_event_id text, p_operation_key text, p_transition_event text,
  p_expected_from_status text, p_status text, p_messages text[], p_patch jsonb,
  p_agent_type text, p_contact_id text, p_attempt_number integer, p_idempotency_key text)
returns table (event_row events, applied boolean, status_conflict boolean, call_event call_events)
language plpgsql security invoker as $$
declare v_from text; v_op_id bigint; v_msg text; v_call call_events; v_linked text; v_found boolean;
begin
  -- 1. Lock and validate the event.
  select status into v_from from events where id = p_event_id for update;
  if not found then
    raise exception 'unknown event %', p_event_id using errcode = 'no_data_found';
  end if;

  -- 1b. Idempotent replay wins first, whatever the status is now. The intent
  --     is read from the LEDGER'S OWN foreign key — never re-created or
  --     re-recovered from the parameters this caller happened to supply.
  select eo.call_event_id into v_linked
    from event_operations eo
   where eo.event_id = p_event_id and eo.operation_key = p_operation_key;
  v_found := found;

  if v_found then
    if v_linked is null then
      raise exception 'operation % on event % started no call', p_operation_key, p_event_id
        using errcode = '23000';
    end if;
    select ce.* into v_call from call_events ce where ce.id = v_linked;

    -- Verify the recorded intent is the one this caller expects. A mismatch
    -- means the caller's reasoning has drifted from what was durably decided
    -- (a different contact, a different attempt, a different key) — an
    -- integrity error, never a reason to create a second intent.
    if v_call.event_id        is distinct from p_event_id
    or v_call.agent_type      is distinct from p_agent_type
    or v_call.contact_id      is distinct from p_contact_id
    or v_call.attempt_number  is distinct from p_attempt_number
    or v_call.idempotency_key is distinct from p_idempotency_key then
      raise exception
        'call intent mismatch for operation % on event %: recorded (%, %, %, %), expected (%, %, %, %)',
        p_operation_key, p_event_id,
        v_call.agent_type, v_call.contact_id, v_call.attempt_number, v_call.idempotency_key,
        p_agent_type,      p_contact_id,      p_attempt_number,      p_idempotency_key
        using errcode = '23000';
    end if;

    return query select e, false, false, v_call from events e where e.id = p_event_id;
    return;
  end if;

  -- 1c. Compare-and-set. No ledger row and NO INTENT on conflict.
  if v_from is distinct from p_expected_from_status then
    return query select e, false, true, null::call_events from events e where e.id = p_event_id;
    return;
  end if;

  -- 2. Create or recover the exact intent FIRST, so the ledger row can name it.
  --    Create-or-recover, because an earlier crashed attempt may have left one
  --    under this idempotency key with no ledger row pointing at it.
  insert into call_events (event_id, agent_type, contact_id, attempt_number,
                           idempotency_key, status)
  values (p_event_id, p_agent_type, p_contact_id, p_attempt_number,
          p_idempotency_key, 'starting')
  on conflict (idempotency_key) do nothing;
  select ce.* into v_call from call_events ce where ce.idempotency_key = p_idempotency_key;

  -- 3. Ledger row, permanently bound to that intent.
  --    idx_event_operations_call_event rejects a second operation trying to
  --    bind an intent that is already spoken for.
  insert into event_operations (event_id, operation_key, transition_event,
                                from_status, to_status, call_event_id)
  values (p_event_id, p_operation_key, p_transition_event, v_from, p_status, v_call.id)
  returning id into v_op_id;

  -- 4. Event patch.
  update events set
    status                   = p_status,
    decision                 = case when p_patch ? 'decision'
                                    then p_patch->>'decision' else decision end,
    decision_reason          = case when p_patch ? 'decisionReason'
                                    then p_patch->>'decisionReason' else decision_reason end,
    current_contact_priority = case when p_patch ? 'currentContactPriority'
                                    then (p_patch->>'currentContactPriority')::int
                                    else current_contact_priority end,
    closed_at                = case when p_patch ? 'closedAt'
                                    then (p_patch->>'closedAt')::timestamptz else closed_at end
  where id = p_event_id;

  -- 5. Timeline messages.
  foreach v_msg in array coalesce(p_messages, '{}') loop
    insert into timeline_entries (event_id, operation_id, status, message)
    values (p_event_id, v_op_id, p_status, v_msg);
  end loop;

  return query select e, true, false, v_call from events e where e.id = p_event_id;
end;
$$;

-- ── 4. Reapply 0004_security.sql's lockdown for the new signature ────────────
-- SECURITY INVOKER like every other RPC here, so even a leaked EXECUTE grant
-- would still be subject to the caller's own RLS and table privileges.
revoke execute on function commit_transition_with_call_intent(
    text, text, text, text, text, text[], jsonb, text, text, integer, text)
  from public, anon, authenticated;

grant execute on function commit_transition_with_call_intent(
    text, text, text, text, text, text[], jsonb, text, text, integer, text)
  to service_role;
