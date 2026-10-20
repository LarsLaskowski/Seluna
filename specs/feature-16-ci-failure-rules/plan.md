# Plan: CI failure rules

Source: Issue #16 | [spec.md](spec.md)
Status: Draft
Tier: security — the webhook processing starts an authenticated GitHub call driven by the signed payload, and the
default-branch condition gains a guard whose purpose is to stop an outside contributor (a fork's branch named like the
default branch, E14) from raising the alarm with a text of their choosing.
Security areas touched: GitHub App authentication (`src/github/api-client.ts` `isPullRequestDraft` gets its first
caller in the webhook processing, with the installation id and pull request taken from the payload); Parsing of
external input (`src/rules/workflow-run.ts` narrows a new payload; branch, workflow name and commit line enter
messages through `src/message.ts`); Logging of external data (`src/webhook.ts`: the decision of the log entry, no new
field)

## Problem / root cause

Feature: [spec.md](spec.md), *Problem*. A `workflow_run` delivery matches no rule today (`src/rules/registry.ts:7-11`
lists only the three pull request rules), although the switches exist (`src/settings.ts:8-9`).

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | The app is subscribed to `workflow_run` and has Actions and Pull requests read; no new permission is needed. | `src/github/manifest.ts:12-26` | confirmed |
| 2 | The switches `ci_failed_default_branch` and `ci_failed_pull_request` exist, default on, in this order after the pull request switches. | `src/settings.ts:4-13`, `:36-45` | confirmed |
| 3 | `runRules` drops the notification of a rule whose switch is off before the caller sees it, and decides `disabled` then. | `src/rules/rule.ts:46-60` | confirmed |
| 4 | Rules are pure; the processing reads settings, runs the rules and renders the messages before the one transaction `recordDelivery`. | `src/webhook.ts:123-127`, `docs/ARCHITECTURE.md` *Components* | confirmed |
| 5 | The duplicate check runs before the payload is parsed, so a recorded id never reaches the rules. | `src/webhook.ts:111-117` | confirmed |
| 6 | `isPullRequestDraft` never throws and returns `{kind:"ok",draft}` or `{kind:"failed"}`; it validates installation id, owner, name and number before any request. | `src/github/api-client.ts:94-113` | confirmed |
| 7 | One API client call may make a token request and a pull request read, each with a 10-second timeout. | `src/github/http.ts:22`, `src/github/conversion.ts:11`, `src/github/api-client.ts:74-83` | confirmed |
| 8 | GitHub ends a webhook delivery not answered within 10 seconds and considers it failed. | GitHub docs `content/webhooks/using-webhooks/best-practices-for-using-webhooks.md` line 43 (fpt/ghec: 10 seconds), read 2026-10-20 | confirmed |
| 9 | A real `workflow_run` `completed` delivery carries `workflow_run.head_branch`, `name`, `html_url`, `conclusion`, `head_repository.id`, `head_commit.message`, `pull_requests[]` with `number` and `base.repo.id`, and `repository.id`, `full_name`, `default_branch`, `installation.id`, with the types the spec expects. | `test/fixtures/workflow_run/completed-failure-pull-request.json` and `completed-success-default-branch.json` (real, anonymized), read with Python | confirmed |
| 10 | In a run of a same-repository pull request, `head_repository.id` and `pull_requests[0].base.repo.id` equal `repository.id`; a scheduled run on the default branch has an empty `pull_requests`. | the two fixtures: ids 2001/2001/2001 and 2000/2000, `pull_requests` `[]` | confirmed |
| 11 | A failed or `timed_out` run on the default branch has the shape of the successful one, only `conclusion` differs. | to verify: the Product Manager's live check on a deployed copy (a failing run on a test repository's default branch gives the message of S1), after merge; a deviation is a new issue; no real sample, the Product Manager could not produce one | unverified |
| 12 | A fork's run has a `head_repository.id` other than `repository.id` and an empty `pull_requests`. | to verify: a captured fork delivery when one occurs (Product Manager), recorded in decision 0027; the rule fails toward silence on the first point by design; GitHub's documentation only, no real sample | unverified |
| 13 | The D1 work of one delivery (duplicate check, settings read, transaction) fits in the 2 seconds left after the 8-second bound. | to verify: the Product Manager's live check reads the wall time of a `POST /webhook` with a CI failure in a pull request in the Worker's logs (`wrangler tail`) on a deployed copy, after merge; not measurable in the session, whose D1 is local | unverified |
| 14 | `formatMessage` cuts a title to 64 code points and lines 2 and 3 to 256, and cleans and escapes every text. | `src/message.ts:39-57`, `:73-86` | confirmed |
| 15 | `toEqual` treats an absent optional property and `undefined` alike, so adding the optional `draftCheck` to `Notification` breaks no existing assertion. | Vitest `toEqual` semantics (recursively ignores `undefined` properties) | confirmed |
| 16 | `test/pull-request.ts` `variant(payload, path, value)` builds a variant of a real payload by one field (or removes it with `ABSENT`), usable for `workflow_run` too. | `test/pull-request.ts:1-27` | confirmed |
| 17 | `registry.test.ts` asserts exactly the three pull request rules, so it changes with this feature. | `src/rules/registry.test.ts:7-13` | confirmed |

## Acceptance criteria

The criteria are AC1–AC15 of [spec.md](spec.md).

## Tests per criterion

Fixtures: `PR_RUN` = `test/fixtures/workflow_run/completed-failure-pull-request.json`; `MAIN_RUN` =
`test/fixtures/workflow_run/completed-success-default-branch.json`; `MAIN_FAILURE` = `MAIN_RUN` with
`workflow_run.conclusion` `failure` (built with `variant` from `test/pull-request.ts`). Every variant changes only the
fields the test names.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `CI_FAILED_DEFAULT_BRANCH reports the failure of the real default-branch run in English` (title `CI failed on main`, repository `example-owner/example-repo`, number `undefined`, subject `Build and deploy`, context `main · [Docs] Add a security policy (#2)`, url the run's `html_url`, no `draftCheck`); `CI_FAILED_DEFAULT_BRANCH reports a timed_out run like a failure`; `firstCommitLine keeps the text before the first line feed or carriage return` (`a\nb`, `a\r\nb`, `a\rb`) | `src/rules/ci-failed-default-branch.test.ts`; `src/rules/workflow-run.test.ts` |
| AC2 | `CI_FAILED_PULL_REQUEST reports the real failed pull request run with a draft check of pull request 296` (title `CI failed in pull request`, number 296, subject `CodeQL`, context `test/failing-workflow · Make the check fail`, url the run's `html_url`, `draftCheck` `{pullRequest: {owner: "example-owner", repo: "example-other-repo", number: 296}, titleWhenUnknown: "CI failed in pull request (draft status unknown)"}`); `CI_FAILED_PULL_REQUEST reports a timed_out run like a failure`; `applyDraftChecks keeps a notification whose pull request is not a draft`; `processWebhook sends the CI failure of the real pull request run when the lookup answers not a draft` (decision `reported`, lookup called once with 3000 and the ref) | `src/rules/ci-failed-pull-request.test.ts`; `src/draft-lookup.test.ts`; `src/webhook.test.ts` |
| AC3 | `applyDraftChecks drops a notification whose pull request is a draft`; `processWebhook stores no outbox row and decides no-match when the pull request is a draft` (delivery recorded) | `src/draft-lookup.test.ts`; `src/webhook.test.ts` |
| AC4 | `applyDraftChecks uses the title for an unknown draft state when the lookup fails`; `applyDraftChecks treats a missing installation id as a failed lookup without calling it`; `boundedDraftLookup answers failed when the lookup outlasts the time limit`; `boundedDraftLookup answers failed when the lookup rejects`; `boundedDraftLookup passes through an answer that comes in time`; `DRAFT_LOOKUP_TIMEOUT_MS is 8000`; `processWebhook sends the CI failure with the draft-status-unknown title when the lookup fails`; `the Worker resolves a draft check through the GitHub API client and, without a GitHub App, sends the draft-status-unknown title` (wiring) | `src/draft-lookup.test.ts`; `src/webhook.test.ts`; `src/index.test.ts` |
| AC5 | `CI_FAILED_DEFAULT_BRANCH reports nothing for the conclusion <c>` and `CI_FAILED_PULL_REQUEST reports nothing for the conclusion <c>` (`it.each`: `success`, `cancelled`, `skipped`, `neutral`, `action_required`, `stale`, `startup_failure`, `null`); the same for the actions `requested` and `in_progress`; `processWebhook makes no draft lookup and decides no-match for the real successful run` | `src/rules/ci-failed-default-branch.test.ts`; `src/rules/ci-failed-pull-request.test.ts`; `src/webhook.test.ts` |
| AC6 | `CI_FAILED_PULL_REQUEST reports nothing for a failed run off the default branch with empty pull_requests`; `CI_FAILED_PULL_REQUEST reports nothing when every pull_requests entry belongs to another repository`; `CI_FAILED_DEFAULT_BRANCH reports nothing for the real pull request run` | `src/rules/ci-failed-pull-request.test.ts`; `src/rules/ci-failed-default-branch.test.ts` |
| AC7 | `CI_FAILED_PULL_REQUEST reports nothing for a failed default-branch run with an entry of its repository`; `CI_FAILED_DEFAULT_BRANCH reports a default-branch failure whose pull_requests holds an entry`; `processWebhook decides disabled, stores no row and makes no lookup for that run with the default-branch switch off` | `src/rules/ci-failed-pull-request.test.ts`; `src/rules/ci-failed-default-branch.test.ts`; `src/webhook.test.ts` |
| AC8 | `pullRequestNumberOf takes the first entry of the repository, skipping foreign and malformed entries` (`it.each` before a valid entry: not an object, `null`, `number` missing/0/1.5/`"296"`/2^53, `base` missing, `base.repo` missing, `base.repo.id` missing/`"2001"`/0/another id); `pullRequestNumberOf answers undefined for a value that is not an array` (`undefined`, `{}`, `"x"`); `CI_FAILED_DEFAULT_BRANCH reports a default-branch failure whose pull_requests holds a malformed entry` | `src/rules/workflow-run.test.ts`; `src/rules/ci-failed-default-branch.test.ts` |
| AC9 | `failedWorkflowRun answers undefined when <field> is <value>` (`it.each`: `workflow_run` absent/`[]`/`null`; `conclusion`, `head_branch`, `name`, `html_url` absent or a number; `head_repository` absent/`null`; `head_repository.id` and `repository.id` absent/`"2001"`/0/1.5; `repository.full_name`, `repository.default_branch` absent or a number); `failedWorkflowRun answers undefined for another event name`; `failedWorkflowRun answers undefined for the real pull_request opened body under the event workflow_run` | `src/rules/workflow-run.test.ts` |
| AC10 | `failedWorkflowRun gives the branch alone as line 3 when head_commit is null, its message is not a string, or its first line is blank` (`null`, `{}`, `{message: 7}`, `"\nbody"`, `"   \nbody"`) | `src/rules/workflow-run.test.ts` |
| AC11 | `processWebhook decides disabled and makes no lookup when the pull request switch is off` (real `PR_RUN`); `processWebhook decides disabled for the default-branch failure with its switch off` | `src/webhook.test.ts` |
| AC12 | `processWebhook stores one row per delivery id for two failed runs and for a re-run` (`PR_RUN` and a variant with another `name`, then `run_attempt` 2, three ids, three rows); `processWebhook makes no lookup for a delivery id already recorded` (second call with the same id: 200 `duplicate`, lookup called once in total) | `src/webhook.test.ts` |
| AC13 | `MESSAGE_TEXTS holds the CI titles and the draft-unknown title in en and de` (`CI failed on x`, `CI failed in pull request`, `CI failed in pull request (draft status unknown)`, `CI fehlgeschlagen auf x`, `CI im Pull Request fehlgeschlagen`, `CI im Pull Request fehlgeschlagen (Draft-Status unbekannt)`); `CI_FAILED_DEFAULT_BRANCH reports in German`; `CI_FAILED_PULL_REQUEST reports in German, its draft check with the German title` | `src/i18n/messages.test.ts`; `src/rules/ci-failed-default-branch.test.ts`; `src/rules/ci-failed-pull-request.test.ts` |
| AC14 | `processWebhook cleans and escapes the branch, workflow name and commit line of a CI failure` (`MAIN_FAILURE` with `default_branch` and `head_branch` `a<b>&c`, `name` `x‮y`, commit `<i>&amp;`; the stored text shows `CI failed on a&lt;b&gt;&amp;c`, `xy`, `a&lt;b&gt;&amp;c · &lt;i&gt;&amp;amp;`) | `src/webhook.test.ts` |
| AC15 | `CI_FAILED_DEFAULT_BRANCH reports nothing for a fork's run from a branch named like the default branch` (`MAIN_FAILURE` with `head_repository.id` 9999); `CI_FAILED_PULL_REQUEST reports nothing for the same run` (empty `pull_requests`) | `src/rules/ci-failed-default-branch.test.ts`; `src/rules/ci-failed-pull-request.test.ts` |

Besides: `RULES holds the pull request rules and the two CI rules in settings order` replaces the existing registry
test (Tester, step 5).

## Approach

1. **Narrowing** (`src/rules/workflow-run.ts`): `failedWorkflowRun(event, payload)` returns the fields of a delivery
   with event `workflow_run`, action `completed` and conclusion `failure` or `timed_out`, or `undefined` for every
   other or malformed delivery (spec E1, E5). It computes `onDefaultBranch` (head branch equals default branch and
   head repository id equals repository id), line 3 (`branch` or `branch · firstCommitLine`), and
   `pullRequestNumber` with `pullRequestNumberOf(workflow_run.pull_requests, repository.id)` (E4). The helpers
   `isRecord`, `stringField`, `recordField` are local, as in `pull-request.ts` (a shared helper module is not in
   scope).
2. **Rules**: `CI_FAILED_DEFAULT_BRANCH` reports when `onDefaultBranch`; `CI_FAILED_PULL_REQUEST` reports when not
   `onDefaultBranch` and `pullRequestNumber` is defined, with a `draftCheck` holding
   `pullRequestRefOf(repository, number)` and the draft-unknown title in the notification language. Registered in
   `RULES` after the pull request rules, in settings order.
3. **Texts**: three keys in `MessageTexts`, `EN` and `DE` (spec *Area documents*). Line 3 needs no text.
4. **Draft lookup** (`src/draft-lookup.ts`): `applyDraftChecks(notifications, installationId, lookup)` resolves each
   notification with a `draftCheck` in order — `ok` and `draft` true: dropped; `ok` and false: kept unchanged; failed or
   `installationId` `undefined` (no call): kept with `title` set to `titleWhenUnknown`. `boundedDraftLookup(lookup,
   timeoutMs, sleep)` races the lookup (a rejection turned into `failed`) against `sleep(timeoutMs)` resolving to
   `failed`.
5. **Processing** (`src/webhook.ts`): `WebhookDeps` gains `lookUpDraft`. `notificationsOf` becomes async: after
   `runRules`, `applyDraftChecks(run.notifications, installationIdOf(payload), deps.lookUpDraft)`; when the run was
   `reported` and nothing is left, the decision is `no-match`. The messages are rendered from what is left, then the
   transaction runs as today.
6. **Wiring** (`src/index.ts`): `lookUpDraft: boundedDraftLookup((id, ref) => isPullRequestDraft({ env, db: env.DB,
   fetcher: outboundFetch, now: () => new Date(), version }, id, ref), DRAFT_LOOKUP_TIMEOUT_MS, wait)`.
7. Documentation as listed below.

## Options considered

Where the lookup runs: (a) chosen — pure rule marks a draft check, the processing resolves it before the transaction;
(b) an async rule calling the client — rejected, breaks rule purity (#12, ARCHITECTURE) and would call GitHub for a
switched-off rule; (c) lookup and row write in `waitUntil` after the 202 — rejected, splits the one transaction and
loses the message when the platform cuts the background work; (d) no lookup — contradicts the issue.
The time bound: (e) chosen — 8 seconds around the whole call; (f) only the client's per-request 10 seconds — up to 20
seconds, past GitHub's 10.
The default-branch test: (g) chosen — branch and head repository id; (h) branch alone, as the issue's table —
rejected, a fork's `main` would raise the default-branch alarm (spec challenge objection 1).
Where the draft-unknown note goes: in the title (spec, *Open questions*) rather than line 2 or 3, where it follows
attacker-chosen text and can be cut. All recorded in decision 0027.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/rules/workflow-run.ts` | new: narrowing of a failed `workflow_run` delivery |
| Worker | `src/rules/ci-failed-default-branch.ts` | new: rule `ci_failed_default_branch` |
| Worker | `src/rules/ci-failed-pull-request.ts` | new: rule `ci_failed_pull_request` with draft check |
| Worker | `src/rules/rule.ts` | `DraftCheck`, optional `Notification.draftCheck` |
| Worker | `src/rules/registry.ts` | two rules appended; comment updated |
| Worker | `src/i18n/messages.ts`, `en.ts`, `de.ts` | three keys |
| Worker | `src/draft-lookup.ts` | new: `applyDraftChecks`, `boundedDraftLookup`, timeout constant |
| Worker | `src/webhook.ts` | `WebhookDeps.lookUpDraft`; draft checks before rendering; decision |
| Worker | `src/index.ts` | wiring of `lookUpDraft` |

## Signatures (for the Dev's skeleton)

`src/rules/rule.ts` (added; `Notification` gains one optional member, nothing else changes):

```ts
import type { PullRequestRef } from "../github/api-client";

/** The pull request whose draft state decides whether a notification is sent. */
export interface DraftCheck {
  readonly pullRequest: PullRequestRef;
  /** Line 1 title used instead of `title` when the draft state cannot be read. */
  readonly titleWhenUnknown: string;
}
// in Notification:
  /** Set when the notification may only be sent for a pull request that is not a draft. */
  readonly draftCheck?: DraftCheck;
```

`src/rules/workflow-run.ts`:

```ts
/** The fields of a failed `workflow_run` delivery the CI rules read, narrowed. */
export interface FailedWorkflowRun {
  /** `repository.full_name`. */
  readonly repository: string;
  /** `workflow_run.head_branch`. */
  readonly branch: string;
  /** Whether `head_branch` is `repository.default_branch` and `head_repository.id` is `repository.id`. */
  readonly onDefaultBranch: boolean;
  /** `workflow_run.name`. */
  readonly workflow: string;
  /** `workflow_run.html_url`. */
  readonly url: string;
  /** Line 3: the branch, then ` · ` and the first commit line when there is one. */
  readonly context: string;
  /** The number of the first `pull_requests` entry of the repository, or `undefined`. */
  readonly pullRequestNumber: number | undefined;
}
export function failedWorkflowRun(event: string, payload: WebhookPayload): FailedWorkflowRun | undefined;
/** The text before the first line feed or carriage return, trimmed; `""` when `message` is not a string. */
export function firstCommitLine(message: unknown): string;
/** The `number` of the first entry whose `base.repo.id` is `repositoryId` (both positive safe integers), else `undefined`. */
export function pullRequestNumberOf(pullRequests: unknown, repositoryId: number): number | undefined;
/** The pull request `number` in the repository `fullName` (`owner/name`, split at the first `/`). */
export function pullRequestRefOf(fullName: string, number: number): PullRequestRef;
```

`src/rules/ci-failed-default-branch.ts`: `export const CI_FAILED_DEFAULT_BRANCH: Rule;`
`src/rules/ci-failed-pull-request.ts`: `export const CI_FAILED_PULL_REQUEST: Rule;`

`src/i18n/messages.ts` (`MessageTexts`, added):

```ts
  /** Title of a failed run on the default branch. */
  readonly ciFailedDefaultBranch: (branch: string) => string;
  /** Title of a failed run in a pull request. */
  readonly ciFailedPullRequest: string;
  /** Title of a failed run in a pull request whose draft state could not be read. */
  readonly ciFailedPullRequestDraftUnknown: string;
```

`src/draft-lookup.ts`:

```ts
import type { DraftResult, PullRequestRef } from "./github/api-client";
import type { Notification } from "./rules/rule";

/** The longest a draft lookup may take before it counts as failed; GitHub waits 10 s for the answer. */
export const DRAFT_LOOKUP_TIMEOUT_MS = 8_000;
/** Asks whether a pull request is a draft, as the installation. Never rejects. */
export type DraftLookup = (installationId: number, pullRequest: PullRequestRef) => Promise<DraftResult>;
/** `lookup` cut off after `timeoutMs` (measured by `sleep`): a later or rejected answer is `failed`. */
export function boundedDraftLookup(
  lookup: DraftLookup,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>,
): DraftLookup;
/** The notifications after their draft checks: drafts dropped, unknown states titled `titleWhenUnknown`. */
export function applyDraftChecks(
  notifications: readonly Notification[],
  installationId: number | undefined,
  lookup: DraftLookup,
): Promise<readonly Notification[]>;
```

`src/webhook.ts`: `WebhookDeps` gains `readonly lookUpDraft: DraftLookup;`; `notificationsOf` (module-private) becomes
`async function notificationsOf(event: string, payload: WebhookPayload, settings: NotificationSettings, deps:
WebhookDeps): Promise<{ readonly decision: RuleDecision; readonly messages: readonly OutboxMessage[] }>`.
`processWebhook` keeps its signature.

Existing files the skeleton rewrites: `src/rules/registry.ts`, `src/webhook.ts`, `src/index.ts`, `src/i18n/*.ts`,
`src/rules/rule.ts` (all read; final otherwise).

## Test files

`src/rules/workflow-run.test.ts`, `src/rules/ci-failed-default-branch.test.ts`,
`src/rules/ci-failed-pull-request.test.ts`, `src/draft-lookup.test.ts` (new); `src/webhook.test.ts`,
`src/index.test.ts`, `src/i18n/messages.test.ts`, `src/rules/registry.test.ts` (extended). Payload variants use
`variant` and `ABSENT` from `test/pull-request.ts`; no new helper module.

Existing test code that calls a changed signature: `harness` in `src/webhook.test.ts:91-111` builds a `WebhookDeps`
— the **Dev** adds `lookUpDraft: vi.fn<DraftLookup>(() => Promise.resolve({ kind: "failed" }))` to its defaults in
step 4 (mechanical). `src/rules/registry.test.ts` asserts the old rule list — the **Tester** rewrites it in step 5.
`MessageTexts` literals exist only in `en.ts` and `de.ts` (Dev).

Files the change no unit test can cover: none (`src/index.ts` wiring is covered by the AC4 wiring test in
`src/index.test.ts`, whose mocked registry adds a rule with a draft check driven by a signed ping carrying an
`installation.id`).

## Areas

- [Notifications](../../docs/areas/notifications.md): *Processing a delivery* step 4, *Rules* (draft check), new
  *CI failure rules* and *Draft lookup*, *Languages*, *Log entries* (`no-match`), *Related decisions* — written by the
  Lead in this step.
- [GitHub API](../../docs/areas/github-api.md): *Scope* and *Pull request read* (the webhook caller, 8 seconds) —
  written by the Lead in this step.

## Documentation updates

Sweep: `grep -n -i "draft\|CI fail\|planned\|#16"` over `docs/areas/`, `docs/ARCHITECTURE.md`, `README.md`,
`.squad/project.md`, `CHANGELOG.md`. Hits and owners:

- `docs/areas/notifications.md`, `docs/areas/github-api.md` — Lead, done in this step.
- `docs/ARCHITECTURE.md` — Lead, done in this step: intro sentence (draft exception), *Components* "Webhook
  processing", *Webhook to Telegram* step 3, *Security model* ("will for the CI failure rule").
- `docs/decisions/0027-ci-failure-rules-and-the-draft-lookup.md` and its index row — Lead, done.
- `.squad/project.md` *Guarantees* — **Dev**, exactly: replace the line `- A draft pull request triggers no
  notification.` with `- A draft pull request triggers no notification; the one exception is a CI failure in a pull
  request whose draft state GitHub did not tell within 8 seconds, reported marked _draft status unknown_ —
  [decision 0027](../docs/decisions/0027-ci-failure-rules-and-the-draft-lookup.md).`
- `README.md` — **Dev**: line 40 status `planned for 0.4.0` → `available`; line 44 "the context (for a pull request
  its author and branches)" → "the context (for a pull request its author and branches, for a failed CI run the
  branch and the first line of the commit message)" and "Draft pull requests trigger nothing." → "Draft pull requests
  trigger nothing; when GitHub cannot tell in time whether a pull request with a failed CI run is a draft, the
  message says so."; line 86 "can already notify you about pull requests" → "can already notify you about pull
  requests and failed CI runs".
- `CHANGELOG.md` `## [Unreleased]` `### Added` — **Dev**: "Notifications for failed CI runs (failure or timeout) on
  the default branch and in pull requests that are not drafts, each with its own switch; when GitHub cannot tell in
  time whether the pull request is a draft, the message is sent marked _draft status unknown_."
- Not changed: `AGENTS.md` and `.github/copilot-instructions.md` ("draft pull requests trigger nothing") — outside a
  product PR (*Scope of a product PR*); see follow-ups. `docs/areas/storage.md` and `setup-wizard.md` already list the
  switches and labels. `test/fixtures/workflow_run/README.md` exists (orchestrator).

## Architecture check

- "A draft pull request triggers no notification" (`.squad/project.md`, *Guarantees*) gets the exception the
  Product Manager set in issue #16; documented in ARCHITECTURE, the area, decision 0027 and project.md.
- "A delivery is processed once": unchanged — the duplicate check precedes the lookup, the transaction follows it.
- "A matched event is written to the outbox before delivery is attempted": unchanged — the lookup runs before the
  transaction; nothing is sent before the row exists.
- Rules stay pure functions (ARCHITECTURE *Components*); the I/O lives in the processing.
- Credentials and tokens: only through the existing API client; nothing new stored or logged.

## Security considerations

- [ ] Limits: the payload is already bounded at 1 MiB before decoding (`src/body.ts`); the texts are cut in code
  points after decoding (64 / 256, `src/message.ts`); the GitHub answer is read bounded at 1 MiB before decoding
  (existing client). The 8-second bound is wall time. No new limit on raw bytes.
- [ ] Exceptions reaching a user-visible text: none. `isPullRequestDraft` never throws, `boundedDraftLookup` turns a
  rejection into `failed`, and a throw elsewhere answers 503 `unavailable` as today; the only user-visible effect of a
  failure is the fixed title `CI failed in pull request (draft status unknown)`.
- The pull request ref comes from the signed payload: `repository.full_name` split at the first `/` and the entry's
  number; the client allow-lists owner, name and number before any URL (`src/github/api-client.ts:99-106`), so a
  malformed value is a failed lookup without a request. The installation id comes from the payload and is validated
  the same way; a call never uses another installation's token.
- Fork guard: `head_repository.id === repository.id`, both positive safe integers; a missing or mistyped id silences
  the delivery (fails closed).
- A lookup cut off at 8 seconds keeps running until its own timeout and may cache a token; its result is discarded.

## Decision records

- `docs/decisions/0027-ci-failure-rules-and-the-draft-lookup.md` (Proposed)

## Out of scope / follow-ups

- Spec *Out of scope*.
- Follow-up `squad` issue in this repository (step 12): `AGENTS.md` and `.github/copilot-instructions.md` say "draft
  pull requests trigger nothing" without the exception of decision 0027; a squad-maintenance PR aligns them. Title:
  "[Squad] Name the draft-status-unknown exception in AGENTS.md (from #16)".
- Live check after merge (Product Manager): a failing run on a test repository's default branch (S1) and in a draft
  and a ready pull request (S2, S3); the wall time of those deliveries in `wrangler tail` (fact 13).
