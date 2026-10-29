import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { FinishGitHubResult, StartGitHubResult } from "./github-step";
import { finishGitHubApp, gitHubStepView, returnFields, startGitHubApp } from "./github-step";
import { readSecret, writeSecret } from "../store/secrets";
import type { SecretName } from "../store/secrets";
import { applyMigrations, migrationTestDb, unusedDb } from "../../test/d1";
import {
  conversionAnswer,
  conversionOwnedBy,
  expectedManifestJson,
  FIXTURE_CLIENT_SECRET,
  FIXTURE_CODE,
  FIXTURE_PKCS8,
  FIXTURE_WEBHOOK_SECRET,
  githubDouble,
  jsonAnswer,
  stateFor,
} from "../../test/github";
import type { GitHubDouble } from "../../test/github";
import { keyFor, signingKeyFor } from "../../test/keys";

const SECRET = "throwaway-setup-secret-0123456789abcdef";
const OTHER_SECRET = "another-throwaway-secret-fedcba9876543210";
const NOW = new Date(1_700_000_000_000);
const SESSION = "v1.1700043200000.sessionmacsessionmacsessionmacsessionmac1";
const OTHER_SESSION = "v1.1700043100000.othermacothermacothermacothermacother1";
const ORIGIN = "https://seluna.example.workers.dev";
const VERSION = "0.0.0-test";
const PLAIN_ENV = { SELUNA_SECRET: SECRET };
const ALL_WORKER_SECRETS = {
  SELUNA_SECRET: SECRET,
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
  GITHUB_WEBHOOK_SECRET: "whsec",
};
const SECRET_NAMES: readonly SecretName[] = ["github_app_id", "github_private_key", "github_webhook_secret"];

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DROP TRIGGER IF EXISTS fail_slug_write"),
    env.DB.prepare("DROP TRIGGER IF EXISTS fail_owner_write"),
    env.DB.prepare("DROP TRIGGER IF EXISTS ignore_secret_insert"),
  ]);
  await env.DB.batch([env.DB.prepare("DELETE FROM secrets"), env.DB.prepare("DELETE FROM meta")]);
});

async function metaValue(key: string): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first();
  return row?.value;
}

const storageKey = (): Promise<CryptoKey> => keyFor(SECRET);
const stateKey = (secret: string = SECRET): Promise<CryptoKey> => signingKeyFor(secret, "setup-github");

/** Stores the credential `name` under the key of `secret`; fails the test when it is not stored. */
async function seed(secret: string, name: SecretName, value: string): Promise<void> {
  const result = await writeSecret(env.DB, await keyFor(secret), name, value);
  expect(result, `seeding ${name}`).toEqual({ kind: "ok" });
}

async function countOf(table: "secrets" | "meta"): Promise<unknown> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first();
  return row?.total;
}

describe("gitHubStepView", () => {
  it("gitHubStepView shows the Worker-secrets view when all three are set, without reading D1", async () => {
    const view = await gitHubStepView(ALL_WORKER_SECRETS, unusedDb(), await storageKey());

    expect(view, "view").toEqual({ kind: "worker-secrets" });
  });

  it.each([
    { name: "only the App ID", set: { GITHUB_APP_ID: "12345" } },
    { name: "only the webhook secret", set: { GITHUB_WEBHOOK_SECRET: "whsec" } },
    { name: "the App ID and the private key", set: { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: "k" } },
  ])("gitHubStepView shows the partial view when one or two are set: $name", async ({ set }) => {
    const view = await gitHubStepView({ ...PLAIN_ENV, ...set }, unusedDb(), await storageKey());

    expect(view, "view").toEqual({ kind: "partial-worker-secrets" });
  });

  it("gitHubStepView shows the saved App ID", async () => {
    await seed(SECRET, "github_app_id", "12345");

    const view = await gitHubStepView(PLAIN_ENV, env.DB, await storageKey());

    expect(view, "view").toEqual({ kind: "form", savedAppId: 12_345 });
  });

  it("gitHubStepView shows the form without a saved app when none is stored", async () => {
    const view = await gitHubStepView(PLAIN_ENV, env.DB, await storageKey());

    expect(view, "view").toEqual({ kind: "form", savedAppId: undefined });
  });

  it.each([
    {
      name: "the credentials were stored under another SELUNA_SECRET",
      prepare: async () => {
        await seed(OTHER_SECRET, "github_app_id", "12345");
      },
    },
    {
      name: "the key check value is damaged",
      prepare: async () => {
        await seed(SECRET, "github_app_id", "12345");
        await env.DB.prepare("UPDATE meta SET value = 'damaged' WHERE key = 'key_check'").run();
      },
    },
  ])("gitHubStepView reports reset needed when the key check fails: $name", async ({ prepare }) => {
    await prepare();

    const view = await gitHubStepView(PLAIN_ENV, env.DB, await storageKey());

    expect(view, "view").toEqual({ kind: "reset-needed" });
  });

  it("gitHubStepView lets a D1 error reach the caller", async () => {
    const pending = gitHubStepView(PLAIN_ENV, migrationTestDb(), await storageKey());

    await expect(pending, "result").rejects.toThrow("no such table");
  });
});

describe("startGitHubApp", () => {
  /** Calls `startGitHubApp` with the given fields and environment, the real database and the keys of `SECRET`. */
  async function start(
    typeFields: readonly string[],
    accountFields: readonly string[],
    workerEnv: object = PLAIN_ENV,
  ): Promise<StartGitHubResult> {
    return startGitHubApp(
      { env: workerEnv, db: env.DB, storageKey: await storageKey(), stateKey: await stateKey() },
      SESSION,
      ORIGIN,
      typeFields,
      accountFields,
      NOW,
    );
  }

  it.each<{ name: string; workerEnv: object; account: string; expected: string }>([
    {
      name: "all three Worker secrets win over an invalid account and a changed key",
      workerEnv: ALL_WORKER_SECRETS,
      account: "a/b",
      expected: "worker-secrets",
    },
    {
      name: "a partial set of Worker secrets wins over an invalid account and a changed key",
      workerEnv: { ...PLAIN_ENV, GITHUB_WEBHOOK_SECRET: "whsec" },
      account: "a/b",
      expected: "partial-worker-secrets",
    },
    {
      name: "an invalid account wins over a changed key",
      workerEnv: PLAIN_ENV,
      account: "a/b",
      expected: "invalid-account",
    },
    {
      name: "a changed key is reported for a valid account",
      workerEnv: PLAIN_ENV,
      account: "octocat",
      expected: "reset-needed",
    },
  ])(
    "startGitHubApp checks Worker secrets, then the account, then the key check: $name",
    async ({ workerEnv, account, expected }) => {
      await seed(OTHER_SECRET, "github_app_id", "12345");

      const result = await start(["personal"], [account], workerEnv);

      expect(result.kind, "result").toBe(expected);
    },
  );

  it.each([
    { name: "no account type", types: [], accounts: ["octocat"] },
    { name: "two account types", types: ["personal", "personal"], accounts: ["octocat"] },
    { name: "an unknown account type", types: ["user"], accounts: ["octocat"] },
    { name: "no account", types: ["personal"], accounts: [] },
    { name: "two accounts", types: ["personal"], accounts: ["octocat", "octocat"] },
    { name: "an account with a trailing line feed", types: ["personal"], accounts: ["octocat\n"] },
  ])("startGitHubApp reports an invalid account for $name", async ({ types, accounts }) => {
    const result = await start(types, accounts);

    expect(result, "result").toEqual({ kind: "invalid-account" });
  });

  it("startGitHubApp returns the review with the app name, the manifest and the form action carrying the state", async () => {
    const result = await start(["organization"], ["Octo-Org"]);

    expect(result, "result").toMatchObject({
      kind: "review",
      choice: { type: "organization", account: "Octo-Org" },
      appName: "seluna-Octo-Org",
      manifest: expectedManifestJson(ORIGIN, "Octo-Org"),
    });
    expect(JSON.stringify(result), "form action").toMatch(
      /"formAction":"https:\/\/github\.com\/organizations\/Octo-Org\/settings\/apps\/new\?state=v1\.organization\.Octo-Org\.1700003600000\.[\w-]{22}\.[\w-]{43}"/,
    );
  });

  it("startGitHubApp lets a D1 error reach the caller", async () => {
    const pending = startGitHubApp(
      { env: PLAIN_ENV, db: migrationTestDb(), storageKey: await storageKey(), stateKey: await stateKey() },
      SESSION,
      ORIGIN,
      ["personal"],
      ["octocat"],
      NOW,
    );

    await expect(pending, "result").rejects.toThrow("no such table");
  });
});

describe("returnFields", () => {
  const STATE = `v1.personal.octocat.1700003600000.${"A".repeat(22)}.${"B".repeat(43)}`;

  it("returnFields returns the one code and the one state when both pass their allow-lists", () => {
    const fields = returnFields([FIXTURE_CODE], [STATE]);

    expect(fields, "fields").toEqual({ code: FIXTURE_CODE, state: STATE });
  });

  it.each([
    { name: "no code", codes: [], states: [STATE] },
    { name: "no state", codes: [FIXTURE_CODE], states: [] },
    { name: "two codes", codes: [FIXTURE_CODE, FIXTURE_CODE], states: [STATE] },
    { name: "two states", codes: [FIXTURE_CODE], states: [STATE, STATE] },
    { name: "a code with a slash", codes: ["a/b"], states: [STATE] },
    { name: "a code with a trailing line feed", codes: ["abc\n"], states: [STATE] },
    { name: "a code of 101 characters", codes: ["a".repeat(101)], states: [STATE] },
    { name: "a state of another version", codes: [FIXTURE_CODE], states: [STATE.replace("v1.", "v2.")] },
    { name: "a state with a trailing line feed", codes: [FIXTURE_CODE], states: [`${STATE}\n`] },
  ])("returnFields returns undefined for $name", ({ codes, states }) => {
    const fields = returnFields(codes, states);

    expect(fields, "fields").toBeUndefined();
  });
});

describe("finishGitHubApp", () => {
  interface FinishOptions {
    readonly workerEnv?: object;
    readonly state?: string;
    readonly stateFields?: readonly string[];
    readonly codeFields?: readonly string[];
    readonly session?: string;
  }

  /** `finishGitHubApp` with a state for `account` (default: the personal account `github` of the documented owner). */
  async function finish(github: GitHubDouble, options: FinishOptions = {}): Promise<FinishGitHubResult> {
    const state =
      options.state ?? (await stateFor(await stateKey(), SESSION, { type: "personal", account: "github" }, NOW));
    return finishGitHubApp(
      {
        env: options.workerEnv ?? PLAIN_ENV,
        db: env.DB,
        storageKey: await storageKey(),
        stateKey: await stateKey(),
        fetcher: github.fetch,
        version: VERSION,
      },
      options.session ?? SESSION,
      options.codeFields ?? [FIXTURE_CODE],
      options.stateFields ?? [state],
      NOW,
    );
  }

  it("finishGitHubApp stores exactly the three values and never the client secret", async () => {
    const github = githubDouble();

    const result = await finish(github);

    expect(result, "result").toEqual({ kind: "created", slug: "octoapp" });
    expect(
      github.requests.map((request) => request.code),
      "converted codes",
    ).toEqual([FIXTURE_CODE]);
    expect(await readSecret(env.DB, await storageKey(), "github_app_id"), "App ID").toEqual({ kind: "ok", value: "1" });
    expect(await readSecret(env.DB, await storageKey(), "github_private_key"), "private key").toEqual({
      kind: "ok",
      value: FIXTURE_PKCS8,
    });
    expect(await readSecret(env.DB, await storageKey(), "github_webhook_secret"), "webhook secret").toEqual({
      kind: "ok",
      value: FIXTURE_WEBHOOK_SECRET,
    });
    expect(await countOf("secrets"), "number of secrets rows").toBe(SECRET_NAMES.length);
    expect(await countOf("meta"), "number of meta rows (the key check value, the slug and the owner)").toBe(3);
    const stored = await env.DB.prepare("SELECT key, iv, ciphertext FROM secrets").all();
    expect(JSON.stringify(stored.results), "stored rows").not.toContain(FIXTURE_CLIENT_SECRET);
  });

  it("finishGitHubApp keeps the slug with the App ID", async () => {
    const github = githubDouble();

    await finish(github);

    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'github_app_slug'").first();
    expect(row?.value, "stored slug row").toBe("1:octoapp");
  });

  it("finishGitHubApp answers created when writing the slug fails", async () => {
    const github = githubDouble();
    await env.DB.prepare(
      "CREATE TRIGGER fail_slug_write BEFORE INSERT ON meta WHEN NEW.key = 'github_app_slug' " +
        "BEGIN SELECT RAISE(ABORT, 'slug write refused'); END",
    ).run();

    const result = await finish(github);

    expect(result, "result").toEqual({ kind: "created", slug: "octoapp" });
    expect(await readSecret(env.DB, await storageKey(), "github_app_id"), "App ID").toEqual({ kind: "ok", value: "1" });
    expect(await countOf("meta"), "number of meta rows (the key check value and the owner)").toBe(2);
  });

  it("finishGitHubApp writes no slug when the answer has none", async () => {
    const github = githubDouble(jsonAnswer(201, conversionAnswer({ slug: null })));

    const result = await finish(github);

    expect(result, "result").toEqual({ kind: "created", slug: undefined });
    expect(await countOf("meta"), "number of meta rows (the key check value and the owner)").toBe(2);
    expect(await metaValue("github_app_slug"), "slug row").toBeUndefined();
  });

  it("finishGitHubApp stores the owner for the saved App ID", async () => {
    const github = githubDouble();

    const result = await finish(github);

    expect(result, "result").toEqual({ kind: "created", slug: "octoapp" });
    expect(await metaValue("github_app_owner"), "stored owner row").toBe("1:1:User:github");
  });

  it("finishGitHubApp stores an organization owner with its type", async () => {
    const github = githubDouble(jsonAnswer(201, conversionOwnedBy("octo-org", "Organization")));
    const state = await stateFor(await stateKey(), SESSION, { type: "organization", account: "octo-org" }, NOW);

    await finish(github, { state });

    expect(await metaValue("github_app_owner"), "stored owner row").toBe("1:1:Organization:octo-org");
  });

  it.each([
    { case: "an id of 0", owner: { id: 0, login: "github", type: "User" } },
    { case: "an id that is a string", owner: { id: "1", login: "github", type: "User" } },
    { case: "no id", owner: { login: "github", type: "User" } },
  ])("finishGitHubApp saves the app without an owner when the owner id is malformed: $case", async ({ owner }) => {
    const github = githubDouble(jsonAnswer(201, conversionAnswer({ owner })));

    const result = await finish(github);

    expect(result, "result").toEqual({ kind: "created", slug: "octoapp" });
    expect(await readSecret(env.DB, await storageKey(), "github_app_id"), "App ID").toEqual({ kind: "ok", value: "1" });
    expect(await countOf("secrets"), "number of secrets rows").toBe(SECRET_NAMES.length);
    expect(await metaValue("github_app_owner"), "owner row").toBeUndefined();
    expect(await metaValue("github_app_slug"), "slug row").toBe("1:octoapp");
  });

  it("finishGitHubApp answers created when the owner write fails", async () => {
    const github = githubDouble();
    await env.DB.prepare(
      "CREATE TRIGGER fail_owner_write BEFORE INSERT ON meta WHEN NEW.key = 'github_app_owner' " +
        "BEGIN SELECT RAISE(ABORT, 'owner write refused'); END",
    ).run();

    const result = await finish(github);

    expect(result, "result").toEqual({ kind: "created", slug: "octoapp" });
    expect(await readSecret(env.DB, await storageKey(), "github_app_id"), "App ID").toEqual({ kind: "ok", value: "1" });
    expect(await metaValue("github_app_slug"), "slug row").toBe("1:octoapp");
    expect(await metaValue("github_app_owner"), "owner row").toBeUndefined();
  });

  it("finishGitHubApp answers store-failed when the credentials are not stored and nothing throws", async () => {
    const github = githubDouble();
    await env.DB.prepare(
      "CREATE TRIGGER ignore_secret_insert BEFORE INSERT ON secrets BEGIN SELECT RAISE(IGNORE); END",
    ).run();

    const result = await finish(github);

    expect(result, "result").toEqual({ kind: "store-failed" });
    expect(await countOf("secrets"), "number of secrets rows").toBe(0);
  });

  it.each<{ name: string; options: () => Promise<FinishOptions>; expected: string }>([
    {
      name: "an invalid state before the Worker secrets",
      options: async () => ({
        workerEnv: ALL_WORKER_SECRETS,
        state: await stateFor(await stateKey(), OTHER_SESSION, { type: "personal", account: "github" }, NOW),
      }),
      expected: "state-invalid",
    },
    { name: "a missing state", options: () => Promise.resolve({ stateFields: [] }), expected: "state-invalid" },
    {
      name: "two states",
      options: async () => {
        const state = await stateFor(await stateKey(), SESSION, { type: "personal", account: "github" }, NOW);
        return { stateFields: [state, state] };
      },
      expected: "state-invalid",
    },
    {
      name: "all Worker secrets before an invalid code",
      options: () => Promise.resolve({ workerEnv: ALL_WORKER_SECRETS, codeFields: ["a/b"] }),
      expected: "worker-secrets",
    },
    {
      name: "a partial set of Worker secrets",
      options: () => Promise.resolve({ workerEnv: { ...PLAIN_ENV, GITHUB_APP_ID: "1" } }),
      expected: "partial-worker-secrets",
    },
    {
      name: "an invalid code before the key check",
      options: () => Promise.resolve({ codeFields: ["a/b"] }),
      expected: "return-invalid",
    },
    { name: "a missing code", options: () => Promise.resolve({ codeFields: [] }), expected: "return-invalid" },
  ])(
    "finishGitHubApp converts only after the state, the Worker secrets, the code and the key check passed: $name",
    async ({ options, expected }) => {
      const github = githubDouble();

      const result = await finish(github, await options());

      expect(result.kind, "result").toBe(expected);
      expect(github.requests, "GitHub requests").toEqual([]);
      expect(await countOf("secrets"), "number of secrets rows").toBe(0);
    },
  );

  it("finishGitHubApp reports reset needed for a changed SELUNA_SECRET without calling GitHub", async () => {
    await seed(OTHER_SECRET, "github_app_id", "12345");
    const github = githubDouble();

    const result = await finish(github);

    expect(result, "result").toEqual({ kind: "reset-needed" });
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it("finishGitHubApp stores an organization's app whose owner matches in another letter case", async () => {
    const github = githubDouble(jsonAnswer(201, conversionOwnedBy("GitHub", "Organization")));
    const state = await stateFor(await stateKey(), SESSION, { type: "organization", account: "github" }, NOW);

    const result = await finish(github, { state });

    expect(result, "result").toEqual({ kind: "created", slug: "octoapp" });
    expect(await countOf("secrets"), "number of secrets rows").toBe(SECRET_NAMES.length);
  });

  it("finishGitHubApp refuses an app of another account before converting the key", async () => {
    const answer = conversionAnswer({ owner: { login: "octocat", type: "User" }, pem: "not a key" });
    const github = githubDouble(jsonAnswer(201, answer));

    const result = await finish(github);

    expect(result, "result").toEqual({ kind: "owner-mismatch" });
    expect(await countOf("secrets"), "number of secrets rows").toBe(0);
    expect(await countOf("meta"), "number of meta rows").toBe(0);
    expect(await metaValue("github_app_owner"), "owner row").toBeUndefined();
  });
});
