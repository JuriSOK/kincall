-- KinCall — soft deletion for vulnerable_people and trusted_contacts
-- (docs/DECISION_LOG.md DEC-009). Optional interface administration, not a
-- core orchestration feature.
--
-- Rows are NEVER physically deleted: doing so would break historical event
-- and call-summary resolution, which must keep working for any event created
-- while the person/contact was still active. `archived_at` marks a row as no
-- longer active without destroying anything historical — getPerson and
-- getTrustedContacts (unfiltered) still resolve an archived row by id.

alter table vulnerable_people add column archived_at timestamptz;
alter table trusted_contacts  add column archived_at timestamptz;

-- Hot-path indexes for "the active ones", mirroring idx_call_events_pending's
-- partial-index pattern in 0001_init.sql.
create index idx_vulnerable_people_active on vulnerable_people (id)
  where archived_at is null;
create index idx_trusted_contacts_active on trusted_contacts (person_id, priority)
  where archived_at is null;

-- ── archive_person: refuses while any non-terminal event exists ────────────
-- Returns no rows for an unknown person (the TS wrapper throws
-- UnknownRecordError on that, matching updateEvent's established pattern —
-- no exception needed for a plain "not found"). Idempotent: archiving an
-- already-archived person returns it unchanged rather than erroring.
create function archive_person(p_person_id text)
returns setof vulnerable_people
language plpgsql security invoker as $$
declare v_row vulnerable_people;
begin
  select * into v_row from vulnerable_people where id = p_person_id for update;
  if not found then
    return;
  end if;

  if v_row.archived_at is not null then
    return query select * from vulnerable_people where id = p_person_id;
    return;
  end if;

  -- The only genuine refusal: a real safety-rule violation, so it DOES raise
  -- (errcode 23000, mapped by SupabaseRepository to PersonHasActiveEventError
  -- — the same generic "integrity constraint" class reorder_trusted_contacts
  -- and commit_transition_with_call_intent already use for their own distinct
  -- safety rules).
  if exists (
    select 1 from events
     where person_id = p_person_id
       and status not in ('CASE_CLOSED', 'HUMAN_REVIEW_REQUIRED')
  ) then
    raise exception 'cannot archive person %: an active event is still open', p_person_id
      using errcode = '23000';
  end if;

  return query update vulnerable_people set archived_at = now()
    where id = p_person_id
    returning *;
end;
$$;

-- ── archive_trusted_contact: refuses while any active call exists ─────────
-- "Active" mirrors the poll route's own definition of "the call still in
-- flight" (result_processed_at is null) — the one place this codebase already
-- decides what counts as an unresolved call.
create function archive_trusted_contact(p_contact_id text)
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

  return query update trusted_contacts set archived_at = now()
    where id = p_contact_id
    returning *;
end;
$$;

-- ── reorder_trusted_contacts: redefined to operate on ACTIVE contacts only ──
-- Same signature and return type as 0006_reorder.sql's original, so this is a
-- straight `create or replace` — grants attach to the function's identity and
-- survive it unchanged. Archived contacts are now invisible to this function
-- entirely: excluded from the "exactly this circle" check, never supplied as
-- a valid id, never renumbered. Their stale priority is left untouched.
create or replace function reorder_trusted_contacts(p_person_id text, p_ordered_ids text[])
returns setof trusted_contacts
language plpgsql security invoker as $$
declare
  v_expected integer;
  v_supplied integer;
  v_offset   integer;
  v_index    integer;
begin
  v_supplied := cardinality(p_ordered_ids);
  select count(*) into v_expected from trusted_contacts
   where person_id = p_person_id and archived_at is null;

  perform 1 from trusted_contacts where person_id = p_person_id for update;

  if v_supplied <> (select count(distinct t.id) from unnest(p_ordered_ids) as t(id)) then
    raise exception 'reorder rejected: the same contact appears more than once'
      using errcode = '23000';
  end if;

  if v_supplied <> v_expected then
    raise exception 'reorder rejected: expected all % active contacts, received %',
      v_expected, v_supplied using errcode = '23000';
  end if;

  if exists (
    select 1 from unnest(p_ordered_ids) as t(id)
     where not exists (
       select 1 from trusted_contacts tc
        where tc.id = t.id and tc.person_id = p_person_id and tc.archived_at is null
     )
  ) then
    raise exception 'reorder rejected: an id is not an active contact in this trusted circle'
      using errcode = '23000';
  end if;

  if v_supplied = 0 then
    return query select * from trusted_contacts
                  where person_id = p_person_id and archived_at is null
                  order by priority;
    return;
  end if;

  -- Offset from the max across ALL contacts (including archived), so the
  -- temporary shift cannot collide with an archived contact's stale priority
  -- either — then only the active ones are actually shifted and renumbered.
  select coalesce(max(priority), 0) into v_offset
    from trusted_contacts where person_id = p_person_id;
  update trusted_contacts set priority = priority + v_offset + 1
   where person_id = p_person_id and archived_at is null;

  for v_index in 1 .. v_supplied loop
    update trusted_contacts set priority = v_index
     where id = p_ordered_ids[v_index] and person_id = p_person_id;
  end loop;

  return query select * from trusted_contacts
                where person_id = p_person_id and archived_at is null
                order by priority;
end;
$$;

-- ── Grants, mirroring 0004_security.sql's pattern exactly ──────────────────
revoke execute on function archive_person(text) from public, anon, authenticated;
revoke execute on function archive_trusted_contact(text) from public, anon, authenticated;
grant execute on function archive_person(text) to service_role;
grant execute on function archive_trusted_contact(text) to service_role;
-- reorder_trusted_contacts' grants were already set by 0006_reorder.sql and
-- are unaffected by create-or-replace (grants attach to the function's
-- identity/signature, not its body).
