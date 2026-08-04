import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Recursive, so the tests/ subdirectories (orchestration, agents,
    // persistence, ui, unit, regression) are all discovered without listing
    // them here — adding a directory needs no config change.
    include: ["tests/**/*.test.ts"],
    // The Supabase integration lane is opt-in and runs serially — sequence
    // resetting and deterministic-id assertions are only coherent that way.
    // `npm run test:integration` includes it.
    exclude: ["tests/integration/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/", import.meta.url)),
      // `server-only` throws when resolved outside Next.js's react-server
      // condition, which is exactly its job in a client bundle — but it would
      // also break a plain Node test run. Stubbed here; the real guard still
      // applies in `next build`.
      "server-only": fileURLToPath(new URL("./tests/support/server-only-stub.ts", import.meta.url)),
    },
  },
});
