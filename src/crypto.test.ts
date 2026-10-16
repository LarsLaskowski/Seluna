import { describe, expect, it } from "vitest";
import * as cryptoModule from "./crypto";
import {
  decrypt,
  encrypt,
  isSelunaSecretConfigured,
  keyFromEnv,
  signingKeyFromEnv,
  verifySelunaSecret,
} from "./crypto";
import { hmacBase64Url, keyFor, signingKeyFor, withFirstCharacterChanged } from "../test/keys";

const SECRET_A = "0123456789abcdef0123456789abcdef";
const SECRET_B = "fedcba9876543210fedcba9876543210";
const CONTEXT = "secrets/github_private_key";

/** Base64 of the given bytes, written like the module under test does. */
function base64Of(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

/** A fresh AES-256-GCM key that has nothing to do with `SELUNA_SECRET`. */
async function generateAesKey(): Promise<CryptoKey> {
  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  if (!("algorithm" in generated)) {
    throw new TypeError("generateKey returned a key pair for AES-GCM");
  }
  return generated;
}

describe("encrypt", () => {
  it("encrypt returns a 12-byte IV as 16 base64 characters", async () => {
    const key = await keyFor(SECRET_A);

    const sealed = await encrypt(key, "value", CONTEXT);

    expect(sealed.iv, "iv").toMatch(/^[A-Za-z0-9+/]{16}$/);
    expect(atob(sealed.iv).length, "decoded iv length").toBe(12);
  });

  it("encrypt returns different IVs and ciphertexts for the same plaintext", async () => {
    const key = await keyFor(SECRET_A);

    const first = await encrypt(key, "value", CONTEXT);
    const second = await encrypt(key, "value", CONTEXT);

    expect(first.iv, "iv").not.toBe(second.iv);
    expect(first.ciphertext, "ciphertext").not.toBe(second.ciphertext);
  });
});

describe("decrypt", () => {
  it("decrypt returns the plaintext encrypt sealed under the same key and context", async () => {
    const key = await keyFor(SECRET_A);
    const sealed = await encrypt(key, "pä\nssword ✓", CONTEXT);

    const plaintext = await decrypt(key, sealed, CONTEXT);

    expect(plaintext, "plaintext").toBe("pä\nssword ✓");
  });

  it("decrypt returns undefined under a key derived from another secret", async () => {
    const sealed = await encrypt(await keyFor(SECRET_A), "value", CONTEXT);
    const otherKey = await keyFor(SECRET_B);

    const plaintext = await decrypt(otherKey, sealed, CONTEXT);

    expect(plaintext, "plaintext").toBeUndefined();
  });

  it("decrypt returns undefined for another context", async () => {
    const key = await keyFor(SECRET_A);
    const sealed = await encrypt(key, "value", CONTEXT);

    const plaintext = await decrypt(key, sealed, "secrets/github_app_id");

    expect(plaintext, "plaintext").toBeUndefined();
  });

  it("decrypt returns undefined for an altered ciphertext", async () => {
    const key = await keyFor(SECRET_A);
    const sealed = await encrypt(key, "value", CONTEXT);
    const altered = { iv: sealed.iv, ciphertext: withFirstCharacterChanged(sealed.ciphertext) };

    const plaintext = await decrypt(key, altered, CONTEXT);

    expect(plaintext, "plaintext").toBeUndefined();
  });

  it("decrypt returns undefined for an IV that is not 12 bytes", async () => {
    const key = await keyFor(SECRET_A);
    const sealed = await encrypt(key, "value", CONTEXT);
    const sixteenByteIv = base64Of(new Uint8Array(16));

    const plaintext = await decrypt(key, { iv: sixteenByteIv, ciphertext: sealed.ciphertext }, CONTEXT);

    expect(plaintext, "plaintext").toBeUndefined();
  });

  it("decrypt returns undefined for text that is not base64", async () => {
    const key = await keyFor(SECRET_A);
    const sealed = await encrypt(key, "value", CONTEXT);

    const plaintext = await decrypt(key, { iv: sealed.iv, ciphertext: "not base64 !!" }, CONTEXT);

    expect(plaintext, "plaintext").toBeUndefined();
  });

  it("decrypt returns undefined for a ciphertext shorter than the 16-byte tag", async () => {
    const key = await keyFor(SECRET_A);
    const sealed = await encrypt(key, "value", CONTEXT);
    const fifteenBytes = base64Of(new Uint8Array(15));

    const plaintext = await decrypt(key, { iv: sealed.iv, ciphertext: fifteenBytes }, CONTEXT);

    expect(plaintext, "plaintext").toBeUndefined();
  });

  it("decrypt returns a plaintext that starts with a byte order mark unchanged", async () => {
    const key = await keyFor(SECRET_A);
    const input = "\uFEFFvalue";
    expect(input.charCodeAt(0), "first code unit of the input").toBe(0xfeff);
    expect(input.length, "length of the input").toBe(6);
    const sealed = await encrypt(key, input, CONTEXT);

    const plaintext = await decrypt(key, sealed, CONTEXT);

    expect(plaintext, "plaintext").toBe(input);
  });

  it("decrypt returns undefined for a plaintext that is not valid UTF-8", async () => {
    const key = await generateAesKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealedBytes = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("test/utf8") },
      key,
      new Uint8Array([0xff, 0xfe]),
    );
    const sealed = { iv: base64Of(iv), ciphertext: base64Of(new Uint8Array(sealedBytes)) };

    const plaintext = await decrypt(key, sealed, "test/utf8");

    expect(plaintext, "plaintext").toBeUndefined();
  });

  // Produced once with Node 24 Web Crypto, importing nothing from src/: importKey("raw", utf8(secret), "HKDF"),
  // deriveKey({ name: "HKDF", hash: "SHA-256", salt: utf8("seluna/secrets/v1"), info: utf8("seluna/secrets/v1") },
  // ..., { name: "AES-GCM", length: 256 }), encrypt({ name: "AES-GCM", iv: bytes 1..12, additionalData:
  // utf8("test/known-vector") }) of "seluna known vector" under the secret 0123456789abcdef0123456789abcdef.
  it("decrypt opens the known vector produced with HKDF-SHA256, salt and info seluna/secrets/v1", async () => {
    const key = await keyFor("0123456789abcdef0123456789abcdef");
    const sealed = { iv: "AQIDBAUGBwgJCgsM", ciphertext: "imbU5UKjDXjoztnXT22Aob8ID6aUHrqLMgT4YEXLB9EpsNE=" };

    const plaintext = await decrypt(key, sealed, "test/known-vector");

    expect(plaintext, "plaintext").toBe("seluna known vector");
  });
});

describe("keyFromEnv", () => {
  it("keyFromEnv returns undefined when SELUNA_SECRET is absent", async () => {
    const key = await keyFromEnv({});

    expect(key, "key").toBeUndefined();
  });

  it("keyFromEnv returns undefined when SELUNA_SECRET is not a string", async () => {
    const key = await keyFromEnv({ SELUNA_SECRET: 42 });

    expect(key, "key").toBeUndefined();
  });

  it("keyFromEnv returns undefined for 31 characters", async () => {
    const key = await keyFromEnv({ SELUNA_SECRET: "a".repeat(31) });

    expect(key, "key").toBeUndefined();
  });

  it("keyFromEnv returns undefined for 31 characters that are 32 UTF-16 code units", async () => {
    const input = "a".repeat(30) + "\u{1F511}";
    expect(input.length, "UTF-16 code units of the input").toBe(32);
    expect(Array.from(input).length, "code points of the input").toBe(31);

    const key = await keyFromEnv({ SELUNA_SECRET: input });

    expect(key, "key").toBeUndefined();
  });

  it("keyFromEnv returns a key for 32 characters", async () => {
    const first = await keyFor(SECRET_A);
    const second = await keyFor(SECRET_A);
    const sealed = await encrypt(first, "value", CONTEXT);

    const plaintext = await decrypt(second, sealed, CONTEXT);

    expect(plaintext, "plaintext").toBe("value");
  });

  it("keyFromEnv uses SELUNA_SECRET verbatim without trimming", async () => {
    const padded = await keyFor(" " + SECRET_A);
    const trimmed = await keyFor(SECRET_A);
    const sealed = await encrypt(padded, "value", CONTEXT);

    const plaintext = await decrypt(trimmed, sealed, CONTEXT);

    expect(plaintext, "plaintext").toBeUndefined();
  });
});

describe("isSelunaSecretConfigured", () => {
  it.each([
    { name: "absent", env: {}, expected: false },
    { name: "a number", env: { SELUNA_SECRET: 42 }, expected: false },
    { name: "31 characters", env: { SELUNA_SECRET: "a".repeat(31) }, expected: false },
    {
      name: "31 characters that are 32 UTF-16 code units",
      env: { SELUNA_SECRET: "a".repeat(30) + String.fromCodePoint(0x1f511) },
      expected: false,
    },
    { name: "32 characters", env: { SELUNA_SECRET: SECRET_A }, expected: true },
  ])("isSelunaSecretConfigured returns $expected for $name", ({ env, expected }) => {
    const configured = isSelunaSecretConfigured(env);

    expect(configured, "configured").toBe(expected);
  });
});

describe("signingKeyFromEnv", () => {
  const MESSAGE = "v1.1700043200000";

  it("signingKeyFromEnv returns undefined when SELUNA_SECRET is not configured", async () => {
    const key = await signingKeyFromEnv({ SELUNA_SECRET: "a".repeat(31) }, "setup-session");

    expect(key, "key").toBeUndefined();
  });

  it("signingKeyFromEnv derives different keys for setup-session and setup-csrf", async () => {
    const sessionKey = await signingKeyFor(SECRET_A, "setup-session");
    const csrfKey = await signingKeyFor(SECRET_A, "setup-csrf");

    const sessionMac = await hmacBase64Url(sessionKey, MESSAGE);
    const csrfMac = await hmacBase64Url(csrfKey, MESSAGE);

    expect(sessionMac, "MAC of the same message").not.toBe(csrfMac);
  });

  it("signingKeyFromEnv derives three different keys for setup-session, setup-csrf and setup-telegram", async () => {
    const macs = await Promise.all(
      (["setup-session", "setup-csrf", "setup-telegram"] as const).map(async (purpose) =>
        hmacBase64Url(await signingKeyFor(SECRET_A, purpose), MESSAGE),
      ),
    );

    expect(new Set(macs).size, "number of distinct MACs of the same message").toBe(3);
  });

  it("signingKeyFromEnv returns a non-extractable HMAC-SHA256 key for signing and verifying", async () => {
    const key = await signingKeyFor(SECRET_A, "setup-csrf");

    expect(key.extractable, "extractable").toBe(false);
    expect(key.algorithm, "algorithm").toMatchObject({ name: "HMAC", hash: { name: "SHA-256" }, length: 256 });
    expect(
      [...key.usages].sort((left, right) => left.localeCompare(right)),
      "usages",
    ).toEqual(["sign", "verify"]);
  });

  // Produced once with Node 24, importing nothing from src/: crypto.hkdfSync("sha256", secret, salt, info, 32)
  // with salt = info = utf8("seluna/setup-session/v1") for the secret 0123456789abcdef0123456789abcdef, then
  // createHmac("sha256", thatKey).update("v1.1700043200000").digest("base64url"); the csrf value likewise with
  // salt = info = utf8("seluna/setup-csrf/v1"); the setup-telegram value likewise with "seluna/setup-telegram/v1".
  it.each([
    { purpose: "setup-session" as const, expected: "5vIymaYhJ58dOAi0xzi8XCc-EDdwlxvsNrv4C-vtVls" },
    { purpose: "setup-csrf" as const, expected: "brU7fxNHFFPkz0tEHsgaHtB87o_qpIeD2Q7Bv9l0JcE" },
    { purpose: "setup-telegram" as const, expected: "7VgSyLpjX6KdiahF8OQ3zfc_QB96Nv7dKxe5nINqJxk" },
  ])(
    "signingKeyFromEnv derives the $purpose key with HKDF-SHA256, salt and info seluna/$purpose/v1",
    async ({ purpose, expected }) => {
      const key = await signingKeyFor(SECRET_A, purpose);

      const mac = await hmacBase64Url(key, MESSAGE);

      expect(mac, "known HMAC").toBe(expected);
    },
  );
});

describe("verifySelunaSecret", () => {
  it("verifySelunaSecret returns true for exactly SELUNA_SECRET", async () => {
    const verified = await verifySelunaSecret({ SELUNA_SECRET: SECRET_A }, SECRET_A);

    expect(verified, "verified").toBe(true);
  });

  it.each([
    { name: "a trailing space", candidate: SECRET_A + " " },
    { name: "the last character missing", candidate: SECRET_A.slice(0, -1) },
    { name: "one letter's case changed", candidate: SECRET_A.replace("abcdef", "abcdeF") },
    { name: "one character more", candidate: SECRET_A + "0" },
    { name: "an empty text", candidate: "" },
  ])("verifySelunaSecret returns false for $name", async ({ candidate }) => {
    const verified = await verifySelunaSecret({ SELUNA_SECRET: SECRET_A }, candidate);

    expect(verified, "verified").toBe(false);
  });

  it("verifySelunaSecret returns false when SELUNA_SECRET is not configured", async () => {
    const verified = await verifySelunaSecret({}, "");

    expect(verified, "verified").toBe(false);
  });
});

describe("crypto module", () => {
  it("crypto exports decrypt, encrypt, isSelunaSecretConfigured, keyFromEnv, signingKeyFromEnv and verifySelunaSecret as its only functions", () => {
    const functionNames = Object.entries(cryptoModule)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right));

    expect(functionNames, "exported function names").toEqual([
      "decrypt",
      "encrypt",
      "isSelunaSecretConfigured",
      "keyFromEnv",
      "signingKeyFromEnv",
      "verifySelunaSecret",
    ]);
  });
});
