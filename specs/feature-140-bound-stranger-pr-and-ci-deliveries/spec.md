# Spec: Bound the deliveries of pull requests and CI failures caused by strangers

Source: Issue #140
Status: Draft

## Problem

On a public repository anyone can open a pull request, and every non-draft one is reported and recorded: the pull
request rules read neither the sender nor the author ([`notifications.md`](../../docs/areas/notifications.md),
*Pull request rules*; `src/rules/pull-request.ts`). A stranger can also make CI fail in the repository's own context
(a `pull_request_target` workflow on their fork's pull request, a workflow started by their comment or issue), which
the CI rules report as a default-branch failure (decision 0027). Each such delivery writes about 14 rows over its life
(decision 0043), and issue #134 bounded only `issues`, `issue_comment`, `star` and `fork`. So a stranger can still
spend the free plan's daily D1 write budget (100,000 rows), after which every delivery, alerts and the owner's own CI
failures included, is answered 503. The owner's, members' and collaborators' pull requests and CI failures must keep
being reported whatever strangers do.

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
(`notifications.md`) does today — at most 20 recorded deliveries per event and UTC hour, past that `limited`.

- S1: Given a public repository and fewer than 20 counted `pull_request` deliveries this UTC hour, when a stranger (an
  account GitHub marks as neither the owner, a member nor a collaborator of the repository) opens a non-draft pull
  request, then the owner gets _New pull request_ as today, and the delivery is counted.
- S2: Given 20 counted `pull_request` deliveries this UTC hour, when a stranger opens another non-draft pull request
  (or marks one ready for review, or re-requests a review on their own), then no message is sent, GitHub gets **202**,
  the log entry's decision is `limited`, and the delivery is not recorded. In the next UTC hour a stranger's pull
  request is reported again.
- S3: Given the `pull_request` bound is full, when the owner, a member or a collaborator opens a pull request, marks
  one ready for review or has a review requested on their pull request, then the message is sent as today; the
  delivery is not counted.
- S4: Given the `pull_request` bound is full, when the owner requests a review on a stranger's pull request, then
  _Review requested_ is sent; the owner's own action is not counted.
- S5: Given the `workflow_run` bound is full, when a run started by a push, a schedule, a manual start
  (`workflow_dispatch`), the merge queue or a pull request from a branch of the repository itself fails, then
  _CI failed on <branch>_ or _CI failed in pull request_ is sent as today; it is not counted. Only an account with
  write access can start such a run.
- S6: Given fewer than 20 counted `workflow_run` deliveries this UTC hour, when a run started by any other event (for
  example `pull_request_target` on a fork's pull request, `issue_comment`, `issues`, a chained `workflow_run`, or a
  fork's `pull_request` should GitHub name its pull request after all) fails and is reported, then the message is sent
  and the delivery is counted; the 21st of the hour is `limited` like S2.
- S7: Given the `workflow_run` bound is full, when such a run of S6 was started or re-run by the owner, then the
  failure is reported; it is not counted.
- S8: Given a delivery was `limited`, when GitHub or the owner redelivers it in a later hour with room in the bound,
  then it is reported once, as for the four events bounded today.

## Errors and edge cases

- E1: A `pull_request` delivery whose pull request author association is missing, not a string or a value other than
  owner, member or collaborator (for example contributor, first-time contributor, none, mannequin, or one GitHub adds
  later) counts as a stranger's: it is counted. A bot's pull request (Dependabot, Renovate) is counted unless GitHub
  marks its author as a member or collaborator.
- E2: A reported `workflow_run` delivery whose run event, head repository or starting account is missing or of an
  unexpected type is counted unless it is provably one of S5 or S7.
- E3: Concurrent deliveries at 19 or 20 counted never record more than 20 of one event in one hour (one conditional
  statement, as today).
- E4: A failure of the counter answers **503** and stores nothing, as today; GitHub may redeliver.
- E5: Around the turn of an hour up to twice the bound can be recorded in a short time, as today.
- E6: One stranger can fill an event's bound for an hour and hide the other strangers' pull requests or CI failures of
  that hour; the owner learns of it only from the log (`limited`) and GitHub's own notifications. The owner's, members'
  and collaborators' pull requests and the runs of S5 and S7 are never hidden.
- E7: A collaborator's comment or issue that starts a failing workflow is counted (S6): the run carries no author
  association, and the account that started it is compared with the owner only, as the issue and comment bound
  already counts collaborators (decision 0043, *Consequences*).
- E8: A delivery that would not be recorded (a draft, an action no rule reports, a successful run, a switch that is
  off, a CI failure in a pull request the draft lookup finds to be a draft) is never counted, as today.

## Non-functional requirements

- Budget: with `pull_request` and `workflow_run` bounded, at most 6 × 24 × 20 = 2,880 counted recorded deliveries a
  day, about 40,000 of the 100,000 daily rows written (estimate per decision 0043); the uncounted ones of S3, S4, S5
  and S7 are not limited, as they cannot be caused by a stranger.
- No new setting: the bound stays the constant 20 (`BOUNDED_DELIVERIES_PER_HOUR`, decision 0043 option 10), shared by
  all six events, each with its own counter.
- No migration, no new GitHub permission or event, no network call and no read beyond today's: the decision uses only
  the payload and the stored owner already read once per delivery.
- At most six `meta` counter rows; a delivery past the bound costs one read and a write that changes nothing.
- Logs: no new field or value; a dropped delivery logs the existing decision `limited`.
- The security alert events stay never counted.

## Acceptance criteria

- [ ] AC1: A `pull_request` delivery that would be recorded is counted when the pull request's author association is
  not owner, member or collaborator and the sender is not the owner; of these at most 20 per UTC hour are recorded,
  every further one of that hour answers 202 with decision `limited`, sends no message and is not recorded (S1, S2, E1,
  E6).
- [ ] AC2: A `pull_request` delivery whose author association is owner, member or collaborator, or whose sender is the
  owner, is reported and recorded without being counted, also while the `pull_request` bound is full (S3, S4).
- [ ] AC3: A `workflow_run` delivery that would be recorded is not counted, also while its bound is full, when its run
  was started by `push`, `schedule`, `workflow_dispatch` or `merge_group`, or by `pull_request` with the repository
  itself as head repository, or when the owner started or re-ran it (S5, S7).
- [ ] AC4: Every other `workflow_run` delivery that would be recorded is counted, a missing or mistyped field
  included; at most 20 per UTC hour are recorded and further ones are `limited` as in AC1 (S6, E2, E7).
- [ ] AC5: `pull_request` and `workflow_run` each have their own hourly counter, separate from each other and from the
  four existing ones, with the same concurrency, hour restart and 503-on-failure behavior (E3, E4, E5).
- [ ] AC6: A delivery that would not be recorded is never counted, and a `limited` delivery redelivered in a later hour
  with room in the bound is reported once (E8, S8).

## Out of scope

- A notice to the owner when a bound is reached (decision 0043, option 11).
- Telling collaborators from strangers for CI runs started by comments or issues (E7): it needs a GitHub API call per
  delivery.
- A bound for the security alert events, which no stranger can cause in numbers.
- Changing what the pull request or CI rules report, their texts or the draft lookup.

## Open questions

- Who is a stranger for a pull request? Answered: the pull request's author as GitHub's author association states it
  (present in all five real `pull_request` fixtures, `test/fixtures/pull_request/*.json`, value `OWNER`). Owner, member
  and collaborator are the accounts with write access to the repository or its organization; this also covers an
  organization-owned App, where `isOwnAction` never matches (`src/rules/actor.ts`). The sender check adds the owner's
  own action on a stranger's pull request (S4).
- Who is a stranger for a CI run? Answered: a `workflow_run` carries no author association, so the run's event decides
  which runs only a writer can start (S5); of the others only the owner is exempt, as `isOwnAction` compares the stored
  owner (`src/rules/actor.ts`). The real `workflow_run` samples carry `event`, `actor`, `triggering_actor` and
  `head_repository` (`test/fixtures/workflow_run/completed-failure-pull-request.json`).
- Should bots' pull requests be exempt? Answered: no — counting is the side that protects the budget; a bot's pull
  request is dropped only while strangers fill the bound, and Dependabot alerts are never counted (E1).
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
