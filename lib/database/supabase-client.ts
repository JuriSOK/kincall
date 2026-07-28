// Never importable from client code: this module holds the service-role key,
// which bypasses RLS. `server-only` makes a stray client-component import a
// build error rather than a credential leak.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | undefined;

// Deliberately NOT prefixed NEXT_PUBLIC_: those are inlined into the browser
// bundle. Both variables are server-only.
export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "KINCALL_PERSISTENCE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. " +
        "See .env.example."
    );
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
