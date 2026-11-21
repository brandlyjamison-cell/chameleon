import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // `server-only` throws outside a react-server condition; the suites are Node.
    alias: { "server-only": resolve("apps/control/test/server-only-stub.ts") },
  },
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
    setupFiles: ["packages/db/test/env.ts", "packages/db/test/global.ts"],
    globalSetup: ["apps/control/test/server.ts"],
  },
});
