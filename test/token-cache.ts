import { decrypt, encrypt } from "../src/crypto";

/** A row of `token_cache` as stored. */
export interface TokenRow {
  readonly installationId: number;
  readonly iv: string;
  readonly ciphertext: string;
  readonly expiresAt: number;
}

/** The additional data the storage contract binds a `token_cache` row to: the token's permission list is part of it. */
export function tokenContext(installationId: number, expiresAt: number): string {
  return `${legacyTokenContext(installationId, expiresAt)}/metadata=read,pull_requests=read`;
}

/** The additional data of rows written before the permission list was bound (versions before this change). */
export function legacyTokenContext(installationId: number, expiresAt: number): string {
  return `token_cache/${String(installationId)}/${String(expiresAt)}`;
}

/** Stores `token` encrypted for `installationId` (bound to `additionalData`) without `src/store/token-cache.ts`; resolves to the row's IV. */
export async function seedCachedToken(
  db: D1Database,
  key: CryptoKey,
  installationId: number,
  token: string,
  expiresAt: number,
  additionalData: string = tokenContext(installationId, expiresAt),
): Promise<string> {
  const sealed = await encrypt(key, token, additionalData);
  await db
    .prepare(
      "INSERT INTO token_cache (installation_id, iv, ciphertext, expires_at) VALUES (?1, ?2, ?3, ?4) " +
        "ON CONFLICT (installation_id) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, expires_at = excluded.expires_at",
    )
    .bind(installationId, sealed.iv, sealed.ciphertext, expiresAt)
    .run();
  return sealed.iv;
}

function rowOf(row: Record<string, unknown>): TokenRow {
  const { installation_id: installationId, iv, ciphertext, expires_at: expiresAt } = row;
  if (
    typeof installationId !== "number" ||
    typeof iv !== "string" ||
    typeof ciphertext !== "string" ||
    typeof expiresAt !== "number"
  ) {
    throw new Error("A token_cache row has an unexpected shape");
  }
  return { installationId, iv, ciphertext, expiresAt };
}

/** Every row of `token_cache`, in installation id order. */
export async function tokenRows(db: D1Database): Promise<readonly TokenRow[]> {
  const result = await db.prepare("SELECT * FROM token_cache ORDER BY installation_id").all();
  return result.results.map(rowOf);
}

/** The row of `installationId`, or `undefined`. */
export async function tokenRowOf(db: D1Database, installationId: number): Promise<TokenRow | undefined> {
  return (await tokenRows(db)).find((row) => row.installationId === installationId);
}

/** The token a row holds, decrypted with exactly the additional data of the storage contract. */
export function tokenOfRow(key: CryptoKey, row: TokenRow): Promise<string | undefined> {
  return decrypt(key, { iv: row.iv, ciphertext: row.ciphertext }, tokenContext(row.installationId, row.expiresAt));
}
