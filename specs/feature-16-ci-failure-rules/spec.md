# Spec: CI failure rules

Source: Issue #16
Status: Draft

## Problem

The owner of a Seluna instance wants to know when CI breaks where it matters: on the default branch, which every
other branch builds on, and in a pull request that is ready for others to look at. Today Seluna reports only three
`pull_request` cases (decision 0024); a `workflow_run` delivery reaches the Worker — the GitHub App the setup wizard
creates already subscribes to `workflow_run` and has read access to Actions and pull requests
(`src/github/manifest.ts`) — but no rule matches it, so a failed run is answered 202 with the decision `no-match` and
nothing is sent (`src/rules/registry.ts` lists only the pull request rules). The two switches for these cases,
`ci_failed_default_branch` and `ci_failed_pull_request`, already exist in the settings and are on by default
(`src/settings.ts`), but switch nothing. The owner learns of a broken build only by looking at GitHub.

A `workflow_run` delivery names the pull requests of a run only by number, without their draft state, while drafts
must stay silent ([ARCHITECTURE.md](../../docs/ARCHITECTURE.md), `.squad/project.md` *Guarantees*). Seluna can ask
GitHub for that state as the app (issue #15, `src/github/api-client.ts`), but that request can fail.

## Scenarios

In the scenarios, "a failed run" is a `workflow_run` delivery with `action` `completed` whose
`workflow_run.conclusion` is `failure` or `timed_out`. A run is "on the default branch" when
`workflow_run.head_branch` equals `repository.default_branch` **and** `workflow_run.head_repository.id` equals
`repository.id` (the run's code comes from the repository itself, not from a fork). The texts are those of the English notification language,
the German ones are under *Area documents*. Line 1 is rendered as the notifications area defines it: the title in
bold, `·`, the repository and, where the case has one, ` #` and the number.

- S1: Given the switch _CI failed on the default branch_ is on, when a failed run arrives whose
  `workflow_run.head_branch` equals `repository.default_branch` (`main`) and whose `head_repository` is the
  delivery's repository, of the workflow `Build` on the commit
  `Fix the parser\n\nLonger body`, then the owner receives one message:
  line 1 `CI failed on main · owner/repo` (no number), line 2 `Build` (`workflow_run.name`), line 3
  `main · Fix the parser` (the branch, ` · `, the first line of `workflow_run.head_commit.message`), and the button
  _Open on GitHub_ opens `workflow_run.html_url`, the page of the run.
- S2: Given the switch _CI failed in a pull request_ is on, when a failed run arrives that is not on the default
  branch, whose `workflow_run.pull_requests` names pull request 42 of the delivery's repository, and GitHub
  answers that pull request 42 is not a draft, then the owner receives one message: line 1
  `CI failed in pull request · owner/repo #42`, line 2 the workflow name, line 3 the run's branch and the first line
  of the head commit message, and the button opens the run.
- S3: Given the same as S2, when GitHub answers that pull request 42 is a draft, then no message is sent.
- S4: Given the same as S2, when asking GitHub for the draft state of pull request 42 fails, then the owner receives
  the message of S2 with the title `CI failed in pull request (draft status unknown)`.
- S5: Given a failed run, when its conclusion is `timed_out` instead of `failure`, then it is reported exactly like
  a run that ended in `failure` (S1, S2, S3, S4).
- S6: Given two workflows that both fail on one push, when their two failed runs arrive, then the owner receives two
  messages, one per run, each with its own workflow name and button. This includes one workflow that runs both on
  `push` and on `pull_request`: a failing push to a pull request's branch gives two runs and so two nearly identical
  messages (one run, one message).
- S7: Given a run that was reported, when it is re-run and fails again, then the new attempt is reported again with a
  message of the same lines.

## Errors and edge cases

- E1: A `workflow_run` delivery whose `action` is not `completed` (`requested`, `in_progress`), or whose conclusion
  is anything but `failure` or `timed_out` — `success`, `cancelled`, `skipped`, `neutral`, `action_required`,
  `stale`, `startup_failure`, `null` or a value GitHub adds later — sends no message and asks GitHub nothing.
- E2: A failed run on a branch that is neither the default branch nor named in `workflow_run.pull_requests` (an
  empty list, which is also what GitHub sends for a pull request from a fork) sends no message.
- E3: The pull request case never matches a run on the default branch, whatever the switches. A failed run on the
  default branch whose `workflow_run.pull_requests` is not empty (for example a pull request from the default branch
  into a release branch) is reported once, as S1, and GitHub is asked nothing; with the switch _CI failed on the
  default branch_ off it sends no message, asks GitHub nothing and leaves the decision `disabled`. One run gives at
  most one message.
- E4: `workflow_run.pull_requests` is read entry by entry, in its order. An entry counts only when it is an object
  with a `number` that is a whole number from 1 to 2^53 − 1 and a `base.repo.id` that is a whole number from 1 to
  2^53 − 1 equal to `repository.id`; any other entry — of another repository, or missing or mistyped — is skipped
  and never silences the delivery. The first entry that counts is used: its number is shown and its draft state
  alone decides. When no entry counts, the pull request case sends nothing (E2); a malformed entry never affects the
  default branch case.
- E5: A delivery whose fields are missing or of another type sends no message and asks GitHub nothing: the event
  name not `workflow_run`, `workflow_run` not an object, `conclusion`, `head_branch`, `name` or `html_url` not a
  string, `workflow_run.head_repository.id` or `repository.id` not a whole number from 1 to 2^53 − 1,
  `repository.full_name` or `repository.default_branch` not a string, and for the pull request case `pull_requests`
  not an array. A body of another event sent under the header `workflow_run` matches nothing for this reason.
- E6: `workflow_run.head_commit` is `null`, or its `message` is not a string: line 3 is the branch alone. A commit
  message whose first line is empty or only spaces gives the same.
- E7: The first line of the commit message ends at the first line feed or carriage return; the rest is never shown.
- E8: A branch name, workflow name or commit line containing `<`, `>`, `&`, control or directional characters is
  shown as written after the cleaning and escaping of every message text; a title longer than 64 characters
  (a long default branch name in `CI failed on <branch>`) is cut to 64 with `…`, a line 2 or 3 longer than 256 to
  256.
- E9: The draft lookup fails in any way the GitHub API client reports as its one failure result — no usable GitHub
  App (setup unfinished, App ID or key unusable, no usable `SELUNA_SECRET`), no valid `installation.id` in the
  delivery, an owner, repository name or number that may not enter a URL, a refused answer (401, 403 for an app set
  by hand without the _Pull requests_ permission, 404, any other non-2xx), a network error, a redirect, an answer
  without a boolean `draft`, a database error on the token cache: the message is sent as in S4.
- E10: GitHub is slow: the draft lookup takes longer than its time bound (see *Non-functional requirements*); it
  counts as failed and the message is sent as in S4. GitHub still receives its answer in time.
- E11: The switch of a case is off: that case sends nothing and, for the pull request case, GitHub is not asked; the
  delivery's log entry has the decision `disabled`. A run on the default branch is never reported as the pull
  request case instead (E3).
- E12: A delivery whose `X-GitHub-Delivery` is already recorded when it arrives (a redelivery) sends no second message
  and asks GitHub nothing. Two deliveries of one id processed at the same time may each make a draft lookup, but only
  one of them is stored, so they give at most one message.
- E14: A pull request from a fork whose branch is named like the default branch (a fork's `main`): its failed run
  has `head_branch` equal to `repository.default_branch` but a `head_repository.id` other than `repository.id`, so it
  is not on the default branch and is never reported as the default branch case. With the empty `pull_requests` GitHub
  is expected to send for a fork (to be confirmed against a real delivery in the plan) it sends no message and asks
  GitHub nothing (E2); should an entry of the delivery's repository ever be present, it is handled as the pull
  request case (S2–S4), never as the default branch case. An outside contributor cannot raise the default branch
  alarm with a text of their choosing.
- E13: A draft pull request (S3) leaves the decision `no-match` in the delivery's log entry, like any delivery no
  rule reports.

## Non-functional requirements

- Time: GitHub expects an answer to a webhook delivery within 10 seconds. The draft lookup is bounded by its own
  time limit of 8 seconds around the whole lookup — installation token and pull request read together, measured from
  the start of the lookup, independent of the API client's 10-second timeout per request; a lookup that has not
  finished then is a failure (E10). The rest of the processing (the duplicate check and the settings read before
  the lookup, the transaction after it) is D1 work expected to take well under the remaining 2 seconds; that
  expectation is unverified and the plan names its measurement.
- Requests: at most one draft lookup per delivery, and only for a failed run that is reported as the pull request
  case with that switch on; no other case of this feature calls GitHub. The lookup uses the existing GitHub API client
  with all its request rules ([GitHub API](../../docs/areas/github-api.md)): the installation token of the
  delivery's `installation.id`, only `https://api.github.com`, allow-listed owner, name and number.
- Security: the GitHub App needs no new permission and no new event — `workflow_run`, Actions read and Pull requests
  read are already in the manifest. Every payload text (branch, workflow name, commit line) is attacker-chosen text
  and passes the existing cleaning and escaping. The button URL is accepted only under the existing rule (`https`,
  host `github.com`).
- The guarantee "a draft pull request triggers no notification" gets one exception, set by issue #16: a pull
  request whose draft state could not be read is reported, marked _draft status unknown_.
- Compatibility: no new setting, secret or table; the two switches exist and stay on by default. Existing rows,
  settings and the pull request rules are unchanged.
- Logs: no new log field; the decision of the delivery's log entry is `reported`, `no-match` or `disabled` as
  today. Neither the draft state nor the failure of the lookup, nor any payload text, is logged.

## Acceptance criteria

- [ ] AC1: A failed run (`failure` or `timed_out`) on the default branch produces one message with the title
  `CI failed on <branch>`, no number, line 2 the workflow name, line 3 `<branch> · <first commit line>` and the run's
  URL as the button (S1, S5, E7).
- [ ] AC2: A failed run in a pull request that GitHub reports as not a draft produces one message titled
  `CI failed in pull request` with the pull request's number, the same lines 2 and 3 and button (S2, S5).
- [ ] AC3: A failed run in a pull request that GitHub reports as a draft produces no message and the decision
  `no-match` (S3, E13).
- [ ] AC4: When the draft lookup fails for any reason of E9, or exceeds its time bound, the message of AC2 is
  produced with the title `CI failed in pull request (draft status unknown)` (S4, E9, E10).
- [ ] AC5: A `workflow_run` delivery with an `action` other than `completed`, or with any conclusion other than
  `failure` and `timed_out` (at least `success`, `cancelled`, `skipped`, `startup_failure` and `null`), produces no
  message and no GitHub request (E1).
- [ ] AC6: A failed run that is on neither the default branch nor in a pull request of the delivery's repository
  produces no message (E2, E4).
- [ ] AC7: A failed run on the default branch with a non-empty `pull_requests` produces exactly one message, the
  default branch one, and no GitHub request; with the default branch switch off it produces no message, no GitHub
  request and the decision `disabled` (E3).
- [ ] AC8: With several `pull_requests` entries, the first entry with a valid number whose `base.repo.id` is the
  delivery's `repository.id` decides the number and the draft lookup; entries of another repository and malformed
  entries are skipped, and a malformed entry does not keep a default branch run from being reported (E4).
- [ ] AC9: A delivery with a missing or wrongly typed field of E5 produces no message and no GitHub request (E5).
- [ ] AC10: Without a usable head commit message line, line 3 is the branch alone (E6).
- [ ] AC11: With a switch off, its case produces no message, the decision is `disabled`, and the pull request case
  makes no GitHub request (E11).
- [ ] AC12: Each failed run delivered under its own delivery id produces its own message, also for a re-run of one run;
  a delivery whose id is already recorded on arrival produces none and no GitHub request (S6, S7, E12).
- [ ] AC13: The titles and the note exist in English and German and follow the notification language (S1, S2, S4).
- [ ] AC14: Branch, workflow name and commit line with HTML special, control or directional characters are cleaned,
  cut and escaped like every message text (E8).
- [ ] AC15: A failed run of a fork's pull request from a branch named like the default branch (`head_branch` equal to
  `repository.default_branch`, `head_repository.id` not `repository.id`, empty `pull_requests`) produces no message
  and no GitHub request (E14).

## Out of scope

- A failed run of a pull request from a fork: GitHub sends it with an empty `pull_requests`, so it is silent (E2),
  also when the fork's branch is named like the default branch (E14).
- Merging the `push` run and the `pull_request` run of one workflow on one commit into one message: they are two
  runs and give two messages (S6).
- The conclusions `startup_failure` (an invalid workflow file), `action_required`, `neutral` and `stale`: the issue
  names only `failure` and `timed_out` (E1).
- Check runs and check suites of other CI systems (`check_run`, `check_suite`): only GitHub Actions runs.
- A message when CI recovers, grouping several failed runs of one push into one message, telling the attempts of a
  re-run apart in the message, and filtering by the actor who triggered the run.
- Whether the pull request is still open: only its draft state is read.
- Failed runs on branches that are neither the default branch nor in a pull request (E2).

## Open questions

- What is line 2? Answered: the workflow name (`workflow_run.name`), as issue #12 defines line 2 for CI ("workflow
  name").
- What does the button open? Answered: `workflow_run.html_url`, the run's page — issue #12: "the `html_url` from the
  payload".
- Which number does line 1 carry? Answered: the pull request's number for the pull request case; none for the default
  branch case, which has no pull request or alert number (notifications area: "the number of the pull request or
  alert (or none)").
- Where does the note "draft status unknown" go? Answered: (Lead) in the title, `CI failed in pull request (draft
  status unknown)`. The title is set by the rule, is never cut at this length (48 characters in English, 58 in
  German, limit 64), and is bold on line 1; in line 2 or 3 it would follow attacker-chosen text and could be cut.
- What when a run is both on the default branch and in a pull request? Answered: (Lead) the default branch case
  only, from the issue's "one run, one message" (E3).
- What when `pull_requests` names several pull requests? Answered: (Lead) the first of the delivery's repository
  (E4), so a run makes at most one lookup and one message. Entries of another base repository, and malformed
  entries, are skipped because their number does not name a pull request of the repository the lookup asks; the plan
  verifies `base.repo.id` against a real delivery.
- How is a run on the default branch told apart from a fork's branch of the same name? Answered: (Lead) by
  `workflow_run.head_repository.id` equal to `repository.id` (E14); the plan verifies the field against a real
  delivery.
- May a pull request whose draft state is unknown be reported, against the guarantee that drafts are silent?
  Answered: yes — issue #16, written by the Product Manager, says "If that call fails, the message is sent anyway
  with the note". The guarantee text in `docs/ARCHITECTURE.md` and `.squad/project.md` is amended to name this
  exception; the plan names the owner of each edit.
- What does "fails" include? Answered: every failure the API client reports as its one failure result
  ([GitHub API](../../docs/areas/github-api.md#limits-and-errors), decision 0026: "it decides what a failure means
  for its notification"), plus a lookup that exceeds the time bound of this spec.
- Is a scheduled or manually started run on the default branch reported? Answered: yes; the issue's condition is the
  branch, not the triggering event.
- Does the app need a new permission? Answered: no; `src/github/manifest.ts` already requests `actions` and
  `pull_requests` read and subscribes to `workflow_run`.
- Is there a real `workflow_run` delivery to build the rule from? Answered: not yet — `test/fixtures/` has none and the
  issue attaches none. `.squad/project.md` (*Fixtures from real deliveries*) makes this an escalation at plan time:
  the Product Manager supplies raw `workflow_run` `completed` deliveries (a `failure` on the default branch, a
  `failure` in a pull request, ideally a `timed_out`, a `success` and a `cancelled` one). This does not change what the
  feature does.

## Area documents

- [Notifications](../../docs/areas/notifications.md): a new section _CI failure rules_ with the two switches, the
  event and conditions, the titles (English `CI failed on <branch>`, `CI failed in pull request`, note
  `(draft status unknown)`; German `CI fehlgeschlagen auf <branch>`, `CI im Pull Request fehlgeschlagen`, note
  `(Draft-Status unbekannt)`), lines 2 and 3, the button, the one-run-one-message rule, the choice of the pull request
  entry, the draft lookup with its time bound and its failure behavior; *Rules* and *Processing a delivery* say where
  the draft lookup happens (the rules themselves read no network today); *Languages* lists the new texts.
- [GitHub API](../../docs/areas/github-api.md): *Scope* and *Pull request read* name the webhook processing as the
  caller and the time bound it applies.
- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md): the *Rules* component and step 3 of *Webhook to Telegram* (the
  draft lookup), the *Security model* sentence that the webhook processing "will" call GitHub, and the draft
  guarantee with its exception.

## Challenge

1. MAJOR — the default-branch condition `head_branch == repository.default_branch` alone matches a fork's pull
   request from a branch named like the default branch. Accepted: "on the default branch" now also requires
   `workflow_run.head_repository.id` equal to `repository.id` (definition before S1, S1); both ids are in E5's type
   list; new edge case E14 and criterion AC15 (fork pull request from `main` → no message, no GitHub request); the
   field is an open question the plan verifies against a real delivery; Out of scope names E14.
2. minor — independent rules could let the pull request case match a default-branch run whose switch is off.
   Accepted: E3 states the pull request case never matches a run on the default branch, whatever the switches, and a
   default-branch run with its switch off gives no message, no GitHub request and the decision `disabled`; E11 refers
   to it; AC7 covers it.
3. minor — a malformed `pull_requests` entry silenced the whole delivery, and entries without `base.repo.id` were
   unaddressed. Accepted: E4 now defines the per-entry fields (`number` and `base.repo.id`, each a positive safe
   integer) and skips a malformed entry like a foreign one, never affecting the default branch case; E5 keeps only
   `pull_requests` not being an array (pull request case); AC8 covers it.
4. minor — the 8-second bound and the D1 work around it. Accepted, 8 seconds kept: the non-functional requirement
   states the bound is its own limit around the whole lookup (token and pull request read), measured from the start
   of the lookup and independent of the client's 10-second per-request timeout, with the remaining D1 work expected
   well under 2 seconds — marked unverified, measurement named by the plan.
5. minor — E12/AC12 hold only for a delivery id already recorded on arrival. Accepted: E12 and AC12 are limited to
   that; two concurrent deliveries of one id may each look up but give at most one message.
6. minor — a workflow on `push` and `pull_request` gives two near-identical messages. Accepted: named in S6 and in Out
   of scope as following "one run, one message".
