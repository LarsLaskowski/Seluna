import { assert } from "vitest";
import { keyFromEnv } from "../src/crypto";

/** The key `keyFromEnv` derives from `secret`; fails the test when none is derived. */
export async function keyFor(secret: string): Promise<CryptoKey> {
  const key = await keyFromEnv({ SELUNA_SECRET: secret });
  assert.isDefined(key, "keyFromEnv returns a key for a secret of at least 32 characters");
  return key;
}

/** `text` with its first character replaced by another base64 character. */
export function withFirstCharacterChanged(text: string): string {
  return (text.startsWith("A") ? "B" : "A") + text.slice(1);
}
