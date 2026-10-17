import { keyFromEnv } from "./crypto";
import { readSecret } from "./store/secrets";

/** Name of the Worker secret that holds the webhook secret. */
export const WEBHOOK_SECRET_NAME = "GITHUB_WEBHOOK_SECRET";

/** Where the webhook secret comes from; resolves to `undefined` when none is configured. */
export interface WebhookSecretSource {
  readonly webhookSecret: () => Promise<string | undefined>;
}

/** The webhook secret from the Worker environment: `GITHUB_WEBHOOK_SECRET` when it is a non-empty string. */
export function secretFromEnv(env: object): WebhookSecretSource {
  const value: unknown = WEBHOOK_SECRET_NAME in env ? env[WEBHOOK_SECRET_NAME] : undefined;
  const secret = typeof value === "string" && value !== "" ? value : undefined;
  return { webhookSecret: () => Promise.resolve(secret) };
}

/** `GITHUB_WEBHOOK_SECRET` when set, else the webhook secret stored in D1; D1 errors reject. */
export function webhookSecretSource(env: object, db: D1Database): WebhookSecretSource {
  const fromEnv = secretFromEnv(env);
  return {
    webhookSecret: async () => {
      const workerSecret = await fromEnv.webhookSecret();
      if (workerSecret !== undefined) {
        return workerSecret;
      }
      const key = await keyFromEnv(env);
      if (key === undefined) {
        return undefined;
      }
      const stored = await readSecret(db, key, "github_webhook_secret");
      return stored.kind === "ok" ? stored.value : undefined;
    },
  };
}
