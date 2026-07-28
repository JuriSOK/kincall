import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The Supabase lane, run by `npm run test:integration`. Separate from the
// default config because it must run SERIALLY: kincall_test_reset() restarts
// the id sequences, and asserting event_001 verbatim is only coherent when no
// other test is touching the same database at the same time.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    // Real network round trips, and lease-expiry waits.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/server-only-stub.ts", import.meta.url)),
    },
  },
});
