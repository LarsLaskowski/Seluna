import type { StoredNotification } from "./notification";
import type { Language } from "./setup/language";
import type { BoundedEvent } from "./store/meta";

/**
 * The notice that deliveries of `event` past `limit` were left out in the UTC hour of `time`, in `language`: fixed
 * texts only, no repository, no number, no button.
 */
export function limitNotice(event: BoundedEvent, time: Date, limit: number, language: Language): StoredNotification {
  throw new Error("Not implemented");
}
