import type { AccountChoice } from "./manifest";

/** Sends one request to the GitHub API; injected so tests never reach the network. Same shape as `TelegramFetch`. */
export type GitHubFetch = (request: Request) => Promise<Response>;

export const GITHUB_API_ORIGIN = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const MAX_GITHUB_RESPONSE_BYTES = 1_048_576;
export const GITHUB_TIMEOUT_MS = 10_000;
export const MAX_PEM_CHARACTERS = 16_384;
export const MAX_WEBHOOK_SECRET_CHARACTERS = 1_024;
export const MAX_OWNER_LOGIN_CHARACTERS = 39;

/** The answer's `owner`, narrowed but not yet checked. */
export interface AppOwner {
  readonly login: string;
  readonly type: string;
}

export interface ConvertedApp {
  readonly appId: number;
  readonly owner: AppOwner;
  readonly slug: string | undefined;
  readonly pem: string;
  readonly webhookSecret: string;
}

export type ConversionResult =
  | { readonly kind: "converted"; readonly app: ConvertedApp }
  | { readonly kind: "rejected" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "malformed" };

/** Whether `text` is a manifest code the conversion URL may carry. */
export function isManifestCode(_text: string): boolean {
  throw new Error("Not implemented");
}

/** The narrowed conversion answer, or `undefined` when it has another shape. */
export function parseConversion(_body: unknown): ConvertedApp | undefined {
  throw new Error("Not implemented");
}

/** Whether the app belongs to the account the state was issued for: login (allow-listed) equal ignoring ASCII case, type `User`/`Organization`. */
export function isAppOwner(_owner: AppOwner, _choice: AccountChoice): boolean {
  throw new Error("Not implemented");
}

/** Exchanges the manifest code for the app's credentials with one request. Never throws. */
export async function convertManifestCode(
  _code: string,
  _version: string,
  _fetcher: GitHubFetch,
): Promise<ConversionResult> {
  throw new Error("Not implemented");
}
