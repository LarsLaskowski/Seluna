import { toBase64Url } from "../base64url";

export const JWT_BACKDATE_SECONDS = 60;
export const JWT_LIFETIME_SECONDS = 600;

const HEADER = '{"alg":"RS256","typ":"JWT"}';
const MILLISECONDS = 1000;

function encodeText(text: string): string {
  return toBase64Url(new TextEncoder().encode(text));
}

/** The RS256 JWT that authenticates as the GitHub App `appId`, signed with `signingKey`, valid around `now`. */
export async function appJwt(signingKey: CryptoKey, appId: number, now: Date): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / MILLISECONDS) - JWT_BACKDATE_SECONDS;
  // The lifetime counts from `iat`: 600 s after the backdated issue time is 540 s after now.
  const claims = JSON.stringify({ iat: issuedAt, exp: issuedAt + JWT_LIFETIME_SECONDS, iss: appId });
  const signingInput = `${encodeText(HEADER)}.${encodeText(claims)}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}
