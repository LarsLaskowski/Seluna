import type { WebhookPayload } from "../src/rules/rule";

/** Marks a field to be removed by {@link variant}. */
export const ABSENT: unique symbol = Symbol("absent");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replaced(node: unknown, path: readonly string[], value: unknown): unknown {
  const [key, ...rest] = path;
  if (key === undefined) {
    return value;
  }
  const record = isRecord(node) ? node : {};
  if (rest.length === 0 && value === ABSENT) {
    return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
  }
  return { ...record, [key]: replaced(record[key], rest, value) };
}

/** A copy of `payload` with the field at `path` set to `value`, or removed when `value` is {@link ABSENT}. */
export function variant(payload: WebhookPayload, path: readonly string[], value: unknown): WebhookPayload {
  const result = replaced(payload, path, value);
  return isRecord(result) ? result : {};
}
