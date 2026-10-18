# Plan: Pull request rules

Source: Issue #13 | [spec.md](spec.md)
Status: Draft
Tier: security — the rules narrow attacker-influenced webhook payload fields (security area *Parsing of external
input*) and implement the guarantee "a draft pull request triggers no notification" of `.squad/project.md`.

## Problem / root cause

Feature, summarized from [spec.md](spec.md): three rules for `pull_request` (`opened`, `ready_for_review`,
`review_requested`) on the pipeline of issue #12, drafts silent, each with its switch, tested on real payloads.

Claims of the issue, checked against the code:

- "Each case is one file under `src/rules/`, a pure function" — confirmed feasible: `Rule` in `src/rules/rule.ts`
  (lines 22-29) is `{ id, evaluate(event, payload, settings) }`; `RULES` in `src/rules/registry.ts` (line 4) is empty
  and is what `src/index.ts` (line 30) passes to the pipeline.
- "switchable in the settings (#11)" — confirmed: `RULE_IDS` in `src/settings.ts` (lines 4-13) holds
  `pull_request_opened`, `pull_request_ready_for_review`, `pull_request_review_requested`, default on; `runRules`
  (`src/rules/rule.ts` lines 39-61) drops the notification of a rule whose switch is off and returns `disabled`. No
  settings change is needed.
- "Fixtures are real payloads (anonymized) under `test/fixtures/pull_request/`" — confirmed: five real deliveries,
  committed in 05efa31. Checked: `opened.json` (`draft` false, #143), `opened-draft.json` (`draft` true, #272),
  `ready_for_review.json` (`draft` false, #274), `review_requested.json` (`draft` false, `requested_reviewer` a
  `User`, #274), `review_requested-draft.json` (`draft` true, same reviewer). All five carry `action`, `number`,
  `pull_request` (with `number`, `title`, `html_url`, `user.login`, `head.ref`, `base.ref`, `draft`),
  `repository.full_name`, `sender`, `installation`. No README records their origin yet.
- Condition "none" for `ready_for_review` — the real `ready_for_review` delivery carries `draft` `false`; that
  GitHub never sends it with `draft` `true` is *unverified* (one sample, no documentation statement found that
  excludes a race with a conversion back to draft). Decided in decision 0024: all three rules require `draft` to be
  the boolean `false`; on every genuine delivery this equals "none".
- "no filter by sender" — confirmed as planned: the rules do not read `sender`. In all five samples `sender` and
  `pull_request.user` are the owner.
- Dependency #12 (message format, languages, outbox) — confirmed merged: `formatMessage` (`src/message.ts`),
  `MessageTexts` (`src/i18n/messages.ts`, today only `openOnGitHub`), the pipeline `processWebhook`
  (`src/webhook.ts`). Issue #12 fixes line 3 for pull requests as "author and branches".
- The GitHub App subscribes to `pull_request` with `pull_requests: read` (`src/github/manifest.ts` lines 14, 21):
  no new permission.

Related defects found on the way: stale statements that no rule exists — `docs/areas/notifications.md` lines 57-58,
the comment in `src/rules/registry.ts` line 3 and the comment in `src/index.test.ts` line 16. All three are updated
below. None is a defect in behavior.

Unverified payload shapes (no sample; not invented as fixtures):

- **Review requested from a team** — GitHub sends `requested_team` instead of `requested_reviewer`. The rules read
  neither, only `pull_request` fields, so a team request is expected to be reported like a user request. Fails
  closed: if a field the rules read were missing, the rule is silent.
- **Pull request from a fork** — `head.repo` is another repository, or `null` after the fork was deleted. The rules
  read `head.ref` only, never `head.repo`; a fork's branch is shown without its owner (documented gap). Same
  fail-closed behavior.
- **Several reviewers requested at once** — expected as one delivery per reviewer (the payload names one
  `requested_reviewer`), hence one identical message each; recorded as an accepted consequence in decision 0024.

## Acceptance criteria

Test names are exact; "fixture X" means the parsed `test/fixtures/pull_request/X.json`. Expected values below are
taken from the fixtures.

Narrowing (`nonDraftPullRequest`, `src/rules/pull-request.test.ts`):

- [ ] AC1: For event `pull_request` and fixture `opened` with action `opened`, it returns exactly
  `{ repository: "example-owner/example-other-repo", number: 143, title: "[Docs] Update the contributor documentation",
  url: "https://github.com/example-owner/example-other-repo/pull/143", author: "example-owner",
  head: "claude/example-branch", base: "main" }`.
  Test: `nonDraftPullRequest returns the fields of the real opened delivery`.
- [ ] AC2: It returns `undefined` for an event name other than `pull_request` with the same body (cases `issues`,
  `pull_request_review`, `ping`). Test: `nonDraftPullRequest returns undefined for the event $event`.
- [ ] AC3: It returns `undefined` when `payload.action` differs from the requested action (fixture `opened` asked for
  `ready_for_review` and `review_requested`; `action` absent; `action` `1`).
  Test: `nonDraftPullRequest returns undefined when the action is $case`.
- [ ] AC4: It returns `undefined` unless `pull_request.draft` is the boolean `false`: fixture `opened-draft`
  (`true`), and fixture `opened` with `draft` removed, `null`, `"false"`, `0`.
  Test: `nonDraftPullRequest returns undefined when draft is $case`.
- [ ] AC5: It returns `undefined` for each unexpected shape, each built from fixture `opened` with one change:
  `pull_request` absent, `null`, an array; `pull_request.number` `0`, `-1`, `1.5`, `2 ** 53`, `"143"`, `Infinity`
  (what `JSON.parse` makes of `1e400`); `title`, `html_url`, `user.login`, `head.ref`, `base.ref` each absent and a
  number; `user`, `head`, `base` each `null`; `repository` absent, `null`; `repository.full_name` absent and a
  number. Test: `nonDraftPullRequest returns undefined when $case`.
- [ ] AC6: It does not read `head.repo` or `sender`: fixture `opened` with `pull_request.head.repo` set to `null` and
  with `sender` removed still returns the fields of AC1.
  Test: `nonDraftPullRequest ignores head.repo and sender`.

Rules (each in its own test file; each test names the rule):

- [ ] AC7: `PULL_REQUEST_OPENED` has id `pull_request_opened`; for event `pull_request` and fixture `opened` with
  `DEFAULT_SETTINGS` (English) it returns `{ title: "New pull request", repository: "example-owner/example-other-repo",
  number: 143, subject: "[Docs] Update the contributor documentation",
  context: "by example-owner · claude/example-branch → main",
  url: "https://github.com/example-owner/example-other-repo/pull/143" }`; with language `de` the title is
  `Neuer Pull Request` and the context `von example-owner · claude/example-branch → main`.
  Tests (`src/rules/pull-request-opened.test.ts`): `PULL_REQUEST_OPENED reports the real opened delivery in English`,
  `PULL_REQUEST_OPENED reports the real opened delivery in German`.
- [ ] AC8 (issue: draft opened → no message): `PULL_REQUEST_OPENED` returns `undefined` for fixture `opened-draft`
  and for fixture `ready_for_review` (other action).
  Tests: `PULL_REQUEST_OPENED ignores the real draft opened delivery`,
  `PULL_REQUEST_OPENED ignores a ready_for_review delivery`.
- [ ] AC9 (issue: draft marked ready → message): `PULL_REQUEST_READY_FOR_REVIEW` has id
  `pull_request_ready_for_review`; for fixture `ready_for_review` it returns title `Ready for review` (de:
  `Bereit zum Review`), repository `example-owner/example-repo`, number 274, subject
  `[Docs] Document an example limitation`, context `by example-owner · claude/example-branch → main` (de: `von …`),
  url `https://github.com/example-owner/example-repo/pull/274`; it returns `undefined` for fixture
  `ready_for_review` with `draft` `true` and for fixture `opened`.
  Tests (`src/rules/pull-request-ready-for-review.test.ts`):
  `PULL_REQUEST_READY_FOR_REVIEW reports the real ready_for_review delivery in English`,
  `PULL_REQUEST_READY_FOR_REVIEW reports the real ready_for_review delivery in German`,
  `PULL_REQUEST_READY_FOR_REVIEW ignores a ready_for_review payload that claims a draft`,
  `PULL_REQUEST_READY_FOR_REVIEW ignores an opened delivery`.
- [ ] AC10 (issue: review requested on a draft → no message): `PULL_REQUEST_REVIEW_REQUESTED` has id
  `pull_request_review_requested`; for fixture `review_requested` it returns title `Review requested` (de:
  `Review angefordert`) and the other fields as in AC9; for fixture `review_requested` with `requested_reviewer`
  removed it returns the same notification (the reviewer is not read); for fixture `review_requested-draft` and for
  fixture `opened` it returns `undefined`.
  Tests (`src/rules/pull-request-review-requested.test.ts`):
  `PULL_REQUEST_REVIEW_REQUESTED reports the real review_requested delivery in English`,
  `PULL_REQUEST_REVIEW_REQUESTED reports the real review_requested delivery in German`,
  `PULL_REQUEST_REVIEW_REQUESTED does not read the requested reviewer`,
  `PULL_REQUEST_REVIEW_REQUESTED ignores the real review_requested delivery on a draft`,
  `PULL_REQUEST_REVIEW_REQUESTED ignores an opened delivery`.
- [ ] AC11: `RULES` is exactly `[PULL_REQUEST_OPENED, PULL_REQUEST_READY_FOR_REVIEW, PULL_REQUEST_REVIEW_REQUESTED]`.
  Test (`src/rules/registry.test.ts`): `RULES holds the three pull request rules in settings order`.

Texts (`src/i18n/messages.test.ts`):

- [ ] AC12: `MESSAGE_TEXTS.en` has `pullRequestOpened` `New pull request`, `pullRequestReadyForReview`
  `Ready for review`, `pullRequestReviewRequested` `Review requested`, and `pullRequestContext("a", "h", "b")`
  `by a · h → b`; `MESSAGE_TEXTS.de` has `Neuer Pull Request`, `Bereit zum Review`, `Review angefordert` and
  `von a · h → b`. Test: `MESSAGE_TEXTS holds the pull request titles and line 3 in en and de`. The existing
  type-error test stays.

End to end through the pipeline (`src/webhook.test.ts`, real D1 of the test pool, `rules: RULES`, the body
`JSON.stringify` of the fixture, `contentType` `application/json`, event `pull_request`):

- [ ] AC13: Fixture `opened` answers 202 with decision `reported` and writes one `outbox` row whose `text` is exactly
  `<b>New pull request</b> · example-owner/example-other-repo #143\n[Docs] Update the contributor documentation\nby example-owner · claude/example-branch → main`
  and whose `button_url` is `https://github.com/example-owner/example-other-repo/pull/143`.
  Test: `processWebhook writes the message of the real opened pull request delivery`.
- [ ] AC14 (issue: draft opened → no message): fixtures `opened-draft` and `review_requested-draft` each answer 202
  with decision `no-match` and write no `outbox` row. Test: `processWebhook writes no message for the real $fixture delivery`.
- [ ] AC15 (issue: a disabled rule → no message): fixture `opened` with the `settings` row `rule_pull_request_opened`
  `off` answers 202 with decision `disabled` and writes no `outbox` row; the same for `ready_for_review` with
  `rule_pull_request_ready_for_review` `off` and `review_requested` with `rule_pull_request_review_requested` `off`.
  Test: `processWebhook writes no message for the real $fixture delivery when its rule is off`.

The decision in the log entry is decided by `runRules` (`src/rules/rule.ts` lines 55-60: `reported` when a
notification of an enabled rule remains, `disabled` when only disabled rules returned one, otherwise `no-match`),
returned by `processWebhook`; AC14/AC15 assert the `decision` field of its outcome.

## Behavior coverage

| Spec bullet | Criterion |
| ----------- | --------- |
| B1 opened, non-draft → message | AC1, AC7, AC13 |
| B2 opened draft → none | AC4, AC8, AC14 |
| B3 ready_for_review → message | AC9 |
| B4 review_requested, non-draft → message | AC10 |
| B5 review_requested draft → none | AC10, AC14 |
| B6 switch off → none, decision `disabled` | AC15 |
| B7 three lines and button, en and de | AC7, AC9, AC10, AC12, AC13 |
| B8 no filter by sender or reviewer | AC6, AC10 |
| B9 other events, actions, shapes → none | AC2, AC3, AC5, AC8, AC9, AC10 |
| B10 fixtures with README | task 2 (Tester; checked by the Reviewer, no test) |

## Approach

1. `src/rules/pull-request.ts`: a private `isRecord` (as in `src/webhook.ts`), `nonDraftPullRequest` that checks, in
   this order, `event === "pull_request"`, `payload.action === action`, `pull_request` a record with `draft === false`,
   then reads and narrows the fields of AC1 (number by `Number.isSafeInteger(n) && n >= 1`, the rest
   `typeof === "string"`); and `pullRequestRule`, which builds a `Rule` whose `evaluate` calls `nonDraftPullRequest`
   and maps the fields to a `Notification` with `MESSAGE_TEXTS[settings.language]`: title from the given selector,
   subject the title, context `pullRequestContext(author, head, base)`, url the `html_url`.
2. One file per rule, each one `export const` built by `pullRequestRule`; `RULES` lists them in the order of
   `RULE_IDS`.
3. Four keys in `MessageTexts`, `EN` and `DE`.
4. No change to `runRules`, `formatMessage`, the pipeline, the schema or the settings.

## Options considered

See [decision 0024](../../docs/decisions/0024-pull-request-rules.md): one file per rule over a shared factory vs.
three self-contained rules vs. one rule for all actions; `draft === false` also for `ready_for_review` vs. no
condition; no notification vs. an emptied field on an unexpected shape; line 3 with author and branches vs. the
requested reviewer.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/rules/pull-request.ts` | new: `PullRequestAction`, `PullRequestFields`, `nonDraftPullRequest`, `pullRequestRule` |
| Worker | `src/rules/pull-request-opened.ts` | new: `PULL_REQUEST_OPENED` |
| Worker | `src/rules/pull-request-ready-for-review.ts` | new: `PULL_REQUEST_READY_FOR_REVIEW` |
| Worker | `src/rules/pull-request-review-requested.ts` | new: `PULL_REQUEST_REVIEW_REQUESTED` |
| Worker | `src/rules/registry.ts` | `RULES` lists the three; comment updated (rewrite of the whole file) |
| Worker | `src/i18n/messages.ts`, `src/i18n/en.ts`, `src/i18n/de.ts` | four new keys |
| Tests | `test/fixtures/pull_request/README.md` | new: origin and anonymization |

## Signatures (for the Dev's skeleton)

`src/rules/pull-request.ts`:

```ts
import type { MessageTexts } from "../i18n/messages";
import type { RuleId } from "../settings";
import type { Rule, WebhookPayload } from "./rule";

/** The `pull_request` actions a rule reports. */
export type PullRequestAction = "opened" | "ready_for_review" | "review_requested";

/** The fields of a pull request delivery the rules read, narrowed. */
export interface PullRequestFields {
  /** `repository.full_name`. */
  readonly repository: string;
  /** `pull_request.number`, a whole number from 1 to 2^53 - 1. */
  readonly number: number;
  /** `pull_request.title`. */
  readonly title: string;
  /** `pull_request.html_url`. */
  readonly url: string;
  /** `pull_request.user.login`. */
  readonly author: string;
  /** `pull_request.head.ref`. */
  readonly head: string;
  /** `pull_request.base.ref`. */
  readonly base: string;
}

/** The fields of a `pull_request` delivery with `action` whose `draft` is `false`; otherwise `undefined`. */
export function nonDraftPullRequest(
  event: string,
  payload: WebhookPayload,
  action: PullRequestAction,
): PullRequestFields | undefined;

/** A rule that reports a non-draft `pull_request` delivery with `action` under the title `title` selects. */
export function pullRequestRule(
  id: RuleId,
  action: PullRequestAction,
  title: (texts: MessageTexts) => string,
): Rule;
```

`src/rules/pull-request-opened.ts`: `export const PULL_REQUEST_OPENED: Rule` (id `pull_request_opened`, action
`opened`, `texts.pullRequestOpened`).
`src/rules/pull-request-ready-for-review.ts`: `export const PULL_REQUEST_READY_FOR_REVIEW: Rule` (id
`pull_request_ready_for_review`, action `ready_for_review`, `texts.pullRequestReadyForReview`).
`src/rules/pull-request-review-requested.ts`: `export const PULL_REQUEST_REVIEW_REQUESTED: Rule` (id
`pull_request_review_requested`, action `review_requested`, `texts.pullRequestReviewRequested`).

`src/rules/registry.ts` (rewritten in full):
`export const RULES: readonly Rule[] = [PULL_REQUEST_OPENED, PULL_REQUEST_READY_FOR_REVIEW, PULL_REQUEST_REVIEW_REQUESTED];`

`src/i18n/messages.ts`, `MessageTexts` gains:

```ts
  /** Title of the case `pull_request` `opened`. */
  readonly pullRequestOpened: string;
  /** Title of the case `pull_request` `ready_for_review`. */
  readonly pullRequestReadyForReview: string;
  /** Title of the case `pull_request` `review_requested`. */
  readonly pullRequestReviewRequested: string;
  /** Line 3 of a pull request notification: the author and the branches. */
  readonly pullRequestContext: (author: string, head: string, base: string) => string;
```

`EN`: `"New pull request"`, `"Ready for review"`, `"Review requested"`,
`` (author, head, base) => `by ${author} · ${head} → ${base}` ``.
`DE`: `"Neuer Pull Request"`, `"Bereit zum Review"`, `"Review angefordert"`,
`` (author, head, base) => `von ${author} · ${head} → ${base}` ``.
(`·` is U+00B7, `→` is U+2192, as literal characters.)

Final as read: `src/rules/rule.ts`, `src/message.ts`, `src/settings.ts`, `src/webhook.ts`, `src/index.ts` — unchanged.

## Test files

- `src/rules/pull-request.test.ts` (new) — AC1-AC6.
- `src/rules/pull-request-opened.test.ts` (new) — AC7, AC8.
- `src/rules/pull-request-ready-for-review.test.ts` (new) — AC9.
- `src/rules/pull-request-review-requested.test.ts` (new) — AC10.
- `src/rules/registry.test.ts` (new) — AC11.
- `src/i18n/messages.test.ts` (extended) — AC12.
- `src/webhook.test.ts` (extended) — AC13-AC15.

Fixtures are imported as JSON (`resolveJsonModule` is on); variants are built by spreading the imported object with
one field changed, never by editing or adding a fixture file. The rule tests pass the payload with the event name
`pull_request` and `DEFAULT_SETTINGS` (or `{ ...DEFAULT_SETTINGS, language: "de" }`).

Existing test code affected: none by a changed signature. The comment in `src/index.test.ts` line 16 ("The registry
holds no rule yet") becomes stale; the Tester rewords it (the mock stays: the wiring test still needs a rule that
matches a ping). `src/webhook.test.ts` tests that pass `RULES` with the ping delivery keep `no-match` (the ping has
no `pull_request`); no change.

Files of the change no unit test can cover: none (`test/fixtures/pull_request/README.md` is documentation).

## Areas

- `docs/areas/notifications.md` — *Rules*: replace "No rule exists yet …" (lines 57-58) with a subsection
  *Pull request rules* (anchor `#pull-request-rules`, linked from decision 0024): the three cases (event, action,
  condition `pull_request.draft` the boolean `false`, switch id, English and German title), line 1-3 and the button
  for them (`repository.full_name`, `pull_request.number`, `pull_request.title`, line 3 "by/von author · head → base"
  from `user.login`, `head.ref`, `base.ref`, `pull_request.html_url`), the fields the rules do not read (`sender`,
  `requested_reviewer`, `requested_team`, `head.repo`) and so no filter by sender or reviewer, silence on any
  unexpected shape, one message per review-request delivery, the unverified team and fork shapes. Keep the sentence
  that #16 and #17 follow. *Languages*: the tables also hold the titles and line 3 of the rules. *Related decisions*:
  add decision 0024; in the 0023 entry drop "the empty rule list". Owner: Dev.

## Documentation updates

| File | Edit | Owner |
| ---- | ---- | ----- |
| `docs/areas/notifications.md` | as in *Areas* | Dev |
| `src/rules/registry.ts` comment | "the rules arrive with their own issues" → the order is the settings order; CI (#16) and security alert (#17) rules follow | Dev |
| `src/index.test.ts` line 16 comment | no longer "holds no rule yet": the mock replaces the real rules so a ping can drive the wiring test | Tester |
| `test/fixtures/pull_request/README.md` | new, like `test/fixtures/github/README.md`: captured from real deliveries of the owner's GitHub App, supplied on issue #13 on 2026-10-18; anonymized by replacing logins, ids, node_ids, repository names, homepage, SHAs, the pull request title and body and the installation id, structure and field set untouched; a table of the five files with action, `draft` and what each covers; the variants not available (team reviewer, fork pull request) and that a later sample is added as its own file, not edited into these | Tester |
| `docs/ARCHITECTURE.md` step 3 | link decision 0024 beside "A draft pull request … produces nothing" | Lead (at approval) |
| `docs/decisions/0024-pull-request-rules.md`, index row | status at approval | Lead |

Sweep done: `docs/areas/*`, `docs/ARCHITECTURE.md`, `README.md`, `src/` searched for "no rule", "rule list",
"#13", "until a rule". `README.md` already lists the three switches (line 18, default on): no change.
`docs/areas/setup-wizard.md` lists the settings labels: unchanged. Decision 0023 (Accepted, unreleased: not in
`v0.2.0`, checked with `git ls-remote --tags origin` and `git cat-file`) keeps its text: its "no notification is
sent until a rule exists (#13)" is the consequence of that decision at its time; 0024 states what follows.

## Architecture check

- "A draft pull request triggers no notification" (`.squad/project.md`, `docs/ARCHITECTURE.md` step 3): implemented
  by `draft === false` in the one shared narrowing, for all three actions, including a missing `draft`.
- "A delivery is processed once", "written to the outbox before delivery": untouched; the rules are pure and run
  inside the existing pipeline.
- Minimal permissions: `pull_request` events and `pull_requests: read` already in the manifest; no change.
- Logging: the rules log nothing; the pipeline logs only the decision.

## Security considerations

- [x] Limits: no new limit. The body is bounded (1 MiB, `src/body.ts`) before parsing; every text the rules pass on
  (title, repository, line 3 assembled from login and branch names) is cleaned, cut (in code points after
  decoding) and escaped by `formatMessage` (`src/message.ts`), unchanged. Line 3 is assembled before the cut, so a
  long branch name only shortens it.
- [x] Exceptions: none. The narrowing performs only `typeof` and property reads on a parsed JSON object (no getters,
  no prototype lookups that throw); `MESSAGE_TEXTS[settings.language]` is defined for both languages, which
  `settingsFromStored` narrows. A throw would answer 503 per decision 0023, never a text.
- Guard forms (the narrowing is the guard; JSON is the only producer):
  - `X-GitHub-Event`: any `^[a-z_]{1,64}$` reaches the rules; only `pull_request` passes (AC2). A signed body of
    another event replayed as `pull_request` must also carry one of the three actions and a full `pull_request`
    object: `pull_request_review` (`submitted`, `edited`, `dismissed`), `pull_request_review_comment`
    (`created`, `edited`, `deleted`), `pull_request_review_thread` (`resolved`, `unresolved`) carry `pull_request`
    but none of these actions; `issues` has `opened` but `issue`, not `pull_request`. Residual risk as accepted in
    decision 0023.
  - `draft`: `false` passes; `true`, absent, `null`, `"false"`, `0` do not (AC4).
  - `number`: JSON gives a finite number, a string, `null`, or `Infinity` from an overflowing literal (`1e400`);
    only `Number.isSafeInteger(n) && n >= 1` passes (AC5). `-0` fails `>= 1`.
  - text fields: only `typeof === "string"`; the empty string passes (an empty title leaves line 2 out per
    `formatMessage`); objects and arrays do not.
  - `html_url`: any string passes the rule; `buttonUrl` (`src/message.ts`) admits only `https://github.com`, else
    the message goes without a button (unchanged).
  - duplicate keys: `JSON.parse` keeps the last; a body is signed by GitHub, so this is not attacker-chosen.
- [x] Unverified claims (no measurement can settle them here; documented, not stated as fact): a genuine
  `ready_for_review` never has `draft` `true`; team and fork shapes; one delivery per requested reviewer.
  Each fails closed or is accepted in decision 0024.

## Decision records

- `docs/decisions/0024-pull-request-rules.md` (Proposed), indexed.

## Out of scope / follow-ups

- Show the requested reviewer or team on line 3 (needs a captured `requested_team` delivery). Not filed now; the
  orchestrator may open it if the Product Manager wants it.
- Live check of the first real notification against the Telegram API (decision 0023): after deployment, by the
  owner.

## Challenge notes

Minor objections of the Devil's Advocate, verbatim:

1. **Deviation from the issue (minor).** The issue table gives condition "none" for `ready_for_review`, while the plan requires `draft === false` for all three actions (AC4, AC9). The plan states this and the fixture supports it. Because the issue text differs, record it explicitly in the *Challenge notes* and in `docs/areas/notifications.md`. That way a reviewer comparing against the issue does not flag it as scope creep. The `ready_for_review` with `draft: true` test must stay, because it is the only test of this deviation.
2. **Review requested from someone else (minor).** Gap: B8 and AC10 accept that `review_requested` fires for any requested reviewer and any team, including when the owner asks someone else to review their own pull request. That produces a "Review requested" message to the owner for a review they do not have to do. The plan does not say whether the app's webhook only reaches the owner's own repositories, nor whether GitHub sends the event to the app for every reviewer. Instruction: the Dev should state this accepted consequence in the `notifications.md` subsection, next to the "one message per review-request delivery" sentence. No plan change is needed, and the issue explicitly says there is no filter by reviewer.

## Security notes

Non-blocking findings of the Security plan review (`APPROVED`), verbatim:

1. On a public repository anyone can open a pull request, and there is no sender filter (B8). So outsiders can trigger messages with their own title and branch name, and one message per pull request means they can also flood the chat. Telegram apps still turn URLs, `@mentions` and `/commands` in that text into clickable links, even with previews off and the text escaped. This is current `formatMessage` behavior, not a defect of this plan. I suggest the *Pull request rules* subsection in `docs/areas/notifications.md` says it in one sentence; rate limiting would be a separate issue if the Product Manager wants it.
2. AC5 covers the text fields only as "absent" and "a number". Adding one object or array case (for example `title: []`) would pin the plan's claim that "objects and arrays do not" pass. This is optional: a `typeof` check rejects them the same way.
3. Not a security point, for the Lead: the *Plan checklist* in `.squad/project.md` asks for a `CHANGELOG.md` entry under `## [Unreleased]` for a user-visible change. The plan's *Documentation updates* table does not list one, and these are the first notifications users will actually get.
