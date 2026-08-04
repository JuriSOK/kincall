import { InMemoryRepository } from "./in-memory-repository";
import type { Repository } from "./repository";
import { seedRepository } from "./seed";
import { getSupabaseClient } from "./supabase-client";
import { SupabaseRepository } from "./supabase-repository";

declare global {
  var __kincallRepository: Repository | undefined;
}

// Opt-in, defaulting to "memory": fake mode and `npm test` then need zero
// configuration and cannot accidentally reach the network, and rolling back to
// the pre-Supabase behaviour is an environment-variable flip with no code
// change (DEC-006).
export type PersistenceDriver = "memory" | "supabase";

export function getPersistenceDriver(): PersistenceDriver {
  return process.env.KINCALL_PERSISTENCE?.trim() === "supabase" ? "supabase" : "memory";
}

function createRepository(): Repository {
  if (getPersistenceDriver() === "supabase") {
    // Rows are seeded by supabase/migrations/0005_seed.sql, not from here.
    return new SupabaseRepository(getSupabaseClient());
  }

  const repository = new InMemoryRepository();
  seedRepository(repository);
  return repository;
}

// Cached on globalThis so Next.js dev-server hot-module-reload doesn't
// silently reset in-memory demo state mid-session, and so the Supabase client
// is reused across requests on one instance.
export function getRepository(): Repository {
  if (!globalThis.__kincallRepository) {
    globalThis.__kincallRepository = createRepository();
  }
  return globalThis.__kincallRepository;
}
