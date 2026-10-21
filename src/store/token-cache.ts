import { decrypt, encrypt } from "../crypto";
import { isInstallationTokenText } from "../github/token-text";

export interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
  readonly iv: string;
}

const SELECT_TOKEN = "SELECT iv, ciphertext, expires_at FROM token_cache WHERE installation_id = ?1";
const UPSERT_TOKEN =
  "INSERT INTO token_cache (installation_id, iv, ciphertext, expires_at) VALUES (?1, ?2, ?3, ?4) " +
  "ON CONFLICT (installation_id) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, " +
  "expires_at = excluded.expires_at";
const DELETE_TOKEN = "DELETE FROM token_cache WHERE installation_id = ?1 AND iv = ?2";

/** The additional data a row is bound to (the storage contract of `token_cache`). */
function tokenContext(installationId: number, expiresAt: number): string {
  return `token_cache/${String(installationId)}/${String(expiresAt)}`;
}

/** The cached installation token of `installationId`, or `undefined` when none is stored or it does not decrypt. */
export async function readCachedToken(
  db: D1Database,
  key: CryptoKey,
  installationId: number,
): Promise<CachedToken | undefined> {
  const row: unknown = await db.prepare(SELECT_TOKEN).bind(installationId).first();
  if (typeof row !== "object" || row === null) {
    return undefined;
  }
  const { iv, ciphertext, expires_at: expiresAt } = row as Record<string, unknown>; // checked to be an object above
  if (
    typeof iv !== "string" ||
    typeof ciphertext !== "string" ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt)
  ) {
    return undefined;
  }
  const token = await decrypt(key, { iv, ciphertext }, tokenContext(installationId, expiresAt));
  return token !== undefined && isInstallationTokenText(token) ? { token, expiresAt, iv } : undefined;
}

/** Stores the encrypted token, replacing the row of `installationId`; resolves to the IV. */
export async function writeCachedToken(
  db: D1Database,
  key: CryptoKey,
  installationId: number,
  token: string,
  expiresAt: number,
): Promise<string> {
  const sealed = await encrypt(key, token, tokenContext(installationId, expiresAt));
  await db.prepare(UPSERT_TOKEN).bind(installationId, sealed.iv, sealed.ciphertext, expiresAt).run();
  return sealed.iv;
}

/** Deletes the row of `installationId` when its IV is still `iv`. */
export async function deleteCachedToken(db: D1Database, installationId: number, iv: string): Promise<void> {
  await db.prepare(DELETE_TOKEN).bind(installationId, iv).run();
}

/** The bounded delete of `token_cache` rows that expired before `expiredBefore`, for a batch. */
export function expiredTokensDelete(db: D1Database, expiredBefore: Date, limit: number): D1PreparedStatement {
  return db
    .prepare(
      "DELETE FROM token_cache WHERE installation_id IN (SELECT installation_id FROM token_cache " +
        "WHERE expires_at < ?1 ORDER BY expires_at, installation_id LIMIT ?2)",
    )
    .bind(expiredBefore.getTime(), limit);
}
