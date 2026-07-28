-- KinCall Phase 5 — TEST HELPERS. NEVER APPLY THIS TO PRODUCTION.
--
-- This function TRUNCATES every event table. Its absence from production is a
-- safety property the integration suite depends on: tests/support/supabase-test-env.ts
-- refuses to run unless the target database exposes kincall_test_reset(), so a
-- database that never received this file is structurally incapable of being
-- truncated by the test suite — independently of any URL comparison.

create or replace function kincall_test_reset() returns void
language plpgsql security invoker as $$
begin
  truncate timeline_entries, event_operations, call_events, events restart identity cascade;

  -- Restarted so event_001 is deterministic per test, which is what lets the
  -- suite assert ids verbatim. Only coherent under serial execution.
  alter sequence kincall_event_seq      restart with 1;
  alter sequence kincall_call_event_seq restart with 1;
  alter sequence kincall_timeline_seq   restart with 1;

  -- Re-seed the demo people and contacts (0005_seed.sql is re-runnable, and
  -- truncate above does not touch these two tables).
  insert into vulnerable_people
    (id, first_name, phone, preferred_language, conversation_profile,
     preferred_call_time, interests, consent_status)
  values
    ('person_marie', 'Marie', '+33639980001', 'fr-FR', 'cognitive_friendly',
     '09:00', array['gardening','family'], 'confirmed')
  on conflict (id) do nothing;

  insert into trusted_contacts
    (id, person_id, first_name, phone, relationship, priority, consent_status)
  values
    ('contact_julie',  'person_marie', 'Julie',  '+33639980002', 'daughter',          1, 'confirmed'),
    ('contact_marc',   'person_marie', 'Marc',   '+33639980003', 'son',               2, 'confirmed'),
    ('contact_nicole', 'person_marie', 'Nicole', '+33639980004', 'trusted neighbour', 3, 'confirmed')
  on conflict (id) do nothing;
end;
$$;

-- Catalog introspection for the security suite. Not sufficient on its own —
-- the suite also makes real anon-key calls, because a grant PostgREST does not
-- expose is still a grant — but it catches privileges the live probes miss.
create or replace function kincall_test_privileges() returns jsonb
language sql security invoker stable as $$
  select jsonb_build_object(
    'tables', (
      select jsonb_object_agg(t, has_table_privilege('anon', 'public.' || t, 'select'))
      from unnest(array['vulnerable_people','trusted_contacts','events',
                        'call_events','event_operations','timeline_entries']) as t
    ),
    'functions', (
      select jsonb_object_agg(f, has_function_privilege('anon', f, 'execute'))
      from unnest(array[
        'public.claim_call_event_result(text,integer)',
        'public.finalize_call_event_result(text,uuid,text,text,jsonb,timestamptz)',
        'public.release_call_event_lease(text,uuid)',
        'public.commit_transition(text,text,text,text,text,text[],jsonb)',
        'public.commit_transition_with_call_intent(text,text,text,text,text,text[],jsonb,text,text,text)',
        'public.kincall_test_reset()'
      ]) as f
    )
  );
$$;

-- Even in a disposable test project, a truncating function must not be
-- reachable by a browser-facing role.
revoke execute on function kincall_test_reset() from public, anon, authenticated;
grant  execute on function kincall_test_reset() to service_role;
revoke execute on function kincall_test_privileges() from public, anon, authenticated;
grant  execute on function kincall_test_privileges() to service_role;
