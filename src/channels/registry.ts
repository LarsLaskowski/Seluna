import type { Channel, ChannelList } from "./channel";
import { DELIVERY_CHANNEL_SETTING, readSetting } from "../store/settings";
import { TELEGRAM_CHANNEL } from "./telegram";

/** The form of a channel id. */
export const CHANNEL_ID_FORM = /^[a-z][a-z0-9-]{0,31}$/;
/** The `/setup/<segment>` paths the wizard owns; no channel id may equal one. */
export const RESERVED_SETUP_SEGMENTS: readonly string[] = ["login", "logout", "settings", "reset", "github", "channel"];
/** The channel used while none is chosen. */
export const DEFAULT_CHANNEL_ID = "telegram";
/** The registered channels, in display order. */
export const CHANNELS: ChannelList = [TELEGRAM_CHANNEL];

/** The channel whose id is `stored`, else the default channel, else the first. */
export function activeChannelOf(channels: ChannelList, stored: string | undefined): Channel {
  return (
    channels.find((channel) => channel.id === stored) ??
    channels.find((channel) => channel.id === DEFAULT_CHANNEL_ID) ??
    channels[0]
  );
}

/** The active channel from the `delivery_channel` setting. D1 errors reject. */
export async function readActiveChannel(db: D1Database, channels: ChannelList): Promise<Channel> {
  return activeChannelOf(channels, await readSetting(db, DELIVERY_CHANNEL_SETTING));
}
