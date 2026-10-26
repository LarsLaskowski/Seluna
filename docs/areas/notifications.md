# Notifications

## Scope

What happens to a webhook delivery after its signature was accepted: how a redelivery is recognized, how the rules
decide on a notification, how a notification becomes an `outbox` row, which delivery channel renders and sends it (Telegram today), in which
language, and how a row is sent, with or without sound. The owner relies on it to be told once about each case and never lose a
message; GitHub relies on the status codes; the retry of the cron ([Scheduled jobs](scheduled-jobs.md#retry)) sends
pending rows through the same sending rules.

## Behavior

### Processing a delivery

A delivery reaches this processing only after the body size limit, the webhook secret and the signature were
checked ([HTTP routes](http-routes.md)). It is processed in this order; the first step that decides answers:

1. The `X-GitHub-Delivery` value must match `^[0-9A-Za-z-]{1,64}$` and the `X-GitHub-Event` value
   `^[a-z_]{1,64}$`; otherwise **400**, nothing stored.
2. A delivery id that `deliveries` already holds answers **200** and has no other effect: nothing is parsed, stored,
   sent or written to `meta`. A `deliveries` row is kept 7 days ([Scheduled jobs](scheduled-jobs.md#cleanup)), so a
   redelivery is recognized within that time.
3. The body is read as the payload (below); a body that is not a JSON object answers **400**, nothing stored.
4. The notification settings are read and the rules run (below); then the draft check of a notification that carries
   one is resolved ([Draft lookup](#draft-lookup)), which may drop the notification or change its title.
5. In one transaction: the delivery (id, event, time received) is added to `deliveries`, one `outbox` row per
   notification is added (the notification as JSON, [Message format](#message-format)), and `meta` `last_delivery` is set to the time received. Either all of it is stored or
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
  button (the `html_url` of the payload). A notification that may only be sent for a pull request that is not a draft
  also holds a draft check: the pull request (owner, repository name, number) and the title to use when its draft
  state is unknown.
- The rules run in the order of the switches in the settings. The pull request rules and the CI failure rules are
  below, then the security alert rules.

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

#### CI failure rules

Two rules report the event `workflow_run` (decision [0027](../decisions/0027-ci-failure-rules-and-the-draft-lookup.md)).
Both report only a delivery whose `action` is `completed` and whose `workflow_run.conclusion` is `failure` or
`timed_out`; every other conclusion (`success`, `cancelled`, `skipped`, `neutral`, `action_required`, `stale`,
`startup_failure`, `null`, any new one) and every other action triggers nothing.

| Switch id                  | Case                                                                  | English title               | German title                        |
| -------------------------- | --------------------------------------------------------------------- | --------------------------- | ----------------------------------- |
| `ci_failed_default_branch` | the run is on the default branch                                      | `CI failed on <branch>`     | `CI fehlgeschlagen auf <branch>`    |
| `ci_failed_pull_request`   | the run is not on the default branch and names a pull request (below) | `CI failed in pull request` | `CI im Pull Request fehlgeschlagen` |

- A run is on the default branch when `workflow_run.head_branch` equals `repository.default_branch` and
  `workflow_run.head_repository.id` equals `repository.id`; a fork's branch of the same name is not. `<branch>` is the
  default branch. A run that an outsider's event starts in the repository's own context (for example `pull_request_target`
  or `issue_comment` on the default branch, or a chained `workflow_run`) is reported like any default-branch run: the
  guard keeps out a fork's branch, and the texts shown still come from the repository, not from the outsider.
- The pull request case never reports a run on the default branch, whatever the switches: one run gives at most one
  message.
- The pull request of a run is the first entry of `workflow_run.pull_requests`, in its order, that is an object with a
  `number` and a `base.repo.id`, each a whole number from 1 to 2^53 − 1, whose `base.repo.id` equals `repository.id`.
  Other entries (another repository, a missing or mistyped field) are skipped; without such an entry, or when
  `pull_requests` is not an array, the pull request case reports nothing. A pull request from a fork arrives with an
  empty `pull_requests` and is not reported.
- Line 1 is the title, `repository.full_name` and, for the pull request case, the pull request's number; line 2 is
  `workflow_run.name`; line 3 is `workflow_run.head_branch`, then `·` and the first line of
  `workflow_run.head_commit.message` (the text before the first line feed or carriage return). When `head_commit` is
  `null`, its `message` is not a string, or the first line is empty or only spaces, line 3 is the branch alone. The
  button URL is `workflow_run.html_url`, the page of the run. Line 3 is the same in both languages.
- A delivery triggers nothing when the event name is not `workflow_run`, `workflow_run` is not an object,
  `conclusion`, `head_branch`, `name` or `html_url` is not a string, `workflow_run.head_repository.id` or
  `repository.id` is not a whole number from 1 to 2^53 − 1, or `repository.full_name` or `repository.default_branch`
  is not a string.
- The notification of the pull request case carries a draft check of its pull request, in the repository of
  `repository.full_name` (owner before the first `/`, name after it).
- Each run is reported once per delivery: two failing workflows on one push give two messages, a workflow that runs on
  both `push` and `pull_request` gives two, and a re-run that fails again is reported again with the same lines.
- Not verified against real deliveries: a failed or `timed_out` run on the default branch, a `cancelled` run, a fork's
  run (its `head_repository` and its empty `pull_requests` follow GitHub's documentation) and a re-run. The rules read
  only fields both real samples carry.

#### Security alert rules

Three rules report the events `dependabot_alert`, `code_scanning_alert` and `secret_scanning_alert` (decision
[0028](../decisions/0028-security-alert-rules.md)). No new permission, event or setting: the three switches exist, on by
default.

| Switch id               | Event                   | Reported `action`                           | English title           | German title              |
| ----------------------- | ----------------------- | ------------------------------------------- | ----------------------- | ------------------------- |
| `dependabot_alert`      | `dependabot_alert`      | `created`, `reopened`                       | `Dependabot alert`      | `Dependabot-Warnung`      |
| `code_scanning_alert`   | `code_scanning_alert`   | `created`, `reopened`, `appeared_in_branch` | `Code scanning alert`   | `Code-Scanning-Warnung`   |
| `secret_scanning_alert` | `secret_scanning_alert` | `created`, `reopened`                       | `Secret scanning alert` | `Secret-Scanning-Warnung` |

Every other action (for example `dismissed`, `fixed`, `resolved`, `auto_reopened`, `reopened_by_user`, or one GitHub
adds later) triggers nothing. A new and a reopened alert give the same message; the alert's `state` and the `sender` are
not read.

- **Fields shown.** Line 1 is the title, the repository (`repository.full_name`) and `alert.number`; the button is
  `alert.html_url`. Lines 2 and 3 are GitHub's own words, the same in both languages, and a value that is missing,
  `null`, not a string or blank falls back as listed; an empty line is left out and the alert is still reported. An
  unknown severity is shown as sent.

  | Event                   | Line 2                            | Line 3                                                                                                                                                                                              |
  | ----------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `dependabot_alert`      | `alert.security_advisory.summary` | severity `alert.security_advisory.severity` (fallback `alert.security_vulnerability.severity`), `·`, package `alert.dependency.package.name` (fallback `alert.security_vulnerability.package.name`) |
  | `code_scanning_alert`   | `alert.rule.description`          | severity `alert.rule.security_severity_level` (fallback `alert.rule.severity`), `·`, rule `alert.rule.id`                                                                                           |
  | `secret_scanning_alert` | `alert.secret_type_display_name`  | `alert.secret_type`                                                                                                                                                                                 |

- **Required fields and shape.** A delivery is reported only when `alert` is an object, `alert.number` a whole number
  from 1 to 2^53 − 1, and `alert.html_url` and `repository.full_name` strings; in addition a Dependabot alert needs
  `alert.security_advisory` as an object, a code scanning alert `alert.rule` as an object and `ref` and
  `repository.default_branch` as strings, a secret scanning alert `alert.secret_type` as a string. Anything else gives
  `no-match`; the event header is not signed, so this also keeps out a payload of another event.
- **Code scanning: default branch only.** `created`, `reopened` and `appeared_in_branch` are reported only when `ref`
  is `refs/heads/<repository.default_branch>` or exactly `<repository.default_branch>`; a pull request ref
  (`refs/pull/<n>/merge`), another branch, a tag, an empty or missing `ref` triggers nothing. Each alert is thus reported
  once, when it reaches the default branch, and a draft pull request triggers nothing.
- **Secrets.** The secret scanning rule reads exactly `alert.number`, `alert.html_url`, `alert.secret_type`,
  `alert.secret_type_display_name` and `repository.full_name`. No part of a secret reaches an outbox row, a message or
  a log entry, whether or not the payload carries it (`alert.secret`, `resolution_comment`, a location field): a field
  that is not read cannot be shown.
- **Whatever its source.** A secret scanning alert names no branch or pull request, so it is reported even when the
  secret was pushed to a draft pull request or written into its text. This is the second exception to "a draft pull
  request triggers no notification" ([Draft lookup](#draft-lookup)). Dependabot alerts stay under the guarantee.
- **Documented, not observed.** Every field path comes from GitHub's OpenAPI webhook schemas, and the fixtures are
  reference-built from them: no real delivery of these events was observed. The residual risk (accepted in decision 0028) is a path, a `ref` format, an action name or the presence of `alert.secret` that differs in real deliveries;
  because only an allow-list of fields is read, such a difference can shorten a line or silence an alert, never leak a
  secret.

#### Draft lookup

- After the rules, each notification with a draft check (only the CI failure in a pull request, so at most one per
  delivery) is resolved before the delivery is recorded. A notification whose switch is off has been dropped by then,
  so it causes no lookup.
- The lookup asks GitHub for the pull request's draft state as the app, with the installation of the delivery's
  `installation.id` ([GitHub API](github-api.md#pull-request-read)). A draft drops the notification; a pull request
  that is not a draft keeps it as it is; any failure keeps it with the title `CI failed in pull request (draft status
unknown)` (German `CI im Pull Request fehlgeschlagen (Draft-Status unbekannt)`).
- A failure is every failure result of the GitHub API client, an `installation.id` that is not a whole number from 1 to
  2^53 − 1 (then nothing is asked), and a lookup that has not finished 8 seconds after it started: GitHub ends a
  delivery not answered within 10 seconds. A lookup cut off this way may still finish in the background; its result
  is not used. The draft checks of one delivery run concurrently, each cut off after 8 seconds, so the 8-second budget
  holds however many rules set a draft check.
- This is one of the two exceptions to "a draft pull request triggers no notification": a pull request whose draft
  state could not be read is reported, marked _draft status unknown_ (the other: a secret scanning alert, [Security
  alert rules](#security-alert-rules)).
- When the lookup drops the only notification, the decision is `no-match`.
- A delivery whose id is already recorded on arrival causes no lookup. Two deliveries of one id processed at once may
  each make a lookup; only one of them is stored.

### Message format

An `outbox` row holds the notification itself, not a message for one messenger. A new row's `text` is the JSON object
`{"title":…,"repository":…,"number":…,"subject":…,"context":…}` (keys in this order; `number` is `null` when there is
none), so it always starts with `{`; every row written by an earlier version starts with `<b>` (old-form row, below).
No migration changes the column: it is still `text` ([Storage](storage.md)).

- Each text (title, repository, line 2 = `subject`, line 3 = `context`) is cleaned before it is stored, by
  `storedNotificationOf`:
  1. a lone surrogate is replaced by U+FFFD;
  2. each control character (U+0000 to U+001F, U+007F to U+009F) and the line and paragraph separators U+2028 and
     U+2029 are replaced by a space;
  3. the directional formatting characters U+061C, U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069 are removed;
  4. leading and trailing spaces are removed;
  5. a text longer than its limit is cut to the limit, its last kept code point replaced by `…` (U+2026). The
     limits count code points of the decoded text: title 64, repository 140, line 2 and line 3 256 each.
     Nothing is escaped in the stored row. The number is stored only when it is a whole number from 1 to 2^53 − 1.
- The button URL is stored in `button_url` only when it parses as a URL with the scheme `https`, the host
  `github.com`, no user name or password, and at most 2,048 characters in its normalized form, which is what is stored;
  otherwise the row has no button URL and the message is sent without a button.
- A new row is written with `silent` 0; whether it is sent without sound is decided when it is sent
  ([Quiet hours](#quiet-hours)). The release notice of the daily release check is a second kind of row besides the
  rules' notifications: the title, the repository `LarsLaskowski/Seluna` and line 2 are fixed texts and the parsed version numbers,
  stored without cleaning or cutting, and the button URL is built from the same numbers
  ([Scheduled jobs](scheduled-jobs.md#release-message)).
- **Telegram rendering** (`renderTelegramText`, at send time): every field is cleaned and cut again, which changes
  nothing for a row this version wrote, and escaped. Line 1 is the title in bold (`<b>…</b>`), then `·`, the
  repository and, when there is a number, ` #` and the number; line 2 and line 3 follow, each on its own line, an
  empty one left out; lines are separated by a single line feed. `&`, `<` and `>` are replaced by `&amp;`, `&lt;` and
  `&gt;`, in this order, so a text that already contains an entity is shown as written. The text is sent with
  `parse_mode` `HTML`. It is the same text the earlier version stored when the row was written.
- Cleaning keeps a text from breaking the three-line layout and removes the invisible characters that reorder text
  around them; it does not stop ordinary right-to-left letters in a title or repository from reordering the
  neutral characters `·` and `#` of line 1 on screen.
- **Old-form rows** (written by an earlier version, `text` starting with `<b>`) keep their Telegram HTML. Telegram
  sends their `text` unchanged. Any other channel receives the notification recovered from it
  (`legacyNotificationOf`): the first line must start with `<b>`, the title runs to the first `</b> · `, the rest is the
  repository, a trailing ` #` and 1 to 16 digits (first not `0`, a safe integer) is cut off as the number, lines 2 and 3
  are the further lines (a missing one is empty), and `&lt;`, `&gt;`, `&amp;` are decoded once, in this order. A text of
  more than three lines or of another shape cannot be recovered; the channel then counts a failed attempt. The parsing
  uses `startsWith` and `indexOf`, no regular expression with unbounded groups.
- **Damaged rows**: a row whose `text` starts with `{` but is not a valid stored notification (not JSON, not an object,
  a missing or mistyped field, a number that is not a whole number from 1 to 2^53 − 1), or whose `text` is not a
  string, is damaged. It is never sent: the attempt is counted as `failed`, no channel is called, and the other rows
  of the batch are still sent. A row without a decoded notification whose `text` starts with `{` is decoded or
  marked damaged the same way when it is sent, so raw JSON never goes out as a message.

### Languages

- The texts of the messages live in one table per language, English and German, that must have the same keys:
  a table with a missing key does not compile.
- The rules write the title and line 3 in the notification language of the settings, read when the delivery is
  processed.
- The tables hold the titles and line 3 of the pull request rules ([Pull request rules](#pull-request-rules)), and
  the titles of the CI failure rules with the draft-unknown title ([CI failure rules](#ci-failure-rules),
  [Draft lookup](#draft-lookup)), and the titles of the security alert rules
  ([Security alert rules](#security-alert-rules)): _Dependabot alert_, _Code scanning alert_, _Secret scanning alert_
  (German _Dependabot-Warnung_, _Code-Scanning-Warnung_, _Secret-Scanning-Warnung_), and the title and line 2 of the
  release notice ([Scheduled jobs](scheduled-jobs.md#release-message)).
- The button reads _Open on GitHub_ in English and _Auf GitHub öffnen_ in German. Its language is the notification
  language at the time the row is sent, so a row still pending when the owner switches the language keeps its text
  and gets the button in the new language.

### Delivery channels

Rows are sent through exactly one **delivery channel**. Telegram is the only one registered today; the registry
(`src/channels/registry.ts`) lists the channels in display order, and the stored notification is rendered by the
channel that sends it.

- The active channel is the `settings` key `delivery_channel` ([Storage](storage.md)); a missing value or one
  that names no registered channel (also with different case or padding) reads as `telegram`, or as the first
  registered channel if Telegram is not registered. The owner changes it on the start page ([Setup
  wizard](setup-wizard.md#messengers)).
- A batch of rows (the rows of a delivery, the rows of one cron retry run, the release notice) reads the active channel
  once and asks it for its destination once (`prepare`); the whole batch is sent through that channel, even when the
  owner switches the channel while it runs. The next batch uses the new one. A D1 error in either step is
  `store-failed` for every row of the batch, the rows unchanged.
- There is no fallback: while the active channel is not ready (`no-token`, `no-chat`), no channel is called and no row
  changes, damaged rows included; they wait. A row's `attempts` are kept across a switch and the next attempt is counted
  on top.
- A channel gets the row's content (the notification, or the `text` of an old-form row), the button URL and, per
  attempt, the `silent` flag ([Quiet hours](#quiet-hours)), the button label in the notification language and the row
  id. It answers `sent`, `rejected` (the destination refuses its credentials; logged `token-rejected`), `rate-limited`
  or `failed`.
- **Shared HTTP rules** (`src/channels/http.ts`, used by the Telegram client): one JSON `POST` per request with
  `content-type: application/json`, aborted after 10 seconds; the answer is read at most 1 MiB, counted in bytes
  before decoding, for a 2xx and for a 429 only (the body of any other status is cancelled unread); a 2xx answer that
  is not UTF-8 JSON or above the limit is `failed`; a 429 whose body is above the limit or unreadable is a 429 without a
  retry hint (`rate-limited`, no retry). After a 429 whose retry hint is a whole number from 1
  to 5 seconds the request is sent once more after that wait, within the same attempt; a rejected wait is `failed`.
  Requests follow redirects as `fetch` does by default (`redirect: "follow"`), because Telegram's fixed host never
  redirects; the first channel with a server address chosen by the owner must decide on this consciously. Network
  errors and their causes are dropped, only the fixed result is kept.
- Nothing under `src/rules/` may import a channel, the message or notification modules, the Telegram client or the
  delivery: an ESLint rule (`no-restricted-imports`) checks it in the _Analyzer gate_.

### Sending a row

- The new rows of a delivery are sent one after the other after the answer, within the time the platform grants
  after a response (about 30 seconds, according to Cloudflare's documentation); a send cut off by it leaves its row
  pending. Each row goes through the active channel ([Delivery channels](#delivery-channels)).
- **Telegram.** The chat is the Worker secret `TELEGRAM_CHAT_ID` when it is a non-empty string; it must then be a chat
  id (`^-?[1-9]\d{0,15}$`, a safe integer), and when it is not, no chat is configured — the stored chat is not used in
  its place. Without that secret it is the `settings` key `telegram_chat_id`, when it is a chat id. The bot token is
  the Worker secret `TELEGRAM_BOT_TOKEN` when it is a non-empty string, otherwise the token saved in the setup wizard
  (read from D1 and decrypted for each batch of rows), in either case only in the bot token form; a malformed Worker
  secret is not replaced by the saved token ([Setup wizard](setup-wizard.md#the-bot-token)).
- Without a usable bot token or chat, Telegram is not called and the row stays `pending` with its attempts
  unchanged: the result is `no-token` when no token is set or saved, the Worker secret is malformed, the saved token
  cannot be read with the current `SELUNA_SECRET` or its row is damaged, or there is no usable `SELUNA_SECRET`;
  `no-chat` without a chat. A D1 error while reading the channel, the token or the chat is `store-failed`, with the
  row unchanged.
- Otherwise one attempt is one `sendMessage` request with `chat_id`, `text`, `parse_mode` `HTML`,
  `link_preview_options` with `is_disabled` true (a link in an attacker-chosen title builds no preview card),
  `disable_notification` (true when the send is silent, [Quiet hours](#quiet-hours)) and, when the row has a button
  URL, an inline keyboard with one button (label, URL). The request is the same as before channels existed. An
  attempt counts one in `attempts`, whatever its outcome:
  - a successful answer (2xx and `ok` true) marks the row `sent`;
  - a 429 answer whose `parameters.retry_after` is a whole number from 1 to 5 makes the Worker wait that many
    seconds and send the same request once more, within the same attempt; the second answer decides as below,
    without a further wait;
  - any other answer — a 429 without a usable `retry_after` or with a longer one, a second 429, 401 or 404 (token
    rejected), another status, a network error or a timeout (10 seconds per request) — leaves the row `pending`
    for the cron; when that attempt is the row's fifth, the same update marks the row `failed` and it is never sent
    again ([Scheduled jobs](scheduled-jobs.md#retry)).
- A row is changed only while it is still `pending`. The rows of a delivery that the sending step finds failing do
  not stop the next row from being tried.
- A row is sent at least once, not exactly once: when marking a row `sent` fails after Telegram accepted it, the
  cron sends it again.

### Quiet hours

- Quiet hours are off by default; when they are on, the settings hold a start and an end time (`HH:MM`, 24-hour,
  start and end differ) and the time zone they are read in ([Storage](storage.md)).
- A send is silent (`disable_notification` true) when its row is marked `silent`, or when quiet hours are on and the
  time of the send lies in them. Otherwise it is sent with sound. Nothing is held back or delayed: a message inside
  the quiet hours is sent at once, without sound.
- The time of the send is one reading of the clock, taken just before the row's `sendMessage` request; the second
  request after a 429 is the same request and keeps its `disable_notification`. Each row of a delivery takes its own
  reading. A row sent again later (the cron) is silent or not by the time of that send, not by the time it was
  written. The settings are those read for the batch of rows being sent (for a new delivery: when it was processed).
- That time is converted to the wall-clock hour and minute of the configured time zone, including daylight saving
  time, and compared by the minute: the start minute is quiet, the end minute is not (22:00–07:00 is quiet from
  22:00:00 up to and including 06:59:59). A start later than the end spans midnight (22:00–07:00 covers 22:00 to
  23:59 and 00:00 to 06:59); `00:00` as the end means up to midnight.
- On the day daylight saving time begins, a wall-clock time inside the skipped hour never occurs, so quiet hours lying
  entirely inside it do not happen that day; on the day it ends, the repeated hour counts by its wall-clock time both
  times. Quiet hours that contain the changeover keep their wall-clock start and end, so they last an hour less or
  more that night.
- A time zone the runtime does not accept is read as UTC; a time that cannot be converted is not quiet. Deciding
  never fails a send.

### Log entries

- The request's log entry ([HTTP routes](http-routes.md#logging)) carries, besides delivery id and event, the
  payload's `action` when it matches `^[a-z_]{1,64}$`, the repository when `repository.full_name` matches
  `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, each `null` otherwise, and the decision: `reported` (at least one
  row written), `no-match` (no rule returned a notification, or the draft lookup dropped it), `disabled` (only rules whose switch is off did),
  `duplicate` (a known delivery id), `invalid` (a 400 of this processing) or `unavailable` (a 503 of this
  processing).
- Each row sent writes one log entry with exactly two fields: the row id and the result — `sent`, `rate-limited`,
  `token-rejected`, `failed`, `no-token`, `no-chat` or `store-failed` (the database could not be read or the row
  could not be updated). When that send was the row's fifth failed attempt and marked it `failed`, a second entry
  follows with exactly two fields: the row id and the status `failed`.
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
  counted before decoding ([HTTP routes](http-routes.md#request-body-size)); a 429 whose body is above the limit
  counts as `rate-limited`, without a retry.
- A stored row that cannot be read as a notification never stops the other rows ([Message format](#message-format)).

## Related decisions

- [`decisions/0023-webhook-processing-and-delivery-through-the-outbox.md`](../decisions/0023-webhook-processing-and-delivery-through-the-outbox.md)
  — the one-transaction deduplication, the text rendered when written (amended by 0038: the notification is stored and rendered when sent), the button label from
  the language at sending, the retry bound, 400 for an unprocessable signed delivery.
- [`decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md`](../decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md)
  — the neutral notification stored as JSON in `text` without a migration, rendered by the active channel, rows of
  the earlier version kept, no fallback.
- [`decisions/0024-pull-request-rules.md`](../decisions/0024-pull-request-rules.md) — the three pull request rules,
  `draft` required to be `false`, silence on an unexpected shape, line 3 with author and branches.
- [`decisions/0027-ci-failure-rules-and-the-draft-lookup.md`](../decisions/0027-ci-failure-rules-and-the-draft-lookup.md)
  — the two CI failure rules, the default branch told from a fork's branch, the draft check resolved by the processing
  within 8 seconds, the message sent with _draft status unknown_ on a failed lookup.
- [`decisions/0028-security-alert-rules.md`](../decisions/0028-security-alert-rules.md) — the three security alert
  rules, code scanning on the default branch only, secret scanning outside the draft guarantee, the field allow-list
  that keeps a secret out of rows, messages and logs.
- [`decisions/0025-quiet-hours-decided-at-sending.md`](../decisions/0025-quiet-hours-decided-at-sending.md) — quiet
  hours applied at each send rather than when the row is written, one clock reading per row, wall-clock times.
- [`decisions/0008-delivery-through-a-d1-outbox.md`](../decisions/0008-delivery-through-a-d1-outbox.md) — the
  outbox and the at-least-once delivery.
- [`decisions/0029-outbox-retry-and-cleanup-by-the-cron.md`](../decisions/0029-outbox-retry-and-cleanup-by-the-cron.md)
  — the fifth failed attempt marks a row `failed` in the update that counts it.
- [`decisions/0016-telegram-chat-in-the-setup-wizard.md`](../decisions/0016-telegram-chat-in-the-setup-wizard.md)
  — the chat, `TELEGRAM_CHAT_ID` and the Bot API client built from the reference.

## Not here

- The route, its status codes before this processing, the body size limit and the signature check:
  [HTTP routes](http-routes.md).
- The `deliveries`, `outbox` and `meta` tables and their columns: [Storage](storage.md).
- Choosing and proving the chat: [Setup wizard](setup-wizard.md#telegram-chat).
- Resending pending rows, marking rows `failed` and removing old rows, and the release notice:
  [Scheduled jobs](scheduled-jobs.md).
