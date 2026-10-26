import { legacyNotificationOf } from "../notification";
import type { StoredNotification } from "../notification";
import type { ChannelFetch } from "./http";

/** What one send attempt came to. */
export type ChannelSendResult = "sent" | "rejected" | "rate-limited" | "failed";

/** What an outbox row holds: a decoded notification, or the text of an old-form row. */
export type OutboxContent =
  | { readonly kind: "notification"; readonly notification: StoredNotification }
  | { readonly kind: "legacy"; readonly text: string };

/** One message to send: its content and the button target. */
export interface ChannelMessage {
  readonly content: OutboxContent;
  readonly buttonUrl: string | undefined;
}

/** How one message is sent. */
export interface SendOptions {
  readonly silent: boolean;
  readonly buttonLabel: string;
  readonly outboxId: number;
}

/** What a channel needs to send. */
export interface ChannelSendDeps {
  readonly fetch: ChannelFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

/** The destination of a batch: ready to send, or the reason it is not. */
export type ChannelTarget =
  | {
      readonly kind: "ready";
      readonly send: (
        message: ChannelMessage,
        options: SendOptions,
        deps: ChannelSendDeps,
      ) => Promise<ChannelSendResult>;
    }
  | { readonly kind: "unavailable"; readonly result: "no-token" | "no-chat" };

/** What removing a channel's credentials came to. */
export type ChannelRemoveResult = "removed" | "worker-secret" | "unreadable";

/** A delivery channel. */
export interface Channel {
  readonly id: string;
  readonly displayName: string;
  readonly setupPath: string;
  /** Resolves the destination once per batch; D1 errors reject. */
  readonly prepare: (env: object, db: D1Database) => Promise<ChannelTarget>;
  readonly hasRemovableCredentials: (env: object, db: D1Database) => Promise<boolean>;
  readonly remove: (env: object, db: D1Database) => Promise<ChannelRemoveResult>;
}

/** The registered channels; never empty. */
export type ChannelList = readonly [Channel, ...Channel[]];

/** The notification of `content`: its own, or the one parsed from an old-form text; `undefined` when unreadable. */
export function contentNotification(content: OutboxContent): StoredNotification | undefined {
  return content.kind === "notification" ? content.notification : legacyNotificationOf(content.text);
}
