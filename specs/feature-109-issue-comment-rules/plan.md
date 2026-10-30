# Plan: Issue and comment rules

Source: Issue #109 | [spec.md](spec.md)
Status: Revised (1)
Tier: standard — three new rules and the owner passed to them change behavior; no security control is created, changed or removed (the owner and bot filter only keeps noise out, escaping and the outbox cleaning stay as they are).
Security areas touched: Parsing of external input (`src/rules/issue.ts` narrows new payload fields and scans issue and comment bodies); Encrypted credentials (the webhook processing now reads the saved App ID through `readSecret`, `resolveAppId` in `src/github/app-credentials.ts`; storage and encryption unchanged); GitHub App authentication (`src/github/app-credentials.ts` refactored; the draft lookup is also used for a comment on a pull request whose payload has no `issue.draft`)

## Problem / root cause

Feature: see [spec.md](spec.md) (S1–S9, E1–E10, AC1–AC13).

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | A rule gets only event, payload and settings | `src/rules/rule.ts:33-38` (`evaluate`), `runRules` `rule.ts:51-56` | confirmed |
| 2 | `isOwnAction` is false for an unknown or organization owner; `isBotSender` checks `sender.type === "Bot"` only | `src/rules/actor.ts:16-27` | confirmed |
| 3 | The owner row counts only for its App ID; reading it needs the App ID | `readAppOwner(db, appId)`, `src/store/meta.ts:48-56`; `docs/areas/storage.md:109-115` | confirmed |
| 4 | The App ID is the Worker secret `GITHUB_APP_ID`, else the saved `github_app_id`, decrypted with the key of `SELUNA_SECRET`; D1 errors reject, other failures read as no App ID | `src/github/app-credentials.ts:34-50`, `readSecret` `src/store/secrets.ts:128-147` | confirmed |
| 5 | On a failed lookup `applyDraftChecks` keeps the notification with `titleWhenUnknown`; no `installation.id` counts as failed | `src/draft-lookup.ts:46-50` | confirmed |
| 6 | GitHub's schema: `issue.draft` optional boolean, `issue.pull_request` an object on pull requests only, `issue.body` string or null, `comment.body` string, `user` nullable | OpenAPI `github/rest-api-description` (main), `webhook-issue-comment-created` and `webhook-issues-opened`, read 2026-10-30 | confirmed |
| 7 | Real `issue_comment` deliveries on a pull request carry `issue.draft` and `issue.pull_request` as documented | to verify: Product Manager's live check on a deployed copy (comments on a ready and a draft pull request, an issue, a comment on an issue) before the PR is marked ready (step 11) | unverified |
| 8 | An absent `rule_<id>` row reads as the default; the form and the start page iterate `RULE_IDS` | `settingsFromStored` `src/settings.ts`; `src/setup/pages.ts:514`; `src/setup/settings-form.ts:58` | confirmed |
| 9 | Cleaning (control characters and U+2028/U+2029 to a space, directional characters removed, cut at 256 with `…`) happens in `storedNotificationOf` and again in `renderTelegramText`, not in the rules | `src/message.ts:41-58`, `:74-87`; `docs/areas/notifications.md` *Message format* | confirmed |
| 10 | `src/rules/` may not import the message or notification modules | ESLint `no-restricted-imports`, `docs/areas/notifications.md:319-320` | confirmed |
| 11 | `issues/opened.json` and `issue_comment/created.json` are reference-built; no fixture of a comment on a pull request exists | `test/fixtures/issues/README.md`, `test/fixtures/issue_comment/README.md` | confirmed |
| 12 | A D1 error in step 4 of the processing answers 503 and stores nothing | `src/webhook.ts:139-180` (one `try`) | confirmed |
| 13 | Record 0039 is unreleased (v0.7.0 = b5c50a4 predates f35d81b), but its topic is events and the owner, not rules | `git ls-remote --tags origin` | confirmed |

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `ISSUE_OPENED reports the opened fixture of another account in English` | `src/rules/issue-opened.test.ts` |
| AC2 | `ISSUE_COMMENT reports the comment on an issue`; `ISSUE_COMMENT ignores a comment on a pull request` | `src/rules/issue-comment.test.ts` |
| AC2 | `PULL_REQUEST_COMMENT reports a comment on a pull request whose issue.draft is false, without a draft check`; `PULL_REQUEST_COMMENT ignores a comment on an issue`; `PULL_REQUEST_COMMENT sets a draft check that drops on an unknown state when issue.draft is absent` | `src/rules/pull-request-comment.test.ts` |
| AC2 | `processWebhook stores one row for a comment on a pull request and none of issue_comment` | `src/webhook.test.ts` |
| AC3 | `isForeignSender is false for the User owner's id and for a Bot sender` | `src/rules/issue.test.ts` |
| AC3 | `<RULE> ignores the owner's delivery and a bot's` (one per rule) | `src/rules/issue-opened.test.ts`, `src/rules/issue-comment.test.ts`, `src/rules/pull-request-comment.test.ts` |
| AC3 | `processWebhook answers 202 no-match and records the delivery for the owner's own issue` | `src/webhook.test.ts` |
| AC4 | `isForeignSender is true for an organization owner's id and without an owner` | `src/rules/issue.test.ts` |
| AC4 | `resolveAppOwner returns the owner stored for the Worker secret App ID and for the saved App ID`; `resolveAppOwner returns undefined without an App ID, for a row of another App ID, a malformed row and an unreadable saved App ID` | `src/github/app-credentials.test.ts` |
| AC4 | `processWebhook passes the owner readOwner answers to the rules` | `src/webhook.test.ts` |
| AC5 | `settingsFromStored reads the three new switches as on without rows and keeps every stored switch` | `src/settings.test.ts` |
| AC5 | `parseSettingsForm reads the three new switches` (extend the existing expectations) | `src/setup/settings-form.test.ts` |
| AC5 | `ruleLabels` expectations of both languages extended | `src/setup/texts.test.ts` |
| AC5 | `renderStartPage puts the eleven rules and the release notice in one fieldset …` (adapt `toBe(8)` and the name), snapshot updated | `src/setup/pages.test.ts` |
| AC5 | `RULES lists every rule in settings order` (extend) | `src/rules/registry.test.ts` |
| AC5 | `runRules passes the owner to every rule and drops only a switched-off rule's notification` | `src/rules/rule.test.ts` |
| AC6 | `<RULE> reports in German` (one per rule); message table expectations for `issueOpened`, `issueComment`, `pullRequestComment`, `byAuthor` | the three rule test files; `src/i18n/messages.test.ts` |
| AC7 | `ISSUE_OPENED ignores every other issues action` (edited, deleted, closed, reopened, transferred, labeled, an unknown action); `<RULE> ignores edited and deleted` for both comment rules | the three rule test files |
| AC8 | `PULL_REQUEST_COMMENT ignores a comment whose issue.draft is true` | `src/rules/pull-request-comment.test.ts` |
| AC8 | `applyDraftChecks drops a notification without titleWhenUnknown when the lookup fails, and without an installation id`; `applyDraftChecks keeps it when the lookup answers not a draft` | `src/draft-lookup.test.ts` |
| AC8 | `processWebhook stores nothing for a comment on a pull request without issue.draft when the lookup fails` | `src/webhook.test.ts` |
| AC9 | `bodyExcerpt removes HTML comments and an unterminated one with the rest, collapses white space, and returns "" for undefined, blank and comment-only bodies` | `src/rules/issue.test.ts` |
| AC9 | `bodyExcerpt returns at most 257 code points for a 1 MiB body` (count-based, per adversarial body: plain text, one unterminated opener then text, repeated openers without a closer, repeated opener-closer pairs, alternating openers and white space, one long white-space run then text; each excerpt also equals the expected prefix) | `src/rules/issue.test.ts` |
| AC9 | `<RULE> writes line 3 as the author alone for an empty, null, missing or blank body` | the three rule test files |
| AC9 | `processWebhook stores an issue with HTML, control and directional characters cleaned and cut at 256, and sends it escaped` | `src/webhook.test.ts` |
| AC10 | `issueOf and commentOf return undefined for each malformed shape of E7` (table); `isForeignSender is false for each sender of E8` (table) | `src/rules/issue.test.ts` |
| AC10 | `processWebhook answers 202 no-match for a malformed comment and records the delivery` | `src/webhook.test.ts` |
| AC11 | `processWebhook answers 503 unavailable and stores nothing when readOwner rejects` | `src/webhook.test.ts` |
| AC11 | `resolveAppOwner rejects when D1 fails` | `src/github/app-credentials.test.ts` |

Rule tests read the fixtures of *Test files*; owner, bot, action and malformed variants are spread copies of them. The
owner used in tests is the fixtures' repository owner (`example-owner` with its fixture id, type `User`).

## Verification without tests

Only AC12 and AC13 have no unit test; every other criterion is tested above.

- AC12: the Reviewer reads the documents of *Documentation updates* against the code in step 8.
- AC13: the Reviewer checks in step 8 that the four fixtures exist, that their READMEs say "reference-built from
  GitHub's webhook payload documentation, not captured", and that 0040 states the residual risk. The live check
  (fact 7) runs on the draft pull request in step 11: the Product Manager creates an issue, a comment on it, and
  comments on a ready and on a draft pull request, and copies the four payloads from the app's *Advanced → Recent
  Deliveries* (kept outside the repository). The orchestrator records in `log.md` whether `issue.draft` and
  `issue.pull_request` are present and where they sit, and compares every field path `issueOf`, `commentOf` and
  `isForeignSender` read against the fixtures; any difference is fixed in this pull request (fixture, rule or
  documentation, through steps 6–8) before it is marked ready.

## Approach

**Owner to the rules.** `WebhookDeps` gets `readOwner: () => Promise<OwnerAccount | undefined>`. In step 4 of
`processWebhook`, inside the existing `try`, the settings are read, then the owner, and both are passed to
`runRules(rules, event, payload, settings, owner)`, which hands the owner to every `evaluate`. A rejection answers 503
`unavailable` (AC11). `src/index.ts` wires `readOwner: () => resolveAppOwner(env, env.DB)`.
`resolveAppId(env, db)` is extracted from `resolveAppCredentials` (the App ID half, behavior unchanged:
Worker secret first, else the saved credential; a secret read other than `ok`, or no usable `SELUNA_SECRET`, gives
`undefined`; D1 errors reject). `resolveAppOwner` returns `readAppOwner(db, appId)` or `undefined` without an App ID.

**Shared narrowing, `src/rules/issue.ts`** (fail closed: any mismatch is `undefined` or `false`):

All three readers are built on `isRecord`, `stringField` and `recordField` of `src/rules/pull-request.ts:27-40`; no
new narrowing helpers.

- `isForeignSender(payload, owner)`: `sender` must be an object with a `number` `id` and a `string` `type` (E8); then
  true unless `isOwnAction(payload, owner)` or `isBotSender(payload)`.
- `issueOf(payload)`: `issue` an object; `number` a whole number 1 to 2^53 − 1; `title`, `html_url`, `user.login` and
  `repository.full_name` strings; `body` a string, `null` or absent (absent and `null` read as `undefined`), anything
  else fails; `pull_request` absent gives `{ kind: "issue" }`, an object gives `{ kind: "pull-request", draft }` where
  `draft` is `issue.draft` when boolean, `undefined` when absent, and any other `draft` fails; a `pull_request` of
  another type fails.
- `commentOf(payload)`: `comment` an object with `html_url` and `user.login` strings and `body` as above.
- `bodyExcerpt(body)`: one forward pass by code point with an index `i`, building the output and stopping as soon
  as it holds `EXCERPT_MAX_CHARACTERS` (257, one more than the 256 of line 3, so the store still cuts and adds `…`)
  code points. The opener is `COMMENT_OPEN` (less-than sign, `!`, two hyphens) and the closer `COMMENT_CLOSE` (two
  hyphens, greater-than sign), named as constants. At `i` where the opener starts: `j = body.indexOf(COMMENT_CLOSE,
  i + 4)`; `j < 0` ends the scan
  (an unterminated comment drops the rest), else `i = j + 3`. A white-space code point (`/^\s$/u` on that one code
  point) only marks a pending space, written as one space before the next kept code point when the output is not
  empty (so runs collapse and the result is trimmed). Every search starts after the previous comment, so the pass is
  linear in the body, and no derived string (excerpt, line 3, the stored and rendered text) exceeds the line limit by
  more than the author and separator, whatever the body's size.
- `authorContext(texts, author, body)`: `joinContext([texts.byAuthor(author), bodyExcerpt(body)])` from
  `src/rules/security-alert.ts:75-84` (joins with ` · `, leaves out an empty excerpt: E5).

**Rules** (`src/rules/issue-opened.ts`, `issue-comment.ts`, `pull-request-comment.ts`): each first checks the event
name and `action` (`issues`/`opened`, `issue_comment`/`created`), then the shapes, then `isForeignSender`.

| Rule | Requires | Line 1 title (en / de), number | Line 2 | Line 3 | Button |
| ---- | -------- | ------------------------------ | ------ | ------ | ------ |
| `issue_opened` | `pull_request` absent | `New issue` / `Neues Issue`, `issue.number` | `issue.title` | `authorContext(issue.user.login, issue.body)` | `issue.html_url` |
| `issue_comment` | `pull_request` absent | `New comment on issue` / `Neuer Kommentar zum Issue` | `issue.title` | `authorContext(comment.user.login, comment.body)` | `comment.html_url` |
| `pull_request_comment` | `pull_request` an object, `draft` not `true` | `New comment on pull request` / `Neuer Kommentar zum Pull Request` | `issue.title` | as above | `comment.html_url` |

`issue_opened` also requires `pull_request` to be absent (an `issues` delivery never names a pull request; one that does
is a foreign shape). `byAuthor` is `by <author>` / `von <author>`.

**Draft state of a commented pull request.** `issue.draft === true`: nothing. `false`: a notification without a draft
check. Absent: a notification with `draftCheck: { pullRequest: pullRequestRefOf(full_name, number), titleWhenUnknown:
undefined }`. `DraftCheck.titleWhenUnknown` becomes `string | undefined`; `applyDraftChecks` drops a notification whose
check fails (lookup failure, the 8-second cut-off, no usable `installation.id`) when it is `undefined`, and retitles
it as today otherwise (the CI rule is unchanged). Field for the live check: `issue.draft` (fact 7).

**Settings and texts.** `RULE_IDS` and `DEFAULT_SETTINGS.rules` gain `issue_opened`, `issue_comment`,
`pull_request_comment` (on) after `secret_scanning_alert`; `RULES` registers the three rules in that order;
`ruleLabels` gets the labels of S6. Layout of the messages: as the table above and S1–S3, nothing free for the Tester.

**Skeleton placeholders** (so the step-5 tests fail): the three rules return `undefined`, `bodyExcerpt` returns `""`,
`isForeignSender` `false`, `issueOf` and `commentOf` `undefined`, `resolveAppOwner` `undefined`, the three new
defaults `false`, the new texts and labels `""`.

## Options considered

As in [0040](../../docs/decisions/0040-issue-and-comment-rules.md): the owner as an `evaluate` argument (over settings
or a D1 read in the rule); read on every delivery (over only for two events, or the `meta` row without the App ID
check); an unknown owner reported; `issue.draft` with the lookup as fallback (over payload only or lookup only); an
unknown draft state dropped (over _draft status unknown_); HTML comments removed (over kept). A required `owner`
parameter was preferred over an optional one so the compiler finds every call that forgets it.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/rules/rule.ts` | `evaluate` and `runRules` take the owner; `DraftCheck.titleWhenUnknown` may be `undefined` |
| Worker | `src/rules/issue.ts` (new) | shared narrowing, excerpt, line 3 |
| Worker | `src/rules/issue-opened.ts`, `issue-comment.ts`, `pull-request-comment.ts` (new) | the three rules |
| Worker | `src/rules/registry.ts` | three rules appended |
| Worker | `src/settings.ts` | three rule ids, default on |
| Worker | `src/i18n/messages.ts`, `en.ts`, `de.ts` | four texts |
| Worker | `src/setup/texts.ts` | three labels per language |
| Worker | `src/draft-lookup.ts` | drop on an unknown state without a title |
| Worker | `src/webhook.ts` | `readOwner` dependency, owner read in step 4 |
| Worker | `src/github/app-credentials.ts` | `resolveAppId`, `resolveAppOwner` |
| Worker | `src/index.ts` | wiring of `readOwner` |
| Tests | `test/fixtures/issue_comment/`, `test/fixtures/issues/` | fixtures and READMEs |

## Signatures (for the Dev's skeleton)

```ts
// src/rules/rule.ts
export interface DraftCheck {
  readonly pullRequest: PullRequestRef;
  /** Line 1 title when the draft state is unknown; without one the notification is dropped. */
  readonly titleWhenUnknown: string | undefined;
}
export interface Rule {
  readonly id: RuleId;
  readonly evaluate: (event: string, payload: WebhookPayload, settings: NotificationSettings,
    owner: OwnerAccount | undefined) => Notification | undefined;
}
export function runRules(rules: readonly Rule[], event: string, payload: WebhookPayload,
  settings: NotificationSettings, owner: OwnerAccount | undefined): RuleRun;

// src/rules/issue.ts
export type IssueKind = { readonly kind: "issue" } | { readonly kind: "pull-request"; readonly draft: boolean | undefined };
export interface IssueFields { readonly repository: string; readonly number: number; readonly title: string;
  readonly url: string; readonly author: string; readonly body: string | undefined; readonly target: IssueKind }
export interface CommentFields { readonly url: string; readonly author: string; readonly body: string | undefined }
export function isForeignSender(payload: WebhookPayload, owner: OwnerAccount | undefined): boolean;
export function issueOf(payload: WebhookPayload): IssueFields | undefined;
export function commentOf(payload: WebhookPayload): CommentFields | undefined;
/** Longest excerpt, in code points: one more than line 3's limit, so the store still cuts it. */
export const EXCERPT_MAX_CHARACTERS = 257;
/** The body without HTML comments, white-space runs as one space, trimmed, at most EXCERPT_MAX_CHARACTERS code points. */
export function bodyExcerpt(body: string | undefined): string;
export function authorContext(texts: MessageTexts, author: string, body: string | undefined): string;

// src/rules/issue-opened.ts, issue-comment.ts, pull-request-comment.ts
export const ISSUE_OPENED: Rule;
export const ISSUE_COMMENT: Rule;
export const PULL_REQUEST_COMMENT: Rule;

// src/i18n/messages.ts (MessageTexts)
readonly issueOpened: string;
readonly issueComment: string;
readonly pullRequestComment: string;
readonly byAuthor: (author: string) => string;

// src/settings.ts: RULE_IDS gains "issue_opened", "issue_comment", "pull_request_comment" (last)

// src/webhook.ts (WebhookDeps)
readonly readOwner: () => Promise<OwnerAccount | undefined>;

// src/github/app-credentials.ts
export async function resolveAppId(env: object, db: D1Database): Promise<number | undefined>;
export async function resolveAppOwner(env: object, db: D1Database): Promise<OwnerAccount | undefined>;
```

Files the skeleton rewrites: all of *Affected projects and types* but the fixtures; its placeholders are under
*Approach*.

## Test files

`src/rules/issue.test.ts`, `src/rules/issue-opened.test.ts`, `src/rules/issue-comment.test.ts`,
`src/rules/pull-request-comment.test.ts` (new); `src/rules/rule.test.ts`, `src/rules/registry.test.ts`,
`src/draft-lookup.test.ts`, `src/webhook.test.ts`, `src/github/app-credentials.test.ts`, `src/settings.test.ts`,
`src/setup/settings-form.test.ts`, `src/setup/texts.test.ts`, `src/setup/pages.test.ts`, `src/i18n/messages.test.ts`.

Fixtures (Tester, reference-built from the OpenAPI schemas of fact 6, names and ids as the existing ones):
`test/fixtures/issues/opened.json` (kept), `test/fixtures/issue_comment/created.json` (kept),
`test/fixtures/issue_comment/created-pull-request.json` (`issue.pull_request` object, `issue.draft` `false`),
`test/fixtures/issue_comment/created-draft-pull-request.json` (`issue.draft` `true`); both READMEs updated (the files,
"reference-built … not captured", decision 0040, the live check).

Existing test call sites:

- Dev, step 4 (the old signature goes away; mechanical, `undefined` as the owner, no assertion touched): every
  `.evaluate(` call in `src/rules/{pull-request-opened,pull-request-ready-for-review,pull-request-review-requested,ci-failed-default-branch,ci-failed-pull-request,dependabot-alert,code-scanning-alert,secret-scanning-alert}.test.ts`,
  the `runRules` calls in `src/rules/rule.test.ts`, the `harness` of `src/webhook.test.ts` (`readOwner: () =>
  Promise.resolve(undefined)`), and `ALL_RULES_OFF` in `src/settings.test.ts` (three keys `false`).
- Tester, step 5: the expectations that list the rules — `src/setup/pages.test.ts` (`toBe(8)` and test name, snapshot
  in `src/setup/__snapshots__/pages.test.ts.snap`), `src/rules/registry.test.ts`, `src/setup/texts.test.ts`,
  `src/setup/settings-form.test.ts`, the `VALID_SETTINGS_FIELDS` of `src/setup/handler.test.ts` where a test compares
  the full settings.
- Kept unchanged: `src/rules/actor.test.ts`, `src/rules/security-alert.test.ts` (no new input).

Files no unit test can cover: none.

## Areas

- Notifications: the new rule section, *The sender*, *Rules*, *Processing a delivery* step 4, *Draft lookup*,
  *Languages* (spec, *Area documents*).
- Setup wizard: eleven switches and their labels.
- Storage: three `rule_<id>` keys, fifteen settings rows.
- GitHub API: the draft lookup also serves a comment on a pull request; the webhook processing resolves the App ID
  for the owner.

## Documentation updates

Dev, once the code is green; found by a sweep for "eight", the rule id list and the case enumerations.

- `docs/areas/notifications.md`: a section *Issue and comment rules* after *Security alert rules* (table, lines,
  shape, excerpt, draft state, volume risk on public repositories, documented-not-observed); *The sender* (lines
  187-201: the three rules read `sender`; the owner is read once per delivery, unknown owner = another account; the
  "no rule reports them yet" bullet narrowed to forks and stars); *Rules* (lines 52-63: a rule also gets the stored
  owner; order); *Processing a delivery* step 4; *Draft lookup* (lines 205-220: a comment on a pull request without
  `issue.draft` is a second kind of check, dropped on an unknown state; still at most one per delivery); *Languages*;
  *Related decisions* (0040).
- `docs/areas/setup-wizard.md`: lines 193 and 587 ("eight" to "eleven"), line 743 (the three labels).
- `docs/areas/storage.md`: line 58 (three ids), line 51 ("twelve rows" to "fifteen").
- `docs/areas/github-api.md`: line 8 (the draft lookup also for a comment on a pull request), line 5 (the processing
  resolves the App ID to read the owner).
- `docs/ARCHITECTURE.md`: the intro's case list, the *Components* rows "Rules" (the stored owner as input) and
  "Webhook processing", step 3 of *Webhook to Telegram*; link 0040.
- `AGENTS.md` and `.github/copilot-instructions.md`, project block `overview`, identically: add "an issue or comment
  was written by someone else" to the case list.
- `README.md`: the event table (two rows: a new issue; a comment on an issue or a pull request, the owner's and bots'
  left out), the paragraph below it (line 3 of an issue or comment), the settings table (one row, on), the *Status*
  sentence; the 0.8.0 roadmap row stays (forks and stars are still open).
- `docs/setup.md` *Status and settings*: the owner's own issues and comments are left out once the status page shows
  the owner; for an organization's app everyone's are reported.
- `CHANGELOG.md` `[Unreleased]`: *Added* entry for the three rules and switches; the #108 entry "send no message yet"
  narrowed to forks and stars.
- `.squad/project.md` *Test doubles* (*Real GitHub payloads*): the two new `issue_comment` fixtures, reference-built
  (decision 0040); *Security areas*, *Parsing of external input*: the sentence "titles and branch names are
  attacker-controlled text" also names issue and comment bodies and author logins, and the body excerpt
  (`bodyExcerpt` in `src/rules/issue.ts`, bounded to 257 code points).
- Tester: the two fixture READMEs.

## Architecture check

- "A draft pull request triggers no notification": kept — a comment on a draft or an undeterminable pull request is
  dropped; the exceptions stay two.
- "A matched event is written to the outbox before delivery": unchanged; the owner read happens before the
  transaction, and its failure stores nothing (503, redeliverable).
- Rules stay pure: the owner is a value read by the processing, like the settings.
- A webhook with an invalid signature has no effect: the owner is read only after the signature.

## Security considerations

- [ ] Limits: the body is read within the 1 MiB request body limit (bytes before decoding); `bodyExcerpt` reads it in
  one linear pass and returns at most 257 code points of the decoded text (count-based test, AC9); line 2 and line 3
  are cut at 256 code points after decoding and cleaning, in `storedNotificationOf` and `renderTelegramText`.
- [ ] Exceptions: none reach a user-visible text; a rejecting `readOwner` (D1) answers 503 with no body, logged only
  as `unavailable`.

## Decision records

- `docs/decisions/0040-issue-and-comment-rules.md` (Proposed, indexed).

## Challenge

Plan challenge: 0 major, 2 minor, both accepted.

1. Reuse the existing helpers — accepted: the readers use `isRecord`, `stringField` and `recordField`, and
   `authorContext` is `joinContext` (*Approach*).
2. Keep the real payloads of the live check — accepted: the four payloads are copied, the presence and place of
   `issue.draft` and `issue.pull_request` logged, every read field path compared with the fixtures, and any difference
   fixed in this pull request before it is marked ready (*Verification without tests*, AC13; `tasks.md` task 7).

## Security review

1. Blocking — the excerpt's resource bound was claimed but not pinned. Resolved by capping: `bodyExcerpt` stops once
   its output holds 257 code points (`EXCERPT_MAX_CHARACTERS`), so every derived string stays at the line limit
   whatever the body's size; each closer search starts after the previous comment and an unterminated opener ends the
   pass, so it is linear. Pinned by the count-based test `bodyExcerpt returns at most 257 code points for a 1 MiB body`
   over the adversarial bodies Security named (AC9 row, *Signatures*); no time-ratio test is needed.
2. Non-blocking — `.squad/project.md` *Parsing of external input*: taken, the sentence names bodies and author logins
   (*Documentation updates*).
3. Non-blocking — the storage key is derived twice per delivery without a `GITHUB_APP_ID` Worker secret: not taken.
   One HKDF derivation is microseconds of Web Crypto; passing the key from `webhook-secret.ts` to the owner read would
   couple the signature check to the rules' inputs, and `resolveAppCredentials` already derives it per call.

## Out of scope / follow-ups

As in the spec (*Out of scope*). No follow-up issue: #121 already covers deliveries no rule reads.
