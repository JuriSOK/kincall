-- KinCall Stage C — enriched, editable profile fields (docs/DECISION_LOG.md
-- DEC-015): a preset avatar, timezone, conversation notes, and the schedule
-- CONFIGURATION a future scheduler will read (Stage D). No scheduler runs yet
-- — check_in_days and schedule_state are stored, not executed.
--
-- Additive and backward-compatible: every new column is nullable or carries a
-- default, so every existing row — and every existing INSERT that does not
-- name these columns (0005_seed.sql, supabase/testing/9999_test_helpers.sql)
-- — remains valid with no change to either file.
--
-- No RPC function references vulnerable_people beyond archive_person, which
-- only ever touches archived_at (0007_archive_entities.sql) and is untouched
-- here. updatePerson is a direct UPDATE via the service-role client, the same
-- pattern updateEvent already uses (0002_functions.sql's functions are all
-- about events/call_events, not people) — so this migration needs no new
-- function and no new grant: 0004_security.sql's blanket
-- `grant all on all tables ... to service_role` (plus its `alter default
-- privileges` counterpart) already covers this table's new columns.

alter table vulnerable_people
  add column timezone           text     not null default 'Europe/Paris',
  add column avatar_key         text,
  add column conversation_notes text,
  add column check_in_days      smallint[] not null default '{1,2,3,4,5,6,7}',
  add column schedule_state     text     not null default 'active'
    check (schedule_state in ('active', 'paused', 'inactive'));

-- Every element must be an ISO weekday, 1 (Monday) through 7 (Sunday). `<@`
-- ("is contained by") is Postgres's array-containment operator — the
-- idiomatic way to express "every element of this array is one of these
-- values" without a custom function.
alter table vulnerable_people
  add constraint vulnerable_people_check_in_days_valid
  check (check_in_days <@ array[1,2,3,4,5,6,7]::smallint[]);

comment on column vulnerable_people.avatar_key is
  'A preset avatar identifier (lib/avatars.ts AVATAR_KEYS). Never an uploaded image or a URL. Null or an unrecognised value falls back to an initials display — never an error.';
comment on column vulnerable_people.conversation_notes is
  'Ordinary conversation preferences or habits only, entered by the person''s trusted circle. Validated server-side against the same phone-digit rejection already applied to interests (lib/validation/profile.ts) — never a medical record, diagnosis, or emergency instruction.';
comment on column vulnerable_people.check_in_days is
  'ISO weekday numbers (1=Monday..7=Sunday) this person is meant to be checked on. Stored configuration only — no scheduler reads this yet (Stage D).';
comment on column vulnerable_people.schedule_state is
  'active | paused | inactive. Stored configuration only — nothing currently executes a schedule based on this value (Stage D).';
