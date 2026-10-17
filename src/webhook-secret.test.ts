import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { writeSecret } from "./store/secrets";
import { secretFromEnv, webhookSecretSource } from "./webhook-secret";
import { applyMigrations, migrationTestDb, unusedDb } from "../test/d1";
import { keyFor } from "../test/keys";

const SECRET = "throwaway-setup-secret-0123456789abcdef";
const OTHER_SECRET = "another-throwaway-secret-fedcba9876543210";

describe("secretFromEnv", () => {
  it("secretFromEnv returns GITHUB_WEBHOOK_SECRET when it is a non-empty string", async () => {
    const source = secretFromEnv({ GITHUB_WEBHOOK_SECRET: "my-secret" });

    const result = await source.webhookSecret();

    expect(result, "secret").toBe("my-secret");
  });

  it("secretFromEnv returns the value verbatim with surrounding whitespace", async () => {
    const source = secretFromEnv({ GITHUB_WEBHOOK_SECRET: " my-secret\n" });

    const result = await source.webhookSecret();

    expect(result, "secret").toBe(" my-secret\n");
  });
});

describe("secretFromEnv with unusable values", () => {
  it.each([
    { case: "the variable absent", env: {} },
    { case: "an empty string", env: { GITHUB_WEBHOOK_SECRET: "" } },
    { case: "a number", env: { GITHUB_WEBHOOK_SECRET: 42 } },
    { case: "an object", env: { GITHUB_WEBHOOK_SECRET: { value: "my-secret" } } },
  ])("secretFromEnv returns undefined for $case", async ({ env }) => {
    const source = secretFromEnv(env);

    const result = await source.webhookSecret();

    expect(result, "secret").toBeUndefined();
  });
});

describe("webhookSecretSource", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.batch([env.DB.prepare("DELETE FROM secrets"), env.DB.prepare("DELETE FROM meta")]);
  });

  async function storeWebhookSecret(secret: string, value: string): Promise<void> {
    const result = await writeSecret(env.DB, await keyFor(secret), "github_webhook_secret", value);
    expect(result, "storing the webhook secret").toEqual({ kind: "ok" });
  }

  it("webhookSecretSource prefers GITHUB_WEBHOOK_SECRET and does not read D1", async () => {
    const source = webhookSecretSource({ GITHUB_WEBHOOK_SECRET: "worker-secret", SELUNA_SECRET: SECRET }, unusedDb());

    const result = await source.webhookSecret();

    expect(result, "secret").toBe("worker-secret");
  });

  it.each([
    { case: "absent", env: { SELUNA_SECRET: SECRET } },
    { case: "empty", env: { SELUNA_SECRET: SECRET, GITHUB_WEBHOOK_SECRET: "" } },
    { case: "a number", env: { SELUNA_SECRET: SECRET, GITHUB_WEBHOOK_SECRET: 42 } },
  ])(
    "webhookSecretSource returns the webhook secret stored in D1 when the Worker secret is $case",
    async ({ env: workerEnv }) => {
      await storeWebhookSecret(SECRET, "stored-secret");

      const result = await webhookSecretSource(workerEnv, env.DB).webhookSecret();

      expect(result, "secret").toBe("stored-secret");
    },
  );

  it.each([
    { case: "nothing is stored", prepare: () => Promise.resolve(), env: { SELUNA_SECRET: SECRET } },
    {
      case: "the credentials were stored under another SELUNA_SECRET",
      prepare: () => storeWebhookSecret(OTHER_SECRET, "stored-secret"),
      env: { SELUNA_SECRET: SECRET },
    },
    {
      case: "the key check value is damaged",
      prepare: async () => {
        await storeWebhookSecret(SECRET, "stored-secret");
        await env.DB.prepare("UPDATE meta SET value = 'damaged' WHERE key = 'key_check'").run();
      },
      env: { SELUNA_SECRET: SECRET },
    },
    {
      case: "SELUNA_SECRET is not set",
      prepare: () => storeWebhookSecret(SECRET, "stored-secret"),
      env: {},
    },
    {
      case: "SELUNA_SECRET is shorter than 32 characters",
      prepare: () => storeWebhookSecret(SECRET, "stored-secret"),
      env: { SELUNA_SECRET: "a".repeat(31) },
    },
  ])(
    "webhookSecretSource returns undefined when nothing is stored, the key check fails or SELUNA_SECRET is not configured: $case",
    async ({ prepare, env: workerEnv }) => {
      await prepare();

      const result = await webhookSecretSource(workerEnv, env.DB).webhookSecret();

      expect(result, "secret").toBeUndefined();
    },
  );

  it("webhookSecretSource lets a D1 error reach the caller", async () => {
    const source = webhookSecretSource({ SELUNA_SECRET: SECRET }, migrationTestDb());

    const pending = source.webhookSecret();

    await expect(pending, "result").rejects.toThrow("no such table");
  });
});
