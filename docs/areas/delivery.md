# Delivery

## Scope

How a stored notification reaches the owner: the delivery channels and the one active channel, how Telegram renders
a notification, the rows written by an earlier version and damaged rows, sending a row with its attempts and the
retry after a 429, and the quiet hours that decide whether a send makes a sound. The owner relies on it never to lose
a row that is in the `outbox`; the retry of the cron ([Scheduled jobs](scheduled-jobs.md#retry)) sends pending rows
through the same rules.

## Behavior

### Delivery channels

Rows are sent through exactly one **delivery channel**. Telegram is the only one registered today; the registry
(`src/channels/registry.ts`) lists the channels in display order, and the stored notification is rendered by the
channel that sends it.

- The active channel is the `settings` key `delivery_channel` ([Storage](storage.md#tables)); a missing value or one
  that names no registered channel (also with different case or padding) reads as `telegram`, or as the first
  registered channel if Telegram is not registered. The owner changes it on the start page
  ([Status page](status-page.md#messengers)).
- A batch of rows (the rows of a delivery, the rows of one cron retry run, the release notice, the limit notice, the
  digest) reads the active channel once and asks it once for its destination; the whole batch is sent through that
  channel, even when the owner switches the channel while it runs. The next batch uses the new one. A D1 error in
  either step is `store-failed` for every row of the batch, the rows unchanged.
- There is no fallback: while the active channel is not ready (`no-token`, `no-chat`), no channel is called and no row
  changes, damaged rows included; they wait. A row's `attempts` are kept across a switch and the next attempt is
  counted on top.
- A channel gets the row's content (the notification, or the `text` of an old-form row), the button URL and, per
  attempt, the `silent` flag ([Quiet hours](#quiet-hours)), the button label in the notification language
  ([Languages](notifications.md#languages)) and the row id. It answers `sent`, `rejected` (the destination refuses its
  credentials; logged `token-rejected`), `rate-limited` or `failed`.
- **Shared HTTP rules** (every channel request, implemented in `src/channels/http.ts`): one JSON `POST` per request
  with `content-type: application/json`, aborted after 10 seconds; the answer is read at most 1 MiB, counted in bytes
  before decoding, for a 2xx and for a 429 only (the body of any other status is cancelled unread); a 2xx answer that
  is not UTF-8 JSON or above the limit is `failed`; a 429 whose body is above the limit or unreadable is a 429 without
  a retry hint (`rate-limited`, no retry). After a 429 whose retry hint is a whole number from 1 to 5 seconds the
  request is sent once more after that wait, within the same attempt; a rejected wait is `failed`. Requests follow
  redirects as the platform's `fetch` does by default, because Telegram's fixed host never redirects; the first
  channel with a server address chosen by the owner must decide on this consciously. Network errors and their causes
  are dropped, only the fixed result is kept.
- The rules stay free of delivery: nothing under `src/rules/` may import a channel, the message or notification
  modules, the Telegram client or the delivery, which a lint rule checks in the _Analyzer gate_.

### Telegram rendering

At send time Telegram builds the message text from the stored notification. Every field is cleaned and cut again as
when it was stored ([Message format](notifications.md#message-format)), which changes nothing for a row this version
wrote, and then escaped.

- Line 1 is the title in bold (`<b>…</b>`), then `·`, the repository and, when there is a number, ` #` and the number.
  When the cleaned repository is empty, line 1 is the title alone, without `·`.
- Line 2 and line 3 follow, each on its own line, an empty one left out; then each further line of the notification
  (`lines`), cleaned, cut to 256 code points and escaped the same way, an empty one left out. Lines are separated by a
  single line feed.
- `&`, `<` and `>` are replaced by `&amp;`, `&lt;` and `&gt;`, in this order, so a text that already contains an
  entity is shown as written. The text is sent with `parse_mode` `HTML`; it is the same text an earlier version stored
  when it wrote the row.

### Old-form rows

A row written by an earlier version has a `text` that starts with `<b>` and keeps its Telegram HTML.

- Telegram sends their `text` unchanged.
- A channel that renders the notification itself recovers it from the text: the first line must start with `<b>`, the
  title runs to the first `</b> · `, the rest is the repository, a trailing ` #` and 1 to 16 digits (first not `0`, a
  safe integer) is cut off as the number, lines 2 and 3 are the further lines (a missing one is empty), and `&lt;`,
  `&gt;`, `&amp;` are decoded once, in this order. The parsing uses no regular expression with unbounded groups.
- A text of more than three lines or of another shape cannot be recovered; such a channel must then answer `failed`,
  which counts a failed attempt.

### Damaged rows

- A row whose `text` starts with `{` but is not a valid stored notification (not JSON, not an object, a missing or
  mistyped field, a number that is not a whole number from 1 to 2^53 − 1, `lines` that is not an array of at most 11
  strings), or whose `text` is not a string, is damaged.
- A damaged row is never sent: the attempt is counted as `failed`, no channel is called, and the other rows of the
  batch are still sent. A row whose `text` starts with `{` is decoded, or found damaged, when it is sent, so raw JSON
  never goes out as a message.

### Sending a row

- The new rows of a delivery are sent one after the other after the answer, within the time the platform grants after
  a response (about 30 seconds, according to Cloudflare's documentation); a send cut off by it leaves its row
  `pending`. Each row goes through the active channel ([Delivery channels](#delivery-channels)).
- **Telegram destination.** The chat is the Worker secret `TELEGRAM_CHAT_ID` when it is a non-empty string; it must
  then be a chat id (`^-?[1-9]\d{0,15}$`, a safe integer), and when it is not, no chat is configured — the stored chat
  is not used in its place. Without that secret it is the `settings` key `telegram_chat_id`, when it is a chat id. The
  bot token is resolved as the Telegram step says ([The bot token](telegram-step.md#the-bot-token)): the Worker secret
  `TELEGRAM_BOT_TOKEN` when it is a non-empty string, otherwise the saved token (read from D1 and decrypted for each
  batch), in either case only when it has the bot token form; a malformed Worker secret is not replaced by the saved
  token.
- Without a usable bot token or chat, Telegram is not called and the row stays `pending` with its attempts unchanged:
  the result is `no-token` when no token is set or saved, the Worker secret is malformed, the saved token cannot be
  read with the current `SELUNA_SECRET` or its row is damaged, or there is no usable `SELUNA_SECRET`; `no-chat` without
  a chat. A D1 error while reading the channel, the token or the chat is `store-failed`, with the row unchanged.
- Otherwise one attempt is one `sendMessage` request with `chat_id`, `text`, `parse_mode` `HTML`,
  `link_preview_options` with `is_disabled` true (a link in an attacker-chosen title builds no preview card),
  `disable_notification` (true when the send is silent, [Quiet hours](#quiet-hours)) and, when the row has a button
  URL, an inline keyboard with one button (label, URL). An attempt counts one in `attempts`, whatever its outcome:
  - a successful answer (2xx and `ok` true) marks the row `sent`;
  - a 429 answer whose `parameters.retry_after` is a whole number from 1 to 5 makes the Worker wait that many seconds
    and send the same request once more, within the same attempt; the second answer decides as below, without a
    further wait;
  - any other answer — a 429 without a usable `retry_after` or with a longer one, a second 429, 401 or 404 (token
    rejected), another status, a network error or a timeout (10 seconds per request) — leaves the row `pending` for
    the cron; when that attempt is the row's fifth, the same update marks the row `failed` and it is never sent again
    ([Scheduled jobs](scheduled-jobs.md#retry)).
- A row is changed only while it is still `pending`. A row that fails does not stop the next row from being tried.
- A row is sent at least once, not exactly once: when marking a row `sent` fails after Telegram accepted it, the cron
  sends it again.

### Quiet hours

- Quiet hours are off by default; when they are on, the settings hold a start and an end time (`HH:MM`, 24-hour, start
  and end differ) and the time zone they are read in ([Storage](storage.md#tables)).
- A send is silent (`disable_notification` true) when its row is marked `silent`, or when quiet hours are on and the
  time of the send lies in them. Otherwise it is sent with sound. Nothing is held back or delayed: a message inside the
  quiet hours is sent at once, without sound.
- The time of the send is one reading of the clock, taken just before the row's `sendMessage` request; the second
  request after a 429 is the same request and keeps its `disable_notification`. Each row of a batch takes its own
  reading. A row sent again later (the cron) is silent or not by the time of that send, not by the time it was
  written. The settings are those read for the batch of rows being sent (for a new delivery: when it was processed).
- That time is converted to the wall-clock hour and minute of the configured time zone, including daylight saving
  time, and compared by the minute: the start minute is quiet, the end minute is not (22:00–07:00 is quiet from
  22:00:00 up to and including 06:59:59). A start later than the end spans midnight (22:00–07:00 covers 22:00 to 23:59
  and 00:00 to 06:59); `00:00` as the end means up to midnight.
- On the day daylight saving time begins, a wall-clock time inside the skipped hour never occurs, so quiet hours lying
  entirely inside it do not happen that day; on the day it ends, the repeated hour counts by its wall-clock time both
  times. Quiet hours that contain the changeover keep their wall-clock start and end, so they last an hour less or more
  that night.
- A time zone the runtime does not accept is read as UTC; a time that cannot be converted is not quiet. Deciding never
  fails a send.

## Limits and errors

- The answer of Telegram is read only for a 2xx (to check `ok`) and for a 429 (for `retry_after`), at most 1 MiB,
  counted before decoding; a 429 whose body is above the limit counts as `rate-limited`, without a retry.
- The bot token appears only in the request URL, which is never logged; no Telegram `description`, answer body,
  network error or runtime error text reaches a log entry ([Log entries](notifications.md#log-entries)).
- A stored row that cannot be read as a notification never stops the other rows ([Damaged rows](#damaged-rows)).
- A row is sent at least once; a duplicate is possible when marking it `sent` fails.

## Related decisions

- [`decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md`](../decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md)
  — the notification rendered by the active channel when it is sent, rows of the earlier version kept, no fallback.
- [`decisions/0023-webhook-processing-and-delivery-through-the-outbox.md`](../decisions/0023-webhook-processing-and-delivery-through-the-outbox.md)
  — the button label from the language at sending, the retry bound.
- [`decisions/0025-quiet-hours-decided-at-sending.md`](../decisions/0025-quiet-hours-decided-at-sending.md) — quiet
  hours applied at each send rather than when the row is written, one clock reading per row, wall-clock times.
- [`decisions/0029-outbox-retry-and-cleanup-by-the-cron.md`](../decisions/0029-outbox-retry-and-cleanup-by-the-cron.md)
  — the fifth failed attempt marks a row `failed` in the update that counts it.
- [`decisions/0016-telegram-chat-in-the-setup-wizard.md`](../decisions/0016-telegram-chat-in-the-setup-wizard.md) —
  the chat, `TELEGRAM_CHAT_ID` and the Bot API client built from the reference.
- [`decisions/0008-delivery-through-a-d1-outbox.md`](../decisions/0008-delivery-through-a-d1-outbox.md) — the outbox
  and the at-least-once delivery.

## Not here

- The stored notification, its cleaning and its languages: [Notifications](notifications.md).
- Resending pending rows and removing old rows: [Scheduled jobs](scheduled-jobs.md).
- Saving the bot token, choosing and proving the chat: [Telegram step](telegram-step.md); activating and removing a
  messenger: [Status page](status-page.md#messengers).
- The `outbox` and `settings` tables: [Storage](storage.md).
