-- KinCall — drop the unused events.priority column (docs/DECISION_LOG.md DEC-012).
--
-- WHY
--
-- KinCall's operational decision is binary: close the check-in, or contact the
-- trusted circle. `events.priority` (low/medium/high, added in 0001_init.sql)
-- was assigned by the orchestrator until DEC-011 was simplified: on review,
-- "high" and "medium" always triggered the identical cascade — same contacts,
-- same order, same retries — so the column never distinguished any real
-- behaviour. The application stopped assigning it before this migration was
-- written (`decideCompanionAction`'s result carries no `priority` field at
-- all), so every row created since has left the column NULL. This migration
-- removes the column outright rather than leaving a permanently-unused one
-- behind.
--
-- DEPENDENCY CHECK, BEFORE DROPPING
--
-- Two functions read or wrote `events.priority`:
--   * `commit_transition`               (0002_functions.sql, unmodified there)
--   * `commit_transition_with_call_intent` (redefined by 0008_call_attempts.sql
--     in this same migration set, ALREADY without any `events.priority`
--     reference — see 0008's own note)
-- Both are redefined below with `create or replace function`, using their
-- existing signatures unchanged, so every existing grant (0004_security.sql)
-- and every existing call site keeps working with no further changes.
--
-- No view, trigger, or index in this schema references `events.priority`:
--   * no `create view` anywhere in supabase/migrations touches `events`;
--   * no trigger is defined on `events` in this schema;
--   * the column's own inline `check (priority in ('low','medium','high'))`
--     constraint is dropped automatically by `drop column`, and no other
--     index or constraint is defined on it (`\d events` has no
--     `idx_events_priority` or similar — only idx_events_person_created,
--     which is on `person_id, created_at`).
-- `commit_transition` is redefined FIRST, below, precisely so that by the
-- time the column is actually dropped, nothing in this schema still
-- references it.
--
-- SAFETY
--
-- Preserves every event row, status, decision, decision_reason, timeline
-- entry and call attempt untouched — only the one column is removed.
-- Historical events remain fully readable: the application's EventRecord type
-- and row mapper no longer reference `priority` at all (removed in the same
-- change that produced this migration), so a row missing the column maps
-- exactly like every other row. No table is dropped, truncated, or altered
-- beyond this single column removal.
--
-- Any non-null historical `priority` value is permanently lost once this runs
-- — there is no application feature that reads it, and once the column is
-- gone there is nowhere left to store it. See the accompanying report for the
-- count of remote rows this affects before this migration is applied.
--
-- NOT APPLIED REMOTELY by this change.

-- ── 1. Redefine commit_transition without the events.priority patch ─────────
-- Signature unchanged from 0002_functions.sql (7 params, same names and
-- types), so `create or replace` preserves every existing grant. Body is
-- byte-identical except the removed `priority = case when …` line.
create or replace function commit_transition(
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

-- ── 2. Drop the column ────────────────────────────────────────────────────
-- Explicit, single-purpose statement. Cascades to drop the column's own
-- inline CHECK constraint automatically; nothing else in the schema
-- references it after step 1 above.
alter table public.events drop column priority;
