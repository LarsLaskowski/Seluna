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

/** Counts an attempt of a pending row, which stays pending. D1 errors are not caught. */
export async function markAttempted(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE outbox SET attempts = attempts + 1 WHERE id = ?1 AND status = 'pending'").bind(id).run();
}
