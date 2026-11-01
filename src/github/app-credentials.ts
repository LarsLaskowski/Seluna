import { keyFromEnv } from "../crypto";
import { readAppOwner } from "../store/meta";
import { readSecret } from "../store/secrets";
import type { SecretName, SecretReadResult } from "../store/secrets";
import type { OwnerAccount } from "./owner";
import { importSigningKey } from "./private-key";
import { APP_ID_SECRET_NAME, PRIVATE_KEY_SECRET_NAME } from "./worker-secrets";

export interface AppCredentials {
  readonly appId: number;
  readonly signingKey: CryptoKey;
}

export type AppCredentialsResult =
  | { readonly kind: "ok"; readonly credentials: AppCredentials }
  | { readonly kind: "no-app" }
  | { readonly kind: "key-unusable" };

const APP_ID_FORM = /^[1-9]\d{0,15}$/;

/** The App ID `text` spells (`^[1-9]\d{0,15}$`, a safe integer), or `undefined`. */
export function parseAppId(text: string): number | undefined {
  if (!APP_ID_FORM.test(text)) {
    return undefined;
  }
  const appId = Number(text);
  return Number.isSafeInteger(appId) ? appId : undefined;
}

/** The Worker secret `name` when it is a non-empty string. */
function workerSecret(env: object, name: string): string | undefined {
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The saved credential `name`, or `missing` when it cannot be read at all (no usable `SELUNA_SECRET`, none saved). */
async function savedSecret(env: object, db: D1Database, name: SecretName): Promise<SecretReadResult> {
  const storageKey = await keyFromEnv(env);
  return storageKey === undefined ? { kind: "missing" } : readSecret(db, storageKey, name);
}

/**
 * The App ID from the Worker secret or the saved credential, or `undefined` without a usable one.
 * D1 errors reject.
 */
export async function resolveAppId(env: object, db: D1Database): Promise<number | undefined> {
  let appIdText = workerSecret(env, APP_ID_SECRET_NAME);
  if (appIdText === undefined) {
    const stored = await savedSecret(env, db, "github_app_id");
    appIdText = stored.kind === "ok" ? stored.value : undefined;
  }
  return appIdText === undefined ? undefined : parseAppId(appIdText);
}

/** The App ID and signing key from the Worker secrets or the saved credentials. D1 errors reject. */
export async function resolveAppCredentials(env: object, db: D1Database): Promise<AppCredentialsResult> {
  const appId = await resolveAppId(env, db);
  if (appId === undefined) {
    return { kind: "no-app" };
  }
  let pem = workerSecret(env, PRIVATE_KEY_SECRET_NAME);
  if (pem === undefined) {
    const stored = await savedSecret(env, db, "github_private_key");
    switch (stored.kind) {
      case "ok":
        pem = stored.value;
        break;
      case "missing":
        return { kind: "no-app" };
      case "secret-changed":
      case "corrupt":
        return { kind: "key-unusable" };
      default: {
        const unreachable: never = stored;
        return unreachable;
      }
    }
  }
  const signingKey = await importSigningKey(pem);
  return signingKey === undefined ? { kind: "key-unusable" } : { kind: "ok", credentials: { appId, signingKey } };
}

/** The stored owner of the App `resolveAppId` names, or `undefined` without an App ID or a valid row. D1 errors reject. */
export async function resolveAppOwner(env: object, db: D1Database): Promise<OwnerAccount | undefined> {
  const appId = await resolveAppId(env, db);
  return appId === undefined ? undefined : readAppOwner(db, appId);
}
