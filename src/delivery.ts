import { isQuietTime } from "./quiet-hours";
import type { NotificationSettings } from "./settings";
import { markAttempted, markSent } from "./store/outbox";
import type { AttemptOutcome } from "./store/outbox";
import { chatTarget } from "./channels/telegram";
import type { StoredNotification } from "./notification";
import type { ChannelFetch } from "./channels/http";
import type { ChannelList } from "./channels/channel";
import { resolveBotToken } from "./bot-token";
import { sendNotification } from "./telegram";
import type { SendNotificationResult } from "./telegram";
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
  | { readonly kind: "ready"; readonly token: string; readonly chatId: number }
  | { readonly kind: "unavailable"; readonly result: "no-token" | "no-chat" | "store-failed" };

/** The bot token and chat to send to; a database failure reads as `store-failed`. */
async function resolveTarget(deps: DeliveryDeps): Promise<Target> {
  try {
    const token = await resolveBotToken(deps.env, deps.db);
    if (token.kind !== "usable") {
      return { kind: "unavailable", result: "no-token" };
    }
    const chatId = await chatTarget(deps.env, deps.db);
    return chatId === undefined
      ? { kind: "unavailable", result: "no-chat" }
      : { kind: "ready", token: token.token, chatId };
  } catch {
    // The error is dropped: only the fixed result reaches the log.
    return { kind: "unavailable", result: "store-failed" };
  }
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
  target: { readonly token: string; readonly chatId: number },
  settings: DeliverySettings,
  buttonText: string,
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  let sent: SendNotificationResult;
  try {
    const silent = message.silent || quietAtSend(settings, deps);
    sent = await sendNotification(
      target.token,
      target.chatId,
      { text: message.text, buttonText, buttonUrl: message.buttonUrl, silent },
      deps.fetch,
      deps.sleep,
    );
  } catch {
    sent = "failed";
  }
  try {
    if (sent === "sent") {
      await markSent(deps.db, message.id);
      return { result: sent, status: undefined };
    }
    return { result: sent, status: await markAttempted(deps.db, message.id) };
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
