-- KinCall Phase 5 — full teardown.
--
-- This is the SECOND tier of rollback and destroys data. The first tier needs
-- no SQL at all: set KINCALL_PERSISTENCE=memory and the application returns to
-- exactly its pre-Supabase behaviour with the schema left untouched. Run this
-- only after confirming no in-flight event needs its data.

drop function if exists archive_trusted_contact(text);
drop function if exists archive_person(text);
drop function if exists reorder_trusted_contacts(text, text[]);
drop function if exists commit_transition_with_call_intent(
  text, text, text, text, text, text[], jsonb, text, text, text);
drop function if exists commit_transition(text, text, text, text, text, text[], jsonb);
drop function if exists release_call_event_lease(text, uuid);
drop function if exists finalize_call_event_result(text, uuid, text, text, jsonb, timestamptz);
drop function if exists claim_call_event_result(text, integer);
drop function if exists kincall_test_reset();

-- Dependency order: timeline_entries → event_operations → call_events → events.
drop table if exists timeline_entries;
drop table if exists event_operations;
drop table if exists call_events;
drop table if exists events;
drop table if exists trusted_contacts;
drop table if exists vulnerable_people;

drop sequence if exists kincall_timeline_seq;
drop sequence if exists kincall_call_event_seq;
drop sequence if exists kincall_event_seq;
