# Plan: Fork and star rules with a digest

Source: Issue #110 | [spec.md](spec.md)
Status: Revised (1)
Tier: security — raised from standard by Security's plan review: the plan rewrites `renderTelegramText`, the output-escaping guard (`.squad/routing.md`, *Tiers*); a Security diff review runs in step 8, and the Tester runs on `opus` (`.squad/team.md`).
Plan size: a new table, cron job, message-model change and settings field in seven groups, plus the answers to Security and the challenge.
Security areas touched: Parsing of external input (`src/notification.ts` `decodeStoredNotification`/`encodeStoredNotification` with the new `lines`, `renderTelegramText` in `src/message.ts`, new payload fields stored by `src/store/activity.ts`, digest lines built in `src/digest.ts`); Logging of external data (new request-log decision `collected`, new scheduled log entry `{ job: "digest", result: "store-failed" }`); Setup login (the settings form in `src/setup/`, with its session and CSRF unchanged); Outbound delivery channels (the cron sends a new, longer message kind through `deliverMessages`, `src/activity-digest.ts`)

## Problem / root cause

Feature: see [spec.md](spec.md) (status *Approved by Product Manager*).

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | The owner and bot helpers exist, and the owner is read once per delivery | `src/rules/actor.ts` `isOwnAction`, `isBotSender`; `src/rules/issue.ts:47` `isForeignSender`; `src/webhook.ts:131` `readOwner` | confirmed |
| 2 | The app receives `fork` and `star` | `src/github/manifest.ts:30-31` | confirmed |
| 3 | The 10-minute cron runs cleanup, then retry; each job catches its own failures | `src/scheduled.ts:39-58,78-92` | confirmed |
| 4 | Decision 0025 is accepted, and quiet hours are decided per row at send time | `docs/decisions/0025-*`; `src/delivery.ts:73-80` | confirmed |
| 5 | The next free migration is `0002`; #69 added none | `migrations/` holds only `0001_initial_schema.sql`; decision 0038 option 1 | confirmed |
| 6 | The issue says the fork and star fixtures are real | `test/fixtures/fork/README.md`, `test/fixtures/star/README.md` say reference-built; `star/deleted.json` is absent; the Product Manager chose reference-built (spec *Open questions*) | refuted |
| 7 | A delivery's rows, its `deliveries` insert and `last_delivery` are one D1 batch | `src/store/deliveries.ts:40-47` | confirmed |
| 8 | The release check writes its outbox row in a transaction and sends it itself through `deliverMessages` | `src/release-check.ts:96-115` | confirmed |
| 9 | The retry skips rows younger than 60 s | `src/outbox-retry.ts:9,29` | confirmed |
| 10 | `cleanUpRows` is one batch, so one failing statement (a missing table) fails all three deletes | `src/cleanup.ts:12-19` | confirmed |
| 11 | A stored notification has five fields, and unknown JSON keys are ignored when it is decoded | `src/notification.ts:8-14,44-68` | confirmed |
| 12 | The settings are read per row with defaults, and the form writes all rows in one batch | `src/settings.ts:120-150`; `src/store/settings.ts:55-58` | confirmed |
| 13 | The fixtures carry `repository.id` 2000, `sender.id` 1000002 (type `User`) and `forkee.full_name`/`html_url` | `test/fixtures/fork/fork.json`, `test/fixtures/star/created.json` | confirmed |
| 14 | SQLite `AUTOINCREMENT` never reuses an id, while a plain `INTEGER PRIMARY KEY` may reuse the largest id after a delete | SQLite documentation, *autoinc.html* | confirmed |
| 15 | Production D1 runs window functions (`ROW_NUMBER`, `COUNT(*) OVER ()`) and `AUTOINCREMENT` as the local Workers pool does | to verify: the Tester's `src/store/activity.test.ts` exercises them locally (step 4); production by the Product Manager's live check (a digest on a deployed copy, before ready) | unverified |
| 16 | The documented budget counts D1 statements as subrequests: at most 18 D1 statements and 20 Telegram requests per 10-minute run, inside 50 | `docs/areas/scheduled-jobs.md:135-136` | confirmed |
| 17 | A cron invocation on the free plan has a CPU limit of about 10 ms | to verify: the Dev reads Cloudflare's Workers limits page in step 6; the due check's `Intl` conversions are bounded and counted by tests either way (AC7) | unverified |
| 19 | `deliverOne` logs `store-failed` and leaves the row `pending` when `markSent` fails after a successful send, so the retry sends it again | `src/delivery.ts:108-117` | confirmed |
| 20 | SQLite's bare-column rule applies only to a query with exactly one `min()` or `max()` aggregate | SQLite documentation, *lang_select.html*, bare columns | confirmed |
| 18 | The real `fork`, `star` `created` and `star` `deleted` payloads have the field paths the rules read | to verify: the Product Manager's live check on a deployed copy before the pull request is marked ready (decision 0040 practice) | unverified |

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | star `created` and fork by another account give the S2 and S3 notification, en and de, with `activity` set; owner, bot, organization and unknown owner (helpers from `test/issue.ts`) | `src/rules/repository-starred.test.ts`, `src/rules/repository-forked.test.ts` |
| AC1 | under *Immediately*, a star delivery writes one outbox row and no `activity` row (decision `reported`) | `src/webhook.test.ts` |
| AC2 | each malformed field of E1 (no `forkee`, non-string names, unsafe ids, missing `sender.type`, a `fork` with an `action`, another star action) gives `undefined`; `stargazers_count` of `-1`, `1.5`, `"5"`, 2^53 and absent leaves out line 3; hostile login and repository (markup, U+202E written as `\\u202E`, 300 code points) are cleaned and escaped in the stored row and the rendered digest | `src/rules/activity.test.ts`, `src/rules/repository-starred.test.ts`, `src/digest.test.ts`, `src/store/activity.test.ts` |
| AC3 | *Hourly* and *Daily*: a star or fork gives one `activity` row and no outbox row, decision `collected`, `deliveries` recorded; switch off gives `disabled` and no row; redelivery gives nothing; a failing batch gives 503 and nothing stored | `src/webhook.test.ts`, `src/store/deliveries.test.ts` |
| AC4 | 50 stars and 2 forks collected, then one job run at the next full hour, gives exactly one outbox row with the S4 line; *Immediately* with 50 stars gives 50 outbox rows | `src/activity-digest.test.ts`, `src/webhook.test.ts` |
| AC5 | the digest's title, line order, ties by name, 10-line cap with "more repositories", 5 names with "and N more" counted per distinct account, empty parts left out, 256-code-point cut, button only for one repository, en and de, digit grouping (`1,234`/`1.234`, `1 star`/`1 fork`); 10,000 events counted exactly in one summary read; events older than 7 days are left out of both reads and deleted by the commit; the rendered text stays at most 4,000 UTF-16 code units with 11 lines of 256 astral code points (lines dropped into "and N more repositories") | `src/digest.test.ts`, `src/store/activity.test.ts`, `src/i18n/messages.test.ts` |
| AC5 | `lines` encoded, decoded (more than 11, or a non-string, makes the row damaged) and rendered after line 3, with the line-1 `·` left out for an empty repository | `src/notification.test.ts`, `src/message.test.ts` |
| AC6 | unstar under each interval removes only that account's stars on that repository (other account, other repository and forks stay); star then unstar leaves no row; unstar then star leaves one; owner, bot and switch off remove nothing; an unstar never writes an outbox row | `src/rules/repository-starred.test.ts`, `src/webhook.test.ts` |
| AC7 | `isDigestDue` cases: hourly at :00 in UTC, `Asia/Kolkata` and `Asia/Kathmandu`; daily 18:00 `Europe/Berlin`; a late run catches up once; a gap of days; the fall-back day (hourly two times, daily once) and the spring day (daily 02:30 at the first run after the change, hourly nothing extra) for `Europe/Berlin` 2026-03-29 and 2026-10-25; a spy on `Intl.DateTimeFormat.prototype.formatToParts` counts at most 50 conversions on the worst-case interval (hourly gap of 120 minutes and daily gap of 1,500 minutes, each across the fall-back day), none for gaps of 121 (hourly) and 1,501 (daily) minutes, and one formatter built per call (spy on `Intl.DateTimeFormat`); job: no stored run time means nothing sent and the run time stored; empty digest time then an event gives no digest before the next time; digest sent silent inside quiet hours | `src/digest-schedule.test.ts`, `src/activity-digest.test.ts` |
| AC8 | job: *Hourly* to *Daily* and a change of time and time zone keep the rows and wait for the new digest time; *Immediately* sends the leftover rows at the next run; both switches off keep the rows and only store the run time | `src/activity-digest.test.ts` |
| AC9 | a D1 wrapper inserts a star when the job calls `batch`, after deleting the largest counted row: the new row stays and the next digest counts it | `src/activity-digest.test.ts` |
| AC10 | a failing summary read, or a failing batch, sends nothing, keeps the rows and stores no run time; `runScheduled` still runs cleanup and retry and logs `{ job: "digest", result: "store-failed" }`; a digest that is not delivered stays `pending`, and the retry sends it after 60 s without a second digest; rows older than 7 days are deleted while a switch is on (also under *Immediately*, by the commit) and kept while both are off; 10 due rows answered 429 twice plus a due digest: 20 Telegram requests, the digest row written `pending` and unsent, sent by the next run's retry | `src/activity-digest.test.ts`, `src/scheduled.test.ts`, `src/outbox-retry.test.ts` |
| AC11 | the settings round trip and invalid stored values (`daily@24:00`, `daily@`, `weekly`) fall back to `daily@18:00`; the new switches default off and stored ones keep their values; the form parses `activity_digest`/`digest_time`, and missing, repeated, unknown or invalid-time fields give `undefined`; the page shows the field, the stored values and 18:00; a 400 shows the new notice text | `src/settings.test.ts`, `src/store/settings.test.ts`, `src/setup/settings-form.test.ts`, `src/setup/pages.test.ts`, `src/setup/handler.test.ts` |
| AC12 | `SCHEMA_TABLES` lists exactly the migrated tables, `activity` included; the applied migrations are `0001` and `0002`, `activity` has the plan's columns, its `kind` CHECK rejects other values and both indexes exist; without the table, a digest-mode star answers 503, an *Immediately* star still reports, an unstar answers 503, and the job logs `store-failed` with a switch on and touches nothing with both off | `src/store/schema.test.ts`, `test/migrations.test.ts`, `src/webhook.test.ts`, `src/activity-digest.test.ts` |
| AC13 | none: documentation; the Reviewer checks the list under *Documentation updates* in step 8 | — |

## Approach

**Rules (pure).** `REPOSITORY_STARRED` (event `star`, action `created`) and `REPOSITORY_FORKED` (event `fork`, no
`action` key) return the S2/S3 notification with an `activity` field. The processing, not the rule, decides
between outbox and `activity` by `settings.activityDigest`. `starRemovalOf` (event `star`, action `deleted`, switch
`repository_starred` on, foreign sender) returns the account and repository ids. Shape narrowing goes in
`src/rules/activity.ts` and reuses `isForeignSender` (sender id a safe integer, string type, not owner, not bot),
plus a string `sender.login`. The repository needs a safe-integer `repository.id`, a string `full_name`, and
`html_url` used only through `buttonUrl`. A count is valid for 0…2^53 − 1. RULE_IDS and RULES append
`repository_starred`, then `repository_forked`, both off in `DEFAULT_SETTINGS.rules`.

**Webhook.** `processWebhook` splits the notifications: one with `activity`, under an interval other than
`immediate`, becomes an `activityInsert`, and every other one an outbox row. `recordDelivery` takes the inserts and
the removal in the same batch, placed after the outbox inserts and before `last_delivery`. The decision is
`collected` when the batch wrote `activity` rows and no outbox rows. An unstar alone is `no-match`.

**Storage.** Migration `migrations/0002_activity.sql`:
`CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('star','fork')), sender_id INTEGER NOT NULL, sender_login TEXT NOT NULL, repository_id INTEGER NOT NULL, repository TEXT NOT NULL, repository_url TEXT, star_count INTEGER, created_at INTEGER NOT NULL)`,
with the indexes `activity_repository_sender (repository_id, sender_id)` and `activity_created_at (created_at)`.
`activityInsert` stores `cleanField(login, 64)`, `cleanField(repository, 140)`, the `buttonUrl()` of the repository
URL or NULL, the star count only for a star, and `created_at` = the delivery's time. `readDigestSummary` makes two
reads:

- (a) `max_id` over all rows, then per `repository_id` over rows with `id <= max_id` and `created_at >= notBefore`
  (the run's start minus `ACTIVITY_RETENTION_MS`): stars, forks, `COUNT(DISTINCT sender_id)`, and
  `COUNT(*) OVER ()` for the total. The name and URL of the newest event and the `star_count` of the newest star
  come from correlated subqueries (`ORDER BY id DESC LIMIT 1`), not bare columns (fact 20). Ordered by stars +
  forks descending, then the name (binary collation), `LIMIT 10`.
- (b) Rows with the same `id <= max_id` and `created_at >= notBefore` filter and those repository ids: each account's
  first event (`MIN(id)` as the only aggregate, so the bare login is that row's), ranked with
  `ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY MIN(id))`, keeping `rn <= 5`.

`readDigestSummary` answers `undefined` for an empty table, and a summary without repositories when only stale rows
exist. The commit batch holds the outbox insert (left out without repositories),
`DELETE FROM activity WHERE id <= max_id` (stale rows go unsent, also under *Immediately*) and `digestRunUpsert`. The `meta`
key is `activity_digest_run` (decimal ms, read like `last_delivery`).

**Digest job** (`runActivityDigest`, in the 10-minute run after retry, its own `try`; `sendNow` is true when the
retry handed fewer than `RETRY_BATCH_SIZE` rows to `deliverMessages`):

1. Read the settings.
2. With both switches off, write only `digestRunUpsert` and stop (`off`).
3. Read the run time. When it is absent, store this run and stop (first run).
4. `isDigestDue` is false: one batch with `oldActivityDelete` (7 days, ≤ 1,000, oldest first) and the upsert
   (`nothing-due`).
5. Due: read the summary. `undefined`: upsert only (`empty`). Without repositories: commit without an outbox row
   (`empty`). Otherwise build `digestNotification` in the settings language and commit. With `sendNow`, call
   `deliverMessages` with the one row (`sent`). Without it, leave the row `pending` for the next run's retry
   (`queued`).

Any D1 error returns `store-failed` and stores no run time, so the next run evaluates again.

Budget, counted as `scheduled-jobs.md` counts: a retry that sends r rows uses at most 8 + r D1 statements and 2r
Telegram requests (18 and 20 at r = 10). The digest's due path uses 7 statements (settings, run time, 2 summary
reads, a batch of 3), plus 5 for its send (channel, token batch of 2, chat, mark) and 2 Telegram requests.
- r ≤ 9 with a send: at most 17 + 18 + 12 + 2 = 49.
- r = 10 without a send: 38 + 7 = 45.

Both stay under 50, so no statement or request of the run is refused. A digest is then sent at most 10 minutes
after its digest time, or 20 minutes when that run's retry was full. Option (a) of the challenge; the other two
options are in 0041.

**Digest times** (`isDigestDue(digest, timeZone, previousRun, now)`, pure): `immediate` is always true, and
`now <= previousRun` is false. Otherwise it applies spec E8 (hourly: instants with local minute 00; daily: the
first instant of each local date at or after HH:MM) on the interval (previousRun, now]. A gap of more than 1,500
minutes is true for daily, and a gap of more than 120 minutes for hourly, both without a conversion. Otherwise
there is no minute-by-minute scan, and a call makes at most 50 conversions (fact 17). `wallClockReader(timeZone)`
builds one `Intl.DateTimeFormat` and returns a function giving the local date and minute of day, an unusable zone
read as UTC. `isDigestDue` builds one reader per call. `isQuietTime` (`src/quiet-hours.ts`) moves onto it with one
reader per call. Daily-time candidates come from the offsets at `previousRun` and at `now`: the
earlier valid one for a repeated time, and the change instant for a skipped one.

**Message model.** `StoredNotification.lines` is optional and holds at most 11 entries. It is encoded as the key
`lines` after `context`, only when non-empty, and a row whose `lines` is not an array of at most 11 strings is
damaged. `renderTelegramText` leaves out ` · <repository>` when the cleaned repository is empty, then renders
`subject`, `context` and each line (cleaned to 256, escaped, empty ones skipped), separated by `\n`. A digest has
an empty `repository`, `subject` and `context`. All its repository lines, at most 10 plus `and N more
repositories`, are in `lines`, so at most 11. An older version sends it as its title alone (0041).

**Digest layout** (fixed by S1, S4, S5):

- Line 1 is the bold title alone. One line per repository: `<repository>: <star part>, <fork part> · <names>`,
  where the star part is `+N ⭐` plus ` (now X)` (German ` (jetzt X)`) when the count is known, and the fork part
  is `+N fork`/`+N forks` (`Fork`/`Forks`). An empty part is left out together with its `, `.
- `<names>` are joined with `, `, then ` and K more` (` und K weitere`) when K > 0.
- With more than 10 repositories the last line is `and N more repositories` (`und N weitere Repositories`).
- Each line is cleaned with `cleanField(…, 256)`. The button is the repository's `buttonUrl` for exactly one
  repository, and absent otherwise. Digits are grouped by `groupDigits`.
- **Length:** the uncapped worst case is title 64 + 11 × 256 code points, which is 2,880 code points and up to
  5,760 UTF-16 code units with astral characters, against Telegram's 4,096 characters after entity parsing.
  `digestNotification` drops repository lines from the end, counting them into `and N more repositories`, until
  title, lines and line feeds hold at most 4,000 UTF-16 code units. `notifications.md` (*Message format*) states
  this. With ASCII logins and repository names the cap is never reached (about 2,900).

**Settings form layout:** after the rules fieldset and before the submit button:

```html
<fieldset class="group">
<legend>Stars and forks</legend>
<select id="activity_digest" name="activity_digest" aria-label="Stars and forks">…</select>
<label for="digest_time">Time</label>
<input id="digest_time" type="time" name="digest_time" value="…">
</fieldset>
```

Every interpolated value, the time included, is written with `escapeHtml`, as in the rest of `pages.ts`; the
snippet shows structure only.

- The three options are `immediate`/`hourly`/`daily`, labelled *Immediately*/*Hourly*/*Daily at* (German
  *Sofort*/*Stündlich*/*Täglich um*, *Uhrzeit*). The value shown is the stored time, or 18:00.
- Rule labels: `repository_starred` *New star on a repository* (*Neuer Stern für ein Repository*),
  `repository_forked` *New fork of a repository* (*Neuer Fork eines Repositorys*).
- The *settings invalid* text becomes exactly: en "The settings were not saved. Check the values: quiet hours need
  a start and an end in the form 22:00, and the two must differ; a daily digest of stars and forks needs a time in
  the form 18:00."; de "Die Einstellungen wurden nicht gespeichert. Prüfe die Werte: Ruhezeiten brauchen einen
  Beginn und ein Ende in der Form 22:00, und beide müssen sich unterscheiden; ein täglicher Überblick über Sterne
  und Forks braucht eine Uhrzeit in der Form 18:00."

**Message texts:**

- Titles: `New star`/`Neuer Stern`, `New fork`/`Neuer Fork`, `New stars and forks`/`Neue Sterne und Forks`.
- `starsNow`: `1 star now`, `1,234 stars now` / `jetzt 1 Stern`, `jetzt 1.234 Sterne`.
- Line 2 of a star and line 3 of a fork reuse `byAuthor`.

## Options considered

Recorded in [0041](../../docs/decisions/0041-fork-and-star-rules-with-a-digest.md):

- A digest rather than a rate limit.
- An `activity` table rather than held outbox rows.
- Due after the previous run, rather than the last digest sent or the last digest time evaluated.
- `lines` in the stored notification, rather than one message per repository or two squeezed lines.
- Delete up to the largest id read, rather than an id list or deleting everything.
- Delete events older than 7 days in the digest job, rather than in the cleanup batch.
- `sender.login` for forks, rather than `forkee.owner.login`.
- Grouping digits by hand, rather than `Intl.NumberFormat`.
- Further options weighed here:
  - The rule reads the interval itself: rejected, because then a rule's output depends on delivery mechanics, and
    the processing already owns the outbox/table choice.
  - The digest job before the retry: rejected, because then the digest row (younger than 60 s) would wait for the
    next run anyway, and the retry's budget is the established one.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/settings.ts` | `ActivityDigest`, `activityDigest` setting, 2 rule ids |
| Worker | `src/rules/rule.ts`, `src/rules/activity.ts` (new), `src/rules/repository-starred.ts` (new), `src/rules/repository-forked.ts` (new), `src/rules/registry.ts` | rules, removal |
| Worker | `src/i18n/messages.ts`, `src/i18n/en.ts`, `src/i18n/de.ts` | texts, `groupDigits` |
| Worker | `src/notification.ts`, `src/message.ts` | `lines` |
| Worker | `src/digest.ts` (new), `src/digest-schedule.ts` (new), `src/wall-clock.ts` (new), `src/quiet-hours.ts` | digest building, due rule |
| Worker | `src/activity-digest.ts` (new), `src/scheduled.ts` | job, dispatch, log entry |
| Worker | `src/store/activity.ts` (new), `src/store/meta.ts`, `src/store/deliveries.ts`, `src/store/schema.ts`, `migrations/0002_activity.sql` (new) | storage |
| Worker | `src/webhook.ts` | split, `collected` |
| Worker | `src/setup/settings-form.ts`, `src/setup/pages.ts`, `src/setup/texts.ts` | form |
| Tests | `test/fixtures/star/deleted.json` (new), `test/fixtures/star/README.md`, `test/fixtures/fork/README.md` | reference-built fixture |

## Signatures (for the Dev's skeleton)

**src/settings.ts**
- `export type ActivityDigest = { readonly kind: "immediate" } | { readonly kind: "hourly" } | { readonly kind: "daily"; readonly time: string };`
- `NotificationSettings.activityDigest: ActivityDigest` (new required member)
- `export const DEFAULT_ACTIVITY_DIGEST: ActivityDigest`
- `export function activityDigestFromStored(value: string | undefined): ActivityDigest`
- `export function activityDigestToStored(digest: ActivityDigest): string`

**src/rules/rule.ts**
- `export interface ActivityEvent { readonly kind: "star" | "fork"; readonly senderId: number; readonly senderLogin: string; readonly repositoryId: number; readonly repository: string; readonly repositoryUrl: string; readonly starCount: number | undefined }`
- `Notification.activity?: ActivityEvent`
- `export interface StarRemoval { readonly senderId: number; readonly repositoryId: number }`

**src/rules/activity.ts**
- `export interface ActivityActor { readonly id: number; readonly login: string }`
- `export function foreignActorOf(payload: WebhookPayload, owner: OwnerAccount | undefined): ActivityActor | undefined`
- `export interface ActivityRepository { readonly id: number; readonly fullName: string; readonly url: string; readonly starCount: number | undefined }`
- `export function activityRepositoryOf(payload: WebhookPayload): ActivityRepository | undefined` (url empty when html_url is not a string)

**src/rules/repository-starred.ts, repository-forked.ts**
- `export const REPOSITORY_STARRED: Rule`
- `export function starRemovalOf(event: string, payload: WebhookPayload, settings: NotificationSettings, owner: OwnerAccount | undefined): StarRemoval | undefined`
- `export const REPOSITORY_FORKED: Rule`

**src/i18n/messages.ts** (members of `MessageTexts`, plus one function)
- `MessageTexts.repositoryStarred: string`
- `MessageTexts.repositoryForked: string`
- `MessageTexts.starsNow: (count: number) => string`
- `MessageTexts.activityDigestTitle: string`
- `MessageTexts.digestStars: (added: number, total: number | undefined) => string`
- `MessageTexts.digestForks: (added: number) => string`
- `MessageTexts.moreNames: (count: number) => string`
- `MessageTexts.moreRepositories: (count: number) => string`
- `export function groupDigits(value: number, separator: string): string`

**src/notification.ts**
- `StoredNotification.lines?: readonly string[]`
- `export const MAX_EXTRA_LINES = 11`

**src/digest.ts**
- `export interface DigestRepository { readonly repositoryId: number; readonly repository: string; readonly repositoryUrl: string | undefined; readonly stars: number; readonly forks: number; readonly starCount: number | undefined; readonly accounts: number; readonly names: readonly string[] }`
- `export interface DigestSummary { readonly maxId: number; readonly repositories: readonly DigestRepository[]; readonly totalRepositories: number }`
- `export const DIGEST_MAX_REPOSITORIES = 10`
- `export const DIGEST_MAX_NAMES = 5`
- `export function digestNotification(summary: DigestSummary, language: Language): { readonly notification: StoredNotification; readonly buttonUrl: string | undefined }`

**src/wall-clock.ts, src/digest-schedule.ts**
- `export interface WallClock { readonly date: string; readonly minuteOfDay: number }`
- `export function wallClockReader(timeZone: string): (at: Date) => WallClock | undefined`
- `export function isDigestDue(digest: ActivityDigest, timeZone: string, previousRun: Date, now: Date): boolean`

**src/store/activity.ts**
- `export const ACTIVITY_RETENTION_MS = 604_800_000`
- `export function activityInsert(db: D1Database, event: ActivityEvent, createdAt: Date): D1PreparedStatement`
- `export function starRemovalDelete(db: D1Database, removal: StarRemoval): D1PreparedStatement`
- `export async function readDigestSummary(db: D1Database, notBefore: Date): Promise<DigestSummary | undefined>`
- `export function countedActivityDelete(db: D1Database, maxId: number): D1PreparedStatement`
- `export function oldActivityDelete(db: D1Database, createdBefore: Date, limit: number): D1PreparedStatement`

**src/store/meta.ts, src/store/deliveries.ts**
- `export const DIGEST_RUN_META_KEY = "activity_digest_run"`
- `export async function readDigestRun(db: D1Database): Promise<Date | undefined>`
- `export function digestRunUpsert(db: D1Database, time: Date): D1PreparedStatement`
- `export interface ActivityChanges { readonly inserts: readonly ActivityEvent[]; readonly removals: readonly StarRemoval[] }`
- `export async function recordDelivery(db: D1Database, delivery: NewDelivery, messages: readonly NewOutboxRow[], activity?: ActivityChanges): Promise<RecordDeliveryResult>`

**src/activity-digest.ts, src/scheduled.ts, src/webhook.ts, src/setup/texts.ts**
- `export type DigestJobResult = "sent" | "queued" | "nothing-due" | "empty" | "off" | "store-failed"`
- `export async function runActivityDigest(startedAt: Date, deps: DeliveryDeps, sendNow: boolean): Promise<DigestJobResult>`
- `export interface RetryOutcome { readonly result: RetryResult; readonly attempted: number }` (src/outbox-retry.ts)
- `export async function retryPendingRows(startedAt: Date, deps: DeliveryDeps): Promise<RetryOutcome>`
- `ScheduledLogEntry |= { readonly job: "digest"; readonly result: "store-failed" }`
- `WebhookDecision |= "collected"`
- `SetupTexts.activityDigestLabel: string`
- `SetupTexts.activityDigestOptions: Readonly<Record<ActivityDigest["kind"], string>>`
- `SetupTexts.digestTimeLabel: string`

Existing files the skeleton leaves as they are, which the Dev rewrites: src/quiet-hours.ts (onto wallClockReader);
in src/settings.ts settingsFromStored, settingsToStored and SETTING_KEYS (the new row); in
src/setup/settings-form.ts parseSettingsForm; src/webhook.ts processWebhook; src/scheduled.ts runScheduled.

## Test files

New: `src/rules/activity.test.ts`, `src/rules/repository-starred.test.ts`, `src/rules/repository-forked.test.ts`,
`src/digest.test.ts`, `src/digest-schedule.test.ts`, `src/wall-clock.test.ts`, `src/activity-digest.test.ts`,
`src/store/activity.test.ts`, and the helper `test/activity.ts` (fixture variants, a `D1Database` wrapper whose
`batch` runs a hook first). Extended: `src/webhook.test.ts`, `src/store/deliveries.test.ts`, `src/store/meta.test.ts`,
`src/store/schema.test.ts`, `src/notification.test.ts`, `src/message.test.ts`, `src/i18n/messages.test.ts`,
`src/scheduled.test.ts`, `src/settings.test.ts`, `src/store/settings.test.ts`, `src/setup/settings-form.test.ts`,
`src/setup/pages.test.ts`, `src/setup/handler.test.ts`, `src/rules/registry.test.ts`, `src/quiet-hours.test.ts`
(kept unchanged: same behavior). Fixture: `test/fixtures/star/deleted.json`, reference-built from GitHub's `star`
`deleted` documentation (the `created.json` names, `starred_at` `null`). The Tester writes it and updates both
fixture READMEs.

Existing test call sites the Tester adapts:

- The `NotificationSettings` literals gain `activityDigest`: `src/settings.test.ts:25`,
  `src/store/settings.test.ts:91`, `src/setup/handler.test.ts:3609`, `src/setup/pages.test.ts:2540`,
  `src/setup/settings-form.test.ts:49`.
- Tests pinning the rule list, order or "on by default": `src/settings.test.ts:36,68`, `src/rules/registry.test.ts`,
  and the "eleven rules" in `src/setup/pages.test.ts`.
- Form posts without `activity_digest` now answer 400 and gain the field: `src/setup/handler.test.ts`,
  `src/setup/settings-form.test.ts`.
- `src/scheduled.test.ts` request counts for `*/10`; `src/outbox-retry.test.ts` expects `{ result, attempted }`
  instead of `"done"` (lines 113-153 and on).
- `test/migrations.test.ts`: `0002_activity.sql` among the applied migrations (:79-81); seven tables (:88-91);
  `activity` in `TABLES` with its columns (:17-52), its `kind` CHECK and both indexes (:105-116).
- `src/store/settings.test.ts:120,136`: "fifteen settings" and `toBe(15)` become eighteen. `src/settings.test.ts:5`:
  `ALL_RULES_OFF` gains the two ids.
- `src/webhook.test.ts:716-738`: fork and star with `RULES` change from `no-match` to `disabled` (the new rules
  are off by default).

Code a unit test cannot cover: none.

## Areas

- `notifications.md`: new *Fork and star rules*; a *Digest* section (collecting, unstar, layout); *The sender*;
  *Message format* (`lines`, line 1 without a repository, the digest's worst case and its 4,000-unit cap); *Languages*; *Log entries* (`collected`).
- `scheduled-jobs.md`: *Schedules* (cleanup, retry, digest), a new *Digest* section (digest times, first run,
  catching up, failures, deletion of events older than 7 days), *Log entries*, *Limits and errors* (the budget of
  *Approach*: at most 49 per run, the digest left to the next retry after a full retry).
- `storage.md`: the `activity` table, migration `0002`, the settings rows (eighteen), the `meta` row
  `activity_digest_run`.
- `setup-wizard.md`: the form fields and validation (*Status and settings*, the "eleven rules" at lines 193 and
  587), the *settings invalid* text in *Texts*.

## Documentation updates

All are the Dev's, written once the code is green:

- the four area documents above;
- `docs/ARCHITECTURE.md`:
  - the components table: *Rules* (stars and forks), *Cron* (digest);
  - flow step 3 and the mermaid diagram (`C -->|retry, clean up, digest|`);
  - *Cron triggers* (the 10-minute row);
  - *D1 tables* ("All six tables" becomes seven, `activity` from `0002`), linking decision 0041;
- `README.md`: the event table row "A new star or fork (not your own and not a bot's), at once or as an hourly or
  daily digest", and the settings table rows (*New star*, *New fork*: off; *Stars and forks*: daily at 18:00);
- `docs/setup.md`: the settings sentence (digest field, the switches off by default);
- `migrations/README.md`: the `0002_activity.sql` entry;
- `CHANGELOG.md` under *Added*: the rules, the digest and the setting. The "`fork` and `star` send no message yet"
  clause of the #108 entry goes;
- `.squad/project.md`, *Parsing of external input*: stored activity fields cleaned in `src/store/activity.ts`,
  digest lines in `src/digest.ts`, `lines` decoded in `decodeStoredNotification`; *Test doubles*, *Real GitHub
  payloads*: add `star/deleted.json`. The Tester updates the fixture READMEs.

## Architecture check

- *A draft triggers nothing*: not touched.
- *Invalid signature has no effect*: unchanged.
- *Processed once*: the `activity` insert is in the `deliveries` batch, so a redelivery collects nothing (AC3).
- *Outbox before delivery*: the digest row is committed before its send and retried up to the fifth attempt.
- *Data stays in the user's account*: yes.

The digest row skips the outbox only while it waits as collected events, and decision 0041 records that. The new
table follows *Integration surface* (migration, store module, `SCHEMA_TABLES`, ARCHITECTURE list). The cron
expressions are unchanged.

## Security considerations

- [ ] Limits: the code-point limits of `cleanField` (64 login, 140 repository, 256 line) count decoded text after
  `JSON.parse`; `lines` at most 11 entries. No byte limit is new.
- [ ] Exceptions reaching the user: none. A D1 or rule error in the webhook answers 503 without a body; the job
  logs only `store-failed`.

## Decision records

- `docs/decisions/0041-fork-and-star-rules-with-a-digest.md` (Proposed, indexed). It amends 0038 (`lines`) and
  settles 0039's open point for forks and stars.

## Out of scope / follow-ups

- The spec's *Out of scope*.
- Issue #121 (do not record deliveries no rule reads): an unstar now reads state, which #121's design must keep.

## Security review

- B1 (tier): accepted. Tier `security`; Security reviews the diff in step 8, and the Tester runs on `opus`.
- N1 (length, channels): accepted. The worst case and the 4,000-unit cap are under *Approach* (*Digest layout*),
  `notifications.md` states them, and AC5 tests them. *Outbound delivery channels* is added to the areas.
- N2 (CPU bounds): accepted. AC7 counts the conversions on the worst-case intervals and the shortcuts.
- N3 (escaping): accepted. The time value goes through `escapeHtml`; the snippet is structure only.
- Read (b) filter: accepted. `id <= max_id` and `created_at >= notBefore`.

## Challenge

- 1 (major, budget): accepted, option (a). The digest sends only when the retry handed fewer than 10 rows to
  `deliverMessages` (`RetryOutcome.attempted`), giving a worst case of 49. Fact 16 is now confirmed, and the
  `scheduled.test.ts` case is under AC10. The spec NFR and E8's timing say "up to 20 minutes when the retry was
  full". Option (b) makes the retry build the digest inside its batch, and (c) costs retry throughput on every due
  run (0041).
- 2: accepted. The call sites are under *Test files*.
- 3: accepted (*Message model*).
- 4: accepted. Correlated subqueries in (a), the filter in (b).
- 5: accepted. One formatter per `isDigestDue` call (`wallClockReader`).
- 6: accepted. Both reads leave out rows older than 7 days, and the commit deletes them, so no extra statement is
  needed. The digest-length sentence is in `notifications.md` (N1).

## Security notes

- Have the skeleton's doc comment on `RetryOutcome.attempted` say what it counts: the rows handed to `deliverMessages`, and 0 when the retry fails before that. The budget's correctness rests on this, and today it can only be inferred from the code. (squad-security, plan round 2, non-blocking)
