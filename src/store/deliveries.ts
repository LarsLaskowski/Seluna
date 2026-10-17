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
  void [db, id];
  return Promise.reject(new Error("Not implemented"));
}

/** One batch: the delivery, one outbox row per message, `last_delivery`. D1 errors other than a known id reject. */
export async function recordDelivery(
  db: D1Database,
  delivery: NewDelivery,
  messages: readonly NewOutboxRow[],
): Promise<RecordDeliveryResult> {
  void [db, delivery, messages];
  return Promise.reject(new Error("Not implemented"));
}
