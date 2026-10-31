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
   sent or written to `meta`. Only a recorded delivery (step 5) has such a row; it is kept 7 days
   ([Scheduled jobs](scheduled-jobs.md#cleanup)), so a redelivery of it is recognized within that time.
3. The body is read as the payload (below); a body that is not a JSON object answers **400**, nothing stored.
4. The notification settings and the stored owner of the app ([The sender](#the-sender)) are read and the rules run
   (below); then the draft check of a notification that carries
   one is resolved ([Draft lookup](#draft-lookup)), which may drop the notification or change its title.
5. A delivery with at least one `outbox` row or one `activity` change (the collected events or the removal of a
   star) is recorded. In one transaction: the delivery (id, event, time received) is added to `deliveries`, one `outbox` row per
   notification is added (the notification as JSON, [Message format](#message-format)), the `activity` changes of
   the delivery are made ([Stars and forks](#stars-and-forks): the collected events and the removal of a star), and
   `meta` `last_delivery` is set to the time received. Either all of it is stored or none of it. A delivery with no
   `activity` change does not touch the `activity` table.
6. Any other delivery (no row and no `activity` change) is not recorded: nothing is added to `deliveries`, `outbox`
   or `activity`, and `meta` `last_delivery` is set only as [Storage](storage.md#tables) says, by one
   conditional statement. A failure of that write is ignored and the answer stays 202. Nothing else changes: a
   draft lookup of such a delivery may still refresh the installation-token cache, as before.
7. The answer is **202**, whether or not a rule matched. The new `outbox` rows are sent after the answer (below).

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

- A rule is a pure function of the event name (`X-GitHub-Event`), the payload, the notification settings
  ([Storage](storage.md)) and the stored owner of the app (a value, or none when unknown) that returns one
  notification or none. The owner is read by the processing once per delivery, beside the settings; no rule reads the
  database. A rule reads no clock and no network, and it narrows every payload field it reads; an unexpected shape
  returns none.
- Every rule has the id of its switch in the settings. All rules run on every delivery; a notification of a rule
  whose switch is off is dropped.
- A notification holds: the title of the case (line 1, in the notification language, chosen by the rule), the
  repository as `owner/repo`, the number of the pull request, issue or alert (or none), line 2, line 3 and the URL for the
  button (the `html_url` of the payload). A notification that may only be sent for a pull request that is not a draft
  also holds a draft check: the pull request (owner, repository name, number) and the title to use when its draft
  state is unknown, or none, which drops the notification when its draft state is unknown.
- The rules run in the order of the switches in the settings. The pull request rules and the CI failure rules are
  below, then the security alert rules and the issue and comment rules.

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
  filter by sender or reviewer, and a fork's branch is shown without its owner. The helpers a later rule can use to
  tell the owner's own actions and bots apart are in [The sender](#the-sender).
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

#### Issue and comment rules

Three rules report the events `issues` and `issue_comment` (decision
[0040](../decisions/0040-issue-and-comment-rules.md)). No new permission, event or setting beyond the three switches,
on by default.

| Switch id              | Event           | Reported `action` | Case                                                | English title                 | German title                       |
| ---------------------- | --------------- | ----------------- | --------------------------------------------------- | ----------------------------- | ---------------------------------- |
| `issue_opened`         | `issues`        | `opened`          | a new issue                                         | `New issue`                   | `Neues Issue`                      |
| `issue_comment`        | `issue_comment` | `created`         | a comment on an issue (`issue.pull_request` absent) | `New comment on issue`        | `Neuer Kommentar zum Issue`        |
| `pull_request_comment` | `issue_comment` | `created`         | a comment on a pull request's conversation          | `New comment on pull request` | `Neuer Kommentar zum Pull Request` |

Every other action (`edited`, `deleted`, `closed`, `reopened`, `transferred`, `labeled`, or one GitHub adds later)
triggers nothing.

- **Lines.** Line 1 is the title, `repository.full_name` and `issue.number`; line 2 is `issue.title`; line 3 is
  `by <author> · <excerpt>` (German `von <author> · <excerpt>`), the author being `issue.user.login` for a new issue
  and `comment.user.login` for a comment, the excerpt the beginning of `issue.body` or `comment.body`. The button is
  `issue.html_url` for a new issue and `comment.html_url` for a comment. Line 2 and line 3 are cut to 256 code points
  like every field ([Message format](#message-format)).
- **The excerpt.** HTML comments (`<!-- … -->`, as issue templates leave them) are removed first, an unterminated
  `<!--` together with everything after it; then every run of white space becomes one space and the ends are trimmed.
  Other Markdown is shown as written. The scan is one linear pass that stops at 257 code points (one more than line 3's
  limit, so the store still cuts and marks it), whatever the size of the body. A body that is empty, `null`, missing,
  blank or only comments gives line 3 `by <author>` alone; the case is still reported.
- **Required shape.** A delivery is reported only when `issue` and `comment` (for a comment) are objects,
  `issue.number` is a whole number from 1 to 2^53 − 1, `issue.title`, `issue.html_url`, `issue.user.login`,
  `comment.html_url`, `comment.user.login` and `repository.full_name` are strings, each `body` is a string, `null` or
  missing, `issue.pull_request` is missing or an object and `issue.draft` is missing or a boolean. A delivery that
  carries a `comment` under the `issues` header is another event's payload: `issue_opened` returns nothing for it, as
  it does when `issue.pull_request` is present. Anything else gives `no-match`.
- **The draft pull request.** `pull_request_comment` reports a comment only on a pull request that is not a draft:
  `issue.draft` `true` triggers nothing, `false` reports without a check, and when the field is absent the
  notification carries a draft check ([Draft lookup](#draft-lookup)) whose unknown state drops the notification
  instead of retitling it. A comment on a draft pull request, or on one whose draft state cannot be determined, is
  thus never reported: neither exception to the guarantee is extended.
- **Volume.** On a public repository anyone can open an issue or comment, so each stranger's issue or comment gives one
  message with text of their choosing; Telegram apps still turn URLs, `@mentions` and `/commands` into tappable
  links. No rate limit exists.
- **Documented, not observed.** The fixtures are reference-built from GitHub's webhook documentation, not captured.
  The residual risk (decision 0040) is a field path, an action name or the place of `issue.draft` that differs in real
  deliveries; each such difference sends nothing. A live check on a deployed copy confirms the cases.

#### Stars and forks

Two rules report the events `star` and `fork` (decision
[0041](../decisions/0041-fork-and-star-rules-with-a-digest.md)). Their switches are **off** by default, and a third
setting, _Stars and forks_, decides whether each event is sent at once or collected into a digest.

| Switch id            | Event  | Reported `action`           | Case                            | English title | German title  |
| -------------------- | ------ | --------------------------- | ------------------------------- | ------------- | ------------- |
| `repository_starred` | `star` | `created`                   | an account starred a repository | `New star`    | `Neuer Stern` |
| `repository_forked`  | `fork` | none (the payload has none) | an account forked a repository  | `New fork`    | `Neuer Fork`  |

Every other action of `star` (and a `fork` delivery with an `action` key) triggers nothing.

- **Lines.** A star: line 1 is the title and `repository.full_name`, line 2 is `by <author>` (German `von <author>`)
  with `sender.login`, line 3 is `<n> stars now` (`1 star now`; German `jetzt <n> Sterne`, `jetzt 1 Stern`) from
  `repository.stargazers_count`, with digits grouped by thousands (`1,234`; German `1.234`). The count 0 is valid. A
  count that is not a whole number from 0 to 2^53 − 1 leaves line 3 empty. A fork: line 1 is the title and
  `repository.full_name` (the repository that was forked), line 2 is `forkee.full_name`, line 3 is `by <author>`.
  The button is `repository.html_url` for a star and `forkee.html_url` for a fork.
- **Required shape.** A star is reported only when `repository` is an object with a safe-integer `id` and a string
  `full_name`, and `sender` is a foreign account ([The sender](#the-sender)) with a string `login`. `repository.html_url`
  that is not a string gives an empty URL, which sends no button. A fork also needs `forkee.full_name` and
  `forkee.html_url` to be strings. Anything else gives `no-match`.
- **Whose stars count.** The owner's own star or fork and a bot's are left out. With an organization owner or an
  owner not stored yet every account counts as foreign (decision 0040).
- **Collecting.** Under the interval _Hourly_ or _Daily at_ a star or fork is not written to the `outbox`: the
  processing stores it as a row of the `activity` table in the delivery's transaction ([Storage](storage.md#tables)),
  with the account id, the login and the repository name cleaned like the fields of a stored notification
  ([Message format](#message-format)), the repository's button URL (only when it passes the button URL rule), the
  star count (stars only) and the time received. The decision is `collected` when a delivery wrote only such rows.
  Under _Immediately_ both rules write an `outbox` row per event like every other rule. A switch that is off collects
  nothing, whatever the interval.
- **Unstar.** A `star` delivery with the action `deleted` removes the collected star rows of that account on that
  repository, in the delivery's transaction, in every interval, while _New star_ is on and the sender is foreign. It
  sends nothing and alone it is `no-match`. A star that was already sent in a digest or message is not taken back.
  A star that was never collected is a removal that deletes nothing.
- **Redelivery.** A redelivered delivery collects nothing a second time (step 2 of
  [Processing a delivery](#processing-a-delivery)).
- **The table is missing.** Where the migration `0002` was not applied, a delivery that has to collect an event or
  remove a star answers **503** and stores nothing, like any database failure; every other delivery is unaffected.
- **Documented, not observed.** The `fork/fork.json` and `star/created.json` fixtures are shaped from GitHub's
  webhook documentation, and `star/deleted.json` is reference-built from it, none captured. The residual risk is a
  field path that differs in real deliveries, which would send or collect nothing.

#### The digest

The digest collects the stars and forks of the interval into one message ([Scheduled jobs](scheduled-jobs.md#digest)
decides when it is built and sent).

- **Content.** The title alone on line 1, bold: `New stars and forks` (German `Neue Sterne und Forks`), with no
  repository. Then one line per repository, busiest first (stars plus forks, ties by repository name in binary
  order), at most 10:
  `<repository>: <star part>, <fork part> · <names>`. The star part is `+<n> ⭐` and, when the newest collected star
  carries a count, ` (now <total>)` (German ` (jetzt <total>)`); the fork part is `+<n> fork` or `+<n> forks` (German
  `Fork`, `Forks`). A part with no events is left out with its `, `. `<names>` are the logins of the first at most 5
  accounts, in the order of their first event, then ` and <k> more` (German ` und <k> weitere`) for the accounts left
  out; an account counts once however many events it caused. Digits are grouped by thousands. With more than 10
  repositories the last line is `and <n> more repositories` (German `und <n> weitere Repositories`).
- **The repository's name and URL** are those of its newest collected event, so a renamed repository shows its new name.
- **Button.** The repository's URL when the digest names exactly one repository, otherwise none.
- **Counting.** All counts are exact (made in SQL), whatever the number of events; only collected events of the last
  7 days are counted. An event collected while a digest is built stays for the next digest.
- **Settings.** The digest is written in the notification language at the time it is built; the button language and
  the quiet hours follow the sending ([Quiet hours](#quiet-hours)).

#### The sender

- The GitHub App is subscribed to the events `issues`, `issue_comment`, `fork` and `star` besides the five of the
  rules above (decision [0039](../decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)). They are
  accepted and answered like every other event, and recorded in `deliveries` only when they lead to a message or an
  `activity` change ([Processing a delivery](#processing-a-delivery)). The rules for issues and comments report
  them ([Issue and comment rules](#issue-and-comment-rules)); the rules for `fork` and `star` are in
  [Stars and forks](#stars-and-forks).
- Two helpers for those rules narrow the payload's `sender` and never throw (`src/rules/actor.ts`):
  - `isOwnAction(payload, owner)` is true only when the stored owner is a `User` and `sender.id` is a number equal to
    the owner's id; a renamed login changes nothing. A missing or non-object `sender`, a missing or non-numeric `id`,
    an unknown owner and an organization owner are all false: the sender of a delivery is a person, and Seluna
    cannot tell which member of an organization is its user, so for an organization's app every account's activity
    counts as foreign (the status page says so, [Setup wizard](setup-wizard.md#status-and-settings)).
  - `isBotSender(payload)` is true exactly when `sender.type` is the string `Bot`.
- The owner is the one stored beside the App ID ([Storage](storage.md#tables)); the processing reads it once per
  delivery, before the rules, for the App ID the Worker secret or the saved credential names ([GitHub
  API](github-api.md)). The three issue and comment rules read `sender`: a delivery is dropped (decision `no-match`)
  when `sender` is not an object with an `id` that is a safe integer (a whole number no larger than 2^53 − 1 in
  absolute value) and a string `type`, when `sender.id` is the id of a `User`
  owner, or when `sender.type` is `Bot` (a user whose login ends in `[bot]` is not a bot). With an organization
  owner, an owner not stored yet (an app created before this version whose status page was not viewed) or an owner row
  that is malformed or of another App ID, the owner's own issues and comments are reported like any other account's.
  A database failure while the owner is read answers **503** and stores nothing, as for the settings. The existing pull
  request and alert rules still do not read `sender`.

#### Draft lookup

- After the rules, each notification with a draft check (the CI failure in a pull request, or a comment on a pull
  request whose payload has no `issue.draft`; the two come from different events, so at most one per delivery) is
  resolved before the delivery is recorded. A notification whose switch is off has been dropped by then,
  so it causes no lookup.
- The lookup asks GitHub for the pull request's draft state as the app, with the installation of the delivery's
  `installation.id` ([GitHub API](github-api.md#pull-request-read)). A draft drops the notification; a pull request
  that is not a draft keeps it as it is; for the CI failure rule any failure keeps it with the title `CI failed in pull
request (draft status unknown)` (German `CI im Pull Request fehlgeschlagen (Draft-Status unbekannt)`), while a
  comment on a pull request is dropped (below).
- A failure is every failure result of the GitHub API client, an `installation.id` that is not a whole number from 1 to
  2^53 − 1 (then nothing is asked), and a lookup that has not finished 8 seconds after it started: GitHub ends a
  delivery not answered within 10 seconds. A lookup cut off this way may still finish in the background; its result
  is not used. The draft checks of one delivery run concurrently, each cut off after 8 seconds, so the 8-second budget
  holds however many rules set a draft check.
- This is one of the two exceptions to "a draft pull request triggers no notification": a pull request whose draft
  state could not be read is reported, marked _draft status unknown_ (the other: a secret scanning alert, [Security
  alert rules](#security-alert-rules)).
- A comment on a pull request ([Issue and comment rules](#issue-and-comment-rules)) is the second kind of check: it has
  no title for an unknown state, so any failure, the 8-second cut-off or a missing `installation.id` drops the
  notification instead of keeping it.
- When the lookup drops the only notification, the decision is `no-match`.
- A delivery whose id is already recorded on arrival causes no lookup. Two deliveries of one id processed at once may
  each make a lookup; at most one of them is stored.

### Message format

An `outbox` row holds the notification itself, not a message for one messenger. A new row's `text` is the JSON object
`{"title":…,"repository":…,"number":…,"subject":…,"context":…}` (keys in this order; `number` is `null` when there is
none), so it always starts with `{`; every row written by an earlier version starts with `<b>` (old-form row, below).
No migration changes the column: it is still `text` ([Storage](storage.md)).

- **Further lines.** A notification may also hold `lines`, at most 11 texts that follow line 3 (the activity digest
  uses them, [The digest](#the-digest)). The key `lines` comes after `context` and is written only for a non-empty
  list. `lines` that is not an array of at most 11 strings makes the row damaged (below). When it is rendered, each
  line is cleaned and cut to 256 code points, escaped in this order, and an empty one is left out. A row without `lines`
  is as before, and an older version decodes the row without the key and so sends a digest as its title alone.
- **The length of a digest.** Telegram accepts 4,096 characters after its entities are parsed. The digest builder
  keeps the title, the lines and the line feeds between them within 4,000 UTF-16 code units: it drops repository
  lines from the end, counting them into `and <n> more repositories`, until they fit. The uncapped worst case is the
  title (64 code points) and 11 lines of 256 code points, which is 2,880 code points and up to 5,760 UTF-16 code
  units with astral characters. With ASCII logins and repository names the cap is never reached (about 2,900). Telegram counts the text after parsing its entities, so the bold tags and the escaping of `&`, `<` and `>` do not count toward its limit; that unescaped text is exactly what the cap measures.

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
  empty one left out; then each further line of the notification (`lines`, below) the same way; lines are separated by
  a single line feed. When the cleaned repository is empty, line 1 is the title alone, without `·`. `&`, `<` and `>` are replaced by `&amp;`, `&lt;` and
  `&gt;`, in this order, so a text that already contains an entity is shown as written. The text is sent with
  `parse_mode` `HTML`. It is the same text the earlier version stored when the row was written.
- Cleaning keeps a text from breaking the three-line layout and removes the invisible characters that reorder text
  around them; it does not stop ordinary right-to-left letters in a title or repository from reordering the
  neutral characters `·` and `#` of line 1 on screen.
- **Old-form rows** (written by an earlier version, `text` starting with `<b>`) keep their Telegram HTML. Telegram
  sends their `text` unchanged. Any other channel receives the text and recovers the notification from it
  through `contentNotification` (`legacyNotificationOf`): the first line must start with `<b>`, the title runs to the first `</b> · `, the rest is the
  repository, a trailing ` #` and 1 to 16 digits (first not `0`, a safe integer) is cut off as the number, lines 2 and 3
  are the further lines (a missing one is empty), and `&lt;`, `&gt;`, `&amp;` are decoded once, in this order. A text of
  more than three lines or of another shape cannot be recovered (`contentNotification` returns `undefined`); a channel
  that renders the notification itself must then answer `failed`, which counts a failed attempt. Telegram is not
  affected: it sends the old text unchanged. The parsing
  uses `startsWith` and `indexOf`, no regular expression with unbounded groups.
- **Damaged rows**: a row whose `text` starts with `{` but is not a valid stored notification (not JSON, not an object,
  a missing or mistyped field, a number that is not a whole number from 1 to 2^53 − 1, `lines` that is not an array of
  at most 11 strings), or whose `text` is not a string, is damaged. It is never sent: the attempt is counted as `failed`, no channel is called, and the other rows
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
  (German _Dependabot-Warnung_, _Code-Scanning-Warnung_, _Secret-Scanning-Warnung_), the titles of the issue and
  comment rules and `by <author>` (German `von <author>`) of their line 3
  ([Issue and comment rules](#issue-and-comment-rules)), the titles of the star and fork rules, `<n> stars now`, and
  the digest's title and its star, fork and `and <k> more` parts ([Stars and forks](#stars-and-forks),
  [The digest](#the-digest)), and the title and line 2 of the
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
  row written), `collected` (only `activity` rows written, [Stars and forks](#stars-and-forks)), `no-match` (no rule returned a notification, or the draft lookup dropped it), `disabled` (only rules whose switch is off did),
  `duplicate` (a known delivery id; only a recorded delivery is known), `invalid` (a 400 of this processing) or `unavailable` (a 503 of this
  processing). A `no-match` or `disabled` delivery is not recorded unless it removes a star.
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
- A delivery that was not recorded (step 6) is evaluated again when GitHub or the owner redelivers it, against the
  settings and draft state of then; it can report then, once. A redelivery of a recorded delivery answers 200.
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
- [`decisions/0040-issue-and-comment-rules.md`](../decisions/0040-issue-and-comment-rules.md) — the three issue and
  comment rules, the owner read by the processing and passed to the rules, an unknown owner reported, the draft state
  from the payload with the lookup as fallback, an unknown state dropped, HTML comments removed from the excerpt.
- [`decisions/0041-fork-and-star-rules-with-a-digest.md`](../decisions/0041-fork-and-star-rules-with-a-digest.md) —
  the star and fork rules, the `activity` table, the digest as further lines of a stored notification, digest times
  after the previous run.
- [`decisions/0025-quiet-hours-decided-at-sending.md`](../decisions/0025-quiet-hours-decided-at-sending.md) — quiet
  hours applied at each send rather than when the row is written, one clock reading per row, wall-clock times.
- [`decisions/0008-delivery-through-a-d1-outbox.md`](../decisions/0008-delivery-through-a-d1-outbox.md) — the
  outbox and the at-least-once delivery.
- [`decisions/0029-outbox-retry-and-cleanup-by-the-cron.md`](../decisions/0029-outbox-retry-and-cleanup-by-the-cron.md)
  — the fifth failed attempt marks a row `failed` in the update that counts it.
- [`decisions/0016-telegram-chat-in-the-setup-wizard.md`](../decisions/0016-telegram-chat-in-the-setup-wizard.md)
  — the chat, `TELEGRAM_CHAT_ID` and the Bot API client built from the reference.

- [`decisions/0043-only-deliveries-with-an-effect-are-recorded.md`](../decisions/0043-only-deliveries-with-an-effect-are-recorded.md)
  — only a delivery with an `outbox` row or an `activity` change is recorded; `last_delivery` is kept by a bounded write.

## Not here

- The route, its status codes before this processing, the body size limit and the signature check:
  [HTTP routes](http-routes.md).
- The `deliveries`, `outbox` and `meta` tables and their columns: [Storage](storage.md).
- Choosing and proving the chat: [Setup wizard](setup-wizard.md#telegram-chat).
- Resending pending rows, marking rows `failed` and removing old rows, and the release notice:
  [Scheduled jobs](scheduled-jobs.md).
