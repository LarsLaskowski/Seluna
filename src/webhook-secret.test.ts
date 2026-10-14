import { describe, expect, it } from "vitest";
import { secretFromEnv } from "./webhook-secret";

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
