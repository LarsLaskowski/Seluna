# Plan: Bound the deliveries of pull requests and CI failures caused by strangers

Source: Issue #140 | [spec.md](spec.md)
Status: Revised (1)
Tier: security — the change widens a rate limit against abuse (the hourly bound of decision 0043, a guard under
*Security areas* in `.squad/project.md`) and adds the payload checks that decide who is exempt from it.
Security areas touched: Bound on deliveries of other senders (`src/webhook.ts`, `src/store/meta.ts`); Parsing of
external input (new narrowed payload fields in `src/rules/stranger.ts`)

## Problem / root cause

See [spec.md](spec.md), *Problem*: `withinBound` (`src/webhook.ts:184`) counts only `BOUNDED_EVENT_NAMES`
(`src/store/meta.ts:119`), so `pull_request` and `workflow_run` deliveries are never bounded.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | The pull request rules read no `sender` or author association | `src/rules/pull-request.ts`, `nonDraftPullRequest` | confirmed |
| 2 | Only `issues`, `issue_comment`, `star`, `fork` are counted | `src/store/meta.ts:119`; `src/webhook.ts:184` | confirmed |
| 3 | A fork's `pull_request` run is not reported today | to verify: a captured fork-run delivery, Product Manager, live check after deploy; either way it is counted (AC4) (evidence so far: `src/rules/workflow-run.ts` and decision 0027, documentation only) | unverified |
| 4 | `processWebhook` has the owner and payload in scope where `withinBound` is called | `src/webhook.ts:204-228` | confirmed |
| 5 | Real `pull_request` deliveries carry `pull_request.author_association` (`OWNER`) | `test/fixtures/pull_request/opened.json`, `ready_for_review.json`, `review_requested.json` | confirmed |
| 6 | Real `workflow_run` deliveries carry `workflow_run.event` (`pull_request`, `schedule`), `actor` and `triggering_actor` | `test/fixtures/workflow_run/*.json` (all accounts id 1000) | confirmed |
| 7 | GitHub's `author_association` values are `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`, computed for the pull request's author, not the sender | to verify: confirmed against Security's knowledge of the enum in step 3 (N3), docs.github.com unreachable; unknown values are counted (evidence so far: GitHub REST/webhook documentation) | unverified |
| 8 | On a re-run, `triggering_actor` is the account that re-ran and `actor` stays the original | to verify: a captured re-run delivery, Product Manager, live check after deploy; wrong only counts a run that need not be (evidence so far: GitHub documentation; fixtures all equal) | unverified |
| 9 | Of the 11 events of AC3, `label` and `milestone` need triage or write, `branch_protection_rule` admin, `registry_package` a publisher the owner granted the package (possibly without repository access), the rest write | to verify: Security's per-event review in step 3 (N2), docs.github.com unreachable; Product Manager live check is not practical per event (evidence so far: GitHub *Events that trigger workflows*) | unverified |
| 10 | The existing test "records and sends $case while every bounded event is at its bound" keeps passing unchanged | `src/webhook.test.ts:2044` runs with the default harness owner `undefined` (`:131`): `opened` (`OWNER`) and `MAIN_FAILURE` (`schedule`) stay uncounted, but `failedPullRequestRun` (event `pull_request`) is now counted and, at the bound, `limited`; the Tester adapts that case (see *Test files*) | refuted |
| 11 | `countBoundedDelivery` works for any key built from `BoundedEvent`; only the type restricts it | `src/store/meta.ts:131-151` | confirmed |
| 12 | Decision 0043 is unreleased | not in `v0.7.0`; `git ls-remote --tags origin` lists v0.3.0–v0.7.0 | confirmed |
| 13 | Anyone with read access can open a pull request between two existing branches of a public repository, and reopen it, which starts `pull_request` runs with the repository as head repository | to verify: Product Manager, live check after deploy with a second account (no exemption depends on it any more: such pull requests and runs are counted) (evidence so far: GitHub *Creating a pull request*, as Security and the Devil's Advocate quote it) | unverified |
| 14 | Events raised with `GITHUB_TOKEN` start no new run except `workflow_dispatch` and `repository_dispatch` | to verify: Product Manager, live check after deploy; both are counted now, so the claim only bounds the residual E11 (evidence so far: GitHub *Triggering a workflow from a workflow*) | unverified |
| 15 | The draft lookup of a counted CI failure in a pull request runs before the bound | `src/webhook.ts:204` (`notificationsOf`) before `withinBound` at `:225` | confirmed |

## Acceptance criteria

The spec's AC1–AC6 ([spec.md](spec.md), *Acceptance criteria*).

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `isCountedDelivery counts a pull request whose author association is $value` (it.each: `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `NONE`, `MANNEQUIN`, `owner`, `Member`, an unknown string, missing, `1`, `null`); `isCountedDelivery counts a NONE pull request from a branch of the repository itself` (head repository id equal to `repository.id`, as in `opened.json`); `isCountedDelivery counts a NONE pull request authored by a Bot` | `src/rules/stranger.test.ts` |
| AC1 | `processWebhook records 20 stranger pull requests of one hour and answers 202 limited for the 21st without a row or a message` | `src/webhook.test.ts` |
| AC2 | `isCountedDelivery leaves uncounted a pull request whose author association is $value` (`OWNER`, `MEMBER`, `COLLABORATOR`); `isCountedDelivery leaves uncounted a NONE pull request sent by the User owner`; `isCountedDelivery counts a NONE pull request sent by the account of an Organization owner` | `src/rules/stranger.test.ts` |
| AC2 | `processWebhook reports $case while the pull_request bound is full` (a `MEMBER` pull request, the owner's review request on a stranger's pull request), each with counter unchanged | `src/webhook.test.ts` |
| AC3 | `isCountedDelivery leaves uncounted a failed run of event $event` (it.each over the 11 events of AC3); `… a stranger's issue_comment run re-run by the owner` (`actor` stranger, `triggering_actor` owner); `… a workflow_dispatch run started by the owner` | `src/rules/stranger.test.ts` |
| AC3 | `processWebhook reports a failed $case run while the workflow_run bound is full` (`push`, `release`, a `workflow_dispatch` run started by the owner, a stranger's run re-run by the owner) | `src/webhook.test.ts` |
| AC4 | `isCountedDelivery counts a failed run of event $event` (`pull_request_target`, `issue_comment`, `issues`, `workflow_dispatch`, `repository_dispatch`, `status`, `deployment_status`, `check_suite`, `dynamic`, `workflow_run`, `gollum`, an unknown name, `Push`, missing, `7`); `… a pull_request run from a branch of the repository itself re-run by a stranger` (`actor` owner, `triggering_actor` stranger, head repository the repository); `… a pull_request run from a fork`; `… a run whose actor is the owner and whose triggering_actor is a stranger`; `… a run whose triggering_actor is missing`; `… an owner-triggered run under an Organization owner` | `src/rules/stranger.test.ts` |
| AC4 | `processWebhook answers 202 limited for a failed $case run when 20 workflow_run deliveries were counted this hour` (`issue_comment`, a `workflow_dispatch` run started by `github-actions[bot]`, a same-repository `pull_request` run started by a stranger) | `src/webhook.test.ts` |
| AC5 | `BOUNDED_EVENT_NAMES lists the six bounded events`; `countBoundedDelivery keeps the pull_request and workflow_run counters apart from each other and from issues` | `src/store/meta.test.ts` |
| AC5 | the existing `processWebhook answers 202 limited for $case when 20 deliveries of its event were counted this hour` extended by a stranger's pull request and a stranger's failed run; `processWebhook answers 503 unavailable and stores nothing when the counter write fails for a stranger pull request`; `processWebhook still records a stranger pull request while workflow_run is at the bound` | `src/webhook.test.ts` |
| AC6 | the existing `processWebhook neither counts nor limits $case` and `… leaves the counter unchanged for $case below the bound` extended by a stranger's draft pull request, a stranger's successful run and a stranger's pull request with `pull_request_opened` off; `processWebhook reports a limited stranger pull request once when it is redelivered in the next hour` | `src/webhook.test.ts` |

Stranger and run payloads are built in the tests from the real fixtures (`variant`), never typed by hand.

## Approach

- `src/store/meta.ts`: append `"pull_request"` and `"workflow_run"` to `BOUNDED_EVENT_NAMES`; the counter statement is
  unchanged, each event gets its own `delivery_count:<event>` row.
- New pure module `src/rules/stranger.ts` decides whether a delivery of a bounded event is counted:
  - `issues`, `issue_comment`, `star`, `fork`: always (today's behavior; their rules already drop the owner).
  - `pull_request`: counted unless `pull_request.author_association` is a string exactly in
    `ADMITTED_AUTHOR_ASSOCIATIONS` (`OWNER`, `MEMBER`, `COLLABORATOR`) or `isOwnAction(payload, owner)`. The head
    repository and `pull_request.user.type` are not read.
  - `workflow_run`: counted unless `workflow_run.event` is a string exactly in `ADMITTED_ONLY_RUN_EVENTS` (the 11 of
    spec AC3) or `isOwnerAccount(workflow_run.triggering_actor, owner)`. The head repository is not read.
  - Every field is narrowed from `unknown` (`recordField`, `stringField` of `src/rules/pull-request.ts`); any
    unexpected shape returns `true` (counted). An exhaustive `switch` over `BoundedEvent` with a `never` check.
- `src/rules/actor.ts`: extract the id comparison of `isOwnAction` into `isOwnerAccount(account, owner)`;
  `isOwnAction` calls it with `senderOf(payload)`.
- `src/webhook.ts`: `withinBound` takes the payload and the owner and returns `true` without a write when
  `isCountedDelivery` is false; the call site passes `payload` and `owner`. The step order is unchanged.
- No new user-visible output: the existing decision `limited` and the 202 answer are reused.

## Options considered

Decision 0043, options 12–19: the bound for any sender, the sender alone as for issues, a collaborator lookup through
the GitHub API, a list of stranger-capable run events, exempting bot authors, one shared counter, and (new in this
revision) exempting pull requests and runs from a branch of the repository itself. Option 13 is chosen.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/store/meta.ts` | two events added to `BOUNDED_EVENT_NAMES`; doc comment |
| Worker | `src/rules/stranger.ts` | new: the counting decision |
| Worker | `src/rules/actor.ts` | `isOwnerAccount` extracted |
| Worker | `src/webhook.ts` | `withinBound` reads the decision; `BOUNDED_EVENTS` doc comment |

## Signatures (for the Dev's skeleton)

```ts
// src/store/meta.ts
export const BOUNDED_EVENT_NAMES = ["issues", "issue_comment", "star", "fork", "pull_request", "workflow_run"] as const;

// src/rules/actor.ts
export function isOwnerAccount(account: unknown, owner: OwnerAccount | undefined): boolean;

// src/rules/stranger.ts
export const ADMITTED_AUTHOR_ASSOCIATIONS: ReadonlySet<string>;
export const ADMITTED_ONLY_RUN_EVENTS: ReadonlySet<string>;
export function isStrangerPullRequest(payload: WebhookPayload, owner: OwnerAccount | undefined): boolean;
export function isStrangerRun(payload: WebhookPayload, owner: OwnerAccount | undefined): boolean;
export function isCountedDelivery(
  event: BoundedEvent,
  payload: WebhookPayload,
  owner: OwnerAccount | undefined,
): boolean;

// src/webhook.ts (module-private)
async function withinBound(
  db: D1Database,
  event: string,
  payload: WebhookPayload,
  owner: OwnerAccount | undefined,
  time: Date,
): Promise<boolean>;
```

The stranger module imports the bounded-event type from the meta store as a type-only import. `isOwnerAccount`
keeps the rules of the existing sender check: only a User owner, an account object whose id is a number equal to the owner's.
No existing file is final; the skeleton touches the four files above.

## Test files

- `src/rules/stranger.test.ts` (new), `src/webhook.test.ts`, `src/store/meta.test.ts`; `src/rules/actor.test.ts`
  keeps its `isOwnAction` cases and gains `isOwnerAccount` cases (Tester).
- Existing call sites: none of a changed public signature. Existing tests affected by behavior: in
  `src/webhook.test.ts` the helpers `setAllCounters`, `countersAt` (four rows) and `counterOf`/`setCounter` (typed
  `BoundedEvent`) are extended to six events by the Tester, so the "while every bounded event is at its bound" test
  (line 2044) holds all six at the bound. Its CI cases stay uncounted only when the fixture's `triggering_actor` is
  the test's owner or the event is one of AC3: the harness owner is `undefined` there, so the `failedPullRequestRun`
  case (event `pull_request`) is now `limited`; the Tester gives that case a stored User owner whose id is the
  fixture's `triggering_actor.id` (1000), keeping it a check that an owner's run is never counted (fact 10). The about 26 other `pull_request`/`workflow_run` deliveries built from synthetic
  payloads now make one counter write each; the Tester checks each one that asserts on `meta` rows or uses a failing
  database stub and adapts it.
- Files no unit test can cover: none.

## Areas

- `docs/areas/notifications.md`, `docs/areas/storage.md`, `docs/areas/http-routes.md` (below).

## Documentation updates

All owned by the Dev, written once the code is green:

- `docs/areas/notifications.md`: step 5 of *Processing a delivery* (line 27–30) names the six events and refers to
  the rules for `pull_request` and `workflow_run`, replacing "Pull request, CI and security alert events are never
  counted" by "security alert events are never counted"; *Pull request rules*, bullet at line 104–107: replace "No
  rate limit exists" by the bound and its exemptions (author association `OWNER`/`MEMBER`/`COLLABORATOR`, the owner's
  action), noting that a member whose organization membership is private is marked otherwise and counted — never
  "every organization member"; *CI failure rules*: a new bullet with the counted and uncounted runs (the 11 events,
  the owner by `triggering_actor`), the residual of spec E11 and E2/E8/E9; *Issue and comment rules* and *Draft
  lookup*: the sentence that a comment past the bound still makes its draft lookup is extended to a counted CI
  failure in a pull request; *Log entries* (line 542): `limited` names the six events; *Related decisions* (line
  603–604): 0043 names the two new events.
- `docs/areas/storage.md` line 120–126: the two new `delivery_count:` rows, "at most six".
- `docs/areas/http-routes.md` line 17: the `POST /webhook` row names the six events and "caused by a stranger" for
  the two new ones.
- `docs/ARCHITECTURE.md` line 19 (*Webhook processing* row) and line 65 (the enumeration of bounded events), linking
  decision 0043.
- `.squad/project.md` line 90–93 (*Bound on deliveries of other senders*): the six events, the exemptions decided in
  `src/rules/stranger.ts` (no claim about every organization member), the residual of spec E11, and "alert events
  are never counted".

## Architecture check

No guarantee of `.squad/project.md` changes: a `limited` delivery is not recorded, so "processed once" and the outbox
guarantee apply as for the four events today (decision 0043). The pull requests of admitted authors, the runs of the
11 admitted-only events and the owner's own runs stay unbounded. `docs/ARCHITECTURE.md` gets the enumeration update
above.

## Security considerations

- [ ] No limits on parsed input are added; the new fields are compared as exact strings or safe integers.
- [ ] None: `isCountedDelivery` never throws (every field narrowed), and a counter failure answers 503 as today with no
  text.
- [ ] Fail-closed: every unknown or malformed value is counted, and the head repository exempts nothing. The fail-open
  risks left: an event wrongly listed in `ADMITTED_ONLY_RUN_EVENTS` (fact 9), an admitted association GitHub gives a
  stranger (fact 7), and a token with write access the owner places in a workflow a stranger can start (spec E11).

## Decision records

- `docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md` (Accepted, unreleased) — extended in place:
  source #140, context, options 12–19, decision sentence, consequences.

## Challenge

1. (major) Same-repository pull requests and runs are not writer-only — accepted. Both head-repository exemptions are
   dropped rather than tied to `user.type` `Bot`: the simplest fail-closed choice, and the Bot claim is unverified
   (option 17). Dependabot and Renovate pull requests and collaborators' `pull_request` CI failures now share the
   bound (spec S4, E2); a stranger's pull request between existing branches and its reopened runs are counted. Tests:
   AC1 counts a `NONE` same-repository pull request; AC4 counts a same-repository run re-run by a stranger.
   Decision 0043 option 13 and 17 updated, new option 19 records the rejected exemption.
2. (major) `workflow_dispatch` and `repository_dispatch` can be raised by `GITHUB_TOKEN` — accepted. Both are removed
   from the list (11 events left); the owner's own start stays exempt by `triggering_actor` (S8). Tests moved from
   the AC3 to the AC4 it.each, plus an owner-started `workflow_dispatch` under AC3. The residual of tokens the owner
   placed in a stranger-startable workflow is spec E11 and a 0043 consequence.
3. (minor) Draft lookup before the bound also for CI failures — accepted: 0043 consequence extended; Dev doc row in
   *Documentation updates* (fact 15).
4. (minor) Private organization membership — accepted: spec E9 and the Dev doc rows for `notifications.md` and
   `.squad/project.md` state it; no document claims every member.

## Security review

- B1 (blocking) — resolved as Challenge 1: no head-repository exemption for pull requests or runs; the planned test
  that pinned the defect is replaced by its opposite; *Security considerations* lists the remaining fail-open risks.
- B2 (blocking) — resolved by option (a)'s simpler variant, removing the two dispatch events (Challenge 2), rather
  than a `triggering_actor.type` `User` check: with them gone, `GITHUB_TOKEN` can start no run of an exempt event
  (fact 14), and the residual (a PAT or App token) is named in spec E11, the NFR and 0043 without "no stranger can
  cause them" unqualified.
- N1 — accepted (Challenge 3).
- N2 — accepted: fact 9 names the access per event; `label`/`milestone` "triage or write", `registry_package` a
  publisher the owner granted. All are accounts the owner admitted, hence the list's name `ADMITTED_ONLY_RUN_EVENTS`.
- N3 — accepted into fact 7.
- N4 — no change.
- Not verified items are facts 3, 8, 13 and 14 (Product Manager, live check after deploy) and 7 and 9 (Security's
  reading, documentation unreachable). Whether a same-repository `pull_request` run by a non-writer needs approval no
  longer matters: such runs are counted.

## Out of scope / follow-ups

The spec's *Out of scope*; no follow-up issue.
