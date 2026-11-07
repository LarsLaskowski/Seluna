# Stars and forks

## Scope

The two rules that report a new star and a new fork of the owner's repositories, the collecting of both into the
`activity` table when the owner chose a digest, the removal of a collected star, and the content of the digest
message. The owner relies on it to hear about stars and forks by others without one message per event; the cron
decides when a digest is built and sent ([Scheduled jobs](scheduled-jobs.md#digest)).

## Behavior

### Star and fork rules

Two rules report the events `star` and `fork` (decision
[0041](../decisions/0041-fork-and-star-rules-with-a-digest.md)). They follow the rule interface of
[Notification rules](notification-rules.md#rule-interface). Their switches are **off** by default, and the setting
_Stars and forks_ (`activity_digest`, [Storage](storage.md#tables)) decides whether each event is sent at once or
collected into a digest.

| Switch id            | Event  | Reported `action`           | Case                            | Title      |
| -------------------- | ------ | --------------------------- | ------------------------------- | ---------- |
| `repository_starred` | `star` | `created`                   | an account starred a repository | `New star` |
| `repository_forked`  | `fork` | none (the payload has none) | an account forked a repository  | `New fork` |

Every other action of `star` (and a `fork` delivery with an `action` key) triggers nothing.

- **Lines.** A star: line 1 is the title and `repository.full_name`, line 2 is `by <author>` with `sender.login`, line
  3 is `<n> stars now` (`1 star now`) from `repository.stargazers_count`, with digits grouped by thousands in the
  notification language (`1,234` in English). The count 0 is valid; a count that is not a whole number from 0 to
  2^53 − 1 leaves line 3 empty. A fork: line 1 is the title and `repository.full_name` (the repository that was
  forked), line 2 is `forkee.full_name`, line 3 is `by <author>`. The button is `repository.html_url` for a star and
  `forkee.html_url` for a fork.
- **Required shape.** A star is reported only when `repository` is an object with a safe-integer `id` and a string
  `full_name`, and the sender is a foreign account ([The sender](notification-rules.md#the-sender)) with a string
  `login`. A `repository.html_url` that is not a string gives an empty URL, which sends no button. A fork also needs
  `forkee.full_name` and `forkee.html_url` to be strings. Anything else gives `no-match`.
- **Whose stars count.** The owner's own star or fork and a bot's are left out. With an organization owner or an owner
  not stored yet every account counts as foreign.
- **The hourly bound.** `star` deliveries (stars and unstars together) and `fork` deliveries that would be recorded
  are always counted against the hourly bound ([Processing a delivery](notifications.md#processing-a-delivery)). Past
  the bound a star or fork is neither collected nor sent and an unstar removes nothing, because the delivery is not
  recorded.

### Collecting

- Under the interval _Hourly_ or _Daily at_ a star or fork is not written to the `outbox`: the processing stores it as
  a row of the `activity` table in the delivery's transaction ([Storage](storage.md#tables)), with the account id, the
  login and the repository name cleaned like the fields of a stored notification
  ([Message format](notifications.md#message-format)), the repository's button URL (only when it passes the button
  URL rule), the star count (stars only) and the time received. The decision is `collected` when a delivery wrote only
  such rows.
- Under _Immediately_ both rules write an `outbox` row per event like every other rule. A switch that is off collects
  nothing, whatever the interval.
- A redelivered delivery collects nothing a second time (step 2 of
  [Processing a delivery](notifications.md#processing-a-delivery)).

### Unstar

- A `star` delivery with the action `deleted` removes the collected star rows of that account on that repository, in
  the delivery's transaction, in every interval, while _New star_ is on and the sender is foreign. It sends nothing and
  alone it is `no-match`.
- A star that was already sent in a digest or message is not taken back. A star that was never collected is a removal
  that deletes nothing.

### The digest

The digest collects the stars and forks of the interval into one message.

- **Content.** The title alone on line 1, bold: `New stars and forks`, with no repository. Then one line per
  repository, busiest first (stars plus forks, ties by repository name in binary order), at most 10:
  `<repository>: <star part>, <fork part> · <names>`. The star part is `+<n> ⭐` and, when the newest collected star
  carries a count, ` (now <total>)`; the fork part is `+<n> fork` or `+<n> forks`. A part with no events is left out
  with its `, `. `<names>` are the logins of the first at most 5 accounts, in the order of their first event, then
  ` and <k> more` for the accounts left out; an account counts once however many events it caused. Digits are grouped
  by thousands. With more than 10 repositories the last line is `and <n> more repositories`. The English texts are
  quoted; the German ones are in `src/i18n/de.ts`.
- **The repository's name and URL** are those of its newest collected event, so a renamed repository shows its new
  name.
- **Button.** The repository's URL when the digest names exactly one repository, otherwise none.
- **Storage.** The digest is one notification whose repository lines are its further `lines`
  ([Message format](notifications.md#message-format)).
- **Length.** Telegram accepts 4,096 characters after its entities are parsed. The title, the lines and the line feeds
  between them are kept within 4,000 UTF-16 code units: repository lines are dropped from the end, counted into
  `and <n> more repositories`, until they fit. The uncapped worst case is the title (64 code points) and 11 lines of
  256 code points, which is 2,880 code points and up to 5,760 UTF-16 code units with astral characters; with ASCII
  logins and repository names the cap is never reached (about 2,900). The bold tags and the escaping of `&`, `<` and
  `>` do not count toward Telegram's limit; the unescaped text is exactly what the cap measures.
- **Counting.** All counts are exact (made in SQL), whatever the number of events; only collected events of the last 7
  days are counted. An event collected while a digest is built stays for the next digest.
- **Settings.** The digest is written in the notification language at the time it is built; the button language and
  the quiet hours follow the sending ([Quiet hours](delivery.md#quiet-hours)).

## Limits and errors

- **The table is missing.** Where the migration `0002` was not applied, a delivery that has to collect an event or
  remove a star answers **503** and stores nothing, like any database failure; every other delivery is unaffected.
- **Documented, not observed.** The `fork/fork.json` and `star/created.json` fixtures are shaped from GitHub's webhook
  documentation, and `star/deleted.json` is reference-built from it, none captured. The residual risk is a field path
  that differs in real deliveries, which would send or collect nothing.
- Logins and repository names are text of the stranger's choosing; they are cleaned and cut when they are collected
  and cleaned and escaped again when the digest is rendered ([Telegram rendering](delivery.md#telegram-rendering)).

## Related decisions

- [`decisions/0041-fork-and-star-rules-with-a-digest.md`](../decisions/0041-fork-and-star-rules-with-a-digest.md) —
  the star and fork rules, the `activity` table, the digest as further lines of a stored notification, digest times
  after the previous run.
- [`decisions/0040-issue-and-comment-rules.md`](../decisions/0040-issue-and-comment-rules.md) — an unknown or
  organization owner counts every account as foreign.

## Not here

- When the digest is built and sent, and the cleanup of stale `activity` rows: [Scheduled jobs](scheduled-jobs.md).
- The `activity` table and the `activity_digest` setting: [Storage](storage.md).
- The other rules and the sender: [Notification rules](notification-rules.md).
- Choosing the interval in the settings form: [Status page](status-page.md#settings).
