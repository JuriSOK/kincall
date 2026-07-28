-- KinCall Phase 5 — lock the database down to service_role only.
--
-- Must run AFTER 0002_functions.sql, because it revokes EXECUTE on functions
-- that have to exist first. KinCall has no authenticated end users and is
-- entirely server-side, so anon and authenticated need exactly zero access.

-- ── Deny everything to the browser-reachable roles ──────────────────────────
revoke all on schema public                  from anon, authenticated;
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all routines  in schema public from anon, authenticated;

-- And for anything created later, so a future migration cannot silently
-- reopen access by inheriting Supabase's permissive defaults.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ── RLS on every table: defence in depth behind the revocations ─────────────
-- No policies are created, so RLS denies by default. service_role bypasses it.
-- `force` closes the loophole where a table owner is exempt from its own RLS.
alter table vulnerable_people enable row level security;
alter table trusted_contacts  enable row level security;
alter table events            enable row level security;
alter table call_events       enable row level security;
alter table event_operations  enable row level security;
alter table timeline_entries  enable row level security;

alter table vulnerable_people force row level security;
alter table trusted_contacts  force row level security;
alter table events            force row level security;
alter table call_events       force row level security;
alter table event_operations  force row level security;
alter table timeline_entries  force row level security;

-- ── RPCs: execute revoked from PUBLIC, granted only to service_role ─────────
-- Every function is SECURITY INVOKER (see 0002_functions.sql), so even if
-- EXECUTE leaked, the caller's own RLS and table privileges still apply.
revoke execute on function claim_call_event_result(text, integer)
  from public, anon, authenticated;
revoke execute on function finalize_call_event_result(text, uuid, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
revoke execute on function release_call_event_lease(text, uuid)
  from public, anon, authenticated;
revoke execute on function commit_transition(text, text, text, text, text, text[], jsonb)
  from public, anon, authenticated;
revoke execute on function commit_transition_with_call_intent(
    text, text, text, text, text, text[], jsonb, text, text, text)
  from public, anon, authenticated;

grant execute on function claim_call_event_result(text, integer)
  to service_role;
grant execute on function finalize_call_event_result(text, uuid, text, text, jsonb, timestamptz)
  to service_role;
grant execute on function release_call_event_lease(text, uuid)
  to service_role;
grant execute on function commit_transition(text, text, text, text, text, text[], jsonb)
  to service_role;
grant execute on function commit_transition_with_call_intent(
    text, text, text, text, text, text[], jsonb, text, text, text)
  to service_role;

-- ── Explicit grants service_role needs (it bypasses RLS, not GRANTs) ────────
grant usage on schema public                  to service_role;
grant all   on all tables    in schema public to service_role;
grant all   on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- ── Verification (every one of these must return false) ─────────────────────
-- select has_function_privilege('anon', 'public.claim_call_event_result(text,integer)', 'execute');
-- select has_table_privilege   ('anon', 'public.call_events', 'select');
-- The integration suite additionally makes real anon-key RPC and table calls,
-- because introspection alone would not prove PostgREST rejects them.
