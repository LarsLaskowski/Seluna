import { describe, expect, it } from "vitest";
import type { WorkerCredentials } from "./worker-secrets";
import { workerCredentials } from "./worker-secrets";

const ID = { GITHUB_APP_ID: "12345" };
const KEY = { GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----" };
const HOOK = { GITHUB_WEBHOOK_SECRET: "whsec" };

describe("workerCredentials", () => {
  it.each<{ name: string; env: object; expected: WorkerCredentials }>([
    { name: "none of the three", env: {}, expected: "none" },
    { name: "only the App ID", env: ID, expected: "partial" },
    { name: "only the private key", env: KEY, expected: "partial" },
    { name: "only the webhook secret", env: HOOK, expected: "partial" },
    { name: "the App ID and the private key", env: { ...ID, ...KEY }, expected: "partial" },
    { name: "the App ID and the webhook secret", env: { ...ID, ...HOOK }, expected: "partial" },
    { name: "the private key and the webhook secret", env: { ...KEY, ...HOOK }, expected: "partial" },
    { name: "all three", env: { ...ID, ...KEY, ...HOOK }, expected: "all" },
    { name: "all three and an unrelated secret", env: { ...ID, ...KEY, ...HOOK, SELUNA_SECRET: "x" }, expected: "all" },
    {
      name: "empty strings for all three",
      env: { GITHUB_APP_ID: "", GITHUB_APP_PRIVATE_KEY: "", GITHUB_WEBHOOK_SECRET: "" },
      expected: "none",
    },
    {
      name: "an empty string for one of three",
      env: { ...ID, ...KEY, GITHUB_WEBHOOK_SECRET: "" },
      expected: "partial",
    },
    { name: "a number for one of three", env: { ...KEY, ...HOOK, GITHUB_APP_ID: 12_345 }, expected: "partial" },
    {
      name: "an object for one of three",
      env: { ...ID, ...HOOK, GITHUB_APP_PRIVATE_KEY: { value: "k" } },
      expected: "partial",
    },
    { name: "a number for the only one", env: { GITHUB_APP_ID: 12_345 }, expected: "none" },
  ])(
    "workerCredentials reports none, partial and all for every combination of the three secrets: $name",
    ({ env, expected }) => {
      const result = workerCredentials(env);

      expect(result, "worker credentials").toBe(expected);
    },
  );
});
