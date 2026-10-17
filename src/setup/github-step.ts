import { convertManifestCode, isAppOwner, isManifestCode } from "../github/conversion";
import type { ConvertedApp, GitHubFetch } from "../github/conversion";
import { appManifest, appName, isAccountName, manifestFormAction, parseAccountType } from "../github/manifest";
import type { AccountChoice } from "../github/manifest";
import { toPkcs8Pem } from "../github/private-key";
import { workerCredentials } from "../github/worker-secrets";
import { checkKey, readSecret, writeSecrets } from "../store/secrets";
import { createGitHubState, isWellFormedGitHubState, verifyGitHubState } from "./github-state";

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
export async function gitHubStepView(env: object, db: D1Database, storageKey: CryptoKey): Promise<GitHubStepView> {
  const credentials = workerCredentials(env);
  if (credentials === "all") {
    return { kind: "worker-secrets" };
  }
  if (credentials === "partial") {
    return { kind: "partial-worker-secrets" };
  }
  const stored = await readSecret(db, storageKey, "github_app_id");
  switch (stored.kind) {
    case "ok": {
      // A stored value that is not an App ID is shown as no saved app.
      const appId = /^[1-9]\d{0,15}$/.test(stored.value) ? Number(stored.value) : undefined;
      return { kind: "form", savedAppId: appId !== undefined && Number.isSafeInteger(appId) ? appId : undefined };
    }
    case "missing":
      return { kind: "form", savedAppId: undefined };
    case "secret-changed":
    case "corrupt":
      return { kind: "reset-needed" };
    default: {
      const unreachable: never = stored;
      return unreachable;
    }
  }
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
  env: object,
  db: D1Database,
  storageKey: CryptoKey,
  stateKey: CryptoKey,
  session: string,
  origin: string,
  typeFields: readonly string[],
  accountFields: readonly string[],
  now: Date,
): Promise<StartGitHubResult> {
  const credentials = workerCredentials(env);
  if (credentials === "all") {
    return { kind: "worker-secrets" };
  }
  if (credentials === "partial") {
    return { kind: "partial-worker-secrets" };
  }
  const [typeField] = typeFields;
  const [account] = accountFields;
  const type = typeFields.length === 1 && typeField !== undefined ? parseAccountType(typeField) : undefined;
  if (type === undefined || accountFields.length !== 1 || account === undefined || !isAccountName(account)) {
    return { kind: "invalid-account" };
  }
  const check = await checkKey(db, storageKey);
  if (check === "changed" || check === "corrupt") {
    return { kind: "reset-needed" };
  }
  const choice: AccountChoice = { type, account };
  const state = await createGitHubState(stateKey, session, choice, now);
  return {
    kind: "review",
    choice,
    appName: appName(account),
    formAction: manifestFormAction(type, account, state),
    manifest: JSON.stringify(appManifest(origin, account)),
  };
}

/** The one code and one state of the return when both pass their allow-lists, else `undefined`. */
export function returnFields(
  codeFields: readonly string[],
  stateFields: readonly string[],
): { readonly code: string; readonly state: string } | undefined {
  const [code] = codeFields;
  const [state] = stateFields;
  if (
    codeFields.length !== 1 ||
    stateFields.length !== 1 ||
    code === undefined ||
    state === undefined ||
    !isManifestCode(code) ||
    !isWellFormedGitHubState(state)
  ) {
    return undefined;
  }
  return { code, state };
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
  env: object,
  db: D1Database,
  storageKey: CryptoKey,
  stateKey: CryptoKey,
  session: string,
  fetcher: GitHubFetch,
  version: string,
  codeFields: readonly string[],
  stateFields: readonly string[],
  now: Date,
): Promise<FinishGitHubResult> {
  const [state] = stateFields;
  const choice =
    stateFields.length === 1 && state !== undefined
      ? await verifyGitHubState(stateKey, state, session, now)
      : undefined;
  if (choice === undefined || state === undefined) {
    return { kind: "state-invalid" };
  }
  const credentials = workerCredentials(env);
  if (credentials === "all") {
    return { kind: "worker-secrets" };
  }
  if (credentials === "partial") {
    return { kind: "partial-worker-secrets" };
  }
  const [code] = codeFields;
  if (codeFields.length !== 1 || code === undefined || !isManifestCode(code)) {
    return { kind: "return-invalid" };
  }
  const check = await checkKey(db, storageKey);
  if (check === "changed" || check === "corrupt") {
    return { kind: "reset-needed" };
  }
  const converted = await convertManifestCode(code, version, fetcher);
  switch (converted.kind) {
    case "rejected":
      return { kind: "code-rejected" };
    case "unavailable":
      return { kind: "github-unavailable", code, state };
    case "malformed":
      return { kind: "answer-invalid" };
    case "converted":
      return storeApp(db, storageKey, converted.app, choice);
    default: {
      const unreachable: never = converted;
      return unreachable;
    }
  }
}

/** Checks the owner, converts the key and stores the three credentials; every failure is a result. */
async function storeApp(
  db: D1Database,
  storageKey: CryptoKey,
  app: ConvertedApp,
  choice: AccountChoice,
): Promise<FinishGitHubResult> {
  if (!isAppOwner(app.owner, choice)) {
    return { kind: "owner-mismatch" };
  }
  const privateKey = await toPkcs8Pem(app.pem);
  if (privateKey === undefined) {
    return { kind: "answer-invalid" };
  }
  try {
    const written = await writeSecrets(db, storageKey, {
      github_app_id: String(app.appId),
      github_private_key: privateKey,
      github_webhook_secret: app.webhookSecret,
    });
    return written.kind === "ok" ? { kind: "created", slug: app.slug } : { kind: "store-failed" };
  } catch {
    // The error is deliberately dropped: it must reach neither the log nor the response.
    return { kind: "store-failed" };
  }
}
