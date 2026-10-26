import { vi } from "vitest";
import { contentNotification } from "../src/channels/channel";
import type {
  Channel,
  ChannelMessage,
  ChannelRemoveResult,
  ChannelSendResult,
  ChannelTarget,
  SendOptions,
} from "../src/channels/channel";
import type { StoredNotification } from "../src/notification";

/*
 * A second delivery channel for tests. It models a channel that renders the notification itself, as every channel
 * other than Telegram does: `send` reads the notification of the message through `contentNotification`, and a
 * message it cannot read (an old-form row of another shape) is a `failed` attempt. Nothing else of a real channel
 * is copied: it makes no request and holds no credentials.
 */

/** One `send` the double received. */
export interface RecordedSend {
  readonly message: ChannelMessage;
  readonly options: SendOptions;
  /** The notification the channel read from the message; `undefined` when `contentNotification` found none. */
  readonly notification: StoredNotification | undefined;
}

export interface TestChannelOptions {
  /** The channel id; `test` by default. */
  readonly id?: string;
  /** Whether `prepare` is ready (the default) or unavailable. */
  readonly configured?: boolean;
  /** The reason `prepare` gives while not configured; `no-token` by default. */
  readonly unavailable?: "no-token" | "no-chat";
  /** The answer of `hasRemovableCredentials`; false by default. */
  readonly removable?: boolean;
  /** The answer of `remove`; `removed` by default. */
  readonly removeResult?: ChannelRemoveResult;
  /** The answer of `send` for a readable message; `sent` by default. */
  readonly sendResult?: ChannelSendResult;
  /** Called after a send was recorded, before it answers; a test uses it to act while a batch is being sent. */
  readonly onSend?: (send: RecordedSend) => Promise<void> | void;
}

export interface TestChannel extends Channel {
  /** Every `send`, in order. */
  readonly sends: readonly RecordedSend[];
  /** How often `prepare` was called. */
  prepareCalls(): number;
  /** How often `remove` was called. */
  removeCalls(): number;
}

/** A channel that records what it receives; the display name is the id, the setup path `/setup/<id>`. */
export function testChannel(options: TestChannelOptions = {}): TestChannel {
  const {
    id = "test",
    configured = true,
    unavailable = "no-token",
    removable = false,
    removeResult = "removed",
    sendResult = "sent",
    onSend,
  } = options;
  const sends: RecordedSend[] = [];
  const prepare = vi.fn<() => Promise<ChannelTarget>>(() =>
    Promise.resolve<ChannelTarget>(
      configured
        ? {
            kind: "ready",
            send: async (message, sendOptions) => {
              const recorded: RecordedSend = {
                message,
                options: sendOptions,
                notification: contentNotification(message.content),
              };
              sends.push(recorded);
              await onSend?.(recorded);
              return recorded.notification === undefined ? "failed" : sendResult;
            },
          }
        : { kind: "unavailable", result: unavailable },
    ),
  );
  const remove = vi.fn<() => Promise<ChannelRemoveResult>>(() => Promise.resolve(removeResult));
  return {
    id,
    displayName: id,
    setupPath: `/setup/${id}`,
    prepare,
    hasRemovableCredentials: () => Promise.resolve(removable),
    remove,
    sends,
    prepareCalls: () => prepare.mock.calls.length,
    removeCalls: () => remove.mock.calls.length,
  };
}
