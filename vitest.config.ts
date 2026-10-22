import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      // The workers pool does not support V8 coverage; see docs/decisions (Istanbul coverage).
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
    projects: [
      {
        // Every test but the tests of workflow scripts runs inside the Workers runtime.
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                // The throwaway secret of the real delivery in test/fixtures/ping/form-delivery.json (decision 0012).
                GITHUB_WEBHOOK_SECRET: "my-secret",
                // A throwaway value for the setup login in tests only (at least 32 characters); never a real secret.
                SELUNA_SECRET: "throwaway-test-secret-for-the-setup-login-0000",
                // The shipped migrations as read from migrations/, applied by test/d1.ts (never a copy of the SQL).
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
              },
              // A second database only test/migrations.test.ts uses, so it can assert an empty database.
              d1Databases: { MIGRATION_TEST_DB: "migration-test-db" },
            },
          })),
        ],
        test: {
          name: "workers",
          include: ["**/*.test.ts"],
          exclude: ["**/node_modules/**", "test/*-workflow.test.ts"],
        },
      },
      {
        // The tests of workflow scripts start Git and Bash, which the Workers runtime cannot (decision 0032).
        test: {
          name: "node",
          environment: "node",
          include: ["test/*-workflow.test.ts"],
        },
      },
    ],
  },
});
