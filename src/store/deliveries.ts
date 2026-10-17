import { lastDeliveryUpsert } from "./meta";
import { outboxInsert } from "./outbox";
import type { NewOutboxRow } from "./outbox";

export interface NewDelivery {
  readonly id: string;
  readonly event: string;
  readonly receivedAt: Date;
}

export type RecordDeliveryResult =
  { readonly kind: "recorded"; readonly outboxIds: readonly number[] } | { readonly kind: "duplicate" };

/** Whether a delivery with `id` is recorded. D1 errors are not caught. */
export async function isKnownDelivery(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS known FROM deliveries WHERE id = ?1").bind(id).first();
  return row !== null;
}

/** One batch: the delivery, one outbox row per message, `last_delivery`. D1 errors other than a known id reject. */
export async function recordDelivery(
  db: D1Database,
  delivery: NewDelivery,
  messages: readonly NewOutboxRow[],
): Promise<RecordDeliveryResult> {
  const insertDelivery = db
    .prepare("INSERT INTO deliveries (id, event, received_at) VALUES (?1, ?2, ?3)")
    .bind(delivery.id, delivery.event, delivery.receivedAt.getTime());
  const inserts = messages.map((message) => outboxInsert(db, message, delivery.receivedAt));
  let results: D1Result<Record<string, unknown>>[];
  try {
    results = await db.batch([insertDelivery, ...inserts, lastDeliveryUpsert(db, delivery.receivedAt)]);
  } catch (error) {
    // A plain insert conflicts on a known id and the whole batch rolls back; any other failure is rethrown.
    if (await isKnownDelivery(db, delivery.id)) {
      return { kind: "duplicate" };
    }
    throw error;
  }
  const outboxIds: number[] = [];
  for (const result of results.slice(1, 1 + messages.length)) {
    const id: unknown = result.results[0]?.id;
    if (typeof id !== "number") {
      throw new TypeError("The outbox insert returned no id");
    }
    outboxIds.push(id);
  }
  return { kind: "recorded", outboxIds };
}
