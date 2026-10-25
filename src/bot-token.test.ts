import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveBotToken } from "./bot-token";
import type { ResolvedBotToken } from "./bot-token";
import { KEY_CHECK_META_KEY, writeSecret } from "./store/secrets";
import { applyMigrations, unusedDb } from "../test/d1";
import { keyFor, withFirstCharacterChanged } from "../test/keys";

const SECRET_A = "0123456789abcdef0123456789abcdef";
const SECRET_B = "fedcba9876543210fedcba9876543210";
const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const OTHER_TOKEN = "987654321:BBH-other_throwaway_token0123456789abcd";
const SAVED_ENV = { SELUNA_SECRET: SECRET_A };

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM secrets"), env.DB.prepare("DELETE FROM meta")]);
});

async function saveToken(value: string, secret: string = SECRET_A): Promise<void> {
  const result = await writeSecret(env.DB, await keyFor(secret), "telegram_bot_token", value);
  expect(result, "seeding the saved token").toEqual({ kind: "ok" });
}

describe("resolveBotToken", () => {
  it("resolveBotToken returns the saved token when TELEGRAM_BOT_TOKEN is not set", async () => {
    await saveToken(TOKEN);

    const result = await resolveBotToken(SAVED_ENV, env.DB);

    expect(result, "result").toEqual({ kind: "usable", token: TOKEN, source: "saved" });
  });

  it("resolveBotToken returns the saved token when TELEGRAM_BOT_TOKEN is the empty text", async () => {
    await saveToken(TOKEN);

    const result = await resolveBotToken({ ...SAVED_ENV, TELEGRAM_BOT_TOKEN: "" }, env.DB);

    expect(result, "result").toEqual({ kind: "usable", token: TOKEN, source: "saved" });
  });

  it("resolveBotToken prefers TELEGRAM_BOT_TOKEN over a saved token without reading D1", async () => {
    const result = await resolveBotToken({ ...SAVED_ENV, TELEGRAM_BOT_TOKEN: OTHER_TOKEN }, unusedDb());

    expect(result, "result").toEqual({ kind: "usable", token: OTHER_TOKEN, source: "worker-secret" });
  });

  it("resolveBotToken uses TELEGRAM_BOT_TOKEN without SELUNA_SECRET and without reading D1", async () => {
    const result = await resolveBotToken({ TELEGRAM_BOT_TOKEN: OTHER_TOKEN }, unusedDb());

    expect(result, "result").toEqual({ kind: "usable", token: OTHER_TOKEN, source: "worker-secret" });
  });

  it("resolveBotToken reports malformed for a malformed TELEGRAM_BOT_TOKEN without falling back", async () => {
    await saveToken(TOKEN);

    const result = await resolveBotToken({ ...SAVED_ENV, TELEGRAM_BOT_TOKEN: "1:a/../setWebhook" }, unusedDb());

    expect(result, "result").toEqual({ kind: "malformed" });
  });

  it("resolveBotToken reports missing when nothing is saved", async () => {
    const result = await resolveBotToken(SAVED_ENV, env.DB);

    expect(result, "result").toEqual({ kind: "missing" });
  });

  it("resolveBotToken reports missing without SELUNA_SECRET and without reading D1", async () => {
    const result = await resolveBotToken({}, unusedDb());

    expect(result, "result").toEqual({ kind: "missing" });
  });

  it("resolveBotToken reports missing for a SELUNA_SECRET that is too short, without reading D1", async () => {
    const result = await resolveBotToken({ SELUNA_SECRET: "too-short" }, unusedDb());

    expect(result, "result").toEqual({ kind: "missing" });
  });

  it("resolveBotToken reports missing when only GitHub credentials are saved", async () => {
    const written = await writeSecret(env.DB, await keyFor(SECRET_A), "github_app_id", "12345");
    expect(written, "seeding the App ID").toEqual({ kind: "ok" });

    const result = await resolveBotToken(SAVED_ENV, env.DB);

    expect(result, "result").toEqual({ kind: "missing" });
  });

  it.each<{ kind: ResolvedBotToken["kind"]; case: string; arrange: () => Promise<void> }>([
    {
      kind: "unreadable",
      case: "a token saved under another SELUNA_SECRET",
      arrange: () => saveToken(TOKEN, SECRET_B),
    },
    {
      kind: "unreadable",
      case: "a token beside a malformed key check value",
      arrange: async () => {
        await saveToken(TOKEN);
        await env.DB.prepare("UPDATE meta SET value = 'garbage' WHERE key = ?1").bind(KEY_CHECK_META_KEY).run();
      },
    },
    {
      kind: "unreadable",
      case: "a token whose key check value is absent",
      arrange: async () => {
        await saveToken(TOKEN);
        await env.DB.prepare("DELETE FROM meta WHERE key = ?1").bind(KEY_CHECK_META_KEY).run();
      },
    },
    {
      kind: "damaged",
      case: "a token row altered under a matching key check value",
      arrange: async () => {
        await saveToken(TOKEN);
        const row = await env.DB.prepare("SELECT ciphertext FROM secrets WHERE key = 'telegram_bot_token'").first();
        const ciphertext = typeof row?.ciphertext === "string" ? row.ciphertext : "";
        await env.DB.prepare("UPDATE secrets SET ciphertext = ?1 WHERE key = 'telegram_bot_token'")
          .bind(withFirstCharacterChanged(ciphertext))
          .run();
      },
    },
    {
      kind: "damaged",
      case: "a saved value outside the bot token form",
      arrange: () => saveToken("1:a/../setWebhook"),
    },
    {
      kind: "damaged",
      case: "a saved value with a trailing line feed",
      arrange: () => saveToken(`${TOKEN}\n`),
    },
  ])("resolveBotToken reports $kind for $case", async ({ kind, arrange }) => {
    await arrange();

    const result = await resolveBotToken(SAVED_ENV, env.DB);

    expect(result, "result").toEqual({ kind });
  });

  it("resolveBotToken lets a D1 error reach the caller", async () => {
    const result = resolveBotToken(SAVED_ENV, unusedDb());

    await expect(result, "the promise").rejects.toThrow("The database must not be used");
  });
});
