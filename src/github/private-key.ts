import { MAX_PEM_CHARACTERS } from "./conversion";

const PEM_FORM =
  /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\r?\n((?:[A-Za-z0-9+/=]+\r?\n)+)-----END \1-----(?:\r?\n)?$/;
const LINE_BREAKS = /\r?\n/g;
const PEM_LINE_CHARACTERS = 64;
const SIGNING_ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
/** DER of `INTEGER 0` and the AlgorithmIdentifier `rsaEncryption` with `NULL` parameters, then the `OCTET STRING` tag. */
const PKCS8_PREFIX = [
  0x02, 0x01, 0x00, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
];
const DER_SEQUENCE = 0x30;
const DER_OCTET_STRING = 0x04;
const DER_LONG_FORM = 0x80;
const BYTE_BITS = 8;

function derLength(length: number): number[] {
  if (length < DER_LONG_FORM) {
    return [length];
  }
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 2 ** BYTE_BITS)) {
    bytes.unshift(rest % 2 ** BYTE_BITS);
  }
  return [DER_LONG_FORM | bytes.length, ...bytes];
}

function derElement(tag: number, content: readonly number[]): number[] {
  return [tag, ...derLength(content.length), ...content];
}

/** The DER of a PKCS#8 `PrivateKeyInfo` that carries the PKCS#1 `RSAPrivateKey` `pkcs1`. */
function wrapPkcs1(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const info = [...PKCS8_PREFIX, ...derElement(DER_OCTET_STRING, Array.from(pkcs1))];
  return new Uint8Array(derElement(DER_SEQUENCE, info));
}

/** The bytes of canonical standard base64, or `undefined` for any other text. */
function decodeCanonical(base64: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.codePointAt(index) ?? 0;
    }
    return btoa(binary) === base64 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function encodePem(der: Uint8Array): string {
  const base64 = btoa(Array.from(der, (byte) => String.fromCodePoint(byte)).join(""));
  const lines: string[] = [];
  for (let offset = 0; offset < base64.length; offset += PEM_LINE_CHARACTERS) {
    lines.push(base64.slice(offset, offset + PEM_LINE_CHARACTERS));
  }
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** The PKCS#8 PEM of an RSA key given as PKCS#1 or PKCS#8 PEM, or `undefined` unless it imports as an RS256 signing key. Never throws. */
export async function toPkcs8Pem(pem: string): Promise<string | undefined> {
  const match = pem.length <= MAX_PEM_CHARACTERS ? PEM_FORM.exec(pem) : null;
  const armour = match?.[1];
  const body = match?.[2];
  if (armour === undefined || body === undefined) {
    return undefined;
  }
  const der = decodeCanonical(body.replaceAll(LINE_BREAKS, ""));
  if (der === undefined || der.length === 0) {
    return undefined;
  }
  const pkcs8 = armour === "RSA PRIVATE KEY" ? wrapPkcs1(der) : der;
  try {
    await crypto.subtle.importKey("pkcs8", pkcs8, SIGNING_ALGORITHM, false, ["sign"]);
  } catch {
    // A key the runtime refuses is reported as undefined; the cause is dropped.
    return undefined;
  }
  return encodePem(pkcs8);
}
