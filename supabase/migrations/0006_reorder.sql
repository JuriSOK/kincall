-- KinCall Phase 5 — atomic trusted-circle reordering.
--
-- `unique (person_id, priority)` (0001_init.sql) rejects any interim state
-- where two contacts share a priority, so a naive pairwise swap fails halfway.
-- The whole reorder therefore happens inside one function, i.e. one
-- transaction: either the new order applies completely or nothing changes.
--
-- SECURITY INVOKER and granted only to service_role, matching 0004_security.sql.

create function reorder_trusted_contacts(p_person_id text, p_ordered_ids text[])
returns setof trusted_contacts
language plpgsql security invoker as $$
declare
  v_expected integer;
  v_supplied integer;
  v_offset   integer;
  v_index    integer;
begin
  -- cardinality(), not array_length(): array_length() returns NULL for an empty
  -- array, which would make every comparison below NULL and silently skip
  -- validation. cardinality() returns 0.
  v_supplied := cardinality(p_ordered_ids);
  select count(*) into v_expected from trusted_contacts where person_id = p_person_id;

  -- Lock the circle for the duration, so a concurrent reorder cannot interleave
  -- between validation and rewrite.
  perform 1 from trusted_contacts where person_id = p_person_id for update;

  -- Every check runs BEFORE any write. Applying a partial order could drop a
  -- contact out of the cascade entirely, which for a vulnerable person means
  -- nobody is called.
  if v_supplied <> (select count(distinct t.id) from unnest(p_ordered_ids) as t(id)) then
    raise exception 'reorder rejected: the same contact appears more than once'
      using errcode = '23000';
  end if;

  if v_supplied <> v_expected then
    raise exception 'reorder rejected: expected all % contacts, received %',
      v_expected, v_supplied using errcode = '23000';
  end if;

  if exists (
    select 1 from unnest(p_ordered_ids) as t(id)
     where not exists (select 1 from trusted_contacts tc
                        where tc.id = t.id and tc.person_id = p_person_id)
  ) then
    raise exception 'reorder rejected: an id is not in this trusted circle'
      using errcode = '23000';
  end if;

  -- Nothing to do for an empty circle, and nothing to validate against either.
  if v_supplied = 0 then
    return query select * from trusted_contacts
                  where person_id = p_person_id order by priority;
    return;
  end if;

  -- Shift clear of the live range first. CHECK (priority > 0) rules out
  -- negative temporaries, and the offset is computed from the current maximum
  -- rather than a fixed constant so it cannot collide with real priorities
  -- however large they have grown.
  select coalesce(max(priority), 0) into v_offset
    from trusted_contacts where person_id = p_person_id;
  update trusted_contacts set priority = priority + v_offset + 1
   where person_id = p_person_id;

  for v_index in 1 .. v_supplied loop
    update trusted_contacts set priority = v_index
     where id = p_ordered_ids[v_index] and person_id = p_person_id;
  end loop;

  return query select * from trusted_contacts
                where person_id = p_person_id order by priority;
end;
$$;

revoke execute on function reorder_trusted_contacts(text, text[])
  from public, anon, authenticated;
grant execute on function reorder_trusted_contacts(text, text[]) to service_role;
