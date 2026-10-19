export interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
  readonly iv: string;
}

/** The cached installation token of `installationId`, or `undefined` when none is stored or it does not decrypt. */
export async function readCachedToken(
  db: D1Database,
  key: CryptoKey,
  installationId: number,
): Promise<CachedToken | undefined> {
  await Promise.resolve([db, key, installationId]);
  throw new Error("Not implemented");
}

/** Stores the encrypted token, replacing the row of `installationId`; resolves to the IV. */
export async function writeCachedToken(
  db: D1Database,
  key: CryptoKey,
  installationId: number,
  token: string,
  expiresAt: number,
): Promise<string> {
  await Promise.resolve([db, key, installationId, token, expiresAt]);
  throw new Error("Not implemented");
}

/** Deletes the row of `installationId` when its IV is still `iv`. */
export async function deleteCachedToken(db: D1Database, installationId: number, iv: string): Promise<void> {
  await Promise.resolve([db, installationId, iv]);
  throw new Error("Not implemented");
}
