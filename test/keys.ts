import { assert } from "vitest";
import { keyFromEnv, signingKeyFromEnv } from "../src/crypto";
import type { SigningPurpose } from "../src/crypto";

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The key `keyFromEnv` derives from `secret`; fails the test when none is derived. */
export async function keyFor(secret: string): Promise<CryptoKey> {
  const key = await keyFromEnv({ SELUNA_SECRET: secret });
  assert.isDefined(key, "keyFromEnv returns a key for a secret of at least 32 characters");
  return key;
}

/** The signing key `signingKeyFromEnv` derives from `secret` for `purpose`; fails the test when none is derived. */
export async function signingKeyFor(secret: string, purpose: SigningPurpose): Promise<CryptoKey> {
  const key = await signingKeyFromEnv({ SELUNA_SECRET: secret }, purpose);
  assert.isDefined(key, "signingKeyFromEnv returns a key for a secret of at least 32 characters");
  return key;
}

/** `text` with its first character replaced by another base64 character. */
export function withFirstCharacterChanged(text: string): string {
  return (text.startsWith("A") ? "B" : "A") + text.slice(1);
}

/** Base64url without padding of `bytes`, written independently of `src/base64url.ts`. */
export function base64UrlOf(bytes: Uint8Array): string {
  const standard = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
  return standard.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** The HMAC-SHA256 of the UTF-8 bytes of `text` under `key`, as base64url without padding. */
export async function hmacBase64Url(key: CryptoKey, text: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return base64UrlOf(new Uint8Array(mac));
}

/**
 * `text`, a base64url text of 32 bytes (43 characters), with only the lowest of the two unused bits of its last
 * character flipped: a forgiving decoder reads the same 32 bytes from it.
 */
export function withUnusedBitFlipped(text: string): string {
  const last = text.slice(-1);
  return text.slice(0, -1) + (BASE64URL_ALPHABET[BASE64URL_ALPHABET.indexOf(last) ^ 1] ?? last);
}
