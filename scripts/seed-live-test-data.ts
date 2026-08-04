// KinCall — live-test data seed (one-off, hand-run script; NOT part of the
// Next.js app, NOT a migration).
//
// Inserts 3 fictional monitored-person profiles and their trusted circles
// (3 contacts each = 9 total) into the CURRENTLY LINKED Supabase project,
// every one of them using the same controlled test phone number — a single
// consenting tester's real number, reused everywhere on purpose so every
// future live CALL-E test reaches the same person.
//
// SAFETY PROPERTIES (see the accompanying report for the full audit):
//   - The phone number is read exclusively from KINCALL_LIVE_TEST_PHONE
//     (see getTestPhone() below) — no fallback is hardcoded anywhere in this
//     file, so the real number is never a literal in source control. Set it
//     only in .env.local, which is Git-ignored (see .env.example for the
//     documented, empty placeholder).
//   - INSERT/UPDATE only, and only rows whose id is one of the 12 stable ids
//     this file defines below. No other row in this database can ever be
//     touched, because every write is keyed on one of those exact ids —
//     never on phone number, never on a broad match.
//   - Never touches events, call_events, timeline_entries, event_operations —
//     this script does not import or reference any of those tables at all,
//     so it is structurally incapable of starting a check-in or a call.
//   - Never sets CALLE_MODE, never calls any CALL-E adapter — this script
//     has no import of backend/integrations/calle/* anywhere.
//   - Idempotent: rerunning compares each test row's current columns against
//     this file's definitions and only writes the columns that differ.
//     Already-correct rows are reported "skipped", not silently rewritten.
//   - An existing test row that is archived is left exactly as it is and
//     reported as such — never silently un-archived.
//
// WHY THIS IS A FULLY SELF-CONTAINED SCRIPT (no import of anything under
// lib/, not even a relative one), NOT backend/persistence/supabase-client.ts /
// SupabaseRepository / shared/utilities/phone.ts / shared/utilities/avatars.ts:
//   - supabase-client.ts starts with `import "server-only"`, a marker package
//     whose default (non-Next) export unconditionally throws — it exists
//     specifically to make an accidental client-bundle import a build error.
//     That guard is exactly right for the app; it also means the file cannot
//     be imported from a plain Node process running outside Next's bundler.
//   - SupabaseRepository's constructor uses a TypeScript parameter property
//     (`constructor(private readonly client: ...)`), which Node's native
//     "strip only" TypeScript execution (no build step — see below) does not
//     support: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, confirmed by hand before
//     writing this file.
//   - Even a leaf, class-free module like shared/utilities/phone.ts hits a genuine
//     conflict between the two tools this script must satisfy at once: tsc
//     (moduleResolution "bundler", no `allowImportingTsExtensions`) REJECTS
//     a relative import ending in ".ts" (TS5097), while Node's native loader
//     REJECTS the same import WITHOUT the ".ts" extension
//     (`ERR_MODULE_NOT_FOUND`) — confirmed by hand both ways. Adding
//     `allowImportingTsExtensions` to the shared tsconfig.json for the sake
//     of one script was rejected as too broad a footprint.
//   This script therefore builds its own Supabase client, the same way
//   backend/persistence/supabase-client.ts does (same env vars, same client
//   options), talks to the two tables directly via parameterized PostgREST
//   calls — exactly what the task brief calls "the existing server-side
//   Supabase connection pattern" — and duplicates the small handful of pure
//   helpers it needs (phone validation/masking, avatar keys) with a comment
//   pointing at each one's real source of truth, rather than forcing the
//   app's own modules into a context/toolchain conflict they were not built
//   for.
//
// RUN WITH (no build step, no ts-node/tsx dependency added — Node 22.6+
// strips TypeScript types natively). Requires SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY and KINCALL_LIVE_TEST_PHONE to already be set in
// .env.local:
//
//   node --env-file=.env.local scripts/seed-live-test-data.ts
//
// Reruns safely; run it twice to see the idempotency report.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Duplicated from shared/utilities/phone.ts (see that file for the authoritative
//    version and its own reasoning) — kept in sync by hand. ─────────────────
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
function isE164(phone: string): boolean {
  return E164_PATTERN.test(phone);
}
const RESERVED_FICTION_PATTERN = /^\+3363998\d{4}$/;
function isReservedFictionPhone(phone: string): boolean {
  return RESERVED_FICTION_PATTERN.test(phone.trim());
}
function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 5) return "•".repeat(trimmed.length);
  const head = trimmed.slice(0, 3);
  const tail = trimmed.slice(-2);
  return `${head}${"•".repeat(trimmed.length - 5)}${tail}`;
}

// ── Duplicated from shared/utilities/avatars.ts (see that file for the authoritative
//    list) — kept in sync by hand. ──────────────────────────────────────────
const AVATAR_KEYS = ["sunrise", "olive", "terracotta", "lavender", "ocean", "meadow", "amber", "rose"] as const;
function isAvatarKey(value: string): boolean {
  return (AVATAR_KEYS as readonly string[]).includes(value);
}

// ── Enum values, mirrored from shared/validation/profile.ts ───────────────────
// Not imported: that module pulls in ../phone and ../avatars via
// EXTENSION-LESS relative imports, which resolve fine under Next.js/tsc's
// bundler but fail under Node's native ESM loader
// (`ERR_MODULE_NOT_FOUND`, confirmed by hand). Duplicated here instead of
// fighting that resolution gap in a one-off script — if
// shared/validation/profile.ts's allowed values ever change, this list must be
// updated to match by hand; there is no automated link between the two.
const CONVERSATION_PROFILES = ["standard", "cognitive_friendly", "speech_difficulty"] as const;
const PREFERRED_LANGUAGES = ["fr-FR", "en-GB", "en-US", "es-ES", "de-DE"] as const;
const CONSENT_STATUSES = ["pending", "confirmed", "declined"] as const;
const SCHEDULE_STATES = ["active", "paused", "inactive"] as const;

function assertOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Seed data error: ${label} "${value}" is not one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

// ── Data definitions ─────────────────────────────────────────────────────

interface PersonSeed {
  id: string;
  firstName: string;
  preferredLanguage: string;
  timezone: string;
  preferredCallTime: string;
  checkInDays: number[];
  scheduleState: string;
  conversationProfile: string;
  interests: string[];
  conversationNotes: string;
  consentStatus: string;
  avatarKey: string;
}

interface ContactSeed {
  id: string;
  personId: string;
  firstName: string;
  relationship: string;
  priority: number;
  isPrimary: boolean;
}

// No `lastName` field anywhere: neither vulnerable_people nor
// trusted_contacts has ever had one across migrations 0001-0011 (confirmed
// by reading every migration before writing this file — see the schema
// audit in the accompanying report). Per the brief's own "if supported"
// qualifier, surnames are simply not persisted; first_name stays exactly the
// given name, matching every existing seeded row's convention (Marie, Julie,
// Marc, Nicole) and — unlike a compound "Claire Martin" string — matching
// what CALL-E would actually read out if this profile is ever used in a real
// call.
const PEOPLE: PersonSeed[] = [
  {
    id: "person_live_test_claire",
    firstName: "Claire",
    preferredLanguage: "fr-FR",
    timezone: "Europe/Paris",
    preferredCallTime: "09:00",
    checkInDays: [1, 2, 3, 4, 5, 6, 7], // every day
    scheduleState: "active",
    conversationProfile: "cognitive_friendly", // closest "friendly/calm" valid value
    interests: ["gardening", "cooking", "family"],
    conversationNotes: "LIVE-TEST FICTIONAL PROFILE — enjoys quiet mornings in the garden.",
    consentStatus: "confirmed",
    avatarKey: "lavender",
  },
  {
    id: "person_live_test_henri",
    firstName: "Henri",
    preferredLanguage: "fr-FR",
    timezone: "Europe/Paris",
    preferredCallTime: "14:00",
    checkInDays: [1, 3, 5], // Monday, Wednesday, Friday
    scheduleState: "active",
    conversationProfile: "standard",
    interests: ["jazz", "football", "history"],
    conversationNotes: "LIVE-TEST FICTIONAL PROFILE — follows local football and jazz radio.",
    consentStatus: "confirmed",
    avatarKey: "ocean",
  },
  {
    id: "person_live_test_sophie",
    firstName: "Sophie",
    preferredLanguage: "fr-FR",
    timezone: "Europe/Paris",
    preferredCallTime: "18:00",
    checkInDays: [2, 4, 7], // Tuesday, Thursday, Sunday
    scheduleState: "active",
    conversationProfile: "speech_difficulty",
    interests: ["travel", "books", "cinema"],
    conversationNotes: "LIVE-TEST FICTIONAL PROFILE — loves picking a new novel each month.",
    consentStatus: "confirmed",
    avatarKey: "meadow",
  },
];

// relationship is free text in this schema (no CHECK/enum constraint on
// trusted_contacts.relationship in any migration) — lowercased to match the
// one existing convention already in the database (0005_seed.sql /
// backend/persistence/seed.ts: "daughter", "son", "trusted neighbour"), including
// its British spelling for the neighbour/sister-style relationship words.
const CONTACTS: ContactSeed[] = [
  // Claire's circle
  { id: "contact_live_test_claire_julie", personId: "person_live_test_claire", firstName: "Julie", relationship: "daughter", priority: 1, isPrimary: true },
  { id: "contact_live_test_claire_marc", personId: "person_live_test_claire", firstName: "Marc", relationship: "son", priority: 2, isPrimary: false },
  { id: "contact_live_test_claire_nathalie", personId: "person_live_test_claire", firstName: "Nathalie", relationship: "neighbour", priority: 3, isPrimary: false },
  // Henri's circle
  { id: "contact_live_test_henri_thomas", personId: "person_live_test_henri", firstName: "Thomas", relationship: "son", priority: 1, isPrimary: true },
  { id: "contact_live_test_henri_emilie", personId: "person_live_test_henri", firstName: "Émilie", relationship: "daughter", priority: 2, isPrimary: false },
  { id: "contact_live_test_henri_paul", personId: "person_live_test_henri", firstName: "Paul", relationship: "friend", priority: 3, isPrimary: false },
  // Sophie's circle
  { id: "contact_live_test_sophie_lucas", personId: "person_live_test_sophie", firstName: "Lucas", relationship: "son", priority: 1, isPrimary: true },
  { id: "contact_live_test_sophie_camille", personId: "person_live_test_sophie", firstName: "Camille", relationship: "daughter", priority: 2, isPrimary: false },
  { id: "contact_live_test_sophie_isabelle", personId: "person_live_test_sophie", firstName: "Isabelle", relationship: "sister", priority: 3, isPrimary: false },
];

const ALL_TEST_PERSON_IDS = PEOPLE.map((p) => p.id);
const ALL_TEST_CONTACT_IDS = CONTACTS.map((c) => c.id);

// ── Pre-flight data validation — fail before touching the database ─────────
// The phone itself is validated separately, in getTestPhone() below, at the
// point it is read from the environment — never as a hardcoded value here.
function validateSeedData(): void {
  for (const p of PEOPLE) {
    assertOneOf(p.preferredLanguage, PREFERRED_LANGUAGES, `${p.id}.preferredLanguage`);
    assertOneOf(p.conversationProfile, CONVERSATION_PROFILES, `${p.id}.conversationProfile`);
    assertOneOf(p.consentStatus, CONSENT_STATUSES, `${p.id}.consentStatus`);
    assertOneOf(p.scheduleState, SCHEDULE_STATES, `${p.id}.scheduleState`);
    if (!isAvatarKey(p.avatarKey)) {
      throw new Error(`Seed data error: ${p.id}.avatarKey "${p.avatarKey}" is not one of: ${AVATAR_KEYS.join(", ")}.`);
    }
    if (p.checkInDays.some((d) => d < 1 || d > 7)) {
      throw new Error(`Seed data error: ${p.id}.checkInDays contains a value outside 1..7.`);
    }
    if (p.conversationNotes.length > 280) {
      throw new Error(`Seed data error: ${p.id}.conversationNotes exceeds 280 characters.`);
    }
  }
  const seenContactIds = new Set<string>();
  for (const personId of ALL_TEST_PERSON_IDS) {
    const circle = CONTACTS.filter((c) => c.personId === personId);
    if (circle.length !== 3) {
      throw new Error(`Seed data error: ${personId} does not have exactly 3 contacts defined.`);
    }
    const priorities = circle.map((c) => c.priority).sort();
    if (priorities.join(",") !== "1,2,3") {
      throw new Error(`Seed data error: ${personId}'s contacts do not have priorities exactly 1,2,3.`);
    }
    if (circle.filter((c) => c.isPrimary).length !== 1) {
      throw new Error(`Seed data error: ${personId} does not have exactly one primary contact.`);
    }
  }
  for (const c of CONTACTS) {
    if (seenContactIds.has(c.id)) throw new Error(`Seed data error: duplicate contact id ${c.id}.`);
    seenContactIds.add(c.id);
  }
}

// ── Supabase client (mirrors backend/persistence/supabase-client.ts's pattern) ────
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}. Aborting — nothing was written.`);
    process.exit(1);
  }
  return value;
}

function buildClient(): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── The one controlled test number every profile and contact uses ──────────
// Read exclusively from KINCALL_LIVE_TEST_PHONE — no fallback is hardcoded
// anywhere in this file. This is not the per-participant override mechanism
// (phoneEnvVarFor/resolveConfiguredPhone in backend/persistence/seed.ts, which
// exists for the four LEGACY demo entities whose stored column is always a
// committed reserved-fiction placeholder): every profile created "through
// the interface" already stores its real, validated number directly
// (DEC-008), and these 3 test profiles are exactly that case, just created
// by a script instead of a form. The env var here is simply this script's
// one required input, kept out of source control the same way
// SUPABASE_SERVICE_ROLE_KEY already is. The value itself is never logged —
// every message below is built from maskPhone(testPhone), never the raw
// string, and validation failures name the variable, never its value.
function getTestPhone(): string {
  const value = requireEnv("KINCALL_LIVE_TEST_PHONE");
  if (!isE164(value)) {
    console.error("KINCALL_LIVE_TEST_PHONE is not a valid E.164 number. Aborting — nothing was written.");
    process.exit(1);
  }
  if (isReservedFictionPhone(value)) {
    console.error(
      "KINCALL_LIVE_TEST_PHONE is a reserved-for-fiction number and cannot be used as a real participant's number. " +
        "Aborting — nothing was written."
    );
    process.exit(1);
  }
  return value;
}

// ── Row shapes (subset of backend/persistence/row-mappers.ts's PersonRow/ContactRow) ──
interface PersonRow {
  id: string;
  first_name: string;
  phone: string;
  preferred_language: string;
  conversation_profile: string;
  preferred_call_time: string;
  interests: string[] | null;
  consent_status: string;
  archived_at: string | null;
  timezone: string;
  avatar_key: string | null;
  conversation_notes: string | null;
  check_in_days: number[] | null;
  schedule_state: string;
}

interface ContactRow {
  id: string;
  person_id: string;
  first_name: string;
  phone: string;
  relationship: string;
  priority: number;
  consent_status: string;
  archived_at: string | null;
  is_primary: boolean;
  enabled: boolean;
  callable_from: string | null;
  callable_to: string | null;
  timezone: string | null;
  max_attempts: number;
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

type Outcome = "created" | "updated" | "skipped" | "skipped-archived";

interface SyncResult {
  id: string;
  outcome: Outcome;
  changedFields: string[];
}

// ── Person sync: read, compare, write only what differs ────────────────────
async function syncPerson(client: SupabaseClient, seed: PersonSeed, testPhone: string): Promise<SyncResult> {
  const { data, error } = await client
    .from("vulnerable_people")
    .select("*")
    .eq("id", seed.id)
    .maybeSingle();
  if (error) throw new Error(`select vulnerable_people(${seed.id}) failed: ${error.message}`);

  const desiredRow = {
    first_name: seed.firstName,
    phone: testPhone,
    preferred_language: seed.preferredLanguage,
    conversation_profile: seed.conversationProfile,
    preferred_call_time: seed.preferredCallTime,
    interests: seed.interests,
    consent_status: seed.consentStatus,
    timezone: seed.timezone,
    avatar_key: seed.avatarKey,
    conversation_notes: seed.conversationNotes,
    check_in_days: seed.checkInDays,
    schedule_state: seed.scheduleState,
  };

  if (!data) {
    const { error: insertError } = await client
      .from("vulnerable_people")
      .insert({ id: seed.id, ...desiredRow });
    if (insertError) throw new Error(`insert vulnerable_people(${seed.id}) failed: ${insertError.message}`);
    return { id: seed.id, outcome: "created", changedFields: [] };
  }

  const existing = data as PersonRow;

  // Never resurrect a test entity that was archived — report it, do not touch it.
  if (existing.archived_at !== null) {
    return { id: seed.id, outcome: "skipped-archived", changedFields: [] };
  }

  const changed: string[] = [];
  const patch: Record<string, unknown> = {};
  if (existing.first_name !== desiredRow.first_name) { changed.push("first_name"); patch.first_name = desiredRow.first_name; }
  if (existing.phone !== desiredRow.phone) { changed.push("phone"); patch.phone = desiredRow.phone; }
  if (existing.preferred_language !== desiredRow.preferred_language) { changed.push("preferred_language"); patch.preferred_language = desiredRow.preferred_language; }
  if (existing.conversation_profile !== desiredRow.conversation_profile) { changed.push("conversation_profile"); patch.conversation_profile = desiredRow.conversation_profile; }
  if (existing.preferred_call_time !== desiredRow.preferred_call_time) { changed.push("preferred_call_time"); patch.preferred_call_time = desiredRow.preferred_call_time; }
  if (!arraysEqual(existing.interests ?? [], desiredRow.interests)) { changed.push("interests"); patch.interests = desiredRow.interests; }
  if (existing.consent_status !== desiredRow.consent_status) { changed.push("consent_status"); patch.consent_status = desiredRow.consent_status; }
  if (existing.timezone !== desiredRow.timezone) { changed.push("timezone"); patch.timezone = desiredRow.timezone; }
  if (existing.avatar_key !== desiredRow.avatar_key) { changed.push("avatar_key"); patch.avatar_key = desiredRow.avatar_key; }
  if (existing.conversation_notes !== desiredRow.conversation_notes) { changed.push("conversation_notes"); patch.conversation_notes = desiredRow.conversation_notes; }
  if (!arraysEqual(existing.check_in_days ?? [], desiredRow.check_in_days)) { changed.push("check_in_days"); patch.check_in_days = desiredRow.check_in_days; }
  if (existing.schedule_state !== desiredRow.schedule_state) { changed.push("schedule_state"); patch.schedule_state = desiredRow.schedule_state; }

  if (changed.length === 0) return { id: seed.id, outcome: "skipped", changedFields: [] };

  const { error: updateError } = await client.from("vulnerable_people").update(patch).eq("id", seed.id);
  if (updateError) throw new Error(`update vulnerable_people(${seed.id}) failed: ${updateError.message}`);
  return { id: seed.id, outcome: "updated", changedFields: changed };
}

// ── Contact sync: same read/compare/write shape ─────────────────────────────
async function syncContact(client: SupabaseClient, seed: ContactSeed, testPhone: string): Promise<SyncResult> {
  const { data, error } = await client
    .from("trusted_contacts")
    .select("*")
    .eq("id", seed.id)
    .maybeSingle();
  if (error) throw new Error(`select trusted_contacts(${seed.id}) failed: ${error.message}`);

  const desiredRow = {
    person_id: seed.personId,
    first_name: seed.firstName,
    phone: testPhone,
    relationship: seed.relationship,
    priority: seed.priority,
    consent_status: "confirmed",
    is_primary: seed.isPrimary,
    enabled: true,
    callable_from: null as string | null,
    callable_to: null as string | null,
    timezone: null as string | null, // inherit the person's own timezone
    max_attempts: 2,
  };

  if (!data) {
    const { error: insertError } = await client
      .from("trusted_contacts")
      .insert({ id: seed.id, ...desiredRow });
    if (insertError) throw new Error(`insert trusted_contacts(${seed.id}) failed: ${insertError.message}`);
    return { id: seed.id, outcome: "created", changedFields: [] };
  }

  const existing = data as ContactRow;

  if (existing.archived_at !== null) {
    return { id: seed.id, outcome: "skipped-archived", changedFields: [] };
  }

  const changed: string[] = [];
  const patch: Record<string, unknown> = {};
  if (existing.person_id !== desiredRow.person_id) { changed.push("person_id"); patch.person_id = desiredRow.person_id; }
  if (existing.first_name !== desiredRow.first_name) { changed.push("first_name"); patch.first_name = desiredRow.first_name; }
  if (existing.phone !== desiredRow.phone) { changed.push("phone"); patch.phone = desiredRow.phone; }
  if (existing.relationship !== desiredRow.relationship) { changed.push("relationship"); patch.relationship = desiredRow.relationship; }
  if (existing.priority !== desiredRow.priority) { changed.push("priority"); patch.priority = desiredRow.priority; }
  if (existing.consent_status !== desiredRow.consent_status) { changed.push("consent_status"); patch.consent_status = desiredRow.consent_status; }
  if (existing.is_primary !== desiredRow.is_primary) { changed.push("is_primary"); patch.is_primary = desiredRow.is_primary; }
  if (existing.enabled !== desiredRow.enabled) { changed.push("enabled"); patch.enabled = desiredRow.enabled; }
  if (existing.callable_from !== desiredRow.callable_from) { changed.push("callable_from"); patch.callable_from = desiredRow.callable_from; }
  if (existing.callable_to !== desiredRow.callable_to) { changed.push("callable_to"); patch.callable_to = desiredRow.callable_to; }
  if (existing.timezone !== desiredRow.timezone) { changed.push("timezone"); patch.timezone = desiredRow.timezone; }
  if (existing.max_attempts !== desiredRow.max_attempts) { changed.push("max_attempts"); patch.max_attempts = desiredRow.max_attempts; }

  if (changed.length === 0) return { id: seed.id, outcome: "skipped", changedFields: [] };

  const { error: updateError } = await client.from("trusted_contacts").update(patch).eq("id", seed.id);
  if (updateError) throw new Error(`update trusted_contacts(${seed.id}) failed: ${updateError.message}`);
  return { id: seed.id, outcome: "updated", changedFields: changed };
}

// ── Read-only verification, run after every seed pass ───────────────────────
async function verify(client: SupabaseClient): Promise<boolean> {
  let ok = true;
  const fail = (message: string) => {
    ok = false;
    console.error(`  ✗ ${message}`);
  };

  const { data: people, error: peopleError } = await client
    .from("vulnerable_people")
    .select("*")
    .in("id", ALL_TEST_PERSON_IDS);
  if (peopleError) throw new Error(`verify: select vulnerable_people failed: ${peopleError.message}`);
  const peopleRows = (people ?? []) as PersonRow[];

  const { data: contacts, error: contactsError } = await client
    .from("trusted_contacts")
    .select("*")
    .in("id", ALL_TEST_CONTACT_IDS);
  if (contactsError) throw new Error(`verify: select trusted_contacts failed: ${contactsError.message}`);
  const contactRows = (contacts ?? []) as ContactRow[];

  if (peopleRows.length !== 3) fail(`expected 3 live-test profiles, found ${peopleRows.length}`);
  if (contactRows.length !== 9) fail(`expected 9 live-test contacts, found ${contactRows.length}`);

  for (const person of peopleRows) {
    if (person.archived_at !== null) fail(`${person.id} is archived`);
    if (person.consent_status !== "confirmed") fail(`${person.id} consent_status is not confirmed`);
    if (person.schedule_state !== "active") fail(`${person.id} schedule_state is not active`);
    if (!isE164(person.phone)) fail(`${person.id} phone is not a valid E.164 shape`);
    if (isReservedFictionPhone(person.phone)) fail(`${person.id} phone is a reserved-fiction number`);

    const circle = contactRows.filter((c) => c.person_id === person.id);
    if (circle.length !== 3) {
      fail(`${person.id} has ${circle.length} live-test contacts, expected 3`);
      continue;
    }
    const priorities = circle.map((c) => c.priority).sort((a, b) => a - b);
    if (priorities.join(",") !== "1,2,3") fail(`${person.id}'s contacts do not have priorities 1,2,3 (got ${priorities.join(",")})`);
    const primaries = circle.filter((c) => c.is_primary);
    if (primaries.length !== 1) fail(`${person.id} has ${primaries.length} primary contacts, expected exactly 1`);
    for (const contact of circle) {
      if (contact.archived_at !== null) fail(`${contact.id} is archived`);
      if (!contact.enabled) fail(`${contact.id} is not enabled`);
      if (contact.consent_status !== "confirmed") fail(`${contact.id} consent_status is not confirmed`);
      if (contact.max_attempts !== 2) fail(`${contact.id} max_attempts is not 2`);
      if (contact.callable_from !== null || contact.callable_to !== null) fail(`${contact.id} has a callable window (expected none)`);
      if (contact.timezone !== null) fail(`${contact.id} has an explicit timezone (expected inherited/null)`);
      if (!isE164(contact.phone)) fail(`${contact.id} phone is not a valid E.164 shape`);
    }
  }

  // Proof that seeding never touches events/call_events/timeline_entries.
  const { count: eventCount, error: eventError } = await client
    .from("events")
    .select("id", { count: "exact", head: true })
    .in("person_id", ALL_TEST_PERSON_IDS);
  if (eventError) throw new Error(`verify: select events failed: ${eventError.message}`);
  if ((eventCount ?? 0) !== 0) fail(`found ${eventCount} event(s) for live-test people — expected 0`);

  console.log(ok ? "  ✓ all verification checks passed" : "  (see failures above)");
  return ok;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Read and validate the phone before touching the network, same as the
  // seed-data shape checks below — a bad or missing input fails immediately,
  // never mid-write.
  const testPhone = getTestPhone();
  validateSeedData();
  const client = buildClient();

  console.log(`KinCall live-test seed — controlled phone ${maskPhone(testPhone)}\n`);

  console.log("People:");
  const personResults: SyncResult[] = [];
  for (const person of PEOPLE) {
    const result = await syncPerson(client, person, testPhone);
    personResults.push(result);
    const detail = result.outcome === "updated" ? ` (${result.changedFields.join(", ")})` : "";
    console.log(`  ${result.id}: ${result.outcome}${detail}`);
  }

  console.log("\nTrusted contacts:");
  const contactResults: SyncResult[] = [];
  for (const contact of CONTACTS) {
    const result = await syncContact(client, contact, testPhone);
    contactResults.push(result);
    const detail = result.outcome === "updated" ? ` (${result.changedFields.join(", ")})` : "";
    console.log(`  ${result.id}: ${result.outcome}${detail}`);
  }

  const summarize = (results: SyncResult[]) => ({
    created: results.filter((r) => r.outcome === "created").length,
    updated: results.filter((r) => r.outcome === "updated").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    skippedArchived: results.filter((r) => r.outcome === "skipped-archived").length,
  });
  const peopleSummary = summarize(personResults);
  const contactSummary = summarize(contactResults);

  console.log("\nSummary:");
  console.log(
    `  people:   created=${peopleSummary.created} updated=${peopleSummary.updated} skipped=${peopleSummary.skipped} skipped-archived=${peopleSummary.skippedArchived}`
  );
  console.log(
    `  contacts: created=${contactSummary.created} updated=${contactSummary.updated} skipped=${contactSummary.skipped} skipped-archived=${contactSummary.skippedArchived}`
  );

  if (peopleSummary.skippedArchived > 0 || contactSummary.skippedArchived > 0) {
    console.log(
      "\n  NOTE: one or more live-test entities are archived and were left untouched.\n" +
        "  This script never un-archives anything automatically."
    );
  }

  console.log("\nVerification:");
  const passed = await verify(client);
  if (!passed) {
    console.error("\nVerification failed — see ✗ lines above.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\nSeed script failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
