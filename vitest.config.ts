import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The throwaway secret of the real delivery in test/fixtures/ping/form-delivery.json (decision 0012).
      miniflare: { bindings: { GITHUB_WEBHOOK_SECRET: "my-secret" } },
    }),
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
