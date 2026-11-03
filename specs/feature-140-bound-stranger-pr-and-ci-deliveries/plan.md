# Plan: Bound the deliveries of pull requests and CI failures caused by strangers

Source: Issue #140 | [spec.md](spec.md)
Status: Draft
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
| 3 | A fork's `pull_request` run is not reported today | to verify: a captured fork-run delivery, Product Manager, live check after deploy; either way it is counted (AC4) (evidence so far: `failedWorkflowRun`/`pullRequestNumberOf` in `src/rules/workflow-run.ts` need `head_repository.id` = `repository.id` or a `pull_requests` entry; GitHub's documentation says a fork's list is empty (decision 0027)) | unverified |
| 4 | `processWebhook` has the owner and payload in scope where `withinBound` is called | `src/webhook.ts:204-228` | confirmed |
| 5 | Real `pull_request` deliveries carry `pull_request.author_association` (`OWNER`) and `pull_request.head.repo.id` equal to `repository.id` for a same-repository branch | `test/fixtures/pull_request/opened.json` (2000001 both), `ready_for_review.json`, `review_requested.json` (2000003 both) | confirmed |
| 6 | Real `workflow_run` deliveries carry `workflow_run.event` (`pull_request`, `schedule`), `actor`, `triggering_actor` and `head_repository.id` | `test/fixtures/workflow_run/*.json` (all accounts id 1000) | confirmed |
| 7 | GitHub's `author_association` values are `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER` | to verify: Security reads the documentation in step 3; unknown values are counted, so a mismatch only counts more (evidence so far: GitHub REST/webhook documentation (author association enum)) | unverified |
| 8 | On a re-run, `triggering_actor` is the account that re-ran and `actor` stays the original | to verify: a captured re-run delivery, Product Manager, live check after deploy; wrong only counts a run that need not be (evidence so far: GitHub documentation of the workflow run object; the fixtures cannot tell (all equal)) | unverified |
| 9 | The 13 events of AC3 can only be caused by an account or app with write (or higher) access to the repository | to verify: Security checks each against the documentation in step 3; a wrongly listed event lets a stranger's runs of it pass unbounded (evidence so far: GitHub documentation *Events that trigger workflows* and the permissions of the API calls behind them) | unverified |
| 10 | Existing tests that assert PR/CI deliveries are never counted still pass: their fixtures are `OWNER` / same-repository / `pull_request`- and `schedule`-event runs | `src/webhook.test.ts:2044` with fixtures of facts 5 and 6 | confirmed |
| 11 | `countBoundedDelivery` works for any key built from `BoundedEvent`; only the type restricts it | `src/store/meta.ts:131-151` | confirmed |
| 12 | Decision 0043 is unreleased | not in `v0.7.0` (`git show v0.7.0:docs/decisions/0043-…` fails); `git ls-remote --tags origin` lists v0.3.0–v0.7.0 | confirmed |

## Acceptance criteria

The spec's AC1–AC6 ([spec.md](spec.md), *Acceptance criteria*).

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `isCountedDelivery counts a pull request from a fork whose author association is $value` (it.each: `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `NONE`, `MANNEQUIN`, `owner`, `Member`, an unknown string, missing, `1`, `null`); `isCountedDelivery counts a NONE pull request whose head repository is $case` (`null`, id missing, id `"2000001"` as string, id 0, another id, same `full_name` with another id) | `src/rules/stranger.test.ts` |
| AC1 | `processWebhook records 20 stranger pull requests of one hour and answers 202 limited for the 21st without a row or a message` | `src/webhook.test.ts` |
| AC2 | `isCountedDelivery leaves uncounted a pull request from a fork whose author association is $value` (`OWNER`, `MEMBER`, `COLLABORATOR`); `isCountedDelivery leaves uncounted a NONE pull request from a branch of the repository itself`; `isCountedDelivery leaves uncounted a NONE fork pull request sent by the User owner`; `isCountedDelivery counts a NONE fork pull request sent by the account of an Organization owner` | `src/rules/stranger.test.ts` |
| AC2 | `processWebhook reports $case while the pull_request bound is full` (a `MEMBER` fork pull request, a `NONE` pull request from the repository's own branch, the owner's review request on a stranger's pull request), each with counter unchanged | `src/webhook.test.ts` |
| AC3 | `isCountedDelivery leaves uncounted a failed run of event $event` (it.each over the 13 events of AC3); `… a pull_request run whose head repository is the repository itself`; `… a stranger's issue_comment run re-run by the owner` (`actor` stranger, `triggering_actor` owner) | `src/rules/stranger.test.ts` |
| AC3 | `processWebhook reports a failed $case run while the workflow_run bound is full` (`push`, `release`, same-repository `pull_request`, re-run by the owner) | `src/webhook.test.ts` |
| AC4 | `isCountedDelivery counts a failed run of event $event` (`pull_request_target`, `issue_comment`, `issues`, `status`, `deployment_status`, `check_suite`, `dynamic`, `workflow_run`, `gollum`, an unknown name, `Push`, missing, `7`); `… a pull_request run from a fork` (head id differs, missing, string); `… a run whose actor is the owner and whose triggering_actor is a stranger`; `… a run whose triggering_actor is missing`; `… an owner-triggered run under an Organization owner` | `src/rules/stranger.test.ts` |
| AC4 | `processWebhook answers 202 limited for a failed issue_comment run when 20 workflow_run deliveries were counted this hour` | `src/webhook.test.ts` |
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
    `ADMITTED_AUTHOR_ASSOCIATIONS` (`OWNER`, `MEMBER`, `COLLABORATOR`), or `pull_request.head.repo.id` and
    `repository.id` are both positive safe integers and equal, or `isOwnAction(payload, owner)`.
  - `workflow_run`: counted unless `workflow_run.event` is a string exactly in `WRITER_ONLY_RUN_EVENTS` (the 13 of
    spec AC3), or it is exactly `pull_request` and `workflow_run.head_repository.id` and `repository.id` are equal
    positive safe integers, or `isOwnerAccount(workflow_run.triggering_actor, owner)`.
  - Every field is narrowed from `unknown` (`recordField`, `stringField` of `src/rules/pull-request.ts`); any
    unexpected shape returns `true` (counted). An exhaustive `switch` over `BoundedEvent` with a `never` check.
- `src/rules/actor.ts`: extract the id comparison of `isOwnAction` into `isOwnerAccount(account, owner)` (same rules:
  only a `User` owner, `id` a number equal to the owner's); `isOwnAction` calls it with `senderOf(payload)`.
- `src/webhook.ts`: `withinBound` takes the payload and the owner and returns `true` without a write when
  `isCountedDelivery` is false; the call site passes `payload` and `owner`. The step order is unchanged: the count
  still happens only for a delivery that would be recorded.
- No new user-visible output: the existing decision `limited` and the 202 answer are reused.

## Options considered

Decision 0043, options 12–18: the bound for any sender (rejected: drops collaborators' work), the sender alone as
for issues, a collaborator lookup through the GitHub API, a list of stranger-capable run events instead of
writer-only ones, exempting bot authors, and one shared counter. Option 13 is chosen.

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
export const WRITER_ONLY_RUN_EVENTS: ReadonlySet<string>;
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
  keeps its `isOwnAction` cases and gains `isOwnerAccount` cases (Tester) — no row above needs them beyond AC3/AC4,
  which reach it through `isCountedDelivery`.
- Existing call sites: none of a changed public signature. Existing tests affected by behavior: in
  `src/webhook.test.ts` the helpers `setAllCounters`, `countersAt` (four rows) and `counterOf`/`setCounter` (typed
  `BoundedEvent`) are extended to six events by the Tester, so the "while every bounded event is at its bound" test
  (line 2044) holds all six at the bound. The about 26 other `pull_request`/`workflow_run` deliveries in
  `src/webhook.test.ts` built from synthetic payloads without `author_association` or `event` now make one counter
  write each; the Tester checks each one that asserts on `meta` rows or uses a failing database stub and adapts it.
- Files no unit test can cover: none.

## Areas

- `docs/areas/notifications.md`, `docs/areas/storage.md`, `docs/areas/http-routes.md` (below).

## Documentation updates

All owned by the Dev, written once the code is green:

- `docs/areas/notifications.md`: step 5 of *Processing a delivery* (line 27–30) names the six events and refers to
  the new rules for `pull_request` and `workflow_run`, replacing "Pull request, CI and security alert events are never
  counted" by "security alert events are never counted"; *Pull request rules*, bullet at line 104–107: replace "No
  rate limit exists" by the bound and its exemptions (author association, same-repository branch, the owner's
  action); *CI failure rules*: a new bullet with the counted and uncounted runs (the 13 events, same-repository
  `pull_request`, the owner by `triggering_actor`) and E8/E9 of the spec; *Log entries* (line 542): `limited` names
  the six events; *Related decisions* (line 603–604): 0043 names the two new events.
- `docs/areas/storage.md` line 120–126: the two new `delivery_count:` rows, "at most six".
- `docs/areas/http-routes.md` line 17: the `POST /webhook` row names the six events and "caused by a stranger" for
  the two new ones.
- `docs/ARCHITECTURE.md` line 19 (*Webhook processing* row: "the hourly bound on issues, comments, stars, forks and
  strangers' pull requests and CI failures") and line 65 (the enumeration of bounded events), linking decision 0043.
- `.squad/project.md` line 90–93 (*Bound on deliveries of other senders*): the six events, the exemptions decided in
  `src/rules/stranger.ts`, and "alert events are never counted".

## Architecture check

No guarantee of `.squad/project.md` changes: a `limited` delivery is not recorded, so "processed once" and the outbox
guarantee apply as for the four events today (decision 0043). The owner's, members' and collaborators' pull requests
and writer-only CI failures stay unbounded. `docs/ARCHITECTURE.md` gets the enumeration update above.

## Security considerations

- [ ] No limits on parsed input are added; the new fields are compared as exact strings or safe integers.
- [ ] None: `isCountedDelivery` never throws (every field narrowed), and a counter failure answers 503 as today with no
  text.
- [ ] Fail-closed: every unknown or malformed value is counted. The only fail-open risk is an event wrongly listed in
  `WRITER_ONLY_RUN_EVENTS` (fact 9) or a `MEMBER`/`COLLABORATOR` value GitHub gives a stranger (fact 7).

## Decision records

- `docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md` (Accepted, unreleased) — extended in place:
  source #140, context, options 12–18, decision sentence, consequences.

## Out of scope / follow-ups

The spec's *Out of scope*; no follow-up issue.
