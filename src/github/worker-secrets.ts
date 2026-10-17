import { WEBHOOK_SECRET_NAME } from "../webhook-secret";

export const APP_ID_SECRET_NAME = "GITHUB_APP_ID";
export const PRIVATE_KEY_SECRET_NAME = "GITHUB_APP_PRIVATE_KEY";

export type WorkerCredentials = "none" | "partial" | "all";

/** How many of GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are non-empty strings. */
export function workerCredentials(env: object): WorkerCredentials {
  const names = [APP_ID_SECRET_NAME, PRIVATE_KEY_SECRET_NAME, WEBHOOK_SECRET_NAME];
  const set = names.filter((name) => {
    const value: unknown = Reflect.get(env, name);
    return typeof value === "string" && value !== "";
  }).length;
  if (set === 0) {
    return "none";
  }
  return set === names.length ? "all" : "partial";
}
