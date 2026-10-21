export interface NewOutboxRow {
  readonly text: string;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}

/** `INSERT … RETURNING id`, for a batch. */
export function outboxInsert(db: D1Database, row: NewOutboxRow, createdAt: Date): D1PreparedStatement {
  return db
    .prepare("INSERT INTO outbox (text, button_url, silent, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id")
    .bind(row.text, row.buttonUrl ?? null, row.silent ? 1 : 0, createdAt.getTime());
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
  readonly text: string;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}

/** The status of a row after an attempt was counted; `unchanged` when no pending row had the id. */
export type AttemptOutcome = "pending" | "failed" | "unchanged";

/** Counts an attempt of a pending row; the fifth marks it `failed`. D1 errors are not caught. */
export function markAttempted(db: D1Database, id: number): Promise<AttemptOutcome> {
  return Promise.reject(new Error("Not implemented"));
}

/** Marks at most `limit` pending rows with `MAX_ATTEMPTS` attempts `failed`, oldest first; the ids. D1 errors reject. */
export function failExhaustedRows(db: D1Database, limit: number): Promise<readonly number[]> {
  return Promise.reject(new Error("Not implemented"));
}

/** At most `limit` pending rows under `MAX_ATTEMPTS` attempts written before `writtenBefore`, oldest first. D1 errors reject. */
export function readDueRows(db: D1Database, writtenBefore: Date, limit: number): Promise<readonly OutboxRow[]> {
  return Promise.reject(new Error("Not implemented"));
}

/** The bounded delete of `sent` and `failed` rows written before `writtenBefore`, for a batch. */
export function finishedRowsDelete(db: D1Database, writtenBefore: Date, limit: number): D1PreparedStatement {
  throw new Error("Not implemented");
}
