import type { AppCredentials } from "./app-credentials";
import type { GitHubFetch } from "./conversion";

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

/** Whether `text` has the form of an installation token (`^[A-Za-z0-9_]{1,255}$`). */
export function isInstallationTokenText(text: string): boolean {
  void text;
  throw new Error("Not implemented");
}

/** The narrowed token answer of GitHub, or `undefined` when it has another shape or expires too soon. */
export function parseInstallationToken(body: unknown, now: Date): InstallationToken | undefined {
  void [body, now];
  throw new Error("Not implemented");
}

/** A valid installation token, cached or newly requested. D1 errors reject; any other failure is `undefined`. */
export async function installationToken(
  deps: TokenDeps,
  credentials: AppCredentials,
  installationId: number,
): Promise<IssuedToken | undefined> {
  await Promise.resolve([deps, credentials, installationId]);
  throw new Error("Not implemented");
}
