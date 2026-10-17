import { describe, expect, it } from "vitest";
import type { AccountChoice } from "../github/manifest";
import {
  createGitHubState,
  GITHUB_STATE_LIFETIME_MS,
  isWellFormedGitHubState,
  verifyGitHubState,
} from "./github-state";
import { hmacBase64Url, signingKeyFor, withFirstCharacterChanged, withUnusedBitFlipped } from "../../test/keys";

const SECRET = "throwaway-setup-secret-0123456789abcdef";
const OTHER_SECRET = "another-throwaway-secret-fedcba9876543210";
const NOW = new Date(1_700_000_000_000);
const SESSION = "v1.1700043200000.sessionmacsessionmacsessionmacsessionmac1";
const OTHER_SESSION = "v1.1700043100000.othermacothermacothermacothermacother1";
const CHOICE: AccountChoice = { type: "organization", account: "Octo-Org" };
const NONCE = "A".repeat(22);
const MAC = "B".repeat(43);

function keyOf(secret: string = SECRET): Promise<CryptoKey> {
  return signingKeyFor(secret, "setup-github");
}

/** The six dot-separated parts of a state (version, type, account, expiry, nonce, MAC). */
function partsOf(state: string): [string, string, string, string, string, string] {
  const [version = "", type = "", account = "", expires = "", nonce = "", mac = ""] = state.split(".");
  return [version, type, account, expires, nonce, mac];
}

/** `parts` joined into a state. */
function stateOf(parts: readonly string[]): string {
  return parts.join(".");
}

/** A state created under the key of `SECRET` for `SESSION` and `CHOICE` at `NOW`. */
async function freshState(): Promise<string> {
  return createGitHubState(await keyOf(), SESSION, CHOICE, NOW);
}

describe("createGitHubState", () => {
  it("createGitHubState yields v1, the account type and name, the expiry one hour ahead, a 22-character nonce and the MAC of the documented text", async () => {
    const key = await keyOf();

    const state = await createGitHubState(key, SESSION, CHOICE, NOW);

    const [version, type, account, expires, nonce, mac] = partsOf(state);
    expect(state.split(".").length, "number of parts").toBe(6);
    expect(version, "version").toBe("v1");
    expect(type, "account type").toBe("organization");
    expect(account, "account as entered").toBe("Octo-Org");
    expect(expires, "expiry").toBe(String(NOW.getTime() + 3_600_000));
    expect(GITHUB_STATE_LIFETIME_MS, "GITHUB_STATE_LIFETIME_MS").toBe(3_600_000);
    expect(nonce, "nonce").toMatch(/^[\w-]{22}$/);
    expect(mac, "MAC").toMatch(/^[\w-]{43}$/);
    expect(mac, "MAC of the documented text").toBe(
      await hmacBase64Url(key, `github-state.v1.organization.Octo-Org.${expires}.${nonce}.${SESSION}`),
    );
  });

  it("createGitHubState draws a new nonce each time", async () => {
    const first = partsOf(await freshState())[4];
    const second = partsOf(await freshState())[4];

    expect(first, "first nonce").not.toBe(second);
  });
});

interface VerifyArguments {
  readonly state: string;
  readonly session?: string;
  readonly key?: CryptoKey;
  readonly now?: Date;
}

describe("verifyGitHubState", () => {
  it("verifyGitHubState returns the account type and name of a fresh state of the same session", async () => {
    const state = await freshState();

    const choice = await verifyGitHubState(await keyOf(), state, SESSION, NOW);

    expect(choice, "account choice").toEqual(CHOICE);
  });

  it("verifyGitHubState accepts a state until the last millisecond before it expires", async () => {
    const state = await freshState();

    const choice = await verifyGitHubState(
      await keyOf(),
      state,
      SESSION,
      new Date(NOW.getTime() + GITHUB_STATE_LIFETIME_MS - 1),
    );

    expect(choice, "account choice").toEqual(CHOICE);
  });

  it.each<{ name: string; args: () => Promise<VerifyArguments> }>([
    {
      name: "another session",
      args: async () => ({ state: await freshState(), session: OTHER_SESSION }),
    },
    {
      name: "another key",
      args: async () => ({ state: await freshState(), key: await keyOf(OTHER_SECRET) }),
    },
    {
      name: "a state that expires at this moment",
      args: async () => ({ state: await freshState(), now: new Date(NOW.getTime() + GITHUB_STATE_LIFETIME_MS) }),
    },
    {
      name: "an expired state",
      args: async () => ({ state: await freshState(), now: new Date(NOW.getTime() + GITHUB_STATE_LIFETIME_MS + 1) }),
    },
    {
      name: "an expiry more than one hour ahead",
      args: async () => ({
        state: await createGitHubState(await keyOf(), SESSION, CHOICE, new Date(NOW.getTime() + 1)),
      }),
    },
    {
      name: "the type swapped to the other value with the original MAC",
      args: async () => {
        const parts = partsOf(await freshState());
        parts[1] = "personal";
        return { state: stateOf(parts) };
      },
    },
    {
      name: "the account replaced with the original MAC",
      args: async () => {
        const parts = partsOf(await freshState());
        parts[2] = "Other-Org";
        return { state: stateOf(parts) };
      },
    },
    {
      name: "the account changed in case with the original MAC",
      args: async () => {
        const parts = partsOf(await freshState());
        parts[2] = "octo-org";
        return { state: stateOf(parts) };
      },
    },
    {
      name: "the expiry changed with the original MAC",
      args: async () => {
        const parts = partsOf(await freshState());
        parts[3] = String(Number(parts[3]) + 1);
        return { state: stateOf(parts) };
      },
    },
    {
      name: "the nonce changed with the original MAC",
      args: async () => {
        const parts = partsOf(await freshState());
        parts[4] = withFirstCharacterChanged(parts[4]);
        return { state: stateOf(parts) };
      },
    },
    {
      name: "the MAC changed",
      args: async () => {
        const parts = partsOf(await freshState());
        parts[5] = withFirstCharacterChanged(parts[5]);
        return { state: stateOf(parts) };
      },
    },
    {
      name: "a MAC with an unused bit set (non-canonical base64url)",
      args: async () => {
        const parts = partsOf(await freshState());
        parts[5] = withUnusedBitFlipped(parts[5]);
        return { state: stateOf(parts) };
      },
    },
    {
      name: "a non-canonical nonce under a valid MAC",
      args: async () => {
        const parts = partsOf(await freshState());
        parts[4] = withUnusedBitFlipped(parts[4]);
        const head = parts.slice(1, 5).join(".");
        parts[5] = await hmacBase64Url(await keyOf(), `github-state.v1.${head}.${SESSION}`);
        return { state: stateOf(parts) };
      },
    },
    {
      name: "another version under a valid MAC",
      args: async () => {
        const parts = partsOf(await freshState());
        parts[0] = "v2";
        const head = parts.slice(1, 5).join(".");
        parts[5] = await hmacBase64Url(await keyOf(), `github-state.v2.${head}.${SESSION}`);
        return { state: stateOf(parts) };
      },
    },
    { name: "an empty state", args: () => Promise.resolve({ state: "" }) },
  ])(
    "verifyGitHubState rejects another session, another key, an expired state, an expiry more than one hour ahead, an altered part and non-canonical base64url: $name",
    async ({ args }) => {
      const { state, session = SESSION, key = await keyOf(), now = NOW } = await args();

      const choice = await verifyGitHubState(key, state, session, now);

      expect(choice, "account choice").toBeUndefined();
    },
  );
});

describe("verifyGitHubState with an unusable key", () => {
  it("verifyGitHubState returns undefined when the key cannot verify", async () => {
    const state = await freshState();
    const signOnly = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(32),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const choice = await verifyGitHubState(signOnly, state, SESSION, NOW);

    expect(choice, "account choice").toBeUndefined();
  });
});

describe("isWellFormedGitHubState", () => {
  const VALID_PERSONAL = `v1.personal.octocat.1700003600000.${NONCE}.${MAC}`;

  it.each([
    { name: "a personal account", state: VALID_PERSONAL },
    { name: "an organization", state: `v1.organization.Octo-Org.1700003600000.${NONCE}.${MAC}` },
    {
      name: "a 39-character account and a 15-digit expiry",
      state: `v1.organization.${"a".repeat(39)}.123456789012345.${NONCE}.${MAC}`,
    },
    { name: "the characters of base64url", state: `v1.personal.a.1.${"-_".repeat(11)}.${"_-".repeat(21)}A` },
  ])("isWellFormedGitHubState accepts $name", ({ state }) => {
    const wellFormed = isWellFormedGitHubState(state);

    expect(wellFormed, "well-formed").toBe(true);
  });

  it.each([
    { form: "empty", state: "" },
    { form: "another version", state: VALID_PERSONAL.replace("v1.", "v2.") },
    { form: "the type user", state: VALID_PERSONAL.replace(".personal.", ".user.") },
    { form: "the type in capitals", state: VALID_PERSONAL.replace(".personal.", ".Personal.") },
    { form: "a missing type", state: `v1..octocat.1700003600000.${NONCE}.${MAC}` },
    { form: "an account with a leading hyphen", state: VALID_PERSONAL.replace(".octocat.", ".-a.") },
    { form: "an account with a trailing hyphen", state: VALID_PERSONAL.replace(".octocat.", ".a-.") },
    { form: "an account of 40 characters", state: VALID_PERSONAL.replace(".octocat.", `.${"a".repeat(40)}.`) },
    { form: "an account with a dot", state: VALID_PERSONAL.replace(".octocat.", ".a.b.") },
    { form: "a missing account", state: `v1.personal..1700003600000.${NONCE}.${MAC}` },
    { form: "a nonce of 21 characters", state: VALID_PERSONAL.replace(NONCE, "A".repeat(21)) },
    { form: "a nonce of 23 characters", state: VALID_PERSONAL.replace(NONCE, "A".repeat(23)) },
    { form: "a nonce with padding", state: VALID_PERSONAL.replace(NONCE, `${"A".repeat(21)}=`) },
    { form: "a nonce with a plus sign", state: VALID_PERSONAL.replace(NONCE, `${"A".repeat(21)}+`) },
    { form: "a nonce with a slash", state: VALID_PERSONAL.replace(NONCE, `${"A".repeat(21)}/`) },
    { form: "a MAC of 42 characters", state: VALID_PERSONAL.replace(MAC, "B".repeat(42)) },
    { form: "a MAC of 44 characters", state: VALID_PERSONAL.replace(MAC, "B".repeat(44)) },
    { form: "a MAC with padding", state: VALID_PERSONAL.replace(MAC, `${"B".repeat(42)}=`) },
    { form: "a MAC with a plus sign", state: VALID_PERSONAL.replace(MAC, `${"B".repeat(42)}+`) },
    { form: "a MAC with a slash", state: VALID_PERSONAL.replace(MAC, `${"B".repeat(42)}/`) },
    { form: "an expiry with a leading zero", state: VALID_PERSONAL.replace("1700003600000", "01700003600000") },
    { form: "an expiry of zero", state: VALID_PERSONAL.replace("1700003600000", "0") },
    { form: "an expiry of 16 digits", state: VALID_PERSONAL.replace("1700003600000", "1234567890123456") },
    { form: "an expiry with a sign", state: VALID_PERSONAL.replace("1700003600000", "+1700003600000") },
    { form: "a missing part", state: `v1.personal.octocat.1700003600000.${NONCE}` },
    { form: "an extra part", state: `${VALID_PERSONAL}.x` },
  ])("isWellFormedGitHubState rejects every form in the state table: $form", ({ state }) => {
    const wellFormed = isWellFormedGitHubState(state);

    expect(wellFormed, "well-formed").toBe(false);
  });

  it("isWellFormedGitHubState rejects a well-formed state followed by a line feed", () => {
    const state = `${VALID_PERSONAL}\n`;
    expect(state.charCodeAt(state.length - 1), "last code unit of the state").toBe(0x0a);

    const wellFormed = isWellFormedGitHubState(state);

    expect(wellFormed, "well-formed").toBe(false);
  });
});
