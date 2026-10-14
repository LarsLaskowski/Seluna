/** Name of the Worker secret that holds the webhook secret. */
export const WEBHOOK_SECRET_NAME = "GITHUB_WEBHOOK_SECRET";

/** Where the webhook secret comes from; resolves to `undefined` when none is configured. */
export interface WebhookSecretSource {
  readonly webhookSecret: () => Promise<string | undefined>;
}

/** The webhook secret from the Worker environment: `GITHUB_WEBHOOK_SECRET` when it is a non-empty string. */
export function secretFromEnv(_env: object): WebhookSecretSource {
  // Skeleton: the implementation follows.
  return { webhookSecret: () => Promise.resolve(undefined) };
}
