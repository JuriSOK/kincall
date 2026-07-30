import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  isIntegrationConfigured,
  requireIntegrationEnv,
  serviceClient,
} from "../support/supabase-test-env";

const TABLES = [
  "vulnerable_people",
  "trusted_contacts",
  "events",
  "call_events",
  "event_operations",
  "timeline_entries",
] as const;

const RPCS = [
  { name: "claim_call_event_result", args: { p_call_event_id: "x", p_lease_seconds: 1 } },
  {
    name: "finalize_call_event_result",
    args: {
      p_call_event_id: "x",
      p_processing_token: "00000000-0000-0000-0000-000000000000",
      p_status: "completed",
      p_summary: null,
      p_structured_result: null,
      p_ended_at: new Date().toISOString(),
    },
  },
  {
    name: "release_call_event_lease",
    args: { p_call_event_id: "x", p_processing_token: "00000000-0000-0000-0000-000000000000" },
  },
  {
    name: "commit_transition",
    args: {
      p_event_id: "x",
      p_operation_key: "k",
      p_transition_event: "COMPANION_CALL_STARTED",
      p_expected_from_status: "SCHEDULED",
      p_status: "CALLING_PERSON",
      p_messages: [],
      p_patch: {},
    },
  },
  {
    name: "commit_transition_with_call_intent",
    args: {
      p_event_id: "x",
      p_operation_key: "k",
      p_transition_event: "COMPANION_CALL_STARTED",
      p_expected_from_status: "SCHEDULED",
      p_status: "CALLING_PERSON",
      p_messages: [],
      p_patch: {},
      p_agent_type: "companion",
      p_contact_id: null,
      // Required since migration 0008 (DEC-011). Omitting it made PostgREST
      // fail to resolve the function at all, so the assertion below passed on
      // "function does not exist" rather than on a denied EXECUTE grant —
      // the privilege check it exists to make was not actually happening.
      p_attempt_number: 1,
      p_idempotency_key: "k",
    },
  },
  // Ships only to test projects, but a truncating function reachable by the
  // anon key would be worse than any read leak, so it is swept too.
  { name: "kincall_test_reset", args: {} },
] as const;

describe.skipIf(!isIntegrationConfigured())("Supabase security — the anon key reaches nothing", () => {
  let anon: SupabaseClient;
  let service: SupabaseClient;

  beforeAll(() => {
    const env = requireIntegrationEnv();
    anon = anonClient(env);
    service = serviceClient(env);
  });

  it.each(TABLES)("denies the anon key any read of %s", async (table) => {
    const { data, error } = await anon.from(table).select("*").limit(1);
    // Either a hard permission error, or an empty result — never data.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    expect(data ?? []).toEqual([]);
  });

  it.each(TABLES)("denies the anon key any write to %s", async (table) => {
    const { error } = await anon.from(table).insert({ id: "anon_should_not_write" });
    expect(error).not.toBeNull();
  });

  it.each(RPCS)("denies the anon key EXECUTE on $name", async ({ name, args }) => {
    const { data, error } = await anon.rpc(name, args as Record<string, unknown>);
    expect(error).not.toBeNull();
    expect(data ?? null).toBeNull();
  });

  it("reports no privileges for anon in the catalog either", async () => {
    // Introspection is not sufficient on its own — hence the live calls above,
    // since a grant PostgREST does not expose is still a grant — but it
    // catches privileges those probes cannot reach.
    const { data, error } = await service.rpc("kincall_test_privileges");
    expect(error).toBeNull();

    const privileges = data as { tables: Record<string, boolean>; functions: Record<string, boolean> };
    for (const [table, granted] of Object.entries(privileges.tables)) {
      expect(granted, `anon must not have SELECT on ${table}`).toBe(false);
    }
    for (const [fn, granted] of Object.entries(privileges.functions)) {
      expect(granted, `anon must not have EXECUTE on ${fn}`).toBe(false);
    }
  });
});
