import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Real-PostgreSQL tenant isolation suite. Kept out of the default `pnpm test`
// include; its tests are skipped unless ANALYTICOOL_PG_TEST_ADMIN_URL is set.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: ["verification/postgres-isolation/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
