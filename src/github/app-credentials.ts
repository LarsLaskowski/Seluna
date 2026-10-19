export interface AppCredentials {
  readonly appId: number;
  readonly signingKey: CryptoKey;
}

export type AppCredentialsResult =
  | { readonly kind: "ok"; readonly credentials: AppCredentials }
  | { readonly kind: "no-app" }
  | { readonly kind: "key-unusable" };

/** The App ID `text` spells (`^[1-9]\d{0,15}$`, a safe integer), or `undefined`. */
export function parseAppId(text: string): number | undefined {
  void text;
  throw new Error("Not implemented");
}

/** The App ID and signing key from the Worker secrets or the saved credentials. D1 errors reject. */
export async function resolveAppCredentials(env: object, db: D1Database): Promise<AppCredentialsResult> {
  await Promise.resolve([env, db]);
  throw new Error("Not implemented");
}
