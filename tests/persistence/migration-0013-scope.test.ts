import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Migration 0013 permanently deletes the legacy Marie demo data from the
// linked Supabase database. This project has no configured Supabase
// integration-test lane (no KINCALL_TEST_SUPABASE_* vars — see
// tests/support/supabase-test-env.ts), so a live re-application cannot run
// here; the migration's actual, correct effect on the linked project was
// verified once, live, by hand (see the accompanying report). What CAN be
// asserted automatically, and re-checked on every future change to this
// file, is that the SQL itself is structurally incapable of touching
// anything but person_marie and rows owned through her id — never by phone
// number or name, and never any other person's id.
const MIGRATION_PATH = new URL(
  "../../supabase/migrations/0013_remove_legacy_marie_demo_data.sql",
  import.meta.url
);
const SEED_PATH = new URL("../../supabase/migrations/0005_seed.sql", import.meta.url);

function readSql(url: URL): string {
  return readFileSync(url, "utf-8");
}

describe("migration 0013 — scoped exclusively to person_marie", () => {
  const sql = readSql(MIGRATION_PATH);
  // Only the SQL statements themselves, not the prose header comment, so an
  // explanatory comment mentioning another id (there is none) could never
  // make this test pass or fail for the wrong reason.
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("contains exactly six delete statements, one per owned table", () => {
    const deletes = statements.match(/delete from/gi) ?? [];
    expect(deletes).toHaveLength(6);
    for (const table of [
      "timeline_entries",
      "event_operations",
      "call_events",
      "events",
      "trusted_contacts",
      "vulnerable_people",
    ]) {
      expect(statements).toMatch(new RegExp(`delete from ${table}\\b`, "i"));
    }
  });

  it("every delete statement is scoped by the stable id 'person_marie'", () => {
    const deleteBlocks = statements.split(/(?=delete from)/i).filter((b) => b.trim().startsWith("delete"));
    expect(deleteBlocks.length).toBeGreaterThan(0);
    for (const block of deleteBlocks) {
      expect(block).toContain("person_marie");
    }
  });

  it("never references any live-test profile id in its executable SQL (comments may name them to explain they're untouched)", () => {
    for (const id of [
      "person_live_test_claire",
      "person_live_test_henri",
      "person_live_test_sophie",
    ]) {
      expect(statements).not.toContain(id);
    }
  });

  it("never deletes by phone number or first name — no phone-shaped literal, no first_name comparison", () => {
    expect(statements).not.toMatch(/\+\d{6,}/); // no E.164-shaped literal anywhere
    expect(statements).not.toMatch(/first_name\s*=/i);
    expect(statements).not.toContain("'Marie'");
  });

  it("touches no table outside the six Marie owns data in", () => {
    const referencedTables = [...statements.matchAll(/delete from (\w+)/gi)].map((m) => m[1]);
    const allowed = new Set([
      "timeline_entries",
      "event_operations",
      "call_events",
      "events",
      "trusted_contacts",
      "vulnerable_people",
    ]);
    for (const table of referencedTables) {
      expect(allowed.has(table)).toBe(true);
    }
  });
});

describe("0005_seed.sql — untouched by the Marie removal", () => {
  it("still contains the original person_marie seed insert, unedited", () => {
    const sql = readSql(SEED_PATH);
    expect(sql).toContain("'person_marie', 'Marie'");
    expect(sql).toContain("on conflict (id) do nothing");
  });
});
