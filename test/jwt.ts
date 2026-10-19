import { assert } from "vitest";
import { FIXTURE_PKCS8 } from "./github";

const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const BASE64URL_TEXT = /^[A-Za-z0-9_-]+$/;

/** The parts of a JWT, decoded independently of `src/`. */
export interface DecodedJwt {
  /** The decoded header text, exactly as signed. */
  readonly headerText: string;
  readonly header: unknown;
  readonly claims: unknown;
  /** `<header>.<claims>`, the text the signature covers. */
  readonly signingInput: string;
  readonly signature: Uint8Array<ArrayBuffer>;
}

function bytesOfBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const standard = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function textOfBase64Url(text: string): string {
  return new TextDecoder().decode(bytesOfBase64Url(text));
}

/** The decoded `token`, or `undefined` unless it is three base64url parts without padding whose first two are JSON. */
export function decodeJwt(token: string): DecodedJwt | undefined {
  const parts = token.split(".");
  const [header, claims, signature] = parts;
  if (
    parts.length !== 3 ||
    header === undefined ||
    claims === undefined ||
    signature === undefined ||
    !parts.every((part) => BASE64URL_TEXT.test(part))
  ) {
    return undefined;
  }
  const headerText = textOfBase64Url(header);
  return {
    headerText,
    header: JSON.parse(headerText),
    claims: JSON.parse(textOfBase64Url(claims)),
    signingInput: `${header}.${claims}`,
    signature: bytesOfBase64Url(signature),
  };
}

/** The token of an `Authorization: Bearer <token>` header, or `undefined` for another value. */
export function bearerOf(authorization: string | null): string | undefined {
  return authorization?.startsWith("Bearer ") === true ? authorization.slice("Bearer ".length) : undefined;
}

function derOfPem(pem: string): Uint8Array<ArrayBuffer> {
  return bytesOfBase64Url(
    pem
      .replaceAll(/-----[A-Z ]+-----|\s/g, "")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", ""),
  );
}

/** A non-extractable RS256 signing key of the documented key, imported without `src/`. */
export function fixtureSigningKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", derOfPem(FIXTURE_PKCS8), ALGORITHM, false, ["sign"]);
}

/** The public key of the documented key (derived from the JWK of an extractable import), for verifying. */
export async function fixturePublicKey(): Promise<CryptoKey> {
  const extractable = await crypto.subtle.importKey("pkcs8", derOfPem(FIXTURE_PKCS8), ALGORITHM, true, ["sign"]);
  const exported = await crypto.subtle.exportKey("jwk", extractable);
  assert.isFalse(exported instanceof ArrayBuffer, "the key is exported as a JWK");
  const { n, e } = exported instanceof ArrayBuffer ? {} : exported;
  assert.isDefined(n, "the exported JWK has a modulus");
  assert.isDefined(e, "the exported JWK has an exponent");
  return crypto.subtle.importKey("jwk", { kty: "RSA", n, e, alg: "RS256", ext: true }, ALGORITHM, false, ["verify"]);
}

/** Whether the signature of `jwt` verifies with the public key of the documented key. */
export async function jwtVerifies(jwt: DecodedJwt): Promise<boolean> {
  return crypto.subtle.verify(
    ALGORITHM,
    await fixturePublicKey(),
    jwt.signature,
    new TextEncoder().encode(jwt.signingInput),
  );
}
