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

/** The common fields of a delivery of `expected` whose `action` is in `actions`; otherwise `undefined`. */
export function securityAlert(
  _event: string,
  _payload: WebhookPayload,
  _expected: SecurityAlertEvent,
  _actions: ReadonlySet<string>,
): SecurityAlertFields | undefined {
  throw new Error("Not implemented");
}

/** The string at `path` below `record`; `undefined` when a step is missing, not an object, or the value not a string. */
export function stringAt(_record: Readonly<Record<string, unknown>>, _path: readonly string[]): string | undefined {
  throw new Error("Not implemented");
}

/** The first of `values` that is a string with a non-space character, trimmed; `undefined` when none is. */
export function firstText(_values: readonly (string | undefined)[]): string | undefined {
  throw new Error("Not implemented");
}

/** The parts that are strings with a non-space character, trimmed, joined with ` · `; `""` when none is. */
export function joinContext(_parts: readonly (string | undefined)[]): string {
  throw new Error("Not implemented");
}
