import type { WebhookPayload } from "../src/rules/rule";
import { ABSENT, variant } from "./pull-request";

/** A fake secret: matches no provider's secret pattern (so push protection stays quiet), 40 characters. */
export const SECRET = "SELUNA_TEST_k3Vq9ZtB7xWmP2dLr8NsHc4YfJ6a";

/** A field every security alert rule requires, set to a value that makes the delivery unusable. */
export interface MalformedField {
  readonly field: string;
  readonly label: string;
  readonly path: readonly string[];
  readonly value: unknown;
}

/** The identifying fields of E1 with the values AC8 names; the same for all three rules. */
export const MALFORMED_IDENTIFYING_FIELDS: readonly MalformedField[] = [
  { field: "alert", label: "missing", path: ["alert"], value: ABSENT },
  { field: "alert", label: "an array", path: ["alert"], value: [] },
  { field: "alert", label: "a string", path: ["alert"], value: "alert" },
  { field: "alert.number", label: "0", path: ["alert", "number"], value: 0 },
  { field: "alert.number", label: "-1", path: ["alert", "number"], value: -1 },
  { field: "alert.number", label: "1.5", path: ["alert", "number"], value: 1.5 },
  { field: "alert.number", label: "2^53", path: ["alert", "number"], value: 2 ** 53 },
  { field: "alert.number", label: "a string", path: ["alert", "number"], value: "7" },
  { field: "alert.number", label: "null", path: ["alert", "number"], value: null },
  { field: "alert.number", label: "missing", path: ["alert", "number"], value: ABSENT },
  { field: "alert.html_url", label: "missing", path: ["alert", "html_url"], value: ABSENT },
  { field: "alert.html_url", label: "a number", path: ["alert", "html_url"], value: 7 },
  { field: "repository", label: "missing", path: ["repository"], value: ABSENT },
  { field: "repository.full_name", label: "missing", path: ["repository", "full_name"], value: ABSENT },
  { field: "repository.full_name", label: "a number", path: ["repository", "full_name"], value: 7 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replaced(node: unknown, keep: readonly string[], replacement: string, path: readonly string[]): unknown {
  if (typeof node === "string") {
    return keep.includes(path.join(".")) ? node : replacement;
  }
  if (Array.isArray(node)) {
    return node.map((item, index): unknown => replaced(item, keep, replacement, [...path, String(index)]));
  }
  if (isRecord(node)) {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, replaced(value, keep, replacement, [...path, key])]),
    );
  }
  return node;
}

/**
 * A copy of `payload` in which every string value (at any depth, array items included) is `replacement`, except the
 * strings at the dotted paths in `keep`.
 */
export function replaceStringsOutside(
  payload: WebhookPayload,
  keep: readonly string[],
  replacement: string,
): WebhookPayload {
  const result = replaced(payload, keep, replacement, []);
  return isRecord(result) ? result : {};
}

/** The dotted paths of the five fields the secret scanning rule reads, and `action`. */
export const SECRET_SCANNING_READ_PATHS: readonly string[] = [
  "action",
  "alert.number",
  "alert.html_url",
  "alert.secret_type",
  "alert.secret_type_display_name",
  "repository.full_name",
];

/** A field change for {@link withFields}: the path and the new value (or {@link ABSENT}). */
export type FieldChange = readonly [path: readonly string[], value: unknown];

/** `payload` with every change applied in order. */
export function withFields(payload: WebhookPayload, changes: readonly FieldChange[]): WebhookPayload {
  return changes.reduce<WebhookPayload>((current, [path, value]) => variant(current, path, value), payload);
}
