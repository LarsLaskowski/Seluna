import { readCachedToken, writeCachedToken } from "../store/token-cache";
import { appJwt } from "./app-jwt";
import type { AppCredentials } from "./app-credentials";
import type { GitHubFetch } from "./conversion";
import { gitHubRequest, sendGitHub } from "./http";
import { isInstallationTokenText } from "./token-text";

export { isInstallationTokenText };

export const TOKEN_RENEWAL_MARGIN_MS = 300_000;

export interface InstallationToken {
  readonly token: string;
  readonly expiresAt: number;
}

export interface IssuedToken {
  readonly token: string;
  readonly iv: string;
}

export interface TokenDeps {
  readonly db: D1Database;
  readonly storageKey: CryptoKey;
  readonly fetcher: GitHubFetch;
  readonly now: () => Date;
  readonly version: string;
}

const EXPIRES_AT_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** The narrowed token answer of GitHub, or `undefined` when it has another shape or expires too soon. */
export function parseInstallationToken(body: unknown, now: Date): InstallationToken | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const { token, expires_at: expiresAtText } = body as Record<string, unknown>; // checked to be an object above
  if (typeof token !== "string" || !isInstallationTokenText(token)) {
    return undefined;
  }
  if (typeof expiresAtText !== "string" || !EXPIRES_AT_FORM.test(expiresAtText)) {
    return undefined;
  }
  const expiresAt = Date.parse(expiresAtText);
  return Number.isFinite(expiresAt) && expiresAt - now.getTime() > TOKEN_RENEWAL_MARGIN_MS
    ? { token, expiresAt }
    : undefined;
}

/** A valid installation token, cached or newly requested. D1 errors reject; any other failure is `undefined`. */
export async function installationToken(
  deps: TokenDeps,
  credentials: AppCredentials,
  installationId: number,
): Promise<IssuedToken | undefined> {
  const now = deps.now();
  const cached = await readCachedToken(deps.db, deps.storageKey, installationId);
  if (cached !== undefined && cached.expiresAt - now.getTime() > TOKEN_RENEWAL_MARGIN_MS) {
    return { token: cached.token, iv: cached.iv };
  }
  const jwt = await appJwt(credentials.signingKey, credentials.appId, now);
  const request = gitHubRequest(
    "POST",
    `/app/installations/${String(installationId)}/access_tokens`,
    deps.version,
    jwt,
  );
  const reply = await sendGitHub(deps.fetcher, request);
  const issued = reply.kind === "ok" ? parseInstallationToken(reply.body, now) : undefined;
  if (issued === undefined) {
    return undefined;
  }
  const iv = await writeCachedToken(deps.db, deps.storageKey, installationId, issued.token, issued.expiresAt);
  return { token: issued.token, iv };
}
