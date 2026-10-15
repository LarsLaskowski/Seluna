import { describe, expect, it } from "vitest";
import { createSessionToken, isValidSessionToken, SESSION_LIFETIME_MS } from "./session";
import { hmacBase64Url, signingKeyFor, withFirstCharacterChanged, withUnusedBitFlipped } from "../../test/keys";

const SECRET_A = "0123456789abcdef0123456789abcdef";
const SECRET_B = "fedcba9876543210fedcba9876543210";
const NOW = new Date(1_700_000_000_000);
const EXPIRES = NOW.getTime() + SESSION_LIFETIME_MS;

const sessionKey = (secret: string): Promise<CryptoKey> => signingKeyFor(secret, "setup-session");

/** `text` signed like a session token: `<text>.<mac of text>`. */
async function signed(key: CryptoKey, text: string): Promise<string> {
  return `${text}.${await hmacBase64Url(key, text)}`;
}

/** A valid token created at `NOW` and its three parts. */
async function validToken(key: CryptoKey): Promise<{ token: string; mac: string }> {
  const token = await createSessionToken(key, NOW);
  return { token, mac: token.split(".")[2] ?? "" };
}

/** A token, created at a moment shortly after `NOW`, whose MAC contains the base64url character `character`. */
async function tokenWithMacContaining(key: CryptoKey, character: string): Promise<string> {
  for (let offset = 0; offset < 500; offset++) {
    const token = await createSessionToken(key, new Date(NOW.getTime() + offset));
    if ((token.split(".")[2] ?? "").includes(character)) {
      return token;
    }
  }
  throw new Error(`no token with ${character} in its MAC within 500 moments`);
}

describe("createSessionToken", () => {
  it("createSessionToken returns v1, the expiry 12 hours after now and a 43-character MAC", async () => {
    const key = await sessionKey(SECRET_A);

    const token = await createSessionToken(key, NOW);

    expect(token, "token").toMatch(/^v1\.1700043200000\.[A-Za-z0-9_-]{43}$/);
    expect(token.split(".")[2], "MAC").toBe(await hmacBase64Url(key, `v1.${String(EXPIRES)}`));
  });
});

describe("isValidSessionToken", () => {
  it("isValidSessionToken accepts a token 1 ms before its expiry", async () => {
    const key = await sessionKey(SECRET_A);
    const token = await createSessionToken(key, NOW);

    const valid = await isValidSessionToken(key, token, new Date(EXPIRES - 1));

    expect(valid, "valid").toBe(true);
  });

  it("isValidSessionToken accepts a token just created", async () => {
    const key = await sessionKey(SECRET_A);
    const token = await createSessionToken(key, NOW);

    const valid = await isValidSessionToken(key, token, NOW);

    expect(valid, "valid").toBe(true);
  });

  it("isValidSessionToken rejects a token at its expiry", async () => {
    const key = await sessionKey(SECRET_A);
    const token = await createSessionToken(key, NOW);

    const valid = await isValidSessionToken(key, token, new Date(EXPIRES));

    expect(valid, "valid").toBe(false);
  });

  it.each([
    {
      name: "a changed expiry",
      token: async (key: CryptoKey) => {
        const { mac } = await validToken(key);
        return `v1.${String(EXPIRES + 1)}.${mac}`;
      },
    },
    {
      name: "one changed MAC character",
      token: async (key: CryptoKey) => {
        const { mac } = await validToken(key);
        return `v1.${String(EXPIRES)}.${withFirstCharacterChanged(mac)}`;
      },
    },
    {
      name: "a key from another secret",
      token: async () => createSessionToken(await sessionKey(SECRET_B), NOW),
    },
    {
      name: "a leading zero in the expiry",
      token: (key: CryptoKey) => signed(key, `v1.0${String(EXPIRES)}`),
    },
    {
      name: "16 expiry digits",
      token: (key: CryptoKey) => signed(key, "v1.1700043200000000"),
    },
    {
      name: "a padded MAC",
      token: async (key: CryptoKey) => `${(await validToken(key)).token}=`,
    },
    {
      name: "a + in the MAC",
      token: async (key: CryptoKey) => (await tokenWithMacContaining(key, "-")).replaceAll("-", "+"),
    },
    {
      name: "a / in the MAC",
      token: async (key: CryptoKey) => (await tokenWithMacContaining(key, "_")).replaceAll("_", "/"),
    },
    {
      name: "version v2",
      token: (key: CryptoKey) => signed(key, `v2.${String(EXPIRES)}`),
    },
    {
      name: "a fourth segment",
      token: async (key: CryptoKey) => `${(await validToken(key)).token}.x`,
    },
    {
      name: "empty text",
      token: () => Promise.resolve(""),
    },
    {
      name: "an expiry more than 12 hours after now",
      token: (key: CryptoKey) => createSessionToken(key, new Date(NOW.getTime() + 1)),
    },
    {
      name: "a MAC whose last character differs only in its two unused bits",
      token: async (key: CryptoKey) => withUnusedBitFlipped((await validToken(key)).token),
    },
  ])("isValidSessionToken rejects $name", async ({ token }) => {
    const key = await sessionKey(SECRET_A);
    const text = await token(key);

    const valid = await isValidSessionToken(key, text, NOW);

    expect(valid, "valid").toBe(false);
  });
});
