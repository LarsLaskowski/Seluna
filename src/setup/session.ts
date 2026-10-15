import { fromBase64Url, toBase64Url } from "../base64url";

export const SESSION_COOKIE = "seluna_session";
/** 12 hours. */
export const SESSION_LIFETIME_MS = 43_200_000;

const SESSION_FORM = /^v1\.(0|[1-9]\d{0,14})\.([\w-]{43})$/;

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

/** `v1.<expires>.<mac>` for a session that expires 12 hours after `now`; `key` from `signingKeyFromEnv(env, "setup-session")`. */
export async function createSessionToken(key: CryptoKey, now: Date): Promise<string> {
  const signed = `v1.${String(now.getTime() + SESSION_LIFETIME_MS)}`;
  const mac = await crypto.subtle.sign("HMAC", key, utf8(signed));
  return `${signed}.${toBase64Url(new Uint8Array(mac))}`;
}

/** Whether `token` has exactly the session form, its MAC verifies under `key`, and `now < expires <= now + 12 hours`. */
export async function isValidSessionToken(key: CryptoKey, token: string, now: Date): Promise<boolean> {
  const match = SESSION_FORM.exec(token);
  const expiresText = match?.[1];
  const macText = match?.[2];
  if (expiresText === undefined || macText === undefined) {
    return false;
  }
  const expires = Number(expiresText);
  const mac = fromBase64Url(macText);
  if (mac === undefined || expires <= now.getTime() || expires > now.getTime() + SESSION_LIFETIME_MS) {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, mac, utf8(`v1.${expiresText}`));
}
