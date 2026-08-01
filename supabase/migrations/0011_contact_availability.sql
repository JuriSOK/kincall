-- KinCall Stage E — richer trusted-contact configuration: a primary flag, an
-- enabled/disabled state, an optional callable time window, an optional
-- per-contact timezone, and a per-contact maximum-attempts override
-- (docs/DECISION_LOG.md DEC-017).
--
-- Additive and backward-compatible: every new column is nullable or carries a
-- default matching the CURRENT behaviour exactly (enabled = true, max_attempts
-- = 2, no availability window), so every existing row — and every existing
-- INSERT that does not name these columns (0005_seed.sql,
-- supabase/testing/9999_test_helpers.sql) — remains valid with no change to
-- either file, and the default-preservation rule (DEC-017) holds by
-- construction rather than by special-casing. The one exception is any
-- contact already archived before this migration: see the UPDATE just below
-- the ALTER TABLE, which normalises is_primary/enabled for those rows so the
-- archived-implies-not-primary-or-enabled constraint further down does not
-- reject the migration's own backfill.
--
-- No change to reorder_trusted_contacts: cascade ORDER is still driven by
-- `priority`, unchanged by this migration (availability only reorders at
-- cascade-run time, in application code — see lib/orchestration/
-- contact-order.ts — never by rewriting the stored priority).

alter table trusted_contacts
  add column is_primary    boolean  not null default false,
  add column enabled       boolean  not null default true,
  add column callable_from time,
  add column callable_to   time,
  add column timezone      text,
  add column max_attempts  smallint not null default 2;

-- Normalise any contact archived before this migration existed. The column
-- default above just set `enabled = true` on EVERY row, including already-
-- archived ones, which would otherwise immediately violate
-- trusted_contacts_archived_not_primary_or_enabled below the moment it is
-- added. This is not a change to any historical fact — `is_primary` and
-- `enabled` are brand-new columns with no prior recorded value — it assigns
-- exactly what archive_trusted_contact() would have written had these
-- columns existed at the moment each contact was archived.
update trusted_contacts
   set is_primary = false, enabled = false
 where archived_at is not null;

-- DEC-017 / CLAUDE.md: per-contact configuration may only LOWER the bound the
-- engine already enforces (lib/orchestration/engine.ts's MAX_CONTACT_ATTEMPTS),
-- never raise it. Checked here so a bad value cannot even be stored, and
-- re-checked at cascade time (effective attempts = min(max_attempts, 2)) so a
-- historical or externally-written row can never bypass the safety bound
-- either.
alter table trusted_contacts
  add constraint trusted_contacts_max_attempts_bounded
  check (max_attempts between 1 and 2);

-- A window is either fully configured or not configured at all — never half
-- of one. "Reject only one side of an incomplete time window" (Stage E
-- brief): allowing just one bound would make "always available" ambiguous
-- with "available until/from this one moment", which is not a rule this
-- product implements.
alter table trusted_contacts
  add constraint trusted_contacts_callable_window_complete
  check ((callable_from is null) = (callable_to is null));

-- Archived contacts can never become primary or enabled again (product rule,
-- Stage E brief §8): there is no "unarchive" action anywhere in this
-- codebase, so a stale primary/enabled flag on an archived row would be a
-- silent, permanent inconsistency with no path to notice or fix it. Enforced
-- here so it holds regardless of write path, not only through the interface.
alter table trusted_contacts
  add constraint trusted_contacts_archived_not_primary_or_enabled
  check (archived_at is null or (not is_primary and not enabled));

-- Only one PRIMARY, ACTIVE (non-archived) contact per person. A partial index
-- rather than a table-wide unique constraint: archived contacts are excluded
-- entirely, so a person may accumulate any number of archived ex-primaries
-- without ever blocking a new one from being set.
create unique index idx_trusted_contacts_one_primary
  on trusted_contacts (person_id)
  where is_primary and archived_at is null;

comment on column trusted_contacts.is_primary is
  'At most one TRUE per person among non-archived contacts (idx_trusted_contacts_one_primary). A visual/informational indicator only — it does not reorder the cascade or bypass consent, enabled state, or retry rules. Set exclusively via set_primary_contact(), which atomically clears any previous primary.';
comment on column trusted_contacts.enabled is
  'Excluded from new cascades when false (Stage E), same as archived_at is not null — but reversible, unlike archival. Distinct from consent_status: an unconsented contact is never called regardless of enabled.';
comment on column trusted_contacts.callable_from is
  'Local start of this contact''s usual callable window, in their own timezone (or the person''s, if timezone is null). Null (with callable_to) means always available. NEVER causes the cascade to wait — it only orders in-window contacts before out-of-window ones (lib/orchestration/contact-order.ts). Nobody is excluded solely for being outside this window.';
comment on column trusted_contacts.callable_to is
  'Local end of the callable window. May be earlier than callable_from to express a window crossing midnight (e.g. 22:00-07:00).';
comment on column trusted_contacts.timezone is
  'IANA timezone identifier for interpreting callable_from/callable_to. Null means inherit the person''s own persisted timezone (vulnerable_people.timezone).';
comment on column trusted_contacts.max_attempts is
  '1 or 2 (trusted_contacts_max_attempts_bounded). Configuration may only LOWER how many times this contact is tried below the global bound, never raise it — the engine always applies min(max_attempts, MAX_CONTACT_ATTEMPTS).';

-- ── archive_trusted_contact: redefined to also clear is_primary/enabled ────
-- Same signature and return type as 0007_archive_entities.sql's original, so
-- this is a straight `create or replace` (grants attach to the function's
-- identity and survive it unchanged) — matching the precedent 0007 itself set
-- when it redefined reorder_trusted_contacts. Without this, archiving a
-- contact who is currently primary and/or enabled would immediately violate
-- trusted_contacts_archived_not_primary_or_enabled above; clearing both here
-- keeps archival working exactly as it always has, for every contact.
create or replace function archive_trusted_contact(p_contact_id text)
returns setof trusted_contacts
language plpgsql security invoker as $$
declare v_row trusted_contacts;
begin
  select * into v_row from trusted_contacts where id = p_contact_id for update;
  if not found then
    return;
  end if;

  if v_row.archived_at is not null then
    return query select * from trusted_contacts where id = p_contact_id;
    return;
  end if;

  if exists (
    select 1 from call_events
     where contact_id = p_contact_id
       and result_processed_at is null
  ) then
    raise exception 'cannot archive contact %: an active call is in progress', p_contact_id
      using errcode = '23000';
  end if;

  return query update trusted_contacts
    set archived_at = now(), is_primary = false, enabled = false
    where id = p_contact_id
    returning *;
end;
$$;

-- ── set_primary_contact: the only way is_primary changes ───────────────────
-- Atomic (one transaction): clears any previous primary and sets the new one,
-- so no interim state is ever observable where a person has zero or two
-- primaries. Refuses for an archived or unknown contact — never silently
-- promotes one, and never leaves an intermediate state on refusal.
create function set_primary_contact(p_person_id text, p_contact_id text)
returns setof trusted_contacts
language plpgsql security invoker as $$
declare v_row trusted_contacts;
begin
  select * into v_row from trusted_contacts
   where id = p_contact_id and person_id = p_person_id
   for update;

  if not found then
    raise exception 'set_primary_contact: "%" is not a trusted contact of "%"', p_contact_id, p_person_id
      using errcode = '23000';
  end if;

  if v_row.archived_at is not null then
    raise exception 'set_primary_contact: an archived contact cannot become primary'
      using errcode = '23000';
  end if;

  update trusted_contacts set is_primary = false
   where person_id = p_person_id and is_primary;

  update trusted_contacts set is_primary = true
   where id = p_contact_id;

  return query select * from trusted_contacts
                where person_id = p_person_id and archived_at is null
                order by priority;
end;
$$;

-- ── Grants, mirroring 0004_security.sql's pattern exactly ──────────────────
revoke execute on function set_primary_contact(text, text) from public, anon, authenticated;
grant execute on function set_primary_contact(text, text) to service_role;
-- archive_trusted_contact's grants were already set by 0007_archive_entities.sql
-- and are unaffected by create-or-replace (grants attach to the function's
-- identity/signature, not its body). updateTrustedContact needs no new grant:
-- it is a direct UPDATE via the service-role client (same pattern as
-- updatePerson/updateEvent), already covered by 0004_security.sql's blanket
-- `grant all on all tables ... to service_role`.
