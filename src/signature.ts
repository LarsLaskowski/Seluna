/** Header carrying GitHub's HMAC-SHA256 signature of the raw body. */
export const SIGNATURE_HEADER = "x-hub-signature-256";

/**
 * Whether `signatureHeader` is GitHub's `sha256=<64 lowercase hex digits>` HMAC-SHA256 of `body` under `secret`,
 * compared in constant time by `crypto.subtle.verify`. `false` for a missing or malformed header and for an
 * empty secret; never throws for those.
 */
export function verifySignature(_body: Uint8Array, _signatureHeader: string | null, _secret: string): Promise<boolean> {
  // Skeleton: the implementation follows.
  return Promise.resolve(false);
}
