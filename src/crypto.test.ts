import { describe, expect, it } from "vitest";
import * as cryptoModule from "./crypto";
import { decrypt, encrypt, keyFromEnv } from "./crypto";
import { keyFor, withFirstCharacterChanged } from "../test/keys";

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

describe("crypto module", () => {
  it("crypto exports keyFromEnv, encrypt and decrypt as its only functions", () => {
    const functionNames = Object.entries(cryptoModule)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right));

    expect(functionNames, "exported function names").toEqual(["decrypt", "encrypt", "keyFromEnv"]);
  });
});
