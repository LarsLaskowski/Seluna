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
