/** Header carrying GitHub's HMAC-SHA256 signature of the raw body. */
export const SIGNATURE_HEADER = "x-hub-signature-256";

const SIGNATURE_FORMAT = /^sha256=([0-9a-f]{64})$/;
const HMAC_SHA256 = { name: "HMAC", hash: "SHA-256" } as const;

/**
 * Whether `signatureHeader` is GitHub's `sha256=<64 lowercase hex digits>` HMAC-SHA256 of `body` under `secret`,
 * compared in constant time by `crypto.subtle.verify`. `false` for a missing or malformed header and for an
 * empty secret; never throws for those.
 */
export async function verifySignature(
  body: Uint8Array,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (secret === "" || signatureHeader === null) {
    return false;
  }
  const match = SIGNATURE_FORMAT.exec(signatureHeader);
  const hex = match?.[1];
  if (hex === undefined) {
    return false;
  }
  const digest = new Uint8Array(hex.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), HMAC_SHA256, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, digest, body);
}
