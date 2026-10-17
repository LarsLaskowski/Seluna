import { fromBase64Url, toBase64Url } from "../base64url";
import type { AccountChoice } from "../github/manifest";

export const GITHUB_STATE_LIFETIME_MS = 3_600_000;
export const MAX_GITHUB_STATE_CHARACTERS = 139;

const NONCE_BYTES = 16;
const STATE_FORM =
  /^v1\.(personal|organization)\.([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\.([1-9]\d{0,14})\.([\w-]{22})\.([\w-]{43})$/;

function macText(choice: AccountChoice, expires: string, nonce: string, session: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    new TextEncoder().encode(`github-state.v1.${choice.type}.${choice.account}.${expires}.${nonce}.${session}`),
  );
}

/** The signed state `v1.<type>.<account>.<expires>.<nonce>.<mac>`; `choice.account` must already pass `isAccountName`. */
export async function createGitHubState(
  key: CryptoKey,
  session: string,
  choice: AccountChoice,
  now: Date,
): Promise<string> {
  const expires = String(now.getTime() + GITHUB_STATE_LIFETIME_MS);
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
  const mac = await crypto.subtle.sign("HMAC", key, macText(choice, expires, nonce, session));
  return `v1.${choice.type}.${choice.account}.${expires}.${nonce}.${toBase64Url(new Uint8Array(mac))}`;
}

/** Whether `state` has exactly the form of a state, without checking its MAC or expiry. */
export function isWellFormedGitHubState(state: string): boolean {
  return state.length <= MAX_GITHUB_STATE_CHARACTERS && STATE_FORM.test(state);
}

/** The account choice the state was issued for, when it is valid for this session now; else `undefined`. Never throws. */
export async function verifyGitHubState(
  key: CryptoKey,
  state: string,
  session: string,
  now: Date,
): Promise<AccountChoice | undefined> {
  const match = isWellFormedGitHubState(state) ? STATE_FORM.exec(state) : null;
  const type = match?.[1];
  const account = match?.[2];
  const expiresText = match?.[3];
  const nonce = match?.[4];
  const macPart = match?.[5];
  if (
    (type !== "personal" && type !== "organization") ||
    account === undefined ||
    expiresText === undefined ||
    nonce === undefined ||
    macPart === undefined
  ) {
    return undefined;
  }
  const expires = Number(expiresText);
  const mac = fromBase64Url(macPart);
  if (
    mac === undefined ||
    fromBase64Url(nonce) === undefined ||
    expires <= now.getTime() ||
    expires > now.getTime() + GITHUB_STATE_LIFETIME_MS
  ) {
    return undefined;
  }
  const choice: AccountChoice = { type, account };
  try {
    const verified = await crypto.subtle.verify("HMAC", key, mac, macText(choice, expiresText, nonce, session));
    return verified ? choice : undefined;
  } catch {
    return undefined;
  }
}
