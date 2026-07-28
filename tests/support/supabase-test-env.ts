import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// All four are required. A partially-configured environment is a HARD FAILURE
// rather than a silent skip, so a half-set-up machine cannot look green.
//
// The anon key is not optional: the security assertions have to make real
// unprivileged calls. Introspecting has_function_privilege() alone would not
// prove that PostgREST actually rejects them.
const REQUIRED = [
  "KINCALL_TEST_SUPABASE_URL",
  "KINCALL_TEST_SUPABASE_SERVICE_ROLE_KEY",
  "KINCALL_TEST_SUPABASE_ANON_KEY",
  "KINCALL_TEST_SUPABASE_ALLOW_DESTRUCTIVE",
] as const;

export function isIntegrationConfigured(): boolean {
  const present = REQUIRED.filter((name) => (process.env[name] ?? "").trim().length > 0);
  if (present.length === 0) return false;
  if (present.length < REQUIRED.length) {
    const missing = REQUIRED.filter((name) => !present.includes(name));
    throw new Error(
      `Supabase integration lane is partially configured. Missing: ${missing.join(", ")}. ` +
        "Set all four or none — a half-configured run would silently skip and look green."
    );
  }
  return true;
}

export interface IntegrationEnv {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
}

// Refuses to run against production. Throws — never skips — because a skip
// here would be indistinguishable from "not configured", and the whole point
// is to make an accidental production run impossible to overlook.
export function requireIntegrationEnv(): IntegrationEnv {
  const url = process.env.KINCALL_TEST_SUPABASE_URL!.trim();
  const serviceRoleKey = process.env.KINCALL_TEST_SUPABASE_SERVICE_ROLE_KEY!.trim();
  const anonKey = process.env.KINCALL_TEST_SUPABASE_ANON_KEY!.trim();

  if (process.env.KINCALL_TEST_SUPABASE_ALLOW_DESTRUCTIVE !== "1") {
    throw new Error(
      "This suite TRUNCATES every event table. Set " +
        "KINCALL_TEST_SUPABASE_ALLOW_DESTRUCTIVE=1 to opt in explicitly."
    );
  }

  const production = (process.env.SUPABASE_URL ?? "").trim();
  if (production && url === production) {
    throw new Error(
      "KINCALL_TEST_SUPABASE_URL is the same as SUPABASE_URL. Refusing to truncate production."
    );
  }

  const denylist = (process.env.KINCALL_PRODUCTION_SUPABASE_URLS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (denylist.includes(url)) {
    throw new Error(
      `KINCALL_TEST_SUPABASE_URL is listed in KINCALL_PRODUCTION_SUPABASE_URLS. Refusing to run.`
    );
  }

  return { url, serviceRoleKey, anonKey };
}

export function serviceClient(env: IntegrationEnv): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(env: IntegrationEnv): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The strongest production guard, and the one that does not depend on any
// string comparison: kincall_test_reset() ships ONLY in
// supabase/testing/9999_test_helpers.sql, which is never applied to
// production. A database that never received that file cannot be truncated by
// this suite at all.
export async function resetTestData(client: SupabaseClient): Promise<void> {
  const { error } = await client.rpc("kincall_test_reset");
  if (error) {
    throw new Error(
      "kincall_test_reset() is not available on the target database. " +
        "Apply supabase/testing/9999_test_helpers.sql to your TEST project only — " +
        "its absence is what makes this suite structurally incapable of running " +
        `against production. (${error.message})`
    );
  }
}
