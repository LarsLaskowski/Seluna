import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // The throwaway secret of the real delivery in test/fixtures/ping/form-delivery.json (decision 0012).
          GITHUB_WEBHOOK_SECRET: "my-secret",
          // The shipped migrations as read from migrations/, applied by test/d1.ts (never a copy of the SQL).
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
        // A second database only test/migrations.test.ts uses, so it can assert an empty database.
        d1Databases: { MIGRATION_TEST_DB: "migration-test-db" },
      },
    })),
  ],
  test: {
    coverage: {
      // The workers pool does not support V8 coverage; see docs/decisions (Istanbul coverage).
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
});
