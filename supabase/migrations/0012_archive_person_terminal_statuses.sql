-- KinCall — archive_person() must recognise ATTENTION_UNRESOLVED as terminal
-- (docs/DECISION_LOG.md DEC-020).
--
-- WHY THIS MIGRATION IS NEEDED
--
-- archive_person() (0007_archive_entities.sql) refuses to archive a person
-- while any event's status is outside ('CASE_CLOSED', 'HUMAN_REVIEW_REQUIRED').
-- That list was correct when 0007 was written, but DEC-011 (30 July 2026)
-- introduced a THIRD terminal status, ATTENTION_UNRESOLVED — the autonomous,
-- finished-but-unresolved outcome when every trusted contact has been tried
-- and none could help. lib/orchestration/states.ts's isTerminalEventStatus()
-- was updated to treat it as terminal; this SQL function never was, and 0007
-- predates DEC-011 so it could not have known about it.
--
-- The practical effect: a person whose most recent check-in ended
-- ATTENTION_UNRESOLVED — a fully finished cascade, nothing left running,
-- nothing further will happen to it automatically — could never be archived
-- at all, indefinitely, with no workaround. That is a bug, not a deliberate
-- safety rule: ATTENTION_UNRESOLVED carries no live call, no open lease, no
-- pending retry — there is nothing left to orphan.
--
-- SAFETY
--
-- Same signature, `create or replace` (grants attach to the function's
-- identity and survive unchanged, per 0007's and 0011's own precedent for
-- redefining archive_trusted_contact/reorder_trusted_contacts). Only the
-- refusal condition changes; every other rule is untouched:
--   * still refuses while a genuinely active event exists (anything not yet
--     CASE_CLOSED / ATTENTION_UNRESOLVED / HUMAN_REVIEW_REQUIRED);
--   * still idempotent (already-archived returns unchanged, not an error);
--   * still a no-op read for an unknown person id.
-- Does not touch archive_trusted_contact, reorder_trusted_contacts, or any
-- table. No existing row's archived_at changes as a result of applying this
-- migration — it only changes what a FUTURE archive_person() call is allowed
-- to do.

create or replace function archive_person(p_person_id text)
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

  if exists (
    select 1 from events
     where person_id = p_person_id
       and status not in ('CASE_CLOSED', 'ATTENTION_UNRESOLVED', 'HUMAN_REVIEW_REQUIRED')
  ) then
    raise exception 'cannot archive person %: an active event is still open', p_person_id
      using errcode = '23000';
  end if;

  return query update vulnerable_people set archived_at = now()
    where id = p_person_id
    returning *;
end;
$$;

-- Grants unaffected by create-or-replace (same signature as 0007's original;
-- see that file's own note on this). No new grant statement is needed.
