# Notifications

## Scope

What happens to a webhook delivery after its signature was accepted: how a redelivery is recognized, how the rules
decide on a notification, how a notification becomes an `outbox` row and a Telegram message, in which language, and
how a row is sent. The owner relies on it to be told once about each case and never lose a message; GitHub relies
on the status codes; the cron retry (issue #18) sends pending rows through the same sending rules.

## Behavior

### Processing a delivery

A delivery reaches this processing only after the body size limit, the webhook secret and the signature were
checked ([HTTP routes](http-routes.md)). It is processed in this order; the first step that decides answers:

1. The `X-GitHub-Delivery` value must match `^[0-9A-Za-z-]{1,64}$` and the `X-GitHub-Event` value
   `^[a-z_]{1,64}$`; otherwise **400**, nothing stored.
2. A delivery id that `deliveries` already holds answers **200** and has no other effect: nothing is parsed, stored,
   sent or written to `meta`.
3. The body is read as the payload (below); a body that is not a JSON object answers **400**, nothing stored.
4. The notification settings are read and the rules run (below).
5. In one transaction: the delivery (id, event, time received) is added to `deliveries`, one `outbox` row per
   notification is added, and `meta` `last_delivery` is set to the time received. Either all of it is stored or
   none of it.
6. The answer is **202**, whether or not a rule matched. The new `outbox` rows are sent after the answer (below).

- When the transaction fails because the delivery id was stored in the meantime (two deliveries of one id at once),
  the answer is **200** and nothing of this delivery is stored. Any other database failure in steps 2 to 5 answers
  **503** and stores nothing.
- Every time (time received, `created_at`, `last_delivery`) is the same reading of the clock, taken once per
  delivery.

### Payload

- When the media type of `Content-Type` (before any `;`, compared case-insensitively, surrounding spaces ignored) is
  `application/x-www-form-urlencoded`, the body is read as UTF-8 form data and must contain exactly one field
  `payload`, whose value is the JSON text. Any other or a missing `Content-Type` means the whole body is the JSON
  text.
- The body must be valid UTF-8 (an invalid byte sequence answers 400; a byte order mark is not removed and so
  makes the text invalid JSON). In the form framing a percent-encoded invalid sequence inside the `payload` value is
  not rejected: form decoding turns it into U+FFFD, which cleaning later passes harmlessly. The JSON text must
  parse to a JSON object, not an array or another value.
- The payload is passed to the rules as it parsed. The processing itself reads only `action` and
  `repository.full_name`, for the log entry.

### Rules

- A rule is a pure function of the event name (`X-GitHub-Event`), the payload and the notification settings
  ([Storage](storage.md)) that returns one notification or none. It reads no clock, no database and no network,
  and it narrows every payload field it reads; an unexpected shape returns none.
- Every rule has the id of its switch in the settings. All rules run on every delivery; a notification of a rule
  whose switch is off is dropped.
- A notification holds: the title of the case (line 1, in the notification language, chosen by the rule), the
  repository as `owner/repo`, the number of the pull request or alert (or none), line 2, line 3 and the URL for the
  button (the `html_url` of the payload).
- The rules follow in the order of the switches in the settings. The pull request rules are below; the rules for CI
  (#16) and security alerts (#17) follow.

#### Pull request rules

Three rules report the event `pull_request` (decision [0024](../decisions/0024-pull-request-rules.md)). Each reports
a delivery only when `action` is the one of its case and `pull_request.draft` is the boolean `false`; a draft pull
request triggers nothing.

| Switch id                       | `action`           | English title      | German title         |
| ------------------------------- | ------------------ | ------------------ | -------------------- |
| `pull_request_opened`           | `opened`           | `New pull request` | `Neuer Pull Request` |
| `pull_request_ready_for_review` | `ready_for_review` | `Ready for review` | `Bereit zum Review`  |
| `pull_request_review_requested` | `review_requested` | `Review requested` | `Review angefordert` |

- Line 1 is the title, `repository.full_name` and `pull_request.number`; line 2 is `pull_request.title`; line 3 is
  `by author · head → base` (German `von author · head → base`) from `pull_request.user.login`,
  `pull_request.head.ref` and `pull_request.base.ref`; the button URL is `pull_request.html_url`.
- The rules read no other field: not `sender`, `requested_reviewer`, `requested_team` or `head.repo`. So there is no
  filter by sender or reviewer, and a fork's branch is shown without its owner.
- A delivery whose fields are missing or of another type (`number` not a whole number from 1 to 2^53 − 1, a text field
  not a string, `draft` not `false`) triggers nothing.
- `ready_for_review` also requires `draft` to be `false`, although issue #13 gives no condition for it; on a genuine
  delivery `draft` is already `false`, so this only silences a payload that claims a draft (decision 0024).
- `review_requested` reports every requested review, whoever was asked (a user or a team) and whoever asked — also
  when the owner asks someone else to review the owner's own pull request; the message names neither. GitHub is
  expected to send one delivery per requested reviewer, so several reviewers give several identical messages.
- Because the rules do not filter by sender, on a public repository anyone who opens a pull request triggers a
  message with a title and branch name of their choosing, one per pull request; Telegram apps still turn URLs,
  `@mentions` and `/commands` in that text into tappable links, even though the text is escaped and link previews
  are off. No rate limit exists.
- Not verified against real deliveries: a review requested from a team, a pull request from a fork and the
  one-delivery-per-reviewer behavior. The rules read only fields that exist in all of them and stay silent when one
  is missing.

### Message format

A notification is rendered once, when its row is written, and stored as the row's `text`; it is sent with
`parse_mode` `HTML`.

- Line 1: the title in bold (`<b>…</b>`), then `·`, the repository and, when there is a number, ` #` and the
  number. Line 2 and line 3 follow, each on its own line; an empty line 2 or 3 is left out. Lines are separated by a
  single line feed.
- Each text (title, repository, line 2, line 3) is cleaned before it enters the message:
  1. a lone surrogate is replaced by U+FFFD;
  2. each control character (U+0000 to U+001F, U+007F to U+009F) and the line and paragraph separators U+2028 and
     U+2029 are replaced by a space;
  3. the directional formatting characters U+061C, U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069 are removed;
  4. leading and trailing spaces are removed;
  5. a text longer than its limit is cut to the limit, its last kept code point replaced by `…` (U+2026). The
     limits count code points of the decoded text, before escaping: title 64, repository 140, line 2 and line 3
     256 each;
  6. `&`, `<` and `>` are replaced by `&amp;`, `&lt;` and `&gt;`, in this order, so a text that already contains
     an entity is shown as written.
- Cleaning keeps a text from breaking the three-line layout and removes the invisible characters that reorder text
  around them; it does not stop ordinary right-to-left letters in a title or repository from reordering the
  neutral characters `·` and `#` of line 1 on screen.
- The number is shown only when it is a whole number from 1 to 2^53 − 1.
- The button URL is stored only when it parses as a URL with the scheme `https`, the host `github.com`, no user name
  or password, and at most 2,048 characters in its normalized form, which is what is stored; otherwise the row has
  no button URL and the message is sent without a button.
- A new row is never silent yet (`silent` 0); quiet hours (issue #14) will set it.

### Languages

- The texts of the messages live in one table per language, English and German, that must have the same keys:
  a table with a missing key does not compile.
- The rules write the title and line 3 in the notification language of the settings, read when the delivery is
  processed.
- The tables hold the titles and line 3 of the pull request rules ([Pull request rules](#pull-request-rules)).
- The button reads _Open on GitHub_ in English and _Auf GitHub öffnen_ in German. Its language is the notification
  language at the time the row is sent, so a row still pending when the owner switches the language keeps its text
  and gets the button in the new language.

### Sending a row

- The new rows of a delivery are sent one after the other after the answer, within the time the platform grants
  after a response (about 30 seconds, according to Cloudflare's documentation); a send cut off by it leaves its row
  pending.
- The chat is the Worker secret `TELEGRAM_CHAT_ID` when it is a non-empty string; it must then be a chat id
  (`^-?[1-9]\d{0,15}$`, a safe integer), and when it is not, no chat is configured — the stored chat is not used in
  its place. Without that secret it is the `settings` key `telegram_chat_id`, when it is a chat id. The bot token is
  the Worker secret `TELEGRAM_BOT_TOKEN` in the form the setup wizard accepts ([Setup wizard](setup-wizard.md#telegram-chat)).
- Without a usable bot token or chat, Telegram is not called and the row stays `pending` with its attempts
  unchanged.
- Otherwise one attempt is one `sendMessage` request with `chat_id`, `text`, `parse_mode` `HTML`,
  `link_preview_options` with `is_disabled` true (a link in an attacker-chosen title builds no preview card),
  `disable_notification` (true when the row is silent) and, when the row has a button URL, an inline keyboard with
  one button (label, URL). An attempt counts one in `attempts`, whatever its outcome:
  - a successful answer (2xx and `ok` true) marks the row `sent`;
  - a 429 answer whose `parameters.retry_after` is a whole number from 1 to 5 makes the Worker wait that many
    seconds and send the same request once more, within the same attempt; the second answer decides as below,
    without a further wait;
  - any other answer — a 429 without a usable `retry_after` or with a longer one, a second 429, 401 or 404 (token
    rejected), another status, a network error or a timeout (10 seconds per request) — leaves the row `pending`
    for the cron.
- A row is changed only while it is still `pending`. The rows of a delivery that the sending step finds failing do
  not stop the next row from being tried.
- A row is sent at least once, not exactly once: when marking a row `sent` fails after Telegram accepted it, the
  cron sends it again.

### Log entries

- The request's log entry ([HTTP routes](http-routes.md#logging)) carries, besides delivery id and event, the
  payload's `action` when it matches `^[a-z_]{1,64}$`, the repository when `repository.full_name` matches
  `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, each `null` otherwise, and the decision: `reported` (at least one
  row written), `no-match` (no rule returned a notification), `disabled` (only rules whose switch is off did),
  `duplicate` (a known delivery id), `invalid` (a 400 of this processing) or `unavailable` (a 503 of this
  processing).
- Each row sent writes one log entry with exactly two fields: the row id and the result — `sent`, `rate-limited`,
  `token-rejected`, `failed`, `no-token`, `no-chat` or `store-failed` (the database could not be read or the row
  could not be updated).
- No log entry holds a payload text (title, branch, commit message, alert text), a message text, a chat id, the bot
  token or a Telegram answer.

## Limits and errors

- A delivery answered 400 or 503 stores nothing and GitHub does not send it again on its own; the owner can redeliver
  it from the GitHub App's delivery list, which works because its id was not recorded. This is accepted: the
  "never lose a message" goal covers rows already in the `outbox`, not deliveries that were never recorded.
- A throwing rule or formatter answers 503 `unavailable` and stores nothing, like a database failure.
- The signature covers the body only, not `X-GitHub-Delivery` or `X-GitHub-Event`. Residual risk, inherent to
  GitHub's webhook design: someone holding a captured signed body can replay it with a new delivery id and cause a
  second message, or change the event header so the payload reaches the rules of another event. The rules therefore
  check that the payload's shape matches the event and do not rely on the header alone.
- 200, 202, 400 and 503 of this processing carry no body, as every answer of `POST /webhook` does.
- A database failure, a failing send and a Telegram error never reach a response or a log entry with their message;
  only the fixed decision or result above is logged.
- The answer of Telegram is read only for a 2xx (to check `ok`) and for a 429 (for `retry_after`), at most 1 MiB,
  counted before decoding ([HTTP routes](http-routes.md#request-body-size)).

## Related decisions

- [`decisions/0023-webhook-processing-and-delivery-through-the-outbox.md`](../decisions/0023-webhook-processing-and-delivery-through-the-outbox.md)
  — the one-transaction deduplication, the text rendered when written, the button label from
  the language at sending, the retry bound, 400 for an unprocessable signed delivery.
- [`decisions/0024-pull-request-rules.md`](../decisions/0024-pull-request-rules.md) — the three pull request rules,
  `draft` required to be `false`, silence on an unexpected shape, line 3 with author and branches.
- [`decisions/0008-delivery-through-a-d1-outbox.md`](../decisions/0008-delivery-through-a-d1-outbox.md) — the
  outbox and the at-least-once delivery.
- [`decisions/0016-telegram-chat-in-the-setup-wizard.md`](../decisions/0016-telegram-chat-in-the-setup-wizard.md)
  — the chat, `TELEGRAM_CHAT_ID` and the Bot API client built from the reference.

## Not here

- The route, its status codes before this processing, the body size limit and the signature check:
  [HTTP routes](http-routes.md).
- The `deliveries`, `outbox` and `meta` tables and their columns: [Storage](storage.md).
- Choosing and proving the chat: [Setup wizard](setup-wizard.md#telegram-chat).
- Resending pending rows, marking rows `failed` and removing old rows: the cron jobs
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md#cron-triggers)).
