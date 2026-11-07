# Notification rules

## Scope

Which GitHub events lead to a notification, and with which lines: the rule interface, the rules for pull requests,
CI failures, security alerts, issues and comments, how the sender of a delivery is told apart, and the draft lookup
that keeps draft pull requests silent. The owner relies on it to be told about each case once and not about drafts;
the processing ([Notifications](notifications.md#processing-a-delivery)) runs the rules and stores what they return.
The star and fork rules are in [Stars and forks](stars-and-forks.md).

## Behavior

### Rule interface

- A rule is a pure function of the event name (`X-GitHub-Event`), the payload, the notification settings
  ([Storage](storage.md#tables)) and the stored owner of the app (a value, or none when unknown) that returns one
  notification or none. The processing reads the owner once per delivery, beside the settings; no rule reads the
  database, a clock or the network. A rule narrows every payload field it reads; an unexpected shape returns none.
- Every rule has the id of its switch in the settings. All rules run on every delivery, in the order of the switches;
  a notification of a rule whose switch is off is dropped.
- A notification holds: the title of the case (line 1, in the notification language, chosen by the rule), the
  repository as `owner/repo`, the number of the pull request, issue or alert (or none), line 2, line 3 and the URL for
  the button (the `html_url` of the payload named below). A notification that may only be sent for a pull request that
  is not a draft also holds a draft check: the pull request (owner, repository name, number) and the title to use
  when its draft state is unknown, or none, which drops the notification when its draft state is unknown
  ([Draft lookup](#draft-lookup)).
- How the fields are cleaned and stored is in [Message format](notifications.md#message-format); the English titles
  below identify the cases, and the German ones are in `src/i18n/de.ts` ([Languages](notifications.md#languages)).
- A whole number in a payload is valid from 1 to 2^53 − 1 unless a rule says otherwise.

### Pull request rules

Three rules report the event `pull_request` (decision [0024](../decisions/0024-pull-request-rules.md)). Each reports
a delivery only when `action` is the one of its case and `pull_request.draft` is the boolean `false`; a draft pull
request triggers nothing.

| Switch id                       | `action`           | Title              |
| ------------------------------- | ------------------ | ------------------ |
| `pull_request_opened`           | `opened`           | `New pull request` |
| `pull_request_ready_for_review` | `ready_for_review` | `Ready for review` |
| `pull_request_review_requested` | `review_requested` | `Review requested` |

- Line 1 is the title, `repository.full_name` and `pull_request.number`; line 2 is `pull_request.title`; line 3 is
  `by <author> · <head> → <base>` from `pull_request.user.login`, `pull_request.head.ref` and `pull_request.base.ref`;
  the button URL is `pull_request.html_url`.
- The rules read no other field: not `sender`, `requested_reviewer`, `requested_team` or `head.repo`. So there is no
  filter by sender or reviewer, and a fork's branch is shown without its owner.
- A delivery whose fields are missing or of another type (`number` not a valid whole number, a text field not a
  string, `draft` not `false`) triggers nothing.
- `ready_for_review` also requires `draft` to be `false`; on a genuine delivery `draft` is already `false`, so this
  only silences a payload that claims a draft.
- `review_requested` reports every requested review, whoever was asked (a user or a team) and whoever asked — also
  when the owner asks someone else to review the owner's own pull request; the message names neither. GitHub is
  expected to send one delivery per requested reviewer, so several reviewers give several identical messages.
- Because the rules do not filter by sender, on a public repository anyone who opens a pull request triggers a message
  with a title and branch name of their choosing, one per pull request; Telegram apps still turn URLs, `@mentions` and
  `/commands` in that text into tappable links, even though the text is escaped and link previews are off.
- **The hourly bound.** A reported `pull_request` delivery is counted against the hourly bound
  ([Processing a delivery](notifications.md#processing-a-delivery)) unless `pull_request.author_association` is
  exactly `OWNER`, `MEMBER` or `COLLABORATOR`, or the sender is the owner ([The sender](#the-sender)). Anything else is
  counted: `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `NONE`, `MANNEQUIN`, a value of another case or
  form, a missing or mistyped field, a bot's pull request (Dependabot, Renovate) and a pull request from a branch of
  the repository itself, because anyone with read access can open one between existing branches. The association is
  computed by GitHub for the pull request's author; a member of an organization whose membership is private may be
  marked `CONTRIBUTOR` or `NONE` and is then counted, so no document claims that every organization member is exempt
  ([decision 0043](../decisions/0043-only-deliveries-with-an-effect-are-recorded.md)).
- Not verified against real deliveries: a review requested from a team, a pull request from a fork and the
  one-delivery-per-reviewer behavior. The rules read only fields that exist in all of them and stay silent when one is
  missing.

### CI failure rules

Two rules report the event `workflow_run` (decision
[0027](../decisions/0027-ci-failure-rules-and-the-draft-lookup.md)). Both report only a delivery whose `action` is
`completed` and whose `workflow_run.conclusion` is `failure` or `timed_out`; every other conclusion (`success`,
`cancelled`, `skipped`, `neutral`, `action_required`, `stale`, `startup_failure`, `null`, any new one) and every other
action triggers nothing.

| Switch id                  | Case                                                                  | Title                       |
| -------------------------- | --------------------------------------------------------------------- | --------------------------- |
| `ci_failed_default_branch` | the run is on the default branch                                      | `CI failed on <branch>`     |
| `ci_failed_pull_request`   | the run is not on the default branch and names a pull request (below) | `CI failed in pull request` |

- A run is on the default branch when `workflow_run.head_branch` equals `repository.default_branch` and
  `workflow_run.head_repository.id` equals `repository.id`; a fork's branch of the same name is not. `<branch>` is the
  default branch. A run that an outsider's event starts in the repository's own context (for example
  `pull_request_target` or `issue_comment` on the default branch, or a chained `workflow_run`) is reported like any
  default-branch run: the guard keeps out a fork's branch, and the texts shown still come from the repository.
- The pull request case never reports a run on the default branch, whatever the switches: one run gives at most one
  message.
- The pull request of a run is the first entry of `workflow_run.pull_requests`, in its order, that is an object with a
  `number` and a `base.repo.id`, each a valid whole number, whose `base.repo.id` equals `repository.id`. Other entries
  are skipped; without such an entry, or when `pull_requests` is not an array, the pull request case reports nothing.
  A pull request from a fork arrives with an empty `pull_requests` and is not reported.
- Line 1 is the title, `repository.full_name` and, for the pull request case, the pull request's number; line 2 is
  `workflow_run.name`; line 3 is `workflow_run.head_branch`, then `·` and the first line of
  `workflow_run.head_commit.message` (the text before the first line feed or carriage return). When `head_commit` is
  `null`, its `message` is not a string, or the first line is empty or only spaces, line 3 is the branch alone. The
  button URL is `workflow_run.html_url`. Line 3 is the same in both languages.
- A delivery triggers nothing when the event name is not `workflow_run`, `workflow_run` is not an object,
  `conclusion`, `head_branch`, `name` or `html_url` is not a string, `workflow_run.head_repository.id` or
  `repository.id` is not a valid whole number, or `repository.full_name` or `repository.default_branch` is not a
  string.
- The notification of the pull request case carries a draft check of its pull request, in the repository of
  `repository.full_name` (owner before the first `/`, name after it), with the title `CI failed in pull request (draft
status unknown)` for an unknown state ([Draft lookup](#draft-lookup)).
- **The hourly bound.** A reported `workflow_run` delivery is counted against the hourly bound
  ([Processing a delivery](notifications.md#processing-a-delivery)) unless `workflow_run.event` is exactly one of
  `push`, `schedule`, `merge_group`, `release`, `create`, `delete`, `page_build`, `label`, `milestone`,
  `registry_package` or `branch_protection_rule` (events only an account admitted to the repository can cause), or
  `workflow_run.triggering_actor` is the owner ([The sender](#the-sender); the account that re-ran a run, not the
  original `actor`). Every other run is counted: `pull_request` (also from a branch of the repository itself, which a
  stranger's reopened pull request can start), `pull_request_target`, `issue_comment`, `issues`, `workflow_dispatch`,
  `repository_dispatch`, `status`, a chained `workflow_run`, an unknown event name, and a run whose event or
  `triggering_actor` is missing or mistyped. A collaborator's run of such an event is counted too (a run carries no
  author association), and so is an organization owner's. Residual: a write-capable token or installed app the owner
  admitted that acts on a stranger's input (a personal access token or App token in a workflow a stranger can start,
  a comment-command release bot whose branch, tag or release starts `push`, `create` or `release` runs) can raise any
  of the 11 events, and those runs are then not counted; the built-in `GITHUB_TOKEN` starts only `workflow_dispatch`
  and `repository_dispatch`, which are counted.
- Each run is reported once per delivery: two failing workflows on one push give two messages, a workflow that runs on
  both `push` and `pull_request` gives two, and a re-run that fails again is reported again with the same lines.
- Not verified against real deliveries: a failed or `timed_out` run on the default branch, a `cancelled` run, a fork's
  run (its `head_repository` and its empty `pull_requests` follow GitHub's documentation) and a re-run. The rules read
  only fields both real samples carry.

### Security alert rules

Three rules report the events `dependabot_alert`, `code_scanning_alert` and `secret_scanning_alert` (decision
[0028](../decisions/0028-security-alert-rules.md)); their switches are on by default.

| Switch id               | Event                   | Reported `action`                           | Title                   |
| ----------------------- | ----------------------- | ------------------------------------------- | ----------------------- |
| `dependabot_alert`      | `dependabot_alert`      | `created`, `reopened`                       | `Dependabot alert`      |
| `code_scanning_alert`   | `code_scanning_alert`   | `created`, `reopened`, `appeared_in_branch` | `Code scanning alert`   |
| `secret_scanning_alert` | `secret_scanning_alert` | `created`, `reopened`                       | `Secret scanning alert` |

Every other action (for example `dismissed`, `fixed`, `resolved`, `auto_reopened`, `reopened_by_user`, or one GitHub
adds later) triggers nothing. A new and a reopened alert give the same message; the alert's `state` and the `sender`
are not read.

- **Fields shown.** Line 1 is the title, `repository.full_name` and `alert.number`; the button is `alert.html_url`.
  Lines 2 and 3 are GitHub's own words, the same in both languages; a value that is missing, `null`, not a string or
  blank falls back as listed, an empty line is left out and the alert is still reported. An unknown severity is shown
  as sent.

  | Event                   | Line 2                            | Line 3                                                                                                                                                                                              |
  | ----------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `dependabot_alert`      | `alert.security_advisory.summary` | severity `alert.security_advisory.severity` (fallback `alert.security_vulnerability.severity`), `·`, package `alert.dependency.package.name` (fallback `alert.security_vulnerability.package.name`) |
  | `code_scanning_alert`   | `alert.rule.description`          | severity `alert.rule.security_severity_level` (fallback `alert.rule.severity`), `·`, rule `alert.rule.id`                                                                                           |
  | `secret_scanning_alert` | `alert.secret_type_display_name`  | `alert.secret_type`                                                                                                                                                                                 |

- **Required fields and shape.** A delivery is reported only when `alert` is an object, `alert.number` a valid whole
  number, and `alert.html_url` and `repository.full_name` strings; in addition a Dependabot alert needs
  `alert.security_advisory` as an object, a code scanning alert `alert.rule` as an object and `ref` and
  `repository.default_branch` as strings, a secret scanning alert `alert.secret_type` as a string. Anything else gives
  `no-match`; the event header is not signed, so this also keeps out a payload of another event.
- **Code scanning: default branch only.** It is reported only when `ref` is `refs/heads/<repository.default_branch>`
  or exactly `<repository.default_branch>`; a pull request ref (`refs/pull/<n>/merge`), another branch, a tag, an
  empty or missing `ref` triggers nothing. Each alert is thus reported once, when it reaches the default branch, and a
  draft pull request triggers nothing.
- **Secrets.** The secret scanning rule reads exactly `alert.number`, `alert.html_url`, `alert.secret_type`,
  `alert.secret_type_display_name` and `repository.full_name`. No part of a secret reaches an outbox row, a message or
  a log entry, whether or not the payload carries it (`alert.secret`, `resolution_comment`, a location field): a field
  that is not read cannot be shown.
- **Whatever its source.** A secret scanning alert names no branch or pull request, so it is reported even when the
  secret was pushed to a draft pull request or written into its text. This is the second exception to "a draft pull
  request triggers no notification" ([Draft lookup](#draft-lookup)). Dependabot alerts stay under the guarantee.
- **Documented, not observed.** Every field path comes from GitHub's OpenAPI webhook schemas, and the fixtures are
  reference-built from them. The residual risk is a path, a `ref` format, an action name or the presence of
  `alert.secret` that differs in real deliveries; because only an allow-list of fields is read, such a difference can
  shorten a line or silence an alert, never leak a secret.

### Issue and comment rules

Three rules report the events `issues` and `issue_comment` (decision
[0040](../decisions/0040-issue-and-comment-rules.md)); their switches are on by default.

| Switch id              | Event           | Reported `action` | Case                                                | Title                         |
| ---------------------- | --------------- | ----------------- | --------------------------------------------------- | ----------------------------- |
| `issue_opened`         | `issues`        | `opened`          | a new issue                                         | `New issue`                   |
| `issue_comment`        | `issue_comment` | `created`         | a comment on an issue (`issue.pull_request` absent) | `New comment on issue`        |
| `pull_request_comment` | `issue_comment` | `created`         | a comment on a pull request's conversation          | `New comment on pull request` |

Every other action (`edited`, `deleted`, `closed`, `reopened`, `transferred`, `labeled`, or one GitHub adds later)
triggers nothing.

- **Lines.** Line 1 is the title, `repository.full_name` and `issue.number`; line 2 is `issue.title`; line 3 is
  `by <author> · <excerpt>`, the author being `issue.user.login` for a new issue and `comment.user.login` for a comment,
  the excerpt the beginning of `issue.body` or `comment.body`. The button is `issue.html_url` for a new issue and
  `comment.html_url` for a comment.
- **The excerpt.** HTML comments (`<!-- … -->`, as issue templates leave them) are removed first, an unterminated
  `<!--` together with everything after it; then every run of white space becomes one space and the ends are trimmed.
  Other Markdown is shown as written. The scan is one linear pass that stops at 257 code points (one more than line
  3's limit, so the store still cuts and marks it), whatever the size of the body. A body that is empty, `null`,
  missing, blank or only comments gives line 3 `by <author>` alone; the case is still reported.
- **Required shape.** A delivery is reported only when `issue` and `comment` (for a comment) are objects,
  `issue.number` is a valid whole number, `issue.title`, `issue.html_url`, `issue.user.login`, `comment.html_url`,
  `comment.user.login` and `repository.full_name` are strings, each `body` is a string, `null` or missing,
  `issue.pull_request` is missing or an object and `issue.draft` is missing or a boolean. A delivery that carries a
  `comment` under the `issues` header is another event's payload: `issue_opened` returns nothing for it, as it does
  when `issue.pull_request` is present. Anything else gives `no-match`.
- **The sender.** A delivery is dropped (`no-match`) when its sender is the owner or a bot, or unusable
  ([The sender](#the-sender)).
- **The draft pull request.** `pull_request_comment` reports a comment only on a pull request that is not a draft:
  `issue.draft` `true` triggers nothing, `false` reports without a check, and when the field is absent the
  notification carries a draft check whose unknown state drops the notification instead of retitling it
  ([Draft lookup](#draft-lookup)). A comment on a draft pull request, or on one whose draft state cannot be determined,
  is thus never reported: neither exception to the guarantee is extended.
- **Volume.** On a public repository anyone can open an issue or comment, so each issue or comment by anyone other
  than the owner gives one message with text of their choosing; Telegram apps still turn URLs, `@mentions` and
  `/commands` into tappable links. Both events are always counted against the hourly bound
  ([Processing a delivery](notifications.md#processing-a-delivery)).
- **Documented, not observed.** The fixtures are reference-built from GitHub's webhook documentation, not captured.
  The residual risk is a field path, an action name or the place of `issue.draft` that differs in real deliveries;
  each such difference sends nothing. A live check on a deployed copy confirms the cases.

### The sender

- The GitHub App is subscribed to the events `issues`, `issue_comment`, `fork` and `star` besides the five of the
  pull request, CI failure and security alert rules (decision
  [0039](../decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)). They are accepted and answered like
  every other event, and recorded only when they lead to a message or an `activity` change
  ([Processing a delivery](notifications.md#processing-a-delivery)).
- The owner is the one stored beside the App ID ([Storage](storage.md#tables)); the processing reads it once per
  delivery, before the rules, for the App ID the Worker secret or the saved credential names
  ([GitHub API](github-api.md)). A database failure while it is read answers **503** and stores nothing, as for the
  settings.
- **Own action.** A delivery is the owner's own action only when the stored owner is a `User` and `sender.id` is a
  number equal to the owner's id; a renamed login changes nothing. A missing or non-object `sender`, a missing or
  non-numeric `id`, an unknown owner and an organization owner are never the owner: the sender is a person, and
  Seluna cannot tell which member of an organization is its user, so for an organization's app every account's
  activity counts as foreign (the status page says so, [Status page](status-page.md#the-app-on-github)). The same
  comparison by account id decides `workflow_run.triggering_actor` and the sender exemption of a pull request for the
  hourly bound. Neither check throws on any payload (implemented in `src/rules/actor.ts`).
- **Bot.** A sender is a bot exactly when `sender.type` is the string `Bot` (a user whose login ends in `[bot]` is not
  a bot).
- **Foreign account.** The issue and comment rules and the star and fork rules
  ([Stars and forks](stars-and-forks.md)) report only a foreign sender: `sender` an object with an `id` that is a safe
  integer (a whole number no larger than 2^53 − 1 in absolute value) and a string `type`, not the owner's own action
  and not a bot; anything else is dropped (`no-match`). With an organization owner, an owner not stored yet (an app
  created before the owner was stored whose status page was not viewed) or an owner row that is malformed or of
  another App ID, the owner's own issues, comments, stars and forks are reported like any other account's.
- The pull request and security alert rules do not read `sender`.

### Draft lookup

- After the rules, each notification with a draft check (the CI failure in a pull request, or a comment on a pull
  request whose payload has no `issue.draft`; the two come from different events, so at most one per delivery) is
  resolved before the delivery is recorded. A notification whose switch is off has been dropped by then, so it causes
  no lookup.
- The lookup asks GitHub for the pull request's draft state as the app, with the installation of the delivery's
  `installation.id` ([GitHub API](github-api.md#pull-request-read)). A draft drops the notification; a pull request
  that is not a draft keeps it as it is.
- A failure is every failure result of the GitHub API client, an `installation.id` that is not a valid whole number
  (then nothing is asked), and a lookup that has not finished 8 seconds after it started: GitHub ends a delivery not
  answered within 10 seconds. A lookup cut off this way may still finish in the background; its result is not used.
  The draft checks of one delivery run concurrently, each cut off after 8 seconds, so the 8-second budget holds
  however many rules set a draft check.
- On a failure, the CI failure in a pull request is kept with its draft-unknown title: this is one of the two
  exceptions to "a draft pull request triggers no notification" (the other: a secret scanning alert,
  [Security alert rules](#security-alert-rules)). A comment on a pull request has no title for an unknown state, so any
  failure drops it.
- When the lookup drops the only notification, the decision is `no-match`.
- The lookup runs before the hourly bound ([Processing a delivery](notifications.md#processing-a-delivery)): a
  delivery past the bound has made its lookup already.
- A delivery whose id is already recorded on arrival causes no lookup. Two deliveries of one id processed at once may
  each make a lookup; at most one of them is stored.

## Limits and errors

- Every field a rule shows is attacker-controlled text when the repository is public; it is cleaned before it is
  stored and escaped when it is rendered ([Message format](notifications.md#message-format),
  [Telegram rendering](delivery.md#telegram-rendering)).
- A payload of an unexpected shape, an unknown action or an unknown conclusion sends nothing; the rules never guess.
- A rule that throws answers 503 like a database failure ([Notifications](notifications.md#limits-and-errors)).

## Related decisions

- [`decisions/0024-pull-request-rules.md`](../decisions/0024-pull-request-rules.md) — the three pull request rules,
  `draft` required to be `false`, silence on an unexpected shape, line 3 with author and branches.
- [`decisions/0027-ci-failure-rules-and-the-draft-lookup.md`](../decisions/0027-ci-failure-rules-and-the-draft-lookup.md)
  — the two CI failure rules, the default branch told from a fork's branch, the draft check resolved within 8 seconds,
  the message sent with _draft status unknown_ on a failed lookup.
- [`decisions/0028-security-alert-rules.md`](../decisions/0028-security-alert-rules.md) — the three security alert
  rules, code scanning on the default branch only, secret scanning outside the draft guarantee, the field allow-list.
- [`decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md`](../decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)
  — the four further events and the stored owner.
- [`decisions/0040-issue-and-comment-rules.md`](../decisions/0040-issue-and-comment-rules.md) — the three issue and
  comment rules, the owner passed to the rules, an unknown owner reported, the draft state from the payload with the
  lookup as fallback, HTML comments removed from the excerpt.
- [`decisions/0043-only-deliveries-with-an-effect-are-recorded.md`](../decisions/0043-only-deliveries-with-an-effect-are-recorded.md)
  — which `pull_request` and `workflow_run` deliveries count against the hourly bound.

## Not here

- Processing a delivery, the hourly bound, the stored notification and its languages:
  [Notifications](notifications.md).
- The star and fork rules and the digest: [Stars and forks](stars-and-forks.md).
- Rendering and sending a notification: [Delivery](delivery.md).
- The pull request read and the installation token behind the draft lookup: [GitHub API](github-api.md).
- The events and permissions the app asks for: [GitHub App step](github-app-step.md).
