import { decodeStoredNotification, encodeStoredNotification } from "../notification";
import type { StoredNotification } from "../notification";

/** A row to be stored: the notification is written to `outbox.text` as JSON. */
export interface NewOutboxRow {
  readonly notification: StoredNotification;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}

/** `INSERT … RETURNING id`, for a batch. */
export function outboxInsert(db: D1Database, row: NewOutboxRow, createdAt: Date): D1PreparedStatement {
  return db
    .prepare("INSERT INTO outbox (text, button_url, silent, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id")
    .bind(encodeStoredNotification(row.notification), row.buttonUrl ?? null, row.silent ? 1 : 0, createdAt.getTime());
}

/** Marks a pending row sent and counts the attempt. D1 errors are not caught. */
export async function markSent(db: D1Database, id: number): Promise<void> {
  await db
    .prepare("UPDATE outbox SET status = 'sent', attempts = attempts + 1 WHERE id = ?1 AND status = 'pending'")
    .bind(id)
    .run();
}

/** Attempts after which a pending row is marked `failed`. */
export const MAX_ATTEMPTS = 5;

/** A stored row that is sent or still to be sent. */
export interface OutboxRow {
  readonly id: number;
  /** The stored text; `""` for a damaged row whose `text` is not a string. */
  readonly text: string;
  /** The decoded notification of a new-form row, `"damaged"` for an undecodable one; absent for an old-form row. */
  readonly notification?: StoredNotification | "damaged";
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}

/** The status of a row after an attempt was counted; `unchanged` when no pending row had the id. */
export type AttemptOutcome = "pending" | "failed" | "unchanged";

/** Counts an attempt of a pending row; the fifth marks it `failed`. D1 errors are not caught. */
export async function markAttempted(db: D1Database, id: number): Promise<AttemptOutcome> {
  const row: unknown = await db
    .prepare(
      "UPDATE outbox SET attempts = attempts + 1, " +
        "status = CASE WHEN attempts + 1 >= ?2 THEN 'failed' ELSE 'pending' END " +
        "WHERE id = ?1 AND status = 'pending' RETURNING status",
    )
    .bind(id, MAX_ATTEMPTS)
    .first();
  if (typeof row !== "object" || row === null || !("status" in row)) {
    return "unchanged";
  }
  return row.status === "failed" ? "failed" : "pending";
}

/** Marks at most `limit` pending rows with `MAX_ATTEMPTS` attempts `failed`, oldest first; the ids. D1 errors reject. */
export async function failExhaustedRows(db: D1Database, limit: number): Promise<readonly number[]> {
  const result = await db
    .prepare(
      "UPDATE outbox SET status = 'failed' WHERE id IN (" +
        "SELECT id FROM outbox WHERE status = 'pending' AND attempts >= ?1 ORDER BY created_at, id LIMIT ?2) " +
        "RETURNING id, created_at",
    )
    .bind(MAX_ATTEMPTS, limit)
    .all();
  const failed: { readonly id: number; readonly createdAt: number }[] = [];
  for (const row of result.results) {
    const { id, created_at: createdAt } = row;
    if (typeof id !== "number" || typeof createdAt !== "number") {
      throw new TypeError("The outbox update returned no id");
    }
    failed.push({ id, createdAt });
  }
  // RETURNING does not promise an order.
  failed.sort((left, right) => left.createdAt - right.createdAt || left.id - right.id);
  return failed.map(({ id }) => id);
}

/** At most `limit` pending rows under `MAX_ATTEMPTS` attempts written before `writtenBefore`, oldest first. D1 errors reject. */
export async function readDueRows(db: D1Database, writtenBefore: Date, limit: number): Promise<readonly OutboxRow[]> {
  const result = await db
    .prepare(
      "SELECT id, text, button_url, silent FROM outbox " +
        "WHERE status = 'pending' AND attempts < ?1 AND created_at < ?2 ORDER BY created_at, id LIMIT ?3",
    )
    .bind(MAX_ATTEMPTS, writtenBefore.getTime(), limit)
    .all();
  return result.results.map((row) => {
    const { id, text, button_url: buttonUrl, silent } = row;
    if (typeof id !== "number" || (buttonUrl !== null && typeof buttonUrl !== "string") || typeof silent !== "number") {
      throw new TypeError("The outbox row has an unexpected shape");
    }
    const common = { id, buttonUrl: buttonUrl ?? undefined, silent: silent === 1 };
    if (typeof text !== "string") {
      return { ...common, text: "", notification: "damaged" as const };
    }
    if (text.startsWith("{")) {
      return { ...common, text, notification: decodeStoredNotification(text) ?? ("damaged" as const) };
    }
    return { ...common, text };
  });
}

/** The bounded delete of `sent` and `failed` rows written before `writtenBefore`, for a batch. */
export function finishedRowsDelete(db: D1Database, writtenBefore: Date, limit: number): D1PreparedStatement {
  return db
    .prepare(
      "DELETE FROM outbox WHERE id IN (SELECT id FROM outbox WHERE status IN ('sent', 'failed') " +
        "AND created_at < ?1 ORDER BY created_at, id LIMIT ?2)",
    )
    .bind(writtenBefore.getTime(), limit);
}
