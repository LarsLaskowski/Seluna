# Spec: Issue and comment rules

Source: Issue #109
Status: Approved by Product Manager

## Problem

Since #108 Seluna receives `issues` and `issue_comment` deliveries (decision
[0039](../../docs/decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)), but no rule reads them: when
someone else opens an issue in one of the owner's repositories or comments on an issue or a pull request's
conversation, the owner hears nothing. The owner's own issues and comments, and those of bots (Dependabot, apps that
comment on every pull request), are noise the owner does not want as messages.

## Scenarios

Layout, cleaning and button as in [Message format](../../docs/areas/notifications.md#message-format); `<owner/repo>` is
`repository.full_name`; "another account" is a sender that is neither the owner (S7, S8) nor a bot.

- S1: Given another account opens issue #7 "Crash on start" with the body "Steps: run it", when GitHub delivers
  `issues` `opened`, then the owner gets one message: line 1 **New issue** · `<owner/repo>` #7, line 2
  `Crash on start`, line 3 `by <issue author> · Steps: run it`; the button _Open on GitHub_ opens the issue.
- S2: Given another account comments on issue #7, when GitHub delivers `issue_comment` `created` for an issue, then the
  message reads: line 1 **New comment on issue** · `<owner/repo>` #7, line 2 the issue's title, line 3
  `by <comment author> · <beginning of the comment>`; the button opens the comment.
- S3: Given another account comments on the conversation of pull request #12, which is not a draft, then the message
  reads: line 1 **New comment on pull request** · `<owner/repo>` #12, line 2 the pull request's title, line 3 as in S2;
  the button opens the comment. S2's rule is silent for it, S3's rule for a comment on an issue.
- S4: Given the app belongs to the owner's personal account and Seluna knows the owner, when the owner opens an issue
  or comments, then no message is sent.
- S5: Given a bot (`sender.type` is `Bot`, for example `dependabot[bot]`) opens an issue or comments, then no message
  is sent.
- S6: Given the owner opens the settings after the update, then three new switches follow _Secret scanning alert_
  under "Notify me about": _New issue_, _New comment on an issue_, _New comment on a pull request_ (German _Neues
  Issue_, _Neuer Kommentar zu einem Issue_, _Neuer Kommentar zu einem Pull Request_), all on; every earlier switch
  keeps its value. A switch turned off silences only its case.
- S7: Given the app belongs to an organization, when any account but a bot opens an issue or comments, the owner's own
  account included, then the message is sent: Seluna cannot tell which member is its user, as the status page says
  ([Setup wizard](../../docs/areas/setup-wizard.md#status-and-settings)).
- S8: Given an app created before this version whose owner Seluna has not stored yet, when the owner opens an issue or
  comments, then the message is sent as for another account; once the owner has viewed the status page, which stores
  the owner, the owner's own issues and comments send nothing.
- S9: Given the notification language is German, then the titles read **Neues Issue**, **Neuer Kommentar zum Issue**,
  **Neuer Kommentar zum Pull Request**, and line 3 starts with `von <author>`.

## Errors and edge cases

- E1: Any other action (`issues` `edited`, `deleted`, `closed`, `reopened`, `transferred`, `labeled` …;
  `issue_comment` `edited`, `deleted`; an action GitHub adds later) sends no message.
- E2: A comment on a draft pull request sends no message, nor does one on a pull request whose draft state Seluna
  cannot determine: "a draft pull request triggers no notification" holds and its two exceptions are not extended.
- E3: A title, body or comment with HTML (`<b>`, `&amp;`), control characters, line or paragraph separators,
  directional characters (U+202E, U+2066) or a lone surrogate is cleaned and escaped like every other field: HTML
  shows literally, no line is added, nothing is reordered. URLs, `@mentions` and `/commands` stay tappable; no link
  preview is built.
- E4: The issue's or pull request's title (line 2) longer than 256 code points, or a line 3 (author and text) longer
  than 256, is cut to 256 with `…` as its last character.
- E5: A body that is empty, `null`, missing, only white space or only HTML comments gives line 3 `by <author>`
  alone; the case is still reported.
- E6: The body is shown on line 3 as one line: HTML comments (`<!-- … -->`, as issue templates leave them) are removed
  first, an unterminated `<!--` with everything after it, as GitHub hides them; then every run of white space
  (spaces, tabs, line breaks) becomes one space, so a template reads `## Context Seluna sends …`. Other Markdown is
  shown as written.
- E7: A delivery whose shape does not fit its event sends no message (decision `no-match`): no `issue` or `comment`
  object, a number that is not a whole number from 1 to 2^53 − 1, a title, `html_url`, author login or
  `repository.full_name` that is not a string, a body that is neither a string nor `null` nor missing, an
  `issue.pull_request` present but not an object, an `issue.draft` present but not a boolean, or a payload of another
  event under the `issues` or `issue_comment` header.
- E8: A `sender` that is missing, not an object, or lacks a numeric `id` or a string `type` sends no message: without
  it the owner and bots cannot be told apart.
- E9: When the database fails while the owner is read, the delivery is answered 503 and nothing is stored, as for a
  failing settings read. An owner row that is absent, malformed or of another App ID, or no readable App ID, counts as
  an unknown owner (S8).
- E10: Many issues or comments by strangers on a selected public repository give one message each; nothing limits
  their number.

## Non-functional requirements

- No new permission, event or app setting (#108 added them); an app that lacks Issues gets no such delivery until the
  owner accepts it (decision 0039).
- Settings: new switches `rule_issue_opened`, `rule_issue_comment`, `rule_pull_request_comment`, default on; existing
  rows keep their values, no migration.
- Time: a delivery is answered within GitHub's 10 seconds; a GitHub request a comment on a pull request may need stays
  within the 8-second budget of the [Draft lookup](../../docs/areas/notifications.md#draft-lookup).
- Privacy: the beginning of an issue or comment of a private repository reaches the `outbox` and the messenger, as
  titles and commit messages do; no log entry holds a payload text.
- Security: the owner is compared by account id, a bot by `sender.type` (decision 0039); a user whose login ends in
  `[bot]` is not a bot. On a public repository anyone can trigger a message with text of their choosing; no rate limit
  exists, as for pull requests (E10).
- Fixtures (Product Manager's answer): built from GitHub's webhook documentation, not captured, as in decision 0028 —
  `issues` `opened`, `issue_comment` `created` on an issue, on a pull request and on a draft pull request; owner, bot
  and action variants built in the tests. A decision record holds the residual risk (a field path, an action name or
  how a payload marks a draft differs in real deliveries; each deviation sends nothing); the Product Manager's live
  check on a deployed copy confirms the three cases before the pull request is marked ready.

## Acceptance criteria

- [ ] AC1: An `issues` `opened` delivery from another account gives exactly one notification, from rule
  `issue_opened`, with the lines of S1 and the button URL `issue.html_url` (S1).
- [ ] AC2: An `issue_comment` `created` delivery from another account gives exactly one notification: from
  `issue_comment` when `issue.pull_request` is absent, from `pull_request_comment` when it is an object and the pull
  request is not a draft, with the lines of S2 or S3 and the button URL `comment.html_url` (S2, S3).
- [ ] AC3: None of the three rules reports a delivery whose `sender.id` equals the stored owner's id when the owner is a
  `User`, or whose `sender.type` is `Bot`; the delivery is recorded and answered 202 with decision `no-match` (S4, S5).
- [ ] AC4: With an organization owner, or no usable stored owner, the owner's own delivery is reported like any other
  account's (S7, S8, E9).
- [ ] AC5: The three switches have the labels of S6 in both languages, follow `secret_scanning_alert` in that order,
  read on when no row is stored, are saved by the settings form, leave every existing switch's value unchanged, and
  one that is off drops only its own rule's notification (S6).
- [ ] AC6: In German the three titles and line 3 are those of S9 (S9).
- [ ] AC7: Every `issues` action but `opened` and every `issue_comment` action but `created` gives no notification
  (E1).
- [ ] AC8: A comment on a draft pull request, or on one whose draft state cannot be determined, gives no message
  (E2).
- [ ] AC9: The characters of E3 are stored cleaned and rendered escaped; line 2 and line 3 are cut at 256 code points
  with `…`; an empty, `null`, missing, blank or comment-only body gives `by <author>`; HTML comments are removed and
  white-space runs become one space as E6 says (E3, E4, E5, E6).
- [ ] AC10: Each shape of E7 and each `sender` of E8 gives no notification; the delivery is recorded and answered 202
  with decision `no-match` (E7, E8).
- [ ] AC11: A database failure while reading the owner answers 503 and stores nothing (E9).
- [ ] AC12: `docs/areas/notifications.md`, `docs/areas/setup-wizard.md`, `docs/areas/storage.md`, `docs/setup.md`,
  the event table and roadmap of `README.md` and `CHANGELOG.md` describe the rules, the sender filter, the volume risk
  and the switches (E10).
- [ ] AC13: The fixtures of the *Fixtures* requirement exist, their READMEs say they are built from the documentation,
  a decision record states the residual risk and the live check, and the live check is recorded before the pull
  request is marked ready (S1, S2, S3, E2).

## Out of scope

- Review comments on code lines (`pull_request_review_comment`), reviews and review-thread replies.
- Filtering by repository, label, author association or mention; a rate limit or digest (E10).
- Forks and stars (#110); not recording deliveries no rule reads (#121).
- A status page hint that the owner is not known yet (S8).

## Open questions

- What does a delivery do without a known owner (left to #109 by decision 0039)?
  Answered: reported as from another account (S8, E9); `isOwnAction` already answers false for an unknown owner
  (`src/rules/actor.ts`), and dropping instead would silence strangers' issues on older instances until their status
  page is viewed. Confirmed by the Product Manager.
- Is a comment on a draft pull request reported?
  Answered: no (E2): the guarantee in `.squad/project.md` (*Guarantees*) holds, and a comment is neither of its
  exceptions (0027, 0028). Confirmed by the Product Manager.
- Which actions are reported, and does the filter read `sender` or the author?
  Answered: `opened` and `created`, filtered on `sender` (issue #109, *Scope*); line 3 names the author
  (`issue.user.login`, `comment.user.login`).
- Are the issue's claims about today's code true?
  Answered: yes (`src/rules/actor.ts`, `src/store/meta.ts`, `cleanField` and `MAX_LINE_CHARACTERS` = 256 in
  `src/message.ts`, `settingsFromStored`, `src/rules/registry.ts`); cleaning happens when the notification is stored
  and rendered, not in the rules.
- Where do the fixtures come from?
  Answered: by the Product Manager — built from GitHub's documentation, with the residual risk in a decision record
  and a live check (*Non-functional requirements*, AC13).

## Area documents

- `docs/areas/notifications.md`: a section *Issue and comment rules* (switch ids, actions, titles, lines and button,
  the required shape, the body excerpt, the draft pull request, the volume risk); *The sender* says these three rules
  read `sender`, with the unknown and the organization owner; *Rules* says a rule also gets the stored owner, read by
  the processing (no rule reads the database); *Processing a delivery* step 4 reads the owner beside the settings;
  *Draft lookup* names the comment on a pull request as a second check, whose unknown state drops the notification;
  *Rules* (order) and *Languages* name the new texts.
- `docs/areas/setup-wizard.md`: eleven rule switches instead of eight, with their labels.
- `docs/areas/storage.md`: the three new `rule_<id>` keys, default `on`.

## Challenge

Spec challenge: 0 major, 5 minor objections, all accepted.

1. Source of the draft state — accepted. The behavior stays E2; the plan (*Approach*) picks the payload's `issue.draft`
   with the draft lookup as fallback, every "cannot determine" outcome drops, and names `issue.draft` for the live
   check. E7 now lists a non-boolean `issue.draft`.
2. Missing passages of `notifications.md` — accepted: *Rules* (pure function), *Processing a delivery* step 4 and
   *Draft lookup* are under *Area documents*; the plan says how the owner reaches the rules.
3. HTML comments of issue templates — accepted: removed before line 3 is built (E6, AC9), with a bounded scan and no
   regular expression with unbounded groups (plan).
4. A body of another type and the logged decision — accepted: such a body is E7 (no message); an owner or bot
   delivery is `no-match` (AC3, AC10).
5. "A title" in E4 — accepted: E4 now names the issue's or pull request's title (line 2).
