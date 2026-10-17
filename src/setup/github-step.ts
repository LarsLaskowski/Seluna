import type { GitHubFetch } from "../github/conversion";
import type { AccountChoice } from "../github/manifest";

export const GITHUB_STEP_PATH = "/setup/github";
export const GITHUB_CALLBACK_PATH = "/setup/github/callback";
export const ACCOUNT_TYPE_FIELD = "account_type";
export const ACCOUNT_FIELD = "account";
export const GITHUB_CODE_FIELD = "code";
export const GITHUB_STATE_FIELD = "state";

export type GitHubStepView =
  | { readonly kind: "worker-secrets" }
  | { readonly kind: "partial-worker-secrets" }
  | { readonly kind: "reset-needed" }
  | { readonly kind: "form"; readonly savedAppId: number | undefined };

/** What the GitHub App step page shows. D1 errors are not caught. */
export async function gitHubStepView(_env: object, _db: D1Database, _storageKey: CryptoKey): Promise<GitHubStepView> {
  throw new Error("Not implemented");
}

export type StartGitHubResult =
  | {
      readonly kind: "review";
      readonly choice: AccountChoice;
      readonly appName: string;
      readonly formAction: string;
      readonly manifest: string;
    }
  | { readonly kind: "worker-secrets" }
  | { readonly kind: "partial-worker-secrets" }
  | { readonly kind: "invalid-account" }
  | { readonly kind: "reset-needed" };

/** Starts the manifest flow for the chosen account. D1 errors are not caught. */
export async function startGitHubApp(
  _env: object,
  _db: D1Database,
  _storageKey: CryptoKey,
  _stateKey: CryptoKey,
  _session: string,
  _origin: string,
  _typeFields: readonly string[],
  _accountFields: readonly string[],
  _now: Date,
): Promise<StartGitHubResult> {
  throw new Error("Not implemented");
}

/** The one code and one state of the return when both pass their allow-lists, else `undefined`. */
export function returnFields(
  _codeFields: readonly string[],
  _stateFields: readonly string[],
): { readonly code: string; readonly state: string } | undefined {
  throw new Error("Not implemented");
}

export type FinishGitHubResult =
  | { readonly kind: "created"; readonly slug: string | undefined }
  | { readonly kind: "state-invalid" }
  | { readonly kind: "worker-secrets" }
  | { readonly kind: "partial-worker-secrets" }
  | { readonly kind: "return-invalid" }
  | { readonly kind: "reset-needed" }
  | { readonly kind: "code-rejected" }
  | { readonly kind: "github-unavailable"; readonly code: string; readonly state: string }
  | { readonly kind: "answer-invalid" }
  | { readonly kind: "owner-mismatch" }
  | { readonly kind: "store-failed" };

/** Finishes the flow: exchanges the code and stores the credentials. D1 errors before the conversion are not caught; after it every failure is `store-failed`. */
export async function finishGitHubApp(
  _env: object,
  _db: D1Database,
  _storageKey: CryptoKey,
  _stateKey: CryptoKey,
  _session: string,
  _fetcher: GitHubFetch,
  _version: string,
  _codeFields: readonly string[],
  _stateFields: readonly string[],
  _now: Date,
): Promise<FinishGitHubResult> {
  throw new Error("Not implemented");
}
