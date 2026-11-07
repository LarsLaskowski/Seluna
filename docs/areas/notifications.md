# Notifications

## Scope

What happens to a webhook delivery after its signature was accepted: how a redelivery is recognized, how the
deliveries of other senders are bounded, how the notifications the rules return become `outbox` rows, the form of a
stored notification, its languages and the log entries. The owner relies on it to be told once about each case and
never lose a message; GitHub relies on the status codes. What the rules report is in
[Notification rules](notification-rules.md) and [Stars and forks](stars-and-forks.md); how a row is sent is in
[Delivery](delivery.md).

## Behavior

### Processing a delivery

A delivery reaches this processing only after the body size limit, the webhook secret and the signature were
checked ([HTTP routes](http-routes.md)). It is processed in this order; the first step that decides answers:

1. The `X-GitHub-Delivery` value must match `^[0-9A-Za-z-]{1,64}$` and the `X-GitHub-Event` value
   `^[a-z_]{1,64}$`; otherwise **400**, nothing stored.
2. A delivery id that `deliveries` already holds answers **200** and has no other effect: nothing is parsed, stored,
   sent or written to `meta`. Only a recorded delivery (step 6) has such a row; it is kept 7 days
   ([Scheduled jobs](scheduled-jobs.md#cleanup)), so a redelivery of it is recognized within that time; GitHub itself
   redelivers only within 3 days.
3. The body is read as the payload ([Payload](#payload)); a body that is not a JSON object answers **400**, nothing
   stored.
4. The notification settings and the stored owner of the app ([The sender](notification-rules.md#the-sender)) are
   read and the rules run ([Notification rules](notification-rules.md)); then the draft check of a notification that
   carries one is resolved ([Draft lookup](notification-rules.md#draft-lookup)), which may drop the notification or
   change its title.
5. **The hourly bound.** A delivery of `issues`, `issue_comment`, `star`, `fork`, `pull_request` or `workflow_run`
   that step 6 would record is first counted for its event in the current UTC hour, at most **20** per event and UTC
   hour, by one conditional statement on the `meta` row `delivery_count:<event>` ([Storage](storage.md#tables)).
   `issues`, `issue_comment`, `star` and `fork` deliveries are always counted; a `pull_request` or `workflow_run`
   delivery only when a stranger caused it, as [Pull request rules](notification-rules.md#pull-request-rules) and
   [CI failure rules](notification-rules.md#ci-failure-rules) define (implemented in `src/rules/stranger.ts`). A
   delivery that step 6 would not record (a draft, an action no rule reports, a switch that is off) is never counted,
   and security alert events are never counted. Past the bound the delivery is not recorded (as step 7) and the answer
   is **202** with the decision `limited`; the first such delivery of the event in the UTC hour also writes and sends
   the owner a limit notice ([Limit notice](#limit-notice)). The draft lookup of step 4 runs before this step, so a
   delivery past the bound has made its lookup already. A failure of the counter answers **503** and stores nothing.
6. A delivery with at least one `outbox` row or one `activity` change (the collected events or the removal of a star,
   [Stars and forks](stars-and-forks.md)) is recorded. In one transaction: the delivery (id, event, time received) is
   added to `deliveries`, one `outbox` row per notification is added ([Message format](#message-format)), the
   `activity` changes of the delivery are made, and `meta` `last_delivery` is set to the time received. Either all of
   it is stored or none of it. A delivery with no `activity` change does not touch the `activity` table.
7. Any other delivery (no row and no `activity` change), and a `limited` one, is not recorded: nothing of its own is
   added to `deliveries`, `outbox` or `activity`, and `meta` `last_delivery` is set only as
   [Storage](storage.md#tables) says, by one conditional statement. Besides that, a `limited` delivery can only write
   its limit notice to `outbox` and the `meta` row `limit_notice:<event>`; a failure of that write is ignored and the
   answer stays 202. A draft lookup of such a delivery may still refresh the installation-token cache.
8. The answer is **202**, whether or not a rule matched. The new `outbox` rows are sent after the answer
   ([Delivery](delivery.md#sending-a-row)).

- When the transaction fails because the delivery id was stored in the meantime (two deliveries of one id at once),
  the answer is **200** and nothing of this delivery is stored except its count of step 5. Any other database failure
  in steps 2 to 6 answers **503** and stores nothing except a count of step 5 that was already made.
- Every time of a delivery (time received, `created_at`, `last_delivery`) is the same reading of the clock, taken
  once per delivery.

### Limit notice

The first delivery of a bounded event that step 5 of [Processing a delivery](#processing-a-delivery) refuses in a UTC
hour tells the owner that messages were left out: at most one notice per event and hour, so at most six an hour.

- **When.** After `last_delivery` is refreshed, one conditional statement claims the `meta` row
  `limit_notice:<event>` for the hour (the key is built only from the six event names, [Storage](storage.md#tables));
  only the delivery whose statement changed the row, the first of the hour, goes on. Of concurrent refused deliveries
  exactly one gets the claim. It writes one `outbox` row (`silent` 0, no button, `created_at` the time received), which
  is sent after the answer like the rows of a recorded delivery. Every further refused delivery of the event in that
  hour costs the one statement and writes nothing. The delivery itself stays unrecorded and its decision stays
  `limited`.
- **Layout.** The title alone on line 1 (the repository is empty), line 2 and line 3, no button, no number. In
  English: title _Notifications left out_; line 2 `<kind>: more than 20 between <from> and <to> UTC`; line 3 _Further
  ones in that hour are not reported; GitHub still shows them._ `<from>` and `<to>` are the UTC hour as `HH:00` and
  the next one (23 reads `between 23:00 and 00:00 UTC`). The kind per event: `issues` _Issues_, `issue_comment`
  _Comments_, `star` _Stars and unstars_, `fork` _Forks_, `pull_request` _Pull requests_, `workflow_run` _CI
  failures_. The notice names the event and the hour, not how many deliveries were dropped nor which. Its language is
  the notification language of the settings ([Languages](#languages)).
- **Sending.** At once, also under a star and fork digest; silent per the quiet hours at the time of sending like every
  row ([Quiet hours](delivery.md#quiet-hours)); a row not sent is retried by the cron.
- **Failure.** A failure of the claim or of the row write is ignored: the answer stays 202 `limited` and nothing is
  sent. A failed row write after the claim loses that hour's notice, because the claim stays for the hour.
- **Redelivery.** A redelivery sends a notice only as the first refused delivery of its event in its hour.

### Payload

- When the media type of `Content-Type` (before any `;`, compared case-insensitively, surrounding spaces ignored) is
  `application/x-www-form-urlencoded`, the body is read as UTF-8 form data and must contain exactly one field
  `payload`, whose value is the JSON text. Any other or a missing `Content-Type` means the whole body is the JSON
  text.
- The body must be valid UTF-8 (an invalid byte sequence answers 400; a byte order mark is not removed and so makes
  the text invalid JSON). In the form framing a percent-encoded invalid sequence inside the `payload` value is not
  rejected: form decoding turns it into U+FFFD, which cleaning later passes harmlessly. The JSON text must parse to a
  JSON object, not an array or another value.
- The payload is passed to the rules as it parsed. The processing itself reads only `action` and
  `repository.full_name`, for the log entry ([Log entries](#log-entries)).

### Message format

An `outbox` row holds the notification itself, not a message for one messenger; the channel that sends it renders it
([Delivery](delivery.md#telegram-rendering)). A new row's `text` is the JSON object
`{"title":…,"repository":…,"number":…,"subject":…,"context":…}` (keys in this order; `number` is `null` when there is
none), so it always starts with `{`; every row written by an earlier version starts with `<b>`
([Old-form rows](delivery.md#old-form-rows)). The column is still `text` ([Storage](storage.md#tables)).

- **Further lines.** A notification may also hold `lines`, at most 11 texts that follow line 3 (the activity digest
  uses them, [The digest](stars-and-forks.md#the-digest)). The key `lines` comes after `context` and is written only
  for a non-empty list; `lines` that is not an array of at most 11 strings makes the row damaged
  ([Damaged rows](delivery.md#damaged-rows)). An older version decodes a row without the key and so sends a digest as
  its title alone.
- **Cleaning.** Each text (title, repository, line 2 = `subject`, line 3 = `context`) is cleaned before it is stored:
  1. a lone surrogate is replaced by U+FFFD;
  2. each control character (U+0000 to U+001F, U+007F to U+009F) and the line and paragraph separators U+2028 and
     U+2029 are replaced by a space;
  3. the directional formatting characters U+061C, U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069 are removed;
  4. leading and trailing spaces are removed;
  5. a text longer than its limit is cut to the limit, its last kept code point replaced by `…` (U+2026). The limits
     count code points of the decoded text: title 64, repository 140, line 2 and line 3 256 each.

  Nothing is escaped in the stored row. The number is stored only when it is a whole number from 1 to 2^53 − 1.
  Cleaning keeps a text from breaking the three-line layout and removes the invisible characters that reorder text
  around them; it does not stop ordinary right-to-left letters in a title or repository from reordering the neutral
  characters `·` and `#` of line 1 on screen.

- **Button URL.** It is stored in `button_url` only when it parses as a URL with the scheme `https`, the host
  `github.com`, no user name or password, and at most 2,048 characters in its normalized form, which is what is
  stored; otherwise the row has no button URL and the message is sent without a button.
- **Kinds of rows.** Every new row is written with `silent` 0; whether it is sent without sound is decided when it is
  sent ([Quiet hours](delivery.md#quiet-hours)). Besides the rules' notifications there are two kinds of rows: the
  release notice of the daily release check, whose title, repository `LarsLaskowski/Seluna` and line 2 are fixed texts
  and the parsed version numbers, stored without cleaning or cutting, with a button URL built from the same numbers
  ([Scheduled jobs](scheduled-jobs.md#release-message)); and the limit notice, fixed texts with an empty repository, no
  number and no button ([Limit notice](#limit-notice)).

### Languages

- The texts of the messages live in one table per language, English (`src/i18n/en.ts`) and German
  (`src/i18n/de.ts`), which must have the same keys: a table with a missing key does not compile. The English texts
  quoted in the area documents identify a case; the German ones are their translation in that table.
- The tables hold the titles and the fixed parts of every message: the rules' titles and line 3 phrases, the
  draft-unknown title, the star, fork and digest parts, the limit notice, the release notice and the button label.
- The rules write the title and line 3 in the notification language of the settings, read when the delivery is
  processed; the digest is written in the language read when it is built.
- The button reads _Open on GitHub_ in English. Its language is the notification language at the time the row is
  sent, so a row still pending when the owner switches the language keeps its text and gets the button in the new
  language.

### Log entries

- The request's log entry ([HTTP routes](http-routes.md#logging)) carries, besides delivery id and event, the
  payload's `action` when it matches `^[a-z_]{1,64}$`, the repository when `repository.full_name` matches
  `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, each `null` otherwise, and the decision:
  - `reported`: at least one row written;
  - `collected`: only `activity` rows written ([Stars and forks](stars-and-forks.md#collecting));
  - `no-match`: no rule returned a notification, or the draft lookup dropped it;
  - `disabled`: only rules whose switch is off returned one;
  - `limited`: a counted delivery past the hourly bound, never recorded;
  - `duplicate`: a known delivery id (only a recorded delivery is known);
  - `invalid`: a 400 of this processing; `unavailable`: a 503 of this processing.

  A `no-match` or `disabled` delivery is not recorded unless it removes a star.

- Each row sent writes one log entry with exactly two fields: the row id and the result — `sent`, `rate-limited`,
  `token-rejected`, `failed`, `no-token`, `no-chat` or `store-failed` (the database could not be read or the row could
  not be updated, [Delivery](delivery.md#sending-a-row)). When that send was the row's fifth failed attempt and marked
  it `failed`, a second entry follows with exactly two fields: the row id and the status `failed`.
- No log entry holds a payload text (title, branch, commit message, alert text), a message text, a chat id, the bot
  token or a Telegram answer.

## Limits and errors

- A delivery answered 400 or 503 stores nothing and GitHub does not send it again on its own; the owner can redeliver
  it from the GitHub App's delivery list, which works because its id was not recorded. This is accepted: the "never
  lose a message" goal covers rows already in the `outbox`, not deliveries that were never recorded.
- A delivery that was not recorded (step 7), a `limited` one included, is evaluated again when GitHub or the owner
  redelivers it, against the settings and draft state of then; it can report then, once. A redelivery of a recorded
  delivery answers 200.
- A throwing rule or formatter answers 503 `unavailable` and stores nothing, like a database failure.
- The signature covers the body only, not `X-GitHub-Delivery` or `X-GitHub-Event`. Residual risk, inherent to GitHub's
  webhook design: someone holding a captured signed body can replay it with a new delivery id and cause a second
  message (also after the cleanup removed the `deliveries` row of a recorded delivery: the signature has no
  timestamp), or change the event header so the payload reaches the rules of another event. The rules therefore check
  that the payload's shape matches the event and do not rely on the header alone.
- 200, 202, 400 and 503 of this processing carry no body, as every answer of `POST /webhook` does.
- A database failure, a failing send and a Telegram error never reach a response or a log entry with their message;
  only the fixed decision or result above is logged.

## Related decisions

- [`decisions/0023-webhook-processing-and-delivery-through-the-outbox.md`](../decisions/0023-webhook-processing-and-delivery-through-the-outbox.md)
  — the one-transaction deduplication, 400 for an unprocessable signed delivery.
- [`decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md`](../decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md)
  — the neutral notification stored as JSON in `text` without a migration, rows of the earlier version kept.
- [`decisions/0043-only-deliveries-with-an-effect-are-recorded.md`](../decisions/0043-only-deliveries-with-an-effect-are-recorded.md)
  — only a delivery with an `outbox` row or an `activity` change is recorded; `last_delivery` is kept by a bounded
  write; the hourly bound per event and the limit notice.
- [`decisions/0008-delivery-through-a-d1-outbox.md`](../decisions/0008-delivery-through-a-d1-outbox.md) — the outbox
  written before delivery is attempted.

## Not here

- The route, its status codes before this processing, the body size limit and the signature check:
  [HTTP routes](http-routes.md).
- <a id="rules"></a><a id="pull-request-rules"></a><a id="ci-failure-rules"></a><a id="security-alert-rules"></a><a id="issue-and-comment-rules"></a><a id="the-sender"></a><a id="draft-lookup"></a>What
  each rule reports, the sender and the draft lookup: [Notification rules](notification-rules.md).
- <a id="stars-and-forks"></a><a id="the-digest"></a>The star and fork rules, collecting them and the digest's
  content: [Stars and forks](stars-and-forks.md).
- <a id="delivery-channels"></a><a id="sending-a-row"></a><a id="quiet-hours"></a>The delivery channels, rendering
  and sending a row, the quiet hours: [Delivery](delivery.md).
- The `deliveries`, `outbox`, `activity` and `meta` tables and their columns: [Storage](storage.md).
- Choosing and proving the chat and activating a messenger: [Telegram step](telegram-step.md),
  [Status page](status-page.md#messengers).
- Resending pending rows, marking rows `failed`, removing old rows, building the digest and the release notice:
  [Scheduled jobs](scheduled-jobs.md).
