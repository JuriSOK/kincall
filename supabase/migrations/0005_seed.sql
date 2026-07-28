-- KinCall Phase 5 — demo seed data.
--
-- Safe to commit: every number here is an ARCEP number reserved for fiction
-- (06 39 98 00 00 – 06 39 98 99 99), which LiveCalleAdapter refuses to dial. A
-- consenting participant's real number is supplied through KINCALL_*_PHONE and
-- overlaid when the row is read, so it never reaches this file or the database
-- (DEC-006). Mirrors lib/database/seed.ts exactly.
--
-- Re-runnable: `on conflict do nothing` makes reapplying it a no-op.

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
