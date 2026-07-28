-- KinCall Phase 5 — the five RPCs (docs/DECISION_LOG.md DEC-006).
--
-- PostgREST cannot span a transaction across HTTP calls, so every operation
-- that must be atomic across several statements lives here. One PostgREST
-- request is one transaction, which is exactly the boundary each needs.
--
-- All are SECURITY INVOKER, never DEFINER: even if EXECUTE leaked, the
-- caller's own RLS and table privileges still apply, so an anon caller could
-- not read or write a single row through them. 0004_security.sql revokes
-- EXECUTE from PUBLIC/anon/authenticated and grants it only to service_role.
--
-- The deterministic state machine stays entirely in TypeScript: these
-- functions only WRITE an already-computed status, never choose one.

-- ── Lease acquisition. Never touches result_processed_at. ────────────────────
create function claim_call_event_result(p_call_event_id text, p_lease_seconds integer)
returns setof call_events
language sql security invoker as $$
  update call_events
     set processing_token      = gen_random_uuid(),
         processing_started_at = now()
   where id = p_call_event_id
     and result_processed_at is null                     -- never reprocess a finished result
     and (processing_token is null                       -- free, or
          or processing_started_at
             < now() - make_interval(secs => p_lease_seconds))  -- stale, reclaimable
  returning *;                                           -- 0 rows ⇒ not available
$$;

-- ── Completion. The ONLY place result_processed_at is ever set. ──────────────
create function finalize_call_event_result(
  p_call_event_id text, p_processing_token uuid,
  p_status text, p_summary text, p_structured_result jsonb, p_ended_at timestamptz)
returns setof call_events
language sql security invoker as $$
  update call_events
     set status                = p_status,
         summary               = p_summary,
         structured_result     = p_structured_result,
         ended_at              = p_ended_at,
         result_processed_at   = now(),
         processing_token      = null,
         processing_started_at = null
   where id = p_call_event_id
     and processing_token    = p_processing_token        -- we still hold the lease
     and result_processed_at is null
  returning *;                                           -- 0 rows ⇒ lease lost
$$;

-- Best-effort early release on a failed branch, so a retry need not wait out
-- the full lease. A no-op if the token is no longer the holder.
create function release_call_event_lease(p_call_event_id text, p_processing_token uuid)
returns setof call_events
language sql security invoker as $$
  update call_events
     set processing_token = null, processing_started_at = null
   where id = p_call_event_id
     and processing_token = p_processing_token
     and result_processed_at is null
  returning *;
$$;

-- ── Idempotent, compare-and-set transition ──────────────────────────────────
-- The lease is scoped to one call event, not to the event, so two call events
-- can race one EventRecord. The event row itself therefore needs its own guard.
create function commit_transition(
  p_event_id text, p_operation_key text, p_transition_event text,
  p_expected_from_status text, p_status text, p_messages text[], p_patch jsonb)
returns table (event_row events, applied boolean, status_conflict boolean)
language plpgsql security invoker as $$
declare v_from text; v_op_id bigint; v_msg text;
begin
  -- Short row lock, held only for this statement. No external HTTP inside.
  select status into v_from from events where id = p_event_id for update;
  if not found then
    raise exception 'unknown event %', p_event_id using errcode = 'no_data_found';
  end if;

  -- 1. Idempotent replay wins first, whatever the status is now.
  if exists (select 1 from event_operations
              where event_id = p_event_id and operation_key = p_operation_key) then
    return query select e, false, false from events e where e.id = p_event_id;
    return;
  end if;

  -- 2. Compare-and-set. No ledger row on conflict, so a later legitimate
  --    attempt from the correct status still succeeds cleanly.
  if v_from is distinct from p_expected_from_status then
    return query select e, false, true from events e where e.id = p_event_id;
    return;
  end if;

  insert into event_operations (event_id, operation_key, transition_event, from_status, to_status)
  values (p_event_id, p_operation_key, p_transition_event, v_from, p_status)
  returning id into v_op_id;

  update events set
    status                   = p_status,
    priority                 = case when p_patch ? 'priority'
                                    then nullif(p_patch->>'priority','') else priority end,
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

  foreach v_msg in array coalesce(p_messages, '{}') loop
    insert into timeline_entries (event_id, operation_id, status, message)
    values (p_event_id, v_op_id, p_status, v_msg);
  end loop;

  return query select e, true, false from events e where e.id = p_event_id;
end;
$$;

-- ── Transition + outbound call intent, in ONE transaction ────────────────────
-- Two statements (transition, then intent) left a crash window: the transition
-- applied with no intent, after which the replay gets applied:false, finds no
-- intent, and the workflow is permanently stuck. This closes it.
--
-- The external CALL-E request happens only after this returns a persisted
-- intent; there is no other way to create a call_events row.
create function commit_transition_with_call_intent(
  p_event_id text, p_operation_key text, p_transition_event text,
  p_expected_from_status text, p_status text, p_messages text[], p_patch jsonb,
  p_agent_type text, p_contact_id text, p_idempotency_key text)
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
    -- (a different contact, a different key) — an integrity error, never a
    -- reason to create a second intent.
    if v_call.event_id        is distinct from p_event_id
    or v_call.agent_type      is distinct from p_agent_type
    or v_call.contact_id      is distinct from p_contact_id
    or v_call.idempotency_key is distinct from p_idempotency_key then
      raise exception
        'call intent mismatch for operation % on event %: recorded (%, %, %), expected (%, %, %)',
        p_operation_key, p_event_id,
        v_call.agent_type, v_call.contact_id, v_call.idempotency_key,
        p_agent_type,      p_contact_id,      p_idempotency_key
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
  insert into call_events (event_id, agent_type, contact_id, idempotency_key, status)
  values (p_event_id, p_agent_type, p_contact_id, p_idempotency_key, 'starting')
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
    priority                 = case when p_patch ? 'priority'
                                    then nullif(p_patch->>'priority','') else priority end,
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
