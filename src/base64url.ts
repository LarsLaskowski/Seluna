/** Base64url (RFC 4648 §5) of `bytes`, without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  throw new Error("Not implemented");
}

/** The bytes of base64url text without padding in its canonical form, or `undefined` for any other text (padding, `+`, `/`, whitespace, a length of 4n+1, a last character with non-zero unused bits). */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  throw new Error("Not implemented");
}
