import { MESSAGE_TEXTS } from "./i18n/messages";
import type { StoredNotification } from "./notification";
import type { Language } from "./setup/language";
import type { BoundedEvent } from "./store/meta";

/** `HH:00` of a UTC hour. */
function hourText(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * The notice that deliveries of `event` past `limit` were left out in the UTC hour of `time`, in `language`: fixed
 * texts only, no repository, no number, no button.
 */
export function limitNotice(event: BoundedEvent, time: Date, limit: number, language: Language): StoredNotification {
  const texts = MESSAGE_TEXTS[language];
  const hour = time.getUTCHours();
  return {
    title: texts.limitNoticeTitle,
    repository: "",
    number: undefined,
    subject: texts.limitNoticeLine(texts.limitNoticeKinds[event], limit, hourText(hour), hourText((hour + 1) % 24)),
    context: texts.limitNoticeContext,
  };
}
