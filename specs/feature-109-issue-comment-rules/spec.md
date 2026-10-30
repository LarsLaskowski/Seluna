# Spec: Issue and comment rules

Source: Issue #109
Status: Draft

## Problem

Seluna is subscribed to `issues` and `issue_comment` since #108 (decision
[0039](../../docs/decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)), but no rule reads them: when
someone else opens an issue in one of the owner's repositories, or comments on an issue or on a pull request's
conversation, the owner hears nothing and has to watch GitHub's own notifications. The owner's own issues and comments,
and those of bots (Dependabot, CI and analysis apps that comment on every pull request), are noise the owner does not
want as messages.

## Scenarios

Line layout, cleaning and button as in [Message format](../../docs/areas/notifications.md#message-format). `<owner/repo>`
is `repository.full_name`; "another account" is a sender that is neither the owner (see S7, S8) nor a bot.

- S1: Given another account opens issue #7 "Crash on start" with the body "Steps: run it", when GitHub delivers
  `issues` `opened`, then the owner gets one message: line 1 **New issue** · `<owner/repo>` #7, line 2
  `Crash on start`, line 3 `by <issue author> · Steps: run it`, and the button _Open on GitHub_ opens the issue.
- S2: Given another account comments on issue #7, when GitHub delivers `issue_comment` `created` for an issue, then the
  owner gets one message: line 1 **New comment on issue** · `<owner/repo>` #7, line 2 the issue's title, line 3
  `by <comment author> · <beginning of the comment>`, and the button opens the comment itself.
- S3: Given another account comments on the conversation of pull request #12, which is not a draft, when GitHub
  delivers `issue_comment` `created` for that pull request, then the owner gets one message: line 1 **New comment on
  pull request** · `<owner/repo>` #12, line 2 the pull request's title, line 3 as in S2, and the button opens the
  comment. S2's rule stays silent for it, and S3's rule stays silent for a comment on an issue.
- S4: Given the owner (the app belongs to the owner's personal account and Seluna knows the owner) opens an issue or
  writes a comment, when GitHub delivers it, then no message is sent.
- S5: Given a bot account (`sender.type` is `Bot`, for example `dependabot[bot]` or an analysis app) opens an issue or
  writes a comment, when GitHub delivers it, then no message is sent.
- S6: Given the owner opens the settings on the status page after the update, then three new switches appear after
  _Secret scanning alert_ under "Notify me about": _New issue_, _New comment on an issue_, _New comment on a pull
  request_ (German _Neues Issue_, _Neuer Kommentar zu einem Issue_, _Neuer Kommentar zu einem Pull Request_), all on;
  every earlier switch shows the value it had. Turning one off and saving silences only its case (S1, S2 or S3).
- S7: Given the app belongs to an organization, when any account but a bot opens an issue or comments, the owner's own
  account included, then the message of S1, S2 or S3 is sent: Seluna cannot tell which member is its user, as the
  status page already says ([Setup wizard](../../docs/areas/setup-wizard.md#status-and-settings)).
- S8: Given an app created before this version whose owner Seluna has not stored yet, when the owner opens an issue or
  comments, then the message is sent as for another account; once the owner has opened the status page, which stores
  the owner from GitHub's answer, the owner's own issues and comments send nothing.
- S9: Given the notification language is German, then the titles read **Neues Issue**, **Neuer Kommentar zum Issue**,
  **Neuer Kommentar zum Pull Request**, and line 3 starts with `von <author>` instead of `by <author>`.

## Errors and edge cases

- E1: Any other action — `issues` `edited`, `deleted`, `closed`, `reopened`, `transferred`, `labeled` and the rest,
  `issue_comment` `edited` and `deleted`, or an action GitHub adds later — sends no message.
- E2: A comment on the conversation of a draft pull request sends no message, nor does one on a pull request whose
  draft state Seluna cannot determine: "a draft pull request triggers no notification" holds, and its two exceptions
  are not extended.
- E3: A title, body or comment with HTML (`<b>`, `&amp;`), control characters, line or paragraph separators,
  directional characters (U+202E, U+2066) or a lone surrogate appears cleaned and escaped as every other field: HTML
  shows literally, no line is added, nothing is reordered by an invisible character. URLs, `@mentions` and `/commands`
  in it stay tappable in Telegram; no link preview is built.
- E4: A title longer than 256 code points, or a line 3 (author and text) longer than 256, is cut to 256 with `…` as
  its last character.
- E5: A body that is empty, `null`, missing or only white space gives line 3 `by <author>` alone; the case is still
  reported.
- E6: A body of several lines or paragraphs is shown on line 3 as one line: every run of white space (spaces, tabs,
  line breaks) becomes one space, so a heading, the text after it and a list read `## Context Seluna sends …`.
  Markdown is shown as written, not rendered.
- E7: A delivery whose shape does not fit its event — no `issue` or `comment` object, an issue or pull request number
  that is not a whole number from 1 to 2^53 − 1, a title, `html_url`, author login or `repository.full_name` that is
  not a string, an `issue.pull_request` that is present but not an object, or a payload of another event under the
  `issues` or `issue_comment` header — sends no message (logged `no-match`).
- E8: A delivery whose `sender` is missing, not an object, or lacks a numeric `id` or a string `type` sends no message:
  without it Seluna cannot tell the owner or a bot from another account.
- E9: When the stored owner cannot be read because the database fails, the delivery is answered 503 and nothing is
  stored, as for a failing settings read; GitHub's delivery list allows a redelivery. An owner row that is absent,
  malformed or tied to another App ID, or an instance without a readable App ID, counts as an unknown owner (S8).
- E10: Many issues or comments by strangers on a selected public repository give one message each; nothing limits
  their number.

## Non-functional requirements

- No new permission, event or GitHub App setting: #108 added them; an instance whose app lacks Issues gets no such
  delivery until the owner accepts it on GitHub (decision 0039).
- Settings: three new `settings` switches `rule_issue_opened`, `rule_issue_comment`, `rule_pull_request_comment`,
  default on; existing rows keep their values, no migration.
- Time: a delivery is still answered within GitHub's 10 seconds; any GitHub request a comment on a pull request needs
  stays within the 8-second budget of the [Draft lookup](../../docs/areas/notifications.md#draft-lookup).
- Privacy: the beginning of an issue or comment of a private repository reaches the `outbox` and the messenger, as
  titles and commit messages do today; no log entry holds a payload text (only the fixed decision).
- Security: the owner is compared by account id, a bot by `sender.type` (decision 0039); a user account whose login
  ends in `[bot]` is not a bot. On a public repository anyone can trigger a message with text of their choosing; no
  rate limit exists, as for pull requests today (E10).
- Fixtures: the rule tests read payloads built from GitHub's webhook documentation, not captured (Product Manager's
  answer to the escalation, as for the security alert rules, decision 0028), one per variant: `issues` `opened`,
  `issue_comment` `created` on an issue, on a pull request that is not a draft and on a draft pull request; owner and
  bot senders are derived in the tests. Each fixture folder's README says so. The residual risk (a field path, an
  action name or the way a comment's payload marks a draft pull request differs in real deliveries) goes into a
  decision record; every deviation fails closed (no message). The Product Manager's live check on a deployed copy
  confirms the three cases before the pull request is marked ready.

## Acceptance criteria

- [ ] AC1: An `issues` `opened` delivery whose sender is another account gives exactly one notification with the
  title, number, line 2, line 3 and button URL of S1 (`issue.html_url`), from rule `issue_opened` only (S1).
- [ ] AC2: An `issue_comment` `created` delivery from another account gives exactly one notification: from
  `issue_comment` when `issue.pull_request` is absent, from `pull_request_comment` when it is an object and the pull
  request is not a draft, each with the layout of S2 or S3 and the button URL `comment.html_url` (S2, S3).
- [ ] AC3: None of the three rules reports a delivery whose `sender.id` equals the stored owner's id when the owner is a
  `User`, or whose `sender.type` is `Bot` (S4, S5).
- [ ] AC4: With an organization owner, or no usable stored owner, a delivery from the owner's own account is reported
  like any other account's (S7, S8, E9).
- [ ] AC5: The three switches exist with the labels of S6 in both languages, in that order after
  `secret_scanning_alert`, read on when no row is stored, are saved by the settings form, leave every existing
  switch's stored value unchanged, and a switch that is off drops only its own rule's notification (S6).
- [ ] AC6: In German the three titles and line 3 are those of S9 (S9).
- [ ] AC7: Every `issues` action but `opened` and every `issue_comment` action but `created` gives no notification
  (E1).
- [ ] AC8: A comment on a draft pull request, or on one whose draft state cannot be determined, gives no message
  (E2).
- [ ] AC9: A title or body with the characters of E3 is stored cleaned and rendered escaped; line 2 and line 3 are cut
  at 256 code points with `…`; an empty, `null`, missing or blank body gives `by <author>`; white-space runs in the
  body become one space (E3, E4, E5, E6).
- [ ] AC10: Each malformed shape of E7 and each `sender` of E8 gives no notification; the delivery is still recorded
  and answered 202 `no-match` (E7, E8).
- [ ] AC11: A database failure while reading the owner answers 503 and stores nothing (E9).
- [ ] AC12: `docs/areas/notifications.md`, `docs/areas/setup-wizard.md`, `docs/areas/storage.md`, `docs/setup.md`,
  the event table and roadmap of `README.md` and `CHANGELOG.md` describe the three rules, the sender filter, the
  volume risk of E10 and the switches (E10).
- [ ] AC13: The fixtures `test/fixtures/issues/opened.json` and `test/fixtures/issue_comment/` (comment on an issue, on
  a pull request, on a draft pull request) are built from GitHub's documentation and marked so in their READMEs, a
  decision record states the residual risk and the live check, and the live check is recorded before the pull request
  is marked ready (S1, S2, S3, E2).

## Out of scope

- Review comments on code lines (`pull_request_review_comment`), reviews, and replies in a review thread.
- Filtering by repository, label, author association or mention; a rate limit or digest for many messages (E10).
- Forks and stars (#110); not recording deliveries no rule reads (#121).
- A status page hint that the owner is not yet known (S8): the status page already learns the owner on its first view.

## Open questions

- What does a delivery do without a known owner? Decision 0039 left it to #109.
  Answered: it is reported as from another account (S8, E9). `isOwnAction` already answers false for an unknown owner
  (`src/rules/actor.ts`, documented in [The sender](../../docs/areas/notifications.md#the-sender)); dropping the
  deliveries instead would silence strangers' issues on every older instance until its status page is viewed, while
  reporting costs only the owner's own messages until then, and that first view stores the owner.
- Is a comment on a draft pull request reported? The issue says only "comment on a pull request".
  Answered: no (E2). The guarantee "a draft pull request triggers no notification" (`.squad/project.md`, *Guarantees*)
  may not change without the Product Manager, and its exceptions are a CI failure with unknown draft state (0027) and
  secret scanning (0028); a comment is neither. An undeterminable draft state therefore sends nothing as well.
- Which actions are reported, and does the filter read `sender` or the author?
  Answered: `opened` and `created` only, filtered on `sender` (issue #109, *Scope*); for these two actions the sender is
  the issue's or comment's author. Line 3 names the author (`issue.user.login`, `comment.user.login`).
- Are the claims of the issue about today's code true?
  Answered: yes. `isOwnAction` and `isBotSender` exist (`src/rules/actor.ts`), the owner is stored in `meta`
  `github_app_owner` per App ID (`src/store/meta.ts`), `cleanField` and `MAX_LINE_CHARACTERS` (256) are in
  `src/message.ts`, a settings row that is absent reads as the default (`settingsFromStored`, `src/settings.ts`), and
  rules are registered in settings order (`src/rules/registry.ts`). One difference: cleaning happens when the
  notification is stored and again when it is rendered, not in the rules.
- Are there real deliveries for the rule tests? `test/fixtures/issues/opened.json` and
  `test/fixtures/issue_comment/created.json` are reference-built from GitHub's documentation (their READMEs), and no
  fixture of a comment on a pull request exists; issue #109 asks for real, anonymized payloads.
  Answered: by the Product Manager: build them from GitHub's documentation, as for decision 0028, with the residual
  risk in a decision record and a live check before the pull request is marked ready (*Non-functional requirements*,
  AC13). The Product Manager also confirmed the answers to the first two questions.

## Area documents

- `docs/areas/notifications.md`: a section *Issue and comment rules* (switch ids, actions, titles in both languages,
  the lines and button, the shape that is required, the comment on a draft pull request, the volume risk on public
  repositories); *The sender* says that these three rules read `sender`, with the unknown and the organization owner,
  and that the other rules still do not; *Rules* (order) and *Languages* name the new texts.
- `docs/areas/setup-wizard.md`: eleven rule switches instead of eight, with their labels.
- `docs/areas/storage.md`: the three new `rule_<id>` keys, default `on`.
