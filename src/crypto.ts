/** Name of the Worker secret the encryption key is derived from. */
export const SELUNA_SECRET_NAME = "SELUNA_SECRET";
/** Fewest characters (Unicode code points) a usable `SELUNA_SECRET` has. */
export const MIN_SELUNA_SECRET_CHARACTERS = 32;
/** HKDF salt and info, and the version of the stored format. */
export const KEY_DERIVATION_LABEL = "seluna/secrets/v1";

/** An AES-256-GCM value as stored: base64 of the 12-byte IV and of the ciphertext with its 16-byte tag. */
export interface SealedValue {
  readonly iv: string;
  readonly ciphertext: string;
}

/**
 * The non-extractable AES-256-GCM storage key, derived with HKDF-SHA256 from `SELUNA_SECRET` in the Worker
 * environment, or `undefined` when `SELUNA_SECRET` is absent, not a string or shorter than 32 code points.
 * The only way to obtain the key: no exported function derives one from a plain string.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- skeleton body, replaced by the implementation
export async function keyFromEnv(env: object): Promise<CryptoKey | undefined> {
  throw new Error("Not implemented");
}

/** Encrypts the UTF-8 bytes of `plaintext` under a fresh random IV, bound to `context` as additional data. */
// eslint-disable-next-line @typescript-eslint/require-await -- skeleton body, replaced by the implementation
export async function encrypt(key: CryptoKey, plaintext: string, context: string): Promise<SealedValue> {
  throw new Error("Not implemented");
}

/** The plaintext, or `undefined` when the value is malformed, altered, bound to another context or under another key. */
// eslint-disable-next-line @typescript-eslint/require-await -- skeleton body, replaced by the implementation
export async function decrypt(key: CryptoKey, sealed: SealedValue, context: string): Promise<string | undefined> {
  throw new Error("Not implemented");
}
