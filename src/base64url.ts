const BASE64URL_TEXT = /^[\w-]*$/;
const CHUNK = 0x2000;

/** Base64url (RFC 4648 §5) of `bytes`, without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** The bytes of base64url text without padding in its canonical form, or `undefined` for any other text (padding, `+`, `/`, whitespace, a length of 4n+1, a last character with non-zero unused bits). */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  // `atob` is forgiving (whitespace, `+`, `/`, padding, dropped low bits), so the text is checked first and the
  // decoded bytes are written back: only the canonical text of a byte string survives.
  if (!BASE64URL_TEXT.test(text) || text.length % 4 === 1) {
    return undefined;
  }
  const standard = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    // Always defined for an index inside `binary`; the fallback only narrows the type.
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return toBase64Url(bytes) === text ? bytes : undefined;
}
