-- KinCall — permanently remove the legacy Marie demo dataset before controlled
-- live testing (docs/DECISION_LOG.md DEC-021).
--
-- WHY
--
-- `person_marie` and her trusted circle (Julie, Marc, Nicole) were the
-- original fictional demo data seeded by 0005_seed.sql, used throughout fake
-- and early live-mode development. Before the first controlled live CALL-E
-- test with the new person_live_test_claire/henri/sophie profiles
-- (scripts/seed-live-test-data.ts), the legacy demo person is removed
-- entirely so she can never be confused with a live-test subject and never
-- appears in a dashboard or history view during real testing.
--
-- Marie was already soft-archived (docs/DECISION_LOG.md DEC-020 fixed
-- archive_person() so this was possible) but a soft-archived row still
-- exists in the table — this migration performs the PERMANENT removal the
-- brief calls for, which archival alone does not.
--
-- 0005_seed.sql is NOT edited: it remains a truthful historical record of
-- what Stage 5 originally seeded, and it stays re-runnable (`on conflict do
-- nothing`) against a fresh database — this migration runs strictly AFTER it
-- in migration order, so a fresh database that applies 0001..0013 in
-- sequence seeds Marie via 0005 and then immediately removes her via 0013,
-- ending with no Marie in either case (linked project or fresh database).
--
-- SCOPE
--
-- Every statement below is scoped exclusively to the stable id
-- 'person_marie' or to rows owned by her through a foreign key — never by
-- phone number, name, or any other attribute two unrelated people could
-- share. `trusted_contacts.person_id`, `events.person_id` and
-- `call_events.contact_id` are direct, non-nullable, single-owner foreign
-- keys in this schema (0001_init.sql) — there is no join table, so a
-- trusted-contact row cannot structurally belong to more than one person.
-- Read-only verification before writing this migration confirmed
-- contact_julie/contact_marc/contact_nicole each resolve to person_id =
-- 'person_marie' and to no one else.
--
-- DELETION ORDER
--
-- Explicit, leaf-to-root, rather than relying solely on the existing
-- `on delete cascade` clauses (0001_init.sql): trusted_contacts.person_id,
-- call_events.event_id, event_operations.event_id, event_operations.call_event_id
-- and timeline_entries.event_id/operation_id all cascade from
-- vulnerable_people/events already, but this migration deletes each level
-- itself, in the order below, so it stays correct even if a future migration
-- ever changes one of those cascade rules, and so a reviewer never has to
-- trace cascade behaviour across several migration files to see what this
-- one removes:
--
--   1. timeline_entries  (references events.id, and event_operations.id)
--   2. event_operations  (references events.id, and call_events.id)
--   3. call_events       (references events.id, and trusted_contacts.id)
--   4. events            (references vulnerable_people.id)
--   5. trusted_contacts  (references vulnerable_people.id)
--   6. vulnerable_people (the row itself)
--
-- Every one of the first three is scoped through
-- `event_id in (select id from events where person_id = 'person_marie')` —
-- computed fresh each time, never assumed stable across statements — so if
-- Marie somehow had zero events this still correctly deletes nothing at that
-- step, rather than erroring.
--
-- IDEMPOTENCY AND SAFETY
--
-- Every statement is a plain `delete ... where ...`: deleting rows that do
-- not exist deletes zero rows and succeeds, so re-running this migration
-- against a database where Marie is already gone (or was never present) is
-- a safe no-op, not an error. No other person, contact, or event is
-- referenced anywhere in this file. `person_live_test_claire`,
-- `person_live_test_henri`, `person_live_test_sophie` and their trusted
-- circles are untouched, as is every other pre-existing profile — none of
-- them is 'person_marie' and none of their rows can match a WHERE clause
-- scoped to her id or to her own events.
--
-- Same per-file transactional guarantee every other migration in this set
-- already relies on (none of 0001-0012 wraps itself in an explicit
-- begin/commit either) — the migration runner applies this file as one unit.
--
-- Does not touch: any migration 0001-0012, lib/calle/fake-adapter.ts's demo
-- scenarios (a separate, in-memory-only fixture, never persisted to this
-- database), archive_person()/archive_trusted_contact() semantics, or any
-- table structure. This is a data-only removal.

delete from timeline_entries
 where event_id in (select id from events where person_id = 'person_marie');

delete from event_operations
 where event_id in (select id from events where person_id = 'person_marie');

delete from call_events
 where event_id in (select id from events where person_id = 'person_marie');

delete from events
 where person_id = 'person_marie';

delete from trusted_contacts
 where person_id = 'person_marie';

delete from vulnerable_people
 where id = 'person_marie';
