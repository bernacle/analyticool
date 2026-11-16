import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// BRU-492 preparation: real local Supabase Auth + PostgreSQL suite. Kept out of
// the default DB-free `pnpm test`. It FAILS without the stack configuration
// (see stack-env.ts); it never skips. Run through run-local.sh or CI.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: ["verification/auth-metadata/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
