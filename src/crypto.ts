/** Name of the Worker secret the encryption key is derived from. */
export const SELUNA_SECRET_NAME = "SELUNA_SECRET";
/** Fewest characters (Unicode code points) a usable `SELUNA_SECRET` has. */
export const MIN_SELUNA_SECRET_CHARACTERS = 32;
/** HKDF salt and info, and the version of the stored format. */
export const KEY_DERIVATION_LABEL = "seluna/secrets/v1";

/** What a signing key derived from `SELUNA_SECRET` is for. */
export type SigningPurpose = "setup-session" | "setup-csrf" | "setup-telegram" | "setup-github";
/** HKDF salt and info of each signing key. */
export const SIGNING_KEY_LABELS: Readonly<Record<SigningPurpose, string>> = {
  "setup-session": "seluna/setup-session/v1",
  "setup-csrf": "seluna/setup-csrf/v1",
  "setup-telegram": "seluna/setup-telegram/v1",
  "setup-github": "seluna/setup-github/v1",
};

const IV_BYTES = 12;
const HMAC_KEY_BYTES = 32;
const BASE64_CHUNK = 0x2000;

/** An AES-256-GCM value as stored: base64 of the 12-byte IV and of the ciphertext with its 16-byte tag. */
export interface SealedValue {
  readonly iv: string;
  readonly ciphertext: string;
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** The bytes of a base64 text, or `undefined` when it is not base64. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      // Always defined for an index inside `binary`; the guard only narrows the type, the bytes are unchanged.
      const codePoint = binary.codePointAt(index);
      if (codePoint !== undefined) {
        bytes[index] = codePoint;
      }
    }
    return bytes;
  } catch {
    return undefined;
  }
}

/** `SELUNA_SECRET` from the Worker environment, unchanged, when it is a string of enough code points. */
function selunaSecretFromEnv(env: object): string | undefined {
  const value: unknown = SELUNA_SECRET_NAME in env ? env[SELUNA_SECRET_NAME] : undefined;
  // Counting code points, not UTF-16 units, is the point of the minimum.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code points are counted on purpose
  return typeof value === "string" && [...value].length >= MIN_SELUNA_SECRET_CHARACTERS ? value : undefined;
}

async function deriveStorageKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", utf8(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: utf8(KEY_DERIVATION_LABEL),
      info: utf8(KEY_DERIVATION_LABEL),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The non-extractable AES-256-GCM storage key, derived with HKDF-SHA256 from `SELUNA_SECRET` in the Worker
 * environment, or `undefined` when `SELUNA_SECRET` is absent, not a string or shorter than 32 code points.
 * The only way to obtain the key: no exported function derives one from a plain string.
 */
export async function keyFromEnv(env: object): Promise<CryptoKey | undefined> {
  const secret = selunaSecretFromEnv(env);
  return secret === undefined ? undefined : await deriveStorageKey(secret);
}

/** Encrypts the UTF-8 bytes of `plaintext` under a fresh random IV, bound to `context` as additional data. */
export async function encrypt(key: CryptoKey, plaintext: string, context: string): Promise<SealedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8(context) },
    key,
    utf8(plaintext),
  );
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(sealed)) };
}

/** The plaintext, or `undefined` when the value is malformed, altered, bound to another context or under another key. */
export async function decrypt(key: CryptoKey, sealed: SealedValue, context: string): Promise<string | undefined> {
  const iv = fromBase64(sealed.iv);
  const ciphertext = fromBase64(sealed.ciphertext);
  if (iv?.length !== IV_BYTES || ciphertext === undefined) {
    return undefined;
  }
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: utf8(context) }, key, ciphertext);
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plain);
  } catch {
    // Bad input of any kind (OperationError, invalid UTF-8) is reported as undefined; the cause is dropped.
    return undefined;
  }
}

/** Whether `SELUNA_SECRET` in the Worker environment is a string of at least 32 code points (the rule of `keyFromEnv`). */
export function isSelunaSecretConfigured(env: object): boolean {
  return selunaSecretFromEnv(env) !== undefined;
}

/** A non-extractable HMAC-SHA256 key (sign, verify) derived with HKDF-SHA256 from `SELUNA_SECRET`, salt and info the purpose's label; `undefined` when `SELUNA_SECRET` is not configured. */
export async function signingKeyFromEnv(env: object, purpose: SigningPurpose): Promise<CryptoKey | undefined> {
  const secret = selunaSecretFromEnv(env);
  if (secret === undefined) {
    return undefined;
  }
  const label = utf8(SIGNING_KEY_LABELS[purpose]);
  const material = await crypto.subtle.importKey("raw", utf8(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: label, info: label },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** Whether the UTF-8 bytes of `candidate` equal those of `SELUNA_SECRET`, compared in constant time (HMAC under a fresh random key, `crypto.subtle.verify`); `false` when `SELUNA_SECRET` is not configured. */
export async function verifySelunaSecret(env: object, candidate: string): Promise<boolean> {
  const secret = selunaSecretFromEnv(env);
  if (secret === undefined) {
    return false;
  }
  // Both values are reduced to 32-byte MACs under a key nobody knows; `verify` compares those in constant time.
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(HMAC_KEY_BYTES)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, utf8(secret));
  return crypto.subtle.verify("HMAC", key, mac, utf8(candidate));
}
