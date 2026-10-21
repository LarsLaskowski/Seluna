# Plan: Retry, cleanup and update notice

Source: Issue #18 | [spec.md](spec.md)
Status: Draft
Tier: security — the change creates a new guard on external input (the allow-list of the release answer's `tag_name`, which enters a message and a URL) and adds a second exception to "every GitHub call is made as the app"
Security areas touched: GitHub App authentication (a request without credentials beside the app's calls: `src/github/http.ts`, new `src/github/release.ts`); Parsing of external input (the release answer narrowed to `tag_name`: `src/github/release.ts`, new `src/version.ts`); Encrypted credentials (expired `token_cache` rows deleted: `src/store/token-cache.ts`); Outbound-only Telegram (`sendMessage` now also from the cron through `src/delivery.ts`); Logging of external data (new log entries: new `src/scheduled.ts`, `src/delivery.ts`); `.squad/project.md` (*Security areas* and *Guarantees* updated)

## Problem / root cause

See [spec.md](spec.md), *Problem*: the `scheduled` handler is empty (`src/index.ts:53-56`), so nothing resends, cleans up or
checks for releases.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | The `scheduled` handler does nothing; both triggers are configured | `src/index.ts:53-56`; `wrangler.jsonc` `triggers.crons` `["*/10 * * * *", "17 5 * * *"]` | confirmed |
| 2 | `controller.cron` is the configured expression, character for character | cloudflare-docs `src/content/docs/workers/runtime-apis/handlers/scheduled.mdx:157` (commit c1036967) | confirmed |
| 3 | `markAttempted` keeps a row `pending`; `markSent` only stops a second update, not a second send | `src/store/outbox.ts:15-25` | confirmed |
| 4 | An attempt is counted per send that reaches Telegram or fails on the way, none without bot token or chat | `src/delivery.ts:78-108` (`deliverOne`), `src/delivery.ts:52-66` (`resolveTarget`), decision 0023 | confirmed |
| 5 | A failed read of the chat is caught inside `deliverMessages` and logged `store-failed` per row (challenge note 1) | `src/delivery.ts:52-66`, `:110-131` (`deliverFrom` logs the target's result per row) | confirmed |
| 6 | No row can be `pending` with 5 attempts today: only the first send counts, once | `src/webhook.ts:141-158` sends only new rows; no other caller of `markAttempted` | confirmed |
| 7 | `update_notice` exists (default on) and is read by `readNotificationSettings`; nothing uses it | `src/settings.ts:28,46,123`; `grep updateNotice src` finds only the settings form (`src/setup/pages.ts:261`, `src/setup/settings-form.ts:47`) | confirmed |
| 8 | The running version is `package.json`'s, imported at build time (0.4.0 today) | `src/index.ts:1`, `package.json` | confirmed |
| 9 | `releases/latest` answers the latest full release (no pre-release, no draft) with a string `tag_name` `vA.B.C` | captured answer 2026-10-21 (`gh api`, HTTP 200, `tag_name` `v0.4.0`, `prerelease` false), saved anonymized as [release-latest.json](release-latest.json); decision 0009 option 12 | confirmed |
| 10 | A hand-published full release is latest before its checks (challenge note 2) | `docs/CONTRIBUTING.md:105-107`, `.squad/project.md:89-90` | confirmed |
| 11 | GitHub answers the unauthenticated request from a Worker's address, within its per-address limit | to verify: Product Manager's live check on a deployed copy (the daily job's log entry, or a run started from the dashboard), step 11 before the pull request is marked ready; the session's proxy authenticates every GitHub request, so it cannot be measured here | unverified |
| 12 | A non-2xx answer (3xx with `redirect: "manual"` included) is `refused` and its body is cancelled unread; a 2xx body is read up to 1 MiB counted before decoding | `src/github/http.ts:21,28-36`, `src/body.ts` (`readJsonWithLimit`), `src/github/http.test.ts:100-107` | confirmed |
| 13 | Free plan: 50 subrequests per invocation (D1 included), 50 D1 queries per invocation, 10 ms CPU and 15 minutes wall time per cron invocation, 100,000 rows written per day (deletes and index rows count), large deletes in chunks of about 1,000 rows | cloudflare-docs commit c1036967: `workers/platform/limits.mdx:24-26,74,159,198`, `d1/platform/limits.mdx` (queries per invocation), `partials/workers/d1-pricing.mdx:8,18,22`, `partials/d1/faq-limits.mdx:41` | confirmed |
| 14 | A 10-minute run with 10 rows stays within 10 ms CPU | to verify: Product Manager's live check reads the CPU time of a 10-minute invocation in the Workers dashboard, step 11 | unverified |
| 15 | A D1 batch is one transaction whose statements see the earlier ones' changes | `src/store/deliveries.ts:21-39`, `resetCredentials` (`docs/areas/storage.md`, *Key check*), decision 0023 option 3 | confirmed |
| 16 | D1 accepts `UPDATE … RETURNING`, `UPDATE/DELETE … WHERE id IN (SELECT … ORDER BY … LIMIT ?)` and `INSERT … SELECT … WHERE … ON CONFLICT (key) DO UPDATE`; in `UPDATE … SET` the right side reads the old values | to verify: the Tester's store tests (AC2, AC4, AC6) against the test pool's D1, step 5/6 — a syntax error or a wrong value fails them | unverified |
| 17 | A retry run takes at most about 250 s: 10 rows × (2 × 10 s + 5 s) | `TELEGRAM_TIMEOUT_MS`, `MAX_RETRY_AFTER_SECONDS` in `src/telegram.ts` | confirmed |
| 18 | An existing test pins the empty handler and must change | `src/index.test.ts:203-218` (asserts no log call) | confirmed |
| 19 | The docs already assign `token_cache` cleanup to this cron (spec Q3) | `docs/areas/github-api.md:117-118`, decision 0026 *Consequences* | confirmed |

Issue claims checked: the empty handler (1), 5 attempts then `failed` (3, 4), the unauthenticated endpoint (9, 11) — none refuted.
Related defect found: none in the code; the spec's E8 ("deletes all old rows at once") contradicted fact 13 and was fixed
in the spec (bounded deletes).

## Tests per criterion

The criteria are the spec's. Test names are the scenarios; the Tester words them.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `retryPendingRows` sends the 10 oldest due rows of 12 (order by `created_at`, then `id`) and marks them `sent`; leaves a row written exactly 60,000 ms before the start unsent and sends one written 60,001 ms before; does not pick rows with 5 attempts; a row sent in quiet hours goes silent and its button is in the language the run read (E18). `readDueRows` returns the bounded, ordered rows | `src/outbox-retry.test.ts`, `src/store/outbox.test.ts` |
| AC2 | `markAttempted` on a row with 4 attempts sets `failed` and 5 and returns `failed`; with 3 attempts keeps `pending` and returns `pending`; on a `sent` row returns `unchanged`. `failExhaustedRows` marks at most `limit` rows (11 rows, limit 10), oldest first, leaves rows under 5 attempts, returns the ids. `deliverMessages` logs `{ outbox, status: "failed" }` after `{ outbox, result: "failed" }` for a fifth failed attempt. `retryPendingRows` marks a row with 5 attempts `failed` with no Telegram request and logs it | `src/store/outbox.test.ts`, `src/delivery.test.ts`, `src/outbox-retry.test.ts` |
| AC3 | Outage: three runs against a Telegram double answering 500 then `ok` — attempts 1→2→3 `pending`, then `sent` in the next run. Without bot token (and without chat): a row with 4 attempts stays `pending` with 4, no request, `no-token` / `no-chat` logged. Marking `sent` fails after Telegram accepted: row `pending`, `store-failed` logged (E5) | `src/outbox-retry.test.ts` |
| AC4 | `cleanUpRows`: deletes `deliveries` 1 ms past 7 days, keeps one exactly 7 days old; deletes `sent` and `failed` rows 1 ms past 30 days, keeps one exactly 30 days old and a `pending` row 365 days old; deletes `token_cache` rows expired 1 ms before, keeps one expiring exactly now; with 1,001 old rows per table deletes 1,000, the oldest | `src/cleanup.test.ts` |
| AC5 | `runScheduled("*/10 * * * *")` with a cleanup batch that fails: logs `{ job: "cleanup", result: "store-failed" }` once and still sends a due row; with a failing row read: logs `{ job: "retry", result: "store-failed" }` and still deletes old rows; no entry holds the error text | `src/scheduled.test.ts` |
| AC6 | `formatReleaseMessage` English and German exact texts (*Approach*). `checkForRelease` with v0.5.0 over 0.4.0: one `outbox` row with the English text and the tag URL, `notified_release` `0.5.0`, one `sendMessage`, result `reported`; second run: `known`, no request to Telegram; `v0.6.0` after `0.5.0`: reported; latest `v0.5.0` with remembered `0.6.0`: `known`, `0.6.0` kept (E14); no chat: row and version written, row `pending`, `no-chat` logged (E17). `recordReleaseNotice` with an expected value that no longer matches writes neither and returns `undefined`; with the row absent as expected writes both (E16) | `src/release-check.test.ts`, `src/store/notified-release.test.ts` |
| AC7 | `checkForRelease` with latest equal to and older than the running version: `current`, nothing written; with `update_notice` `off`: `off`, the GitHub double receives no request and `meta` is not read (a database that throws on the `meta` read) | `src/release-check.test.ts` |
| AC8 | `publicGitHubRequest`: GET, `Accept`, `X-GitHub-Api-Version`, `User-Agent: seluna/<version>`, no `Authorization`, `redirect` `manual`, a signal. `fetchLatestRelease` against the captured fixture returns 0.4.0; 404 → `none`; 302, 403, 429, 500 → `refused`; rejection, body over 1 MiB, invalid JSON → `unavailable`; array, `{}`, `tag_name` 5 or `null` → `malformed`. `parseLatestRelease` tag table (*Approach*, *Accepted tag forms*). `checkForRelease`: running `0.4` → `invalid-version` with no request; failing settings read, failing `meta` read and failing batch → `store-failed`, nothing written | `src/github/http.test.ts`, `src/github/release.test.ts`, `src/release-check.test.ts` |
| AC9 | `compareVersions`: 0.10.0 > 0.9.0, 1.0.0 > 0.99.99, equal → 0; `parseVersion` rejects `01.0.0`, `1.0`, `1.0.0.0`, `1.0.0-rc.1`, `1000000000.0.0`, accepts `0.0.0` and `999999999.0.0`. `checkForRelease` with remembered `garbage` reports v0.5.0 | `src/version.test.ts`, `src/release-check.test.ts` |
| AC10 | `runScheduled`: `*/10 * * * *` runs cleanup and retry and no GitHub request; `17 5 * * *` runs only the release check and logs one `release-check` entry; `0 * * * *` logs exactly `{ job: "schedule", result: "unknown" }` and touches neither D1 nor a fetch. Worker wiring: `worker.scheduled` with `*/10 * * * *` sends a due row through the global `fetch`; with `17 5 * * *` the GitHub request goes through the global `fetch` without `Authorization` (replaces the test at `src/index.test.ts:203-218`) | `src/scheduled.test.ts`, `src/index.test.ts` |

Escapes: the tag cases with a line feed (U+000A) and U+202E are written in the test source as escapes; each such test
also asserts that its input contains that character (`includes`), so a lost escape fails the run instead of testing
`v0.5.0` (*Escapes in files*). The guard that must reject them is the anchored pattern of `parseReleaseTag`.

## Approach

**Modules.** `src/scheduled.ts` dispatches by expression and isolates the jobs; `src/cleanup.ts`,
`src/outbox-retry.ts` and `src/release-check.ts` are the three jobs; `src/version.ts` parses and compares versions;
`src/github/release.ts` makes and narrows the release request; the SQL lives in `src/store/` (`outbox.ts`,
`deliveries.ts`, `token-cache.ts`, new `notified-release.ts`). `src/index.ts` wires `runScheduled` with `env.DB`,
`() => new Date()`, `outboundFetch` for Telegram and GitHub, `wait`, `log` and `version`.

**Dispatch (`runScheduled`).** Reads `now()` once (`startedAt`). `*/10 * * * *`: `cleanUpRows(db, startedAt)` in a
try/catch (failure → `{ job: "cleanup", result: "store-failed" }`), then `retryPendingRows(startedAt, deps)`
(`store-failed` → `{ job: "retry", … }`). `17 5 * * *`: `checkForRelease` and its result as one `release-check` entry.
Anything else: `{ job: "schedule", result: "unknown" }`. Every log call is wrapped so a throwing sink cannot stop a
job; `runScheduled` never rejects.

**Retry (`retryPendingRows`).** 1. `failExhaustedRows(db, 10)` and one `{ outbox, status: "failed" }` per id.
2. `readDueRows(db, startedAt − 60,000 ms, 10)`: `status = 'pending' AND attempts < 5 AND created_at < ?` ordered by
`created_at, id`. 3. None → `done`. 4. `readNotificationSettings`, then `deliverMessages(rows, settings, deps)`.
Failure in 1–4 before sending → `store-failed`.

**The fifth attempt.** `markAttempted` becomes one statement: `UPDATE outbox SET attempts = attempts + 1, status =
CASE WHEN attempts + 1 >= ?2 THEN 'failed' ELSE 'pending' END WHERE id = ?1 AND status = 'pending' RETURNING status`
with `?2` = `MAX_ATTEMPTS` (5); it returns `failed`, `pending` or `unchanged` (no row). `deliverOne` passes the outcome
up and `deliverFrom` logs `{ outbox, status: "failed" }` after the row's result entry. The first send cannot reach 5
(fact 6), so its behavior and log stay as they are.

**Cleanup (`cleanUpRows`).** One `db.batch` of three deletes, each `WHERE <key> IN (SELECT <key> … ORDER BY … LIMIT
1000)`: `deliveries` with `received_at < startedAt − 604,800,000`, `outbox` with `status IN ('sent','failed') AND
created_at < startedAt − 2,592,000,000` (order `created_at, id`), `token_cache` with `expires_at < startedAt`
(order `expires_at`). D1 errors reject; the caller logs.

**Release check (`checkForRelease`).** Steps and results exactly as `docs/areas/scheduled-jobs.md`, *Release check*
(already written from this plan): settings (`off` → stop, before any other read), `parseVersion(version)`,
`readNotifiedRelease`, `fetchLatestRelease`, compare, `recordReleaseNotice`, `deliverMessages` with the one row.
`recordReleaseNotice` runs one batch:
(1) `INSERT INTO outbox (text, button_url, silent, created_at) SELECT ?1, ?2, 0, ?3 WHERE COALESCE((SELECT value FROM
meta WHERE key = 'notified_release'), '') = ?4 RETURNING id` and (2) `INSERT INTO meta (key, value) SELECT
'notified_release', ?1 WHERE COALESCE((SELECT value FROM meta WHERE key = 'notified_release'), '') = ?2 ON CONFLICT
(key) DO UPDATE SET value = excluded.value`, `?4`/`?2` the raw value read (empty text when absent). Both guards read
the same pre-state (statement 1 does not touch `meta`), so both or neither apply; no id → `known`.

**Accepted tag forms.** `parseReleaseTag` accepts exactly `^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$`
(ASCII digits, no `u`/`m` flag, so `$` is the end of input); `parseVersion` the same without `v`. The tag is a JSON
string; JSON escapes are decoded before the check, so they reach it as characters. Accepted: `v0.5.0`, `v0.0.0`,
`v999999999.0.0`. Rejected: `v0.5`, `v0.5.0.1`, `v0.5.0-rc.1`, `v0.5.0+build`, `0.5.0`, `V0.5.0`, `v01.5.0`,
`v1000000000.0.0`, a leading or trailing space, a trailing line feed (U+000A), U+202E after the version, a fullwidth
digit (U+FF10) as a part, `v0.5.0<b>`, an empty text, a tag of 1 MiB (the body limit stops a longer one), and a
non-string `tag_name`. The message and the URL are built from the three numbers by `versionText`, never from the
tag text.

**Release message layout** (new user-visible output; text in `src/i18n/en.ts` / `de.ts`, keys `newSelunaRelease` and
`releaseAvailable(latest, running)`): line 1 `<b>New Seluna release</b> · LarsLaskowski/Seluna`, line 2
`Version 0.5.0 is available; this instance runs 0.4.0.`, separated by one line feed, no line 3; German
`<b>Neue Seluna-Version</b> · LarsLaskowski/Seluna` and `Version 0.5.0 ist verfügbar; diese Instanz läuft mit 0.4.0.`;
the parts pass `escapeTelegramHtml`; the button URL `https://github.com/LarsLaskowski/Seluna/releases/tag/v0.5.0`
passes `buttonUrl`. Log entries: as in *Signatures* — no other fields.

**Statement budget** (spec NFR): 10-minute run 3 + 1 + 1 + 1 + 1 + 10 = 17 D1 statements (cleanup, mark, select,
settings, chat, row updates); daily run 6.

## Options considered

The options of the retry and cleanup are in decision 0029 (send path, the fifth attempt in one statement, separate
marking of exhausted rows, no claim, 10 rows and 1,000 deletes, retention), those of the release check in decision
0030 (unauthenticated read, `tag_name` only, outbox row with the remembered version in one guarded batch, nothing
read while off). Within the plan also weighed:

- **Dispatch order cleanup then retry** over retry then cleanup: the cleanup is short and bounded, so a retry slowed
  by Telegram timeouts cannot keep it from running.
- **Job log entries on failure only** (retry, cleanup) over one entry per run: 288 entries a day saying nothing
  happened; the release check logs every run (once a day, its result is what the owner asks about).
- **A log entry of its own for a row marked `failed`** over a new `DeliveryResult` value: the per-row result stays
  the send's result, as the notifications area documents it.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/index.ts` | `scheduled` calls `runScheduled`; `log` accepts `ScheduledLogEntry` |
| Worker | `src/scheduled.ts`, `src/cleanup.ts`, `src/outbox-retry.ts`, `src/release-check.ts`, `src/version.ts`, `src/github/release.ts`, `src/store/notified-release.ts` | new |
| Worker | `src/delivery.ts` | `DeliveryLogEntry` union; the marked-failed entry |
| Worker | `src/store/outbox.ts` | `MAX_ATTEMPTS`, `OutboxRow`, `markAttempted` outcome, `failExhaustedRows`, `readDueRows`, `finishedRowsDelete` |
| Worker | `src/store/deliveries.ts`, `src/store/token-cache.ts` | one delete statement each |
| Worker | `src/github/http.ts` | `publicGitHubRequest` |
| Worker | `src/i18n/messages.ts`, `en.ts`, `de.ts` | two keys |
| Tests | `test/github.ts` | route `latestRelease` (`GET /repos/LarsLaskowski/Seluna/releases/latest`) answered from `test/fixtures/github/release-latest.json` |

## Signatures (for the Dev's skeleton)

```ts
// src/version.ts (new)
export interface Version { readonly major: number; readonly minor: number; readonly patch: number }
export function parseVersion(text: string): Version | undefined;
export function parseReleaseTag(tag: string): Version | undefined;
/** Negative when `left` is older, 0 when equal, positive when newer. */
export function compareVersions(left: Version, right: Version): number;
export function versionText(version: Version): string; // "A.B.C"

// src/github/http.ts (added)
/** GET `path` on the GitHub API with the standard headers, no `Authorization`, no redirects, a 10-second timeout. */
export function publicGitHubRequest(path: string, version: string): Request;

// src/github/release.ts (new)
export const UPSTREAM_REPOSITORY = "LarsLaskowski/Seluna";
export const LATEST_RELEASE_PATH = "/repos/LarsLaskowski/Seluna/releases/latest";
export type LatestRelease =
  | { readonly kind: "found"; readonly version: Version }
  | { readonly kind: "none" } | { readonly kind: "refused" }
  | { readonly kind: "unavailable" } | { readonly kind: "malformed" };
export function parseLatestRelease(body: unknown): Version | undefined;
/** One request; never throws. */
export async function fetchLatestRelease(fetcher: GitHubFetch, version: string): Promise<LatestRelease>;

// src/store/outbox.ts (added / changed)
export const MAX_ATTEMPTS = 5;
export interface OutboxRow { readonly id: number; readonly text: string; readonly buttonUrl: string | undefined; readonly silent: boolean }
export type AttemptOutcome = "pending" | "failed" | "unchanged";
export async function markAttempted(db: D1Database, id: number): Promise<AttemptOutcome>; // was Promise<void>
export async function failExhaustedRows(db: D1Database, limit: number): Promise<readonly number[]>;
export async function readDueRows(db: D1Database, writtenBefore: Date, limit: number): Promise<readonly OutboxRow[]>;
export function finishedRowsDelete(db: D1Database, writtenBefore: Date, limit: number): D1PreparedStatement;

// src/store/deliveries.ts, src/store/token-cache.ts (added)
export function oldDeliveriesDelete(db: D1Database, receivedBefore: Date, limit: number): D1PreparedStatement;
export function expiredTokensDelete(db: D1Database, expiredBefore: Date, limit: number): D1PreparedStatement;

// src/store/notified-release.ts (new)
export const NOTIFIED_RELEASE_META_KEY = "notified_release";
export async function readNotifiedRelease(db: D1Database): Promise<string | undefined>;
/** One guarded batch; the new row's id, or `undefined` when `notified_release` no longer holds `expected`. D1 errors reject. */
export async function recordReleaseNotice(db: D1Database, row: NewOutboxRow, createdAt: Date, notified: string, expected: string | undefined): Promise<number | undefined>;

// src/delivery.ts (changed)
export type DeliveryLogEntry =
  | { readonly outbox: number; readonly result: DeliveryResult }
  | { readonly outbox: number; readonly status: "failed" };

// src/i18n/messages.ts (added to MessageTexts)
readonly newSelunaRelease: string;
readonly releaseAvailable: (latest: string, running: string) => string;

// src/cleanup.ts (new)
export const DELIVERY_RETENTION_MS = 604_800_000;
export const OUTBOX_RETENTION_MS = 2_592_000_000;
export const CLEANUP_LIMIT = 1000;
/** One batch of three bounded deletes. D1 errors reject. */
export async function cleanUpRows(db: D1Database, startedAt: Date): Promise<void>;

// src/outbox-retry.ts (new)
export const RETRY_BATCH_SIZE = 10;
export const RETRY_GRACE_MS = 60_000;
export type RetryResult = "done" | "store-failed";
/** Never rejects. */
export async function retryPendingRows(startedAt: Date, deps: DeliveryDeps): Promise<RetryResult>;

// src/release-check.ts (new)
export type ReleaseCheckResult =
  | "reported" | "off" | "invalid-version" | "no-release" | "refused" | "unavailable"
  | "malformed" | "current" | "known" | "store-failed";
export interface ReleaseCheckDeps extends DeliveryDeps { readonly githubFetch: GitHubFetch; readonly version: string }
export function formatReleaseMessage(latest: Version, running: Version, language: Language): OutboxMessage;
/** Never rejects. */
export async function checkForRelease(startedAt: Date, deps: ReleaseCheckDeps): Promise<ReleaseCheckResult>;

// src/scheduled.ts (new)
export const RETRY_SCHEDULE = "*/10 * * * *";
export const RELEASE_SCHEDULE = "17 5 * * *";
export type ScheduledLogEntry =
  | { readonly job: "retry" | "cleanup"; readonly result: "store-failed" }
  | { readonly job: "release-check"; readonly result: ReleaseCheckResult }
  | { readonly job: "schedule"; readonly result: "unknown" };
export interface ScheduledDeps {
  readonly env: object;
  readonly db: D1Database;
  readonly now: () => Date;
  readonly telegramFetch: TelegramFetch;
  readonly githubFetch: GitHubFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (entry: ScheduledLogEntry | DeliveryLogEntry) => void;
  readonly version: string;
}
/** Never rejects. */
export async function runScheduled(cron: string, deps: ScheduledDeps): Promise<void>;

// src/index.ts (changed)
scheduled(controller: ScheduledController, env: Env): Promise<void>;
```

Files the skeleton rewrites: `src/index.ts` (`scheduled`, `log`), `src/delivery.ts` (type and `deliverOne`/`deliverFrom`
bodies), `src/store/outbox.ts`. `src/i18n/en.ts` and `de.ts` get their real texts in the skeleton (a missing key does not
compile).

## Test files

`src/version.test.ts`, `src/github/release.test.ts`, `src/github/http.test.ts`, `src/store/outbox.test.ts`,
`src/store/notified-release.test.ts`, `src/delivery.test.ts`, `src/cleanup.test.ts`, `src/outbox-retry.test.ts`,
`src/release-check.test.ts`, `src/scheduled.test.ts`, `src/index.test.ts`. Fixture: [release-latest.json](release-latest.json),
copied unchanged by the Tester to `test/fixtures/github/release-latest.json` with a row in `test/fixtures/github/README.md`
(captured 2026-10-21, anonymized as `pull-request.json`: owner, repository, ids, `node_id`s, author and body replaced;
`tag_name`, flags and dates untouched). `test/github.ts` gets the route `latestRelease`.

Existing test code affected: `src/index.test.ts:203-218` pins the empty handler — the Tester replaces it in step 5 (AC10).
`src/delivery.test.ts:61-80` (`Harness.log: DeliveryLogEntry[]`) keeps compiling with the union. `markAttempted`'s new
return type breaks no call site (`src/store/outbox.test.ts` awaits it). No signature the Dev changes needs a
mechanical adaptation.

Files no unit test can cover: none (`src/index.ts`'s `scheduled` is covered by the wiring test).

## Areas

- New area **Scheduled jobs** (`docs/areas/scheduled-jobs.md`, Lead decision): scope and *Not here* as in its index row
  in `docs/areas/README.md`. Written with this plan; re-checked against the code in the docs group.
- Notifications, Storage, GitHub API, Deployment, HTTP routes: pointers and enumerations (below).

## Documentation updates

Sweep: `grep` over `docs/areas/*.md`, `docs/ARCHITECTURE.md`, `README.md`, `SECURITY.md`, `.squad/project.md` for "cron",
"scheduled", "unauthenticated", "every other GitHub call", "only calls", "update notice", "retried", "does nothing".

| File | Edit | Owner |
| ---- | ---- | ----- |
| `docs/areas/scheduled-jobs.md` | new (done); re-check against the code | Lead |
| `docs/areas/README.md` | new index row (done); Notifications *Not here* "the cron retry" → Scheduled jobs; Deployment *Not here* "What the cron jobs do" → Scheduled jobs | Lead |
| `docs/areas/notifications.md` | *Scope* and *Not here*: link Scheduled jobs instead of `ARCHITECTURE.md`; *Sending a row*: the fifth attempt marks the row `failed`; *Languages*: the tables hold the release notice texts; *Log entries*: the `{ outbox, status: "failed" }` entry | Lead |
| `docs/areas/storage.md` | `meta` row `notified_release` (format `A.B.C`, written only by the release check, never lowered, kept by the reset); `outbox` `failed` after 5 attempts; `token_cache` expired rows removed by the cleanup; *Not here* → Scheduled jobs | Lead |
| `docs/areas/github-api.md` | *Not here*: `token_cache` cleanup and the release check → Scheduled jobs; "the one unauthenticated GitHub request" → one of two | Lead |
| `docs/areas/deployment.md` | *Cron triggers*: the handler runs the jobs of Scheduled jobs; *Not here* | Lead |
| `docs/areas/http-routes.md:67` | the release answer is read with the same bounded reader | Lead |
| `docs/ARCHITECTURE.md` | component row *Cron*, step 4 ("retries … up to the fifth attempt"), *Cron triggers* table (link the area and 0029/0030; daily job sends the notice), *Security model* ("the Worker's one unauthenticated GitHub call" → two, the release check named), guarantee sentence | Lead |
| `.squad/project.md` | *GitHub App authentication*: "every GitHub call except the manifest conversion and the release check (`src/github/release.ts`: fixed URL, no credential, same request rules, narrowed to `tag_name`)"; *Encrypted credentials*: expired `token_cache` rows deleted by the cleanup; *Logging of external data*: the job entries and the marked-failed entry; *Guarantees*: "unsent rows are retried up to the fifth attempt, then marked failed" (decision 0029) | Dev |
| `README.md` | event table: release notice "available"; drop the sentence "The switches for notifications that arrive in a later release …"; *Status* sentence names release notices | Dev |
| `CHANGELOG.md` | `## [Unreleased]` → `### Added`: retry with `failed` after the fifth attempt, cleanup of old rows, the daily release notice (switch "Notice about a new Seluna release") | Dev |
| `test/fixtures/github/README.md` | row for `release-latest.json` | Tester |

## Architecture check

- *Unsent rows are retried* (`.squad/project.md` *Guarantees*, decision 0008) gains the bound of 5 attempts that issue
  #18 itself prescribes; recorded in decision 0029 (amends 0008) and in the guarantee text — no weakening beyond the
  Product Manager's own requirement.
- *Matched event written to the outbox before delivery*: the notice is an outbox row too, written before its send.
- *A delivery is processed once*: `deliveries` rows are kept 7 days; GitHub redelivers only within 3 days.
- *One instance per user*: the new call reads a public repository and sends only `User-Agent: seluna/<version>`.

## Security considerations

- [x] Limits: the release answer is limited to 1 MiB of raw bytes before decoding (existing reader); the 9-digit
  bound and the pattern apply to the decoded `tag_name` string.
- [x] Exceptions that reach a user-visible text: none. D1 errors, fetch errors and parse failures become the fixed
  results of *Signatures*; nothing of an answer or an error reaches a message or a log.

## Decision records

- `docs/decisions/0029-outbox-retry-and-cleanup-by-the-cron.md` (Proposed; amends 0008)
- `docs/decisions/0030-release-notice-without-credentials.md` (Proposed)

## Out of scope / follow-ups

As in the spec's *Out of scope*. No follow-up issue: #19 (one-click updates) and #69 (channel-neutral outbox) exist.
