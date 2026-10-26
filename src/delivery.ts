import { isQuietTime } from "./quiet-hours";
import type { NotificationSettings } from "./settings";
import { markAttempted, markSent } from "./store/outbox";
import type { AttemptOutcome } from "./store/outbox";
import { decodeStoredNotification } from "./notification";
import type { StoredNotification } from "./notification";
import type { ChannelFetch } from "./channels/http";
import type { ChannelList, ChannelSendResult, ChannelTarget, OutboxContent } from "./channels/channel";
import { CHANNELS, readActiveChannel } from "./channels/registry";
import { MESSAGE_TEXTS } from "./i18n/messages";

export interface PendingMessage {
  readonly id: number;
  readonly text: string;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
  /** The decoded notification; `"damaged"` for an undecodable stored row; absent for an old-form row. */
  readonly notification?: StoredNotification | "damaged";
}

export type DeliveryResult =
  "sent" | "rate-limited" | "token-rejected" | "failed" | "no-token" | "no-chat" | "store-failed";

export type DeliveryLogEntry =
  { readonly outbox: number; readonly result: DeliveryResult } | { readonly outbox: number; readonly status: "failed" };

/** What sending reads from the settings: the button's language and the quiet hours with their time zone. */
export type DeliverySettings = Pick<NotificationSettings, "language" | "timeZone" | "quietHours">;

export interface DeliveryDeps {
  readonly env: object;
  readonly db: D1Database;
  readonly fetch: ChannelFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (entry: DeliveryLogEntry) => void;
  /** The clock read once per row, just before it is sent, for the quiet hours. */
  readonly now: () => Date;
  /** The registered channels; defaults to `CHANNELS`. */
  readonly channels?: ChannelList;
}

type Target =
  | Extract<ChannelTarget, { readonly kind: "ready" }>
  | { readonly kind: "unavailable"; readonly result: "no-token" | "no-chat" | "store-failed" };

/** The active channel's destination, resolved once per batch; a database failure reads as `store-failed`. */
async function resolveTarget(deps: DeliveryDeps): Promise<Target> {
  try {
    const channel = await readActiveChannel(deps.db, deps.channels ?? CHANNELS);
    return await channel.prepare(deps.env, deps.db);
  } catch {
    // The error is dropped: only the fixed result reaches the log.
    return { kind: "unavailable", result: "store-failed" };
  }
}

/** What a row holds for a channel, or `undefined` when it is damaged. A new row never reaches a channel as raw JSON. */
function contentOf(message: PendingMessage): OutboxContent | undefined {
  const { notification } = message;
  if (notification === "damaged") {
    return undefined;
  }
  if (notification !== undefined) {
    return { kind: "notification", notification };
  }
  if (message.text.startsWith("{")) {
    const decoded = decodeStoredNotification(message.text);
    return decoded === undefined ? undefined : { kind: "notification", notification: decoded };
  }
  return { kind: "legacy", text: message.text };
}

/** Whether the quiet hours hold now; a failing clock reads as not quiet, so the row is still sent. */
function quietAtSend(settings: DeliverySettings, deps: DeliveryDeps): boolean {
  try {
    return isQuietTime(settings.quietHours, settings.timeZone, deps.now());
  } catch {
    return false;
  }
}

/** What sending one row came to: the result to log and, when the attempt was counted, the row's status afterwards. */
interface DeliveryOutcome {
  readonly result: DeliveryResult;
  readonly status: AttemptOutcome | undefined;
}

/** Sends one row, records the attempt and returns the outcome to log. Never rejects. */
async function deliverOne(
  message: PendingMessage,
  target: Extract<Target, { readonly kind: "ready" }>,
  settings: DeliverySettings,
  buttonLabel: string,
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  let sent: ChannelSendResult = "failed";
  try {
    const content = contentOf(message);
    if (content !== undefined) {
      const silent = message.silent || quietAtSend(settings, deps);
      sent = await target.send(
        { content, buttonUrl: message.buttonUrl },
        { silent, buttonLabel, outboxId: message.id },
        { fetch: deps.fetch, sleep: deps.sleep },
      );
    }
  } catch {
    sent = "failed";
  }
  const result: DeliveryResult = sent === "rejected" ? "token-rejected" : sent;
  try {
    if (sent === "sent") {
      await markSent(deps.db, message.id);
      return { result, status: undefined };
    }
    return { result, status: await markAttempted(deps.db, message.id) };
  } catch {
    return { result: "store-failed", status: undefined };
  }
}

/** Delivers `messages[index]` and then the rows after it, one after the other. Never rejects. */
async function deliverFrom(
  messages: readonly PendingMessage[],
  index: number,
  target: Target,
  settings: DeliverySettings,
  buttonText: string,
  deps: DeliveryDeps,
): Promise<void> {
  const message = messages[index];
  if (message === undefined) {
    return;
  }
  const outcome: DeliveryOutcome =
    target.kind === "ready"
      ? await deliverOne(message, target, settings, buttonText, deps)
      : { result: target.result, status: undefined };
  try {
    deps.log({ outbox: message.id, result: outcome.result });
    if (outcome.status === "failed") {
      deps.log({ outbox: message.id, status: "failed" });
    }
  } catch {
    // A failing log sink must not stop the next row.
  }
  await deliverFrom(messages, index + 1, target, settings, buttonText, deps);
}

/** Sends each row once, in order, silent per row by its flag or the quiet hours at its send; updates and logs it. Never rejects. */
export async function deliverMessages(
  messages: readonly PendingMessage[],
  settings: DeliverySettings,
  deps: DeliveryDeps,
): Promise<void> {
  const target = await resolveTarget(deps);
  await deliverFrom(messages, 0, target, settings, MESSAGE_TEXTS[settings.language].openOnGitHub, deps);
}

/** Resolves after `milliseconds` (a timer). */
export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
