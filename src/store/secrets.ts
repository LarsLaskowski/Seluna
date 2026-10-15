/** The credentials kept in the `secrets` table. */
export type SecretName = "github_app_id" | "github_private_key" | "github_webhook_secret";

/** Outcome of reading one credential. */
export type SecretReadResult =
  | { readonly kind: "ok"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "secret-changed" }
  | { readonly kind: "corrupt" };

/** Outcome of writing one credential. */
export type SecretWriteResult =
  { readonly kind: "ok" } | { readonly kind: "secret-changed" } | { readonly kind: "corrupt" };

/** Outcome of comparing the stored key check value with a key. */
export type KeyCheckResult = "unset" | "match" | "changed" | "corrupt";

/** `meta` key of the key check value. */
export const KEY_CHECK_META_KEY = "key_check";
/** The text the key check value encrypts. */
export const KEY_CHECK_PLAINTEXT = "seluna/key-check/v1";

/** Compares the stored key check value with `key` (the key from `keyFromEnv`). */
// eslint-disable-next-line @typescript-eslint/require-await -- skeleton body, replaced by the implementation
export async function checkKey(db: D1Database, key: CryptoKey): Promise<KeyCheckResult> {
  throw new Error("Not implemented");
}

/** Reads and decrypts one credential in one D1 round trip. D1 errors are not caught. */
// eslint-disable-next-line @typescript-eslint/require-await -- skeleton body, replaced by the implementation
export async function readSecret(db: D1Database, key: CryptoKey, name: SecretName): Promise<SecretReadResult> {
  throw new Error("Not implemented");
}

/**
 * Encrypts and stores one credential, storing the key check value with the first one; writes only while the
 * checked key check value is still stored, with one retry. D1 errors are not caught.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- skeleton body, replaced by the implementation
export async function writeSecret(
  db: D1Database,
  key: CryptoKey,
  name: SecretName,
  value: string,
): Promise<SecretWriteResult> {
  throw new Error("Not implemented");
}
