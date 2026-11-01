import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { parseAppId, resolveAppCredentials, resolveAppOwner } from "./app-credentials";
import type { AppCredentials } from "./app-credentials";
import { applyMigrations, migrationTestDb } from "../../test/d1";
import { FIXTURE_PEM, FIXTURE_PKCS8, RSA_4104_PKCS8 } from "../../test/github";
import { keyFor } from "../../test/keys";
import { GITHUB_APP_OWNER_META_KEY, writeAppOwner } from "../store/meta";
import { writeSecret, writeSecrets } from "../store/secrets";
import type { OwnerAccount } from "./owner";

const SECRET = "throwaway-setup-secret-0123456789abcdef";
const OTHER_SECRET = "another-throwaway-secret-fedcba9876543210";
const WEBHOOK_SECRET = "worker-webhook-secret-value";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM secrets"), env.DB.prepare("DELETE FROM meta")]);
});

/** Stores the three credentials under `secret`; fails the test when they are not stored. */
async function saveApp(appId: string, privateKey: string, secret: string = SECRET): Promise<void> {
  const result = await writeSecrets(env.DB, await keyFor(secret), {
    github_app_id: appId,
    github_private_key: privateKey,
    github_webhook_secret: WEBHOOK_SECRET,
  });
  expect(result, "saving the app").toEqual({ kind: "ok" });
}

function okCredentials(result: Awaited<ReturnType<typeof resolveAppCredentials>>): AppCredentials {
  if (result.kind !== "ok") {
    throw new Error(`resolveAppCredentials answered ${result.kind}`);
  }
  return result.credentials;
}

describe("parseAppId", () => {
  it.each([
    { text: "1", expected: 1 },
    { text: "12345", expected: 12_345 },
    { text: "9007199254740991", expected: Number.MAX_SAFE_INTEGER },
    { text: "1234567890123456", expected: 1_234_567_890_123_456 },
  ])("parseAppId reads $text as $expected", ({ text, expected }) => {
    const appId = parseAppId(text);

    expect(appId, "App ID").toBe(expected);
  });

  it.each([
    { case: "an empty text", text: "" },
    { case: "zero", text: "0" },
    { case: "a leading zero", text: "012345" },
    { case: "a negative number", text: "-1" },
    { case: "a plus sign", text: "+1" },
    { case: "a fraction", text: "1.5" },
    { case: "an exponent", text: "1e3" },
    { case: "leading white space", text: " 1" },
    { case: "trailing white space", text: "1 " },
    { case: "a trailing line feed", text: "1\n" },
    { case: "a word", text: "abc" },
    { case: "Arabic-Indic digits", text: "١٢" },
    { case: "17 digits", text: "12345678901234567" },
    { case: "a number above the safe integers", text: "9007199254740992" },
  ])("parseAppId rejects $case", ({ text }) => {
    const appId = parseAppId(text);

    expect(appId, "App ID").toBeUndefined();
  });
});

describe("resolveAppCredentials", () => {
  it.each([
    { form: "PKCS#1", pem: FIXTURE_PEM },
    { form: "PKCS#8", pem: FIXTURE_PKCS8 },
  ])("resolveAppCredentials takes both Worker secrets, the key as $form", async ({ pem }) => {
    const workerEnv = { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: pem };

    const result = await resolveAppCredentials(workerEnv, env.DB);

    const credentials = okCredentials(result);
    expect(credentials.appId, "App ID").toBe(12_345);
    expect(credentials.signingKey.usages, "usages of the key").toEqual(["sign"]);
    expect(credentials.signingKey.extractable, "key is extractable").toBe(false);
  });

  it("resolveAppCredentials returns a key that signs", async () => {
    const workerEnv = { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM };

    const credentials = okCredentials(await resolveAppCredentials(workerEnv, env.DB));

    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", credentials.signingKey, new Uint8Array([1, 2, 3]));
    expect(signature.byteLength, "signature length of a 2048-bit key").toBe(256);
  });

  it("resolveAppCredentials takes both credentials saved by the wizard", async () => {
    await saveApp("54321", FIXTURE_PKCS8);

    const result = await resolveAppCredentials({ SELUNA_SECRET: SECRET }, env.DB);

    expect(okCredentials(result).appId, "App ID").toBe(54_321);
  });

  it("resolveAppCredentials takes the Worker secrets over the saved credentials, each on its own", async () => {
    await saveApp("99999", "saved key that is not a key");
    const workerEnv = { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM };

    const result = await resolveAppCredentials(workerEnv, env.DB);

    expect(okCredentials(result).appId, "App ID of the Worker secret").toBe(12_345);
  });

  it("resolveAppCredentials takes the App ID from GITHUB_APP_ID and the key from D1", async () => {
    await saveApp("22222", FIXTURE_PKCS8);

    const result = await resolveAppCredentials({ SELUNA_SECRET: SECRET, GITHUB_APP_ID: "11111" }, env.DB);

    expect(okCredentials(result).appId, "App ID of the Worker secret").toBe(11_111);
  });

  it("resolveAppCredentials takes the key from GITHUB_APP_PRIVATE_KEY and the App ID from D1", async () => {
    await saveApp("22222", "saved key that is not a key");
    const workerEnv = { SELUNA_SECRET: SECRET, GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM };

    const result = await resolveAppCredentials(workerEnv, env.DB);

    expect(okCredentials(result).appId, "App ID from D1").toBe(22_222);
  });

  it("resolveAppCredentials uses the saved app when only the webhook secret is a Worker secret", async () => {
    await saveApp("54321", FIXTURE_PKCS8);
    const workerEnv = { SELUNA_SECRET: SECRET, GITHUB_WEBHOOK_SECRET: "another-webhook-secret" };

    const result = await resolveAppCredentials(workerEnv, env.DB);

    expect(okCredentials(result).appId, "App ID from D1").toBe(54_321);
  });

  it.each([
    { case: "an empty string", value: "" },
    { case: "a number", value: 11_111 },
    { case: "undefined", value: undefined },
  ])("resolveAppCredentials takes the saved App ID when GITHUB_APP_ID is $case", async ({ value }) => {
    await saveApp("54321", FIXTURE_PKCS8);

    const result = await resolveAppCredentials({ SELUNA_SECRET: SECRET, GITHUB_APP_ID: value }, env.DB);

    expect(okCredentials(result).appId, "App ID from D1").toBe(54_321);
  });

  it("resolveAppCredentials takes the saved key when GITHUB_APP_PRIVATE_KEY is an empty string", async () => {
    await saveApp("54321", FIXTURE_PKCS8);
    const workerEnv = { SELUNA_SECRET: SECRET, GITHUB_APP_PRIVATE_KEY: "" };

    const result = await resolveAppCredentials(workerEnv, env.DB);

    expect(okCredentials(result).appId, "App ID from D1").toBe(54_321);
  });

  it.each<{ case: string; workerEnv: object; prepare?: () => Promise<void> }>([
    { case: "nothing set and nothing saved", workerEnv: { SELUNA_SECRET: SECRET } },
    { case: "a key but no App ID anywhere", workerEnv: { SELUNA_SECRET: SECRET, GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM } },
    { case: "an App ID but no key anywhere", workerEnv: { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "12345" } },
    {
      case: "an App ID Worker secret of 0",
      workerEnv: { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "0", GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM },
    },
    {
      case: "an App ID Worker secret that is a word",
      workerEnv: { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "abc", GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM },
    },
    {
      case: "an App ID Worker secret with a leading zero",
      workerEnv: { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "012345", GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM },
    },
    {
      case: "a saved App ID that is not a number",
      workerEnv: { SELUNA_SECRET: SECRET },
      prepare: () => saveApp("not-a-number", FIXTURE_PKCS8),
    },
    {
      case: "a saved App ID under another SELUNA_SECRET",
      workerEnv: { SELUNA_SECRET: SECRET, GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM },
      prepare: () => saveApp("12345", FIXTURE_PKCS8, OTHER_SECRET),
    },
    {
      case: "a saved app and no SELUNA_SECRET",
      workerEnv: {},
      prepare: () => saveApp("12345", FIXTURE_PKCS8),
    },
    {
      case: "a saved app and a SELUNA_SECRET of 31 characters",
      workerEnv: { SELUNA_SECRET: "a".repeat(31) },
      prepare: () => saveApp("12345", FIXTURE_PKCS8),
    },
  ])("resolveAppCredentials reports no-app for $case", async ({ workerEnv, prepare }) => {
    await prepare?.();

    const result = await resolveAppCredentials(workerEnv, env.DB);

    expect(result, "result").toEqual({ kind: "no-app" });
  });

  it.each<{ case: string; workerEnv: object; prepare?: () => Promise<void> }>([
    {
      case: "a Worker secret key that is no PEM",
      workerEnv: { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: "not a pem" },
    },
    {
      case: "a Worker secret key that is only the armour line",
      workerEnv: {
        SELUNA_SECRET: SECRET,
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
      },
    },
    {
      case: "a Worker secret key whose body is no key",
      workerEnv: {
        SELUNA_SECRET: SECRET,
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nQUJD\n-----END PRIVATE KEY-----\n",
      },
    },
    {
      case: "a Worker secret key of more than 4096 bits",
      workerEnv: { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: RSA_4104_PKCS8 },
    },
    {
      case: "a saved key that is no key",
      workerEnv: { SELUNA_SECRET: SECRET },
      prepare: () => saveApp("12345", "private-key-text"),
    },
    {
      case: "a saved key of more than 4096 bits",
      workerEnv: { SELUNA_SECRET: SECRET },
      prepare: () => saveApp("12345", RSA_4104_PKCS8),
    },
    {
      case: "a saved key under another SELUNA_SECRET beside a Worker secret App ID",
      workerEnv: { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "12345" },
      prepare: () => saveApp("12345", FIXTURE_PKCS8, OTHER_SECRET),
    },
    {
      case: "a saved key whose ciphertext was altered",
      workerEnv: { SELUNA_SECRET: SECRET },
      prepare: async () => {
        await saveApp("12345", FIXTURE_PKCS8);
        await env.DB.prepare(
          "UPDATE secrets SET ciphertext = (CASE WHEN substr(ciphertext, 1, 1) = 'A' THEN 'B' ELSE 'A' END) || substr(ciphertext, 2) WHERE key = 'github_private_key'",
        ).run();
      },
    },
  ])("resolveAppCredentials reports key-unusable for $case", async ({ workerEnv, prepare }) => {
    await prepare?.();

    const result = await resolveAppCredentials(workerEnv, env.DB);

    expect(result, "result").toEqual({ kind: "key-unusable" });
  });

  it("resolveAppCredentials reports key-unusable for a lone saved key that is no key beside a Worker secret App ID", async () => {
    const stored = await writeSecret(env.DB, await keyFor(SECRET), "github_private_key", "private-key-text");
    expect(stored, "saving the key").toEqual({ kind: "ok" });

    const result = await resolveAppCredentials({ SELUNA_SECRET: SECRET, GITHUB_APP_ID: "12345" }, env.DB);

    expect(result, "result").toEqual({ kind: "key-unusable" });
  });

  it("resolveAppCredentials lets a D1 error reach the caller", async () => {
    const pending = resolveAppCredentials({ SELUNA_SECRET: SECRET }, migrationTestDb());

    await expect(pending, "result").rejects.toThrow(/no such table/i);
  });
});

const OWNER: OwnerAccount = { id: 583_231, login: "octocat", type: "User" };

describe("resolveAppOwner", () => {
  it("resolveAppOwner returns the owner stored for the Worker secret App ID", async () => {
    await writeAppOwner(env.DB, 12_345, OWNER);

    const owner = await resolveAppOwner({ GITHUB_APP_ID: "12345" }, env.DB);

    expect(owner, "owner").toEqual(OWNER);
  });

  it("resolveAppOwner returns the owner stored for the saved App ID", async () => {
    await saveApp("54321", FIXTURE_PKCS8);
    await writeAppOwner(env.DB, 54_321, OWNER);

    const owner = await resolveAppOwner({ SELUNA_SECRET: SECRET }, env.DB);

    expect(owner, "owner").toEqual(OWNER);
  });

  it("resolveAppOwner returns an organization owner as stored", async () => {
    const organization: OwnerAccount = { id: 9, login: "Octo-Org", type: "Organization" };
    await writeAppOwner(env.DB, 12_345, organization);

    const owner = await resolveAppOwner({ GITHUB_APP_ID: "12345" }, env.DB);

    expect(owner, "owner").toEqual(organization);
  });

  it("resolveAppOwner returns undefined without an App ID", async () => {
    await writeAppOwner(env.DB, 12_345, OWNER);

    const owner = await resolveAppOwner({ SELUNA_SECRET: SECRET }, env.DB);

    expect(owner, "owner").toBeUndefined();
  });

  it("resolveAppOwner returns undefined for an owner row of another App ID", async () => {
    await writeAppOwner(env.DB, 99_999, OWNER);

    const owner = await resolveAppOwner({ GITHUB_APP_ID: "12345" }, env.DB);

    expect(owner, "owner").toBeUndefined();
  });

  it("resolveAppOwner returns undefined for a malformed owner row", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2)")
      .bind(GITHUB_APP_OWNER_META_KEY, "12345:not-a-number:User:octocat")
      .run();

    const owner = await resolveAppOwner({ GITHUB_APP_ID: "12345" }, env.DB);

    expect(owner, "owner").toBeUndefined();
  });

  it("resolveAppOwner returns undefined when the saved App ID cannot be read with the current SELUNA_SECRET", async () => {
    await saveApp("54321", FIXTURE_PKCS8);
    await writeAppOwner(env.DB, 54_321, OWNER);

    const owner = await resolveAppOwner({ SELUNA_SECRET: OTHER_SECRET }, env.DB);

    expect(owner, "owner").toBeUndefined();
  });

  it("resolveAppOwner returns undefined when the Worker secret App ID is not an App ID", async () => {
    await writeAppOwner(env.DB, 12_345, OWNER);

    const owner = await resolveAppOwner({ GITHUB_APP_ID: "12x45" }, env.DB);

    expect(owner, "owner").toBeUndefined();
  });

  it("resolveAppOwner rejects when D1 fails", async () => {
    const pending = resolveAppOwner({ GITHUB_APP_ID: "12345" }, migrationTestDb());

    await expect(pending, "result").rejects.toThrow(/no such table/i);
  });
});
