import { isRecord, recordField, stringField } from "./pull-request";
import type { WebhookPayload } from "./rule";

/** The three security alert events. */
export type SecurityAlertEvent = "dependabot_alert" | "code_scanning_alert" | "secret_scanning_alert";

/** The fields every reported security alert delivery carries, narrowed. */
export interface SecurityAlertFields {
  /** `repository.full_name`. */
  readonly repository: string;
  /** `repository` itself, for event-specific fields such as `default_branch`. */
  readonly repositoryRecord: Readonly<Record<string, unknown>>;
  /** `alert.number`, a whole number from 1 to 2^53 - 1. */
  readonly number: number;
  /** `alert.html_url`. */
  readonly url: string;
  /** `alert` itself, for the event-specific fields. */
  readonly alert: Readonly<Record<string, unknown>>;
}

const CONTEXT_SEPARATOR = " · ";

/** The common fields of a delivery of `expected` whose `action` is in `actions`; otherwise `undefined`. */
export function securityAlert(
  event: string,
  payload: WebhookPayload,
  expected: SecurityAlertEvent,
  actions: ReadonlySet<string>,
): SecurityAlertFields | undefined {
  const action = payload.action;
  if (event !== expected || typeof action !== "string" || !actions.has(action)) {
    return undefined;
  }
  const alert = recordField(payload, "alert");
  const repositoryRecord = recordField(payload, "repository");
  if (alert === undefined || repositoryRecord === undefined) {
    return undefined;
  }
  const number = alert.number;
  const url = stringField(alert, "html_url");
  const repository = stringField(repositoryRecord, "full_name");
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) {
    return undefined;
  }
  if (url === undefined || repository === undefined) {
    return undefined;
  }
  return { repository, repositoryRecord, number, url, alert };
}

/** The string at `path` below `record`; `undefined` when a step is missing, not an object, or the value not a string. */
export function stringAt(record: Readonly<Record<string, unknown>>, path: readonly string[]): string | undefined {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
}

/** The first of `values` that is a string with a non-space character, trimmed; `undefined` when none is. */
export function firstText(values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const text = value?.trim();
    if (text !== undefined && text !== "") {
      return text;
    }
  }
  return undefined;
}

/** The parts that are strings with a non-space character, trimmed, joined with ` · `; `""` when none is. */
export function joinContext(parts: readonly (string | undefined)[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    const text = firstText([part]);
    if (text !== undefined) {
      texts.push(text);
    }
  }
  return texts.join(CONTEXT_SEPARATOR);
}
