export interface NewOutboxRow {
  readonly text: string;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}

/** `INSERT … RETURNING id`, for a batch. */
export function outboxInsert(db: D1Database, row: NewOutboxRow, createdAt: Date): D1PreparedStatement {
  void [db, row, createdAt];
  throw new Error("Not implemented");
}

/** Marks a pending row sent and counts the attempt. D1 errors are not caught. */
export async function markSent(db: D1Database, id: number): Promise<void> {
  void [db, id];
  return Promise.reject(new Error("Not implemented"));
}

/** Counts an attempt of a pending row, which stays pending. D1 errors are not caught. */
export async function markAttempted(db: D1Database, id: number): Promise<void> {
  void [db, id];
  return Promise.reject(new Error("Not implemented"));
}
