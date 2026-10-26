import type { Channel, ChannelList } from "../channels/channel";
import { readActiveChannel } from "../channels/registry";
import { DELIVERY_CHANNEL_SETTING, writeSetting } from "../store/settings";

/** Path of the form that makes a messenger the active one. */
export const CHANNEL_ACTIVATE_PATH = "/setup/channel/activate";
/** Path of the form that removes a messenger's saved credentials. */
export const CHANNEL_REMOVE_PATH = "/setup/channel/remove";
/** Name of the form field that holds the messenger id. */
export const CHANNEL_FIELD = "channel";

/** The registered channel the form's `channel` field names exactly; `undefined` when it is missing, repeated or unknown. */
export function channelOfForm(form: URLSearchParams, channels: ChannelList): Channel | undefined {
  const values = form.getAll(CHANNEL_FIELD);
  const [id] = values;
  return values.length === 1 ? channels.find((channel) => channel.id === id) : undefined;
}

/** What activating a messenger came to. */
export type ActivateResult = "activated" | "already-active" | "not-set-up";

/** Makes `channel` the active messenger when it is set up. D1 errors are not caught. */
export async function activateChannel(
  env: object,
  db: D1Database,
  channel: Channel,
  channels: ChannelList,
): Promise<ActivateResult> {
  if ((await readActiveChannel(db, channels)).id === channel.id) {
    return "already-active";
  }
  if ((await channel.prepare(env, db)).kind !== "ready") {
    return "not-set-up";
  }
  await writeSetting(db, DELIVERY_CHANNEL_SETTING, channel.id);
  return "activated";
}
