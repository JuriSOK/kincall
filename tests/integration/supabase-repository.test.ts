import { beforeEach, describe } from "vitest";
import { SupabaseRepository } from "@/backend/persistence/supabase-repository";
import type { Repository } from "@/backend/persistence/repository";
import { repositoryContract } from "../persistence/repository-contract";
import {
  isIntegrationConfigured,
  requireIntegrationEnv,
  resetTestData,
  serviceClient,
} from "../support/supabase-test-env";

// Short leases, so expiry is reachable by really waiting rather than by a fake
// clock — the database's own now() is the authority here.
const LEASE_SECONDS = 1;

describe.skipIf(!isIntegrationConfigured())("SupabaseRepository (integration)", () => {
  const env = isIntegrationConfigured() ? requireIntegrationEnv() : null;
  const client = env ? serviceClient(env) : null;

  beforeEach(async () => {
    // Per test, not per suite: restarting the sequences is what makes
    // event_001 deterministic, and that is only coherent serially.
    await resetTestData(client!);
  });

  repositoryContract("SupabaseRepository", {
    leaseSeconds: LEASE_SECONDS,
    async make(): Promise<Repository> {
      await resetTestData(client!);
      return new SupabaseRepository(client!);
    },
    // A genuinely separate client, the way a second Vercel instance would be.
    async reopen(): Promise<Repository> {
      return new SupabaseRepository(serviceClient(env!));
    },
    async advance(seconds: number) {
      // No fake clock reaches Postgres, so wait it out. LEASE_SECONDS is 1.
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    },
  });
});
