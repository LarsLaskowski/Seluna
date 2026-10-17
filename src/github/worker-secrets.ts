export const APP_ID_SECRET_NAME = "GITHUB_APP_ID";
export const PRIVATE_KEY_SECRET_NAME = "GITHUB_APP_PRIVATE_KEY";

export type WorkerCredentials = "none" | "partial" | "all";

/** How many of GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are non-empty strings. */
export function workerCredentials(_env: object): WorkerCredentials {
  throw new Error("Not implemented");
}
