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
