# Spec: Bound the deliveries of pull requests and CI failures caused by strangers

Source: Issue #140
Status: Approved by Lead

## Problem

On a public repository anyone can open a pull request, and every non-draft one is reported and recorded: the pull
request rules read neither the sender nor the author ([`notifications.md`](../../docs/areas/notifications.md),
*Pull request rules*; `src/rules/pull-request.ts`). A stranger can also make CI fail in the repository's own context
(a `pull_request_target` workflow on their fork's pull request, a workflow started by their comment or issue), which
the CI rules report as a default-branch failure (decision 0027). Each such delivery writes about 14 rows over its life
(decision 0043), and issue #134 bounded only `issues`, `issue_comment`, `star` and `fork`. So a stranger can still
spend the free plan's daily D1 write budget (100,000 rows), after which every delivery, alerts and the owner's own CI
failures included, is answered 503. The pull requests of the owner, members and collaborators, and the CI failures of
runs that only a person or app admitted to the repository can start, must keep being reported whatever strangers do.

Claims of the issue checked against the code:

- Confirmed: every non-draft `pull_request` delivery of the three reported actions is reported and recorded, whoever
  sent it (`src/rules/pull-request.ts`, `nonDraftPullRequest` reads no `sender` or `author_association`).
- Confirmed: the bound counts only `BOUNDED_EVENT_NAMES = ["issues", "issue_comment", "star", "fork"]`
  (`src/store/meta.ts:119`); `withinBound` in `src/webhook.ts` lets every other event through.
- Refuted in its example, confirmed in substance: a failed run of a fork's pull request (`event` `pull_request`) is
  *not* reported today. Its `head_repository` is the fork, so it is not on the default branch, and GitHub sends it
  with an empty `workflow_run.pull_requests`, so the pull request case finds no number (`src/rules/workflow-run.ts`,
  `failedWorkflowRun` and `pullRequestNumberOf`); it is therefore not recorded (decision 0043). The empty list follows
  GitHub's documentation and is not observed (decision 0027, *Consequences*). The real stranger path is the run a
  stranger's event starts in the repository's own context, reported as `CI failed on <branch>`
  (`notifications.md`, *CI failure rules*, first bullet).

## Scenarios

"Counted" below means: counted against the hourly bound of its event as step 5 of *Processing a delivery*
(`notifications.md`) does today — at most 20 recorded deliveries per event and UTC hour, past that `limited`. "The
owner" is the stored owner as `isOwnAction` (`src/rules/actor.ts`) compares it, by account id; it is never matched
for an organization-owned App or an owner not stored yet (E9).

- S1: Given a public repository and fewer than 20 counted `pull_request` deliveries this UTC hour, when a stranger (an
  account GitHub marks as neither the owner, a member nor a collaborator) opens a non-draft pull request from their
  fork, then the owner gets _New pull request_ as today, and the delivery is counted.
- S2: Given 20 counted `pull_request` deliveries this UTC hour, when a stranger opens another non-draft pull request
  from a fork (or marks one ready for review, or re-requests a review on their own), then no message is sent, GitHub
  gets **202**, the log entry's decision is `limited`, and the delivery is not recorded. In the next UTC hour a
  stranger's pull request is reported again.
- S3: Given the `pull_request` bound is full, when the owner, a member or a collaborator opens a pull request, marks
  one ready for review or has a review requested on their pull request, then the message is sent as today; the
  delivery is not counted.
- S4: Given the `pull_request` bound is full, when a pull request from a branch of the repository itself (Dependabot,
  Renovate, Copilot or any account that can push branches there) is opened, marked ready or has a review requested,
  then the message is sent; it is not counted.
- S5: Given the `pull_request` bound is full, when the owner requests a review on a stranger's pull request, then
  _Review requested_ is sent; the owner's own action is not counted.
- S6: Given the `workflow_run` bound is full, when a run fails whose event only a person or app with write access to
  the repository can cause (the list of AC3: a push, a schedule, a manual or API start, the merge queue, a release, a
  branch or tag created or deleted, …) or a pull request from a branch of the repository itself, then
  _CI failed on <branch>_ or _CI failed in pull request_ is sent as today; it is not counted.
- S7: Given fewer than 20 counted `workflow_run` deliveries this UTC hour, when a run of any other event fails and is
  reported (for example `pull_request_target` on a fork's pull request, `issue_comment`, `issues`, `status`,
  `dynamic`, a chained `workflow_run`, or a fork's `pull_request` should GitHub name its pull request after all), then
  the message is sent and the delivery is counted; the 21st of the hour is `limited` like S2.
- S8: Given the `workflow_run` bound is full, when such a run of S7 was started or re-run by the owner, then the
  failure is reported; it is not counted.
- S9: Given a delivery was `limited`, when GitHub or the owner redelivers it in a later hour with room in the bound,
  then it is reported once, as for the four events bounded today.

## Errors and edge cases

- E1: A `pull_request` delivery whose author association is missing, not a string or not exactly one of `OWNER`,
  `MEMBER`, `COLLABORATOR` (for example `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `NONE`, `MANNEQUIN`, a lower-case
  `owner`, one GitHub adds later), and whose head repository is not provably the repository itself, is counted. A
  bot's pull request from a fork is counted.
- E2: A pull request's head repository counts as the repository itself only when `pull_request.head.repo.id` and
  `repository.id` are both whole numbers from 1 to 2^53 − 1 and equal; a `null` head repository (a deleted fork), a
  missing or mistyped id, or a matching name with another id is counted. A run's head repository is compared the same
  way (`workflow_run.head_repository.id` with `repository.id`, as `failedWorkflowRun` already narrows them), never by
  name.
- E3: A reported `workflow_run` delivery whose run event or starting account is missing or of an unexpected type is
  counted unless it is provably one of S6 or S8.
- E4: Concurrent deliveries at 19 or 20 counted never record more than 20 of one event in one hour (one conditional
  statement, as today).
- E5: A failure of the counter answers **503** and stores nothing, as today; GitHub may redeliver.
- E6: Around the turn of an hour up to twice the bound can be recorded in a short time, as today.
- E7: One stranger can fill an event's bound for an hour and hide the other strangers' pull requests or CI failures of
  that hour; the owner learns of it only from the log (`limited`) and GitHub's own notifications. The pull requests of
  S3 and S4 and the runs of S6 are never hidden.
- E8: A collaborator's comment or issue that starts a failing workflow, and a chained `workflow_run` started by a
  collaborator's run, are counted (S7): a run carries no author association, a chained run does not name the event of
  the run before it, and only the owner is told apart, as the issue and comment bound already counts collaborators
  (decision 0043, *Consequences*).
- E9: For an organization-owned App, or an owner not stored yet, S5 and S8 never apply: an organization admin's review
  request on a stranger's pull request and an admin's re-run of a stranger's run are counted, as `isOwnAction` never
  matches there (`src/rules/actor.ts:17`; `notifications.md`, *Whose stars count*). Members' and collaborators' pull
  requests (S3, by author association) and the runs of S6 stay uncounted there too.
- E10: A delivery that would not be recorded (a draft, an action no rule reports, a successful run, a switch that is
  off, a CI failure in a pull request the draft lookup finds to be a draft) is never counted, as today.

## Non-functional requirements

- Budget: with `pull_request` and `workflow_run` bounded, at most 6 × 24 × 20 = 2,880 counted recorded deliveries a
  day, about 40,000 of the 100,000 daily rows written (estimate per decision 0043); the uncounted ones of S3 to S6 and
  S8 are not limited, as no stranger can cause them.
- No new setting: the bound stays the constant 20 (`BOUNDED_DELIVERIES_PER_HOUR`, decision 0043 option 10), shared by
  all six events, each with its own counter.
- No migration, no new GitHub permission or event, no network call and no read beyond today's: the decision uses only
  the payload and the stored owner already read once per delivery.
- At most six `meta` counter rows; a delivery past the bound costs one read and a write that changes nothing.
- Logs: no new field or value; a dropped delivery logs the existing decision `limited`.
- The security alert events stay never counted.

## Acceptance criteria

- [ ] AC1: A `pull_request` delivery that would be recorded is counted unless AC2 applies; of the counted ones at most
  20 per UTC hour are recorded, every further one of that hour answers 202 with decision `limited`, sends no message
  and is not recorded (S1, S2, E1, E7).
- [ ] AC2: A `pull_request` delivery is reported and recorded without being counted, also while its bound is full,
  when `pull_request.author_association` is exactly `OWNER`, `MEMBER` or `COLLABORATOR`, when its head repository is
  the repository itself (compared as E2), or when `sender` is the owner (S3, S4, S5, E2, E9).
- [ ] AC3: A `workflow_run` delivery that would be recorded is not counted, also while its bound is full, when
  `workflow_run.event` is exactly one of `push`, `schedule`, `workflow_dispatch`, `repository_dispatch`,
  `merge_group`, `release`, `create`, `delete`, `page_build`, `label`, `milestone`, `registry_package` or
  `branch_protection_rule`; when it is `pull_request` and the head repository is the repository itself (compared as
  E2); or when `workflow_run.triggering_actor.id` is the owner's id (S6, S8, E9).
- [ ] AC4: Every other `workflow_run` delivery that would be recorded is counted, a missing or mistyped field
  included, and a run whose `workflow_run.actor` is the owner but whose `triggering_actor` is not is counted; at most
  20 per UTC hour are recorded and further ones are `limited` as in AC1 (S7, E3, E8).
- [ ] AC5: `pull_request` and `workflow_run` each have their own hourly counter, separate from each other and from the
  four existing ones, with the same concurrency, hour restart and 503-on-failure behavior (E4, E5, E6).
- [ ] AC6: A delivery that would not be recorded is never counted, and a `limited` delivery redelivered in a later hour
  with room in the bound is reported once (E10, S9).

## Out of scope

- A notice to the owner when a bound is reached (decision 0043, option 11).
- Telling collaborators from strangers for CI runs started by comments, issues or a chained run (E8): it needs a
  GitHub API call per delivery.
- A bound for the security alert events, which no stranger can cause in numbers.
- Changing what the pull request or CI rules report, their texts or the draft lookup.

## Open questions

- Who is a stranger for a pull request? Answered: an author GitHub marks as neither `OWNER`, `MEMBER` nor
  `COLLABORATOR` (`pull_request.author_association`, present with `OWNER` in all five real fixtures,
  `test/fixtures/pull_request/*.json`) whose pull request comes from a fork. These three values name the accounts the
  owner admitted to the repository or its organization, whatever their access level; this also covers an
  organization-owned App, where `isOwnAction` never matches. A branch of the repository itself can only be pushed by
  an account or app with write access, so its pull requests are never counted (S4; `opened.json` has
  `head.repo.id` equal to `repository.id`). The sender check adds the owner's own action on a stranger's pull request
  (S5).
- Who is a stranger for a CI run? Answered: a `workflow_run` carries no author association, so the run's `event`
  decides which runs only someone with write access (or GitHub on their behalf) can start (AC3). Events a stranger can
  cause, directly or through an app reacting to their pull request (`status`, `deployment`, `deployment_status`,
  `check_run`, `check_suite`, `dynamic` — CodeQL default setup also analyzes fork pull requests), stay counted, failing
  closed toward the budget. Of the rest only the owner is exempt, by `workflow_run.triggering_actor.id`: on a re-run
  it is the account that re-ran while `actor` stays the original one (GitHub's documentation; the real fixtures have
  all three accounts equal, so the plan marks it unverified). The real samples carry `event`, `actor`,
  `triggering_actor` and `head_repository` (`test/fixtures/workflow_run/completed-failure-pull-request.json`).
- Should bots' pull requests be exempt? Answered: those from a branch of the repository are (S4); a bot's pull request
  from a fork is counted, the side that protects the budget (E1). Dependabot alerts are never counted.
- One counter per event or a shared one? Answered: per event, as decision 0043 option 6 chose, so a flood of pull
  requests does not hide CI failures and vice versa.

## Area documents

- `docs/areas/notifications.md`: *Processing a delivery* step 5 names the six counted events and, for `pull_request`
  and `workflow_run`, which deliveries are counted; *Pull request rules* replaces "No rate limit exists" with the
  bound; *CI failure rules* states which runs are counted; *Log entries* names the two events under `limited`.
- `docs/areas/storage.md`: the `meta` rows `delivery_count:pull_request` and `delivery_count:workflow_run`, at most
  six such rows.
- `docs/areas/http-routes.md`: the `POST /webhook` row names the bounded events.
- Also (not an area document): the *Webhook processing* row of `docs/ARCHITECTURE.md` and decision 0043 (unreleased,
  extended in place), whose option 12 becomes the chosen extension.

## Challenge

1. (major) AC3 narrower than the Problem and the issue — accepted. AC3 now exempts every event only a writer causes
   directly (its list). Not taken: `status`, `deployment(_status)`, `check_run`, `check_suite`, `dynamic`, which apps
   and CodeQL create in reaction to a stranger's fork pull request (open questions). A chained `workflow_run` stays
   counted: its payload lacks the upstream event (E8). The Problem's promise is narrowed to match.
2. (minor) Field of the owner check — accepted. AC3 names `workflow_run.triggering_actor.id`; AC4 counts a run with
   the owner as `actor` and a stranger as `triggering_actor`; tests build both directions from the real fixture.
3. (minor) Same-repository pull requests — accepted. AC2 adds the head-repository test, S4 describes it, and E1 and
   the bots question are adjusted.
4. (minor) Wording of `MEMBER`/`COLLABORATOR` — accepted in the first open question; E1 and AC2 require the exact
   upper-case values, so tests build `MEMBER`, `COLLABORATOR`, a lower-case `owner` and an unknown value.
5. (minor) How the head repository is compared — accepted: E2, by positive safe-integer ids, never by name.
6. (minor) Owner exemption for organization-owned Apps — accepted. E9 states that S5 and S8 never apply there and that
   an organization admin's action is counted. "The owner" is defined once above the scenarios.
