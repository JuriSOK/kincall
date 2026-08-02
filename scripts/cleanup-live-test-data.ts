// KinCall — live-test data cleanup (one-off, hand-run script; NOT part of the
// Next.js app, NOT a migration). Companion to scripts/seed-live-test-data.ts.
//
// DO NOT RUN THIS UNTIL THE PRODUCT OWNER DECIDES TO. It is written and
// reviewed here, but never executed by this change.
//
// Targets ONLY the 3 stable live-test profile ids and the 9 stable live-test
// contact ids scripts/seed-live-test-data.ts defines — the exact same
// literal id lists, duplicated here on purpose so this script has no import
// dependency on the seed script (each stays independently readable and
// independently safe).
//
// SAFETY PROPERTIES:
//   - Every write is keyed on one of the 12 known stable ids — never on
//     phone number, never on a name match, never on a broad filter.
//   - Refuses to run at all unless every one of the 9 live-test contacts it
//     finds is owned by one of the 3 live-test person ids — see
//     assertNoUnrelatedOwnership() below. This catches the one way a stable
//     id could theoretically have been reused/repurposed for something else
//     since seeding.
//   - Prefers archival (archived_at = now()) over physical deletion, matching
//     this product's existing soft-deletion model (DEC-009,
//     migration 0007_archive_entities.sql) — the same action the interface's
//     own "Archive" buttons perform. Rows are never physically DELETEd by
//     this script.
//   - Never touches events, call_events, or timeline_entries — no import of
//     any of those tables, and no DELETE statement anywhere in this file.
//   - Requires an explicit `--confirm` flag. Without it, this is a dry run:
//     it reports exactly what WOULD be archived and changes nothing.
//   - Archiving a person with a non-terminal event, or a contact with an
//     unresolved call, is refused by the database itself
//     (archive_person/archive_trusted_contact — migration 0007) — this
//     script surfaces that refusal rather than working around it.
//
// RUN WITH (dry run — reports only, writes nothing):
//   node --env-file=.env.local scripts/cleanup-live-test-data.ts
//
// RUN WITH (actually archives the live-test rows):
//   node --env-file=.env.local scripts/cleanup-live-test-data.ts --confirm

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Duplicated verbatim from scripts/seed-live-test-data.ts — see that file's
// own header comment for why nothing under lib/ is imported here.
const TEST_PERSON_IDS = ["person_live_test_claire", "person_live_test_henri", "person_live_test_sophie"];
const TEST_CONTACT_IDS = [
  "contact_live_test_claire_julie",
  "contact_live_test_claire_marc",
  "contact_live_test_claire_nathalie",
  "contact_live_test_henri_thomas",
  "contact_live_test_henri_emilie",
  "contact_live_test_henri_paul",
  "contact_live_test_sophie_lucas",
  "contact_live_test_sophie_camille",
  "contact_live_test_sophie_isabelle",
];

interface PersonRow {
  id: string;
  archived_at: string | null;
}
interface ContactRow {
  id: string;
  person_id: string;
  archived_at: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}. Aborting — nothing was read or written.`);
    process.exit(1);
  }
  return value;
}

function buildClient(): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Refuses to proceed if any of the 9 known contact ids is owned by a person
// OTHER than one of the 3 known live-test person ids, or if any contact
// exists under a live-test person id that is NOT one of the 9 known contact
// ids (either would mean an id got reused/repurposed since seeding, and
// guessing which rows are "really" test data would be exactly the kind of
// silent broad match this script must never do).
function assertNoUnrelatedOwnership(contacts: ContactRow[]): void {
  const knownPersonIds = new Set(TEST_PERSON_IDS);
  const knownContactIds = new Set(TEST_CONTACT_IDS);

  const foreignOwned = contacts.filter((c) => knownContactIds.has(c.id) && !knownPersonIds.has(c.person_id));
  if (foreignOwned.length > 0) {
    throw new Error(
      `Refusing to continue: ${foreignOwned.length} contact id(s) recognised from the seed list are owned by a ` +
        `person id NOT in the live-test set (${foreignOwned.map((c) => c.id).join(", ")}). An id may have been ` +
        `reused. Nothing was changed — resolve this manually before rerunning.`
    );
  }

  const unexpectedUnderTestPerson = contacts.filter(
    (c) => knownPersonIds.has(c.person_id) && !knownContactIds.has(c.id)
  );
  if (unexpectedUnderTestPerson.length > 0) {
    throw new Error(
      `Refusing to continue: found ${unexpectedUnderTestPerson.length} contact(s) under a live-test person id that ` +
        `are NOT in this script's known contact list (${unexpectedUnderTestPerson.map((c) => c.id).join(", ")}). ` +
        `This looks like a contact added by hand under a test profile. Nothing was changed — resolve this ` +
        `manually before rerunning.`
    );
  }
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const client = buildClient();

  const { data: people, error: peopleError } = await client
    .from("vulnerable_people")
    .select("id, archived_at")
    .in("id", TEST_PERSON_IDS);
  if (peopleError) throw new Error(`select vulnerable_people failed: ${peopleError.message}`);
  const peopleRows = (people ?? []) as PersonRow[];

  // Matches a known contact id OR anything owned by a known live-test person
  // id — the second clause is what lets assertNoUnrelatedOwnership below
  // detect a contact someone added by hand under a test profile.
  const { data: contacts, error: contactsError } = await client
    .from("trusted_contacts")
    .select("id, person_id, archived_at")
    .or(`id.in.(${TEST_CONTACT_IDS.join(",")}),person_id.in.(${TEST_PERSON_IDS.join(",")})`);
  if (contactsError) throw new Error(`select trusted_contacts failed: ${contactsError.message}`);
  const contactRows = (contacts ?? []) as ContactRow[];

  assertNoUnrelatedOwnership(contactRows);

  const peopleToArchive = peopleRows.filter((p) => p.archived_at === null);
  const peopleAlreadyArchived = peopleRows.filter((p) => p.archived_at !== null);
  const contactsToArchive = contactRows.filter(
    (c) => TEST_CONTACT_IDS.includes(c.id) && c.archived_at === null
  );
  const contactsAlreadyArchived = contactRows.filter(
    (c) => TEST_CONTACT_IDS.includes(c.id) && c.archived_at !== null
  );

  console.log(`KinCall live-test cleanup — ${confirm ? "CONFIRM mode (will write)" : "DRY RUN (no writes)"}\n`);
  console.log(`Found ${peopleRows.length}/${TEST_PERSON_IDS.length} live-test profiles, ${contactRows.length}/${TEST_CONTACT_IDS.length} live-test contacts.`);
  console.log(`Would archive: ${peopleToArchive.length} profile(s), ${contactsToArchive.length} contact(s).`);
  console.log(`Already archived (left as-is): ${peopleAlreadyArchived.length} profile(s), ${contactsAlreadyArchived.length} contact(s).`);
  console.log("\nEvents, call_events and timeline_entries are never touched by this script.");

  if (!confirm) {
    console.log("\nDry run only — rerun with --confirm to actually archive the rows listed above.");
    return;
  }

  // Contacts first: archiving the person while an active (non-terminal) event
  // exists is refused by the database (migration 0007) regardless of order,
  // but archiving contacts first is the more natural reading of "wind down
  // the circle, then the profile".
  console.log("\nArchiving...");
  for (const contact of contactsToArchive) {
    const { data, error } = await client.rpc("archive_trusted_contact", { p_contact_id: contact.id });
    if (error) {
      console.error(`  ✗ ${contact.id}: ${error.message}`);
      continue;
    }
    console.log(`  ✓ ${contact.id}: archived${Array.isArray(data) && data.length === 0 ? " (already was)" : ""}`);
  }
  for (const person of peopleToArchive) {
    const { data, error } = await client.rpc("archive_person", { p_person_id: person.id });
    if (error) {
      console.error(`  ✗ ${person.id}: ${error.message} (likely a non-terminal event is still open — resolve it first)`);
      continue;
    }
    console.log(`  ✓ ${person.id}: archived${Array.isArray(data) && data.length === 0 ? " (already was)" : ""}`);
  }

  console.log("\nDone. Historical events for these profiles, if any, were not created by seeding and remain untouched.");
}

main().catch((error) => {
  console.error("\nCleanup script failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
