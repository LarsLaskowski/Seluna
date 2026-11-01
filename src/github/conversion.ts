import { readJsonWithLimit } from "../body";
import { isAccountName } from "./manifest";
import type { AccountChoice } from "./manifest";
import { parseOwnerAccount } from "./owner";
import type { OwnerAccount } from "./owner";

/** Sends one request to the GitHub API; injected so tests never reach the network. Same shape as `TelegramFetch`. */
export type GitHubFetch = (request: Request) => Promise<Response>;

export const GITHUB_API_ORIGIN = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const MAX_GITHUB_RESPONSE_BYTES = 1_048_576;
export const GITHUB_TIMEOUT_MS = 10_000;
export const MAX_PEM_CHARACTERS = 16_384;
export const MAX_WEBHOOK_SECRET_CHARACTERS = 1_024;
export const MAX_OWNER_LOGIN_CHARACTERS = 39;

const MANIFEST_CODE = /^[A-Za-z0-9_-]{1,100}$/;
const APP_SLUG = /^[a-z0-9-]{1,100}$/;

/** The answer's `owner`, narrowed but not yet checked. */
export interface AppOwner {
  readonly login: string;
  readonly type: string;
}

export interface ConvertedApp {
  readonly appId: number;
  readonly owner: AppOwner;
  /** The owner with its numeric id, parsed apart from `owner`; `undefined` when its id or shape is unusable. */
  readonly account: OwnerAccount | undefined;
  readonly slug: string | undefined;
  readonly pem: string;
  readonly webhookSecret: string;
}

export type ConversionResult =
  | { readonly kind: "converted"; readonly app: ConvertedApp }
  | { readonly kind: "rejected" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "malformed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `text` is a manifest code the conversion URL may carry. */
export function isManifestCode(text: string): boolean {
  return MANIFEST_CODE.test(text);
}

function parseOwner(value: unknown): AppOwner | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { login, type } = value;
  return typeof login === "string" && login.length <= MAX_OWNER_LOGIN_CHARACTERS && typeof type === "string"
    ? { login, type }
    : undefined;
}

/** The narrowed conversion answer, or `undefined` when it has another shape. */
export function parseConversion(body: unknown): ConvertedApp | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const { id, slug, pem, webhook_secret: webhookSecret } = body;
  const owner = parseOwner(body.owner);
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    owner === undefined ||
    typeof pem !== "string" ||
    pem.length > MAX_PEM_CHARACTERS ||
    typeof webhookSecret !== "string" ||
    webhookSecret === "" ||
    webhookSecret.length > MAX_WEBHOOK_SECRET_CHARACTERS
  ) {
    return undefined;
  }
  return {
    appId: id,
    owner,
    account: parseOwnerAccount(body.owner),
    slug: typeof slug === "string" && APP_SLUG.test(slug) ? slug : undefined,
    pem,
    webhookSecret,
  };
}

/** Whether the app belongs to the account the state was issued for: login (allow-listed) equal ignoring ASCII case, type `User`/`Organization`. */
export function isAppOwner(owner: AppOwner, choice: AccountChoice): boolean {
  if (!isAccountName(owner.login) || !isAccountName(choice.account)) {
    return false;
  }
  // Both names are ASCII after the allow-list, so lowercasing is an ASCII-only mapping.
  const sameLogin = owner.login.toLowerCase() === choice.account.toLowerCase();
  return sameLogin && owner.type === (choice.type === "personal" ? "User" : "Organization");
}

/** Exchanges the manifest code for the app's credentials with one request. Never throws. */
export async function convertManifestCode(
  code: string,
  version: string,
  fetcher: GitHubFetch,
): Promise<ConversionResult> {
  if (!isManifestCode(code)) {
    return { kind: "rejected" };
  }
  try {
    const request = new Request(`${GITHUB_API_ORIGIN}/app-manifests/${code}/conversions`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": `seluna/${version}`,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    const response = await fetcher(request);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return response.status === 404 || response.status === 422 ? { kind: "rejected" } : { kind: "unavailable" };
    }
    const app = parseConversion(await readJsonWithLimit(response, MAX_GITHUB_RESPONSE_BYTES));
    return app === undefined ? { kind: "malformed" } : { kind: "converted", app };
  } catch {
    // Network errors and aborts carry nothing the owner can use; the cause is dropped.
    return { kind: "unavailable" };
  }
}
