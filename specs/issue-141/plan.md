# Plan: Tell the owner when the hourly bound drops deliveries

Source: Issue #141
Status: Draft
Tier: standard — a new user-visible message on the `limited` path of `processWebhook`; the bound itself (the counter statement and what is recorded) is unchanged, so no security control is created, changed or removed.
Security areas touched: Bound on deliveries of other senders (`processWebhook` in `src/webhook.ts`, its `limited` branch; a new `meta` statement in `src/store/meta.ts`)

## Problem / root cause

Past the hourly bound `processWebhook` (`src/webhook.ts:240-243`) only refreshes `last_delivery` and answers 202
`limited`; the log entry is the only trace, so the owner never learns that messages were left out. Decision 0043
option 11 left a notice to this issue. This is a missing behavior, not a defect in the bound.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | Issue: since #134 a delivery of `issues`, `issue_comment`, `star`, `fork` past 20 per event and UTC hour is dropped, leaving only the decision `limited`. | `src/webhook.ts:44` (`BOUNDED_DELIVERIES_PER_HOUR = 20`), `:240-243` (refresh `last_delivery`, return `limited`); `countBoundedDelivery` `src/store/meta.ts:131-151` counts per `Math.floor(time / 3,600,000)`. Incomplete: since #140 (`6c081a2`) `pull_request` and `workflow_run` are bounded too when a stranger caused them (`BOUNDED_EVENT_NAMES`, `src/store/meta.ts:118`; `isCountedDelivery`, `src/rules/stranger.ts:51-72`); the notice covers all six. | confirmed |
| 2 | Issue: this also applies to collaborators and, for an organization-owned App, its members. | `isCountedDelivery` returns `true` for the four events whoever the sender is (`src/rules/stranger.ts:57-61`); decision 0043 *Consequences*. Holds for the four events; not for pull requests of `OWNER`/`MEMBER`/`COLLABORATOR` authors, which are exempt (`:30-39`). | confirmed |
| 3 | A limited delivery writes no `deliveries`, `outbox` or `activity` row today, and its redelivery in a later hour can report it. | `src/webhook.ts:240-243` returns before `recordDelivery`; test `processWebhook reports a limited issue once when it is redelivered in the next hour` (`src/webhook.test.ts:2024`). | confirmed |
| 4 | A row written outside a delivery transaction (a system notice) is an established pattern: build a `StoredNotification` with fixed texts, write one `outbox` row, hand it to `deliverMessages`. | Release notice `src/release-check.ts:39-57, 100-115`; digest `src/digest.ts:84` (empty repository, title alone on line 1). | confirmed |
| 5 | `renderTelegramText` prints the title alone on line 1 when the repository is empty and skips empty lines. | `src/message.ts:74-89` | confirmed |
| 6 | `outboxInsert` is `INSERT … RETURNING id`, usable alone with `.first()`. | `src/store/outbox.ts:12-16` | confirmed |
| 7 | One conditional upsert decides a race between concurrent statements in D1 (one statement, one `meta.changes`). | Decision 0043 measurements for `countBoundedDelivery` and `refreshLastDelivery` (local workerd pool); tests `countBoundedDelivery counts exactly two of five concurrent calls at 18 of 20` (`src/store/meta.test.ts:423`); measured in the local pool only. | confirmed |
| 8 | The claim statement for an hour already claimed writes no row (`meta.changes` 0, `rows_written` 0). | to verify: the Tester asserts `meta.changes` and `meta.rows_written` of a second claim in the same hour in `src/store/meta.test.ts` (step 5); same mechanism as `refreshLastDelivery`'s no-op, measured 0/0 in the local pool (decision 0043); the real D1's billing stays unmeasured (residual). | unverified |
| 9 | Existing test doubles do not catch the new `meta` key: `counterFailingDb` throws only for values starting `delivery_count:`, `counterRows` selects `substr(key,1,15) = 'delivery_count:'`. | `src/webhook.test.ts:1766-1801`; hence the prefix `limit_notice:`. | confirmed |
| 10 | Decision 0043 is unreleased and is extended in place. | `git ls-remote --tags origin`: latest `v0.7.0` (2026-10-27); 0043 dated 2026-11-02, added in `f211304`; the bound's entry sits under `## [Unreleased]` in `CHANGELOG.md`. | confirmed |
| 11 | `NOW` of the webhook tests (`1_792_240_440_000`) lies in UTC hour 497844, i.e. 12:00–13:00 UTC. | 497844 mod 24 = 12 | confirmed |

## Acceptance criteria

- [ ] AC1: The first delivery of a bounded event that `withinBound` refuses in a UTC hour still answers 202 `limited`, records nothing of its own (no `deliveries` row, no `activity` change, counter unchanged), and writes exactly one `outbox` row — the limit notice of *Approach* for that event and hour in the notification language of the settings, `button_url` NULL, `silent` 0, `created_at` the time received — which it hands to `waitUntil` for sending. Holds for each of the six bounded events and for every case the existing `limited` tests cover.
- [ ] AC2: Every further refused delivery of the same event in the same UTC hour writes no row and sends nothing — also a redelivery of the first one, and also when two refused deliveries arrive concurrently (exactly one notice).
- [ ] AC3: Notices are per event and per UTC hour: a refused delivery of another event in the same hour gets its own notice, and the first refused delivery of the same event in the next UTC hour gets a new one.
- [ ] AC4: The notice texts are exactly those of *Approach* in English and German, for each of the six events; the hour 23 reads `between 23:00 and 00:00 UTC` (`zwischen 23:00 und 00:00 UTC`).
- [ ] AC5: A failure of the notice is ignored: when the claim write fails, or the row write fails after the claim, the answer stays 202 `limited`, `last_delivery` is still refreshed, nothing is sent; after a failed row write no further notice is sent for that event and hour.
- [ ] AC6: `claimLimitNotice` stores the hour as `limit_notice:<event>` and returns true when the row is missing or holds any other value; for the hour it already holds it returns false and changes nothing (`meta.changes` 0, `rows_written` 0); of five concurrent calls in one hour exactly one returns true; it touches no other `meta` row.
- [ ] AC7: `insertOutboxRow` writes one `pending` row with the notification as JSON (the form `outboxInsert` writes) and returns its id.

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | new: `processWebhook writes and sends one limit notice for the first limited issue of the hour and still answers 202 limited` (row text JSON, `button_url`, `silent`, `created_at`, Telegram text and no button, no `deliveries` row, counter, `limit_notice:issues` = `497844`); new: `processWebhook writes the limit notice in German when the notification language is German`; adapted (see *Test files*): the `it.each` `processWebhook answers 202 limited for $case when 20 deliveries of its event were counted this hour` (9 cases) and `… for a failed $case run when 20 workflow_run deliveries were counted this hour` (4 cases) now expect one notice row and one Telegram request with the case's notice text | `src/webhook.test.ts` |
| AC2 | new: `processWebhook sends one limit notice for three limited issues of one hour, a redelivery among them`; new: `processWebhook writes one limit notice for two concurrent limited issues` | `src/webhook.test.ts` |
| AC3 | new: `processWebhook sends one limit notice each for issues and comments past the bound in the same hour`; new: `processWebhook sends a new limit notice for the first limited issue of the next UTC hour` | `src/webhook.test.ts` |
| AC4 | new: `limitNotice returns the English notice of each bounded event for 12:00 to 13:00 UTC` (`it.each`, 6), `limitNotice returns the German notice of each bounded event` (`it.each`, 6), `limitNotice writes 23:00 and 00:00 for the last UTC hour of a day`, `limitNotice leaves the repository, the number and the further lines empty` | `src/limit-notice.test.ts` |
| AC5 | new: `processWebhook answers 202 limited and sets last_delivery when the limit notice claim fails`; new: `processWebhook answers 202 limited, sends nothing and sends no later notice that hour when the notice row write fails` | `src/webhook.test.ts` |
| AC6 | new: `LIMIT_NOTICE_META_PREFIX names the rows limit_notice:`, `claimLimitNotice stores the hour and returns true when no row is stored`, `claimLimitNotice returns false and writes nothing for a second claim in the same hour` (row unchanged; `meta.changes` and `meta.rows_written` read through a `D1Database` wrapper that records each statement's `run()` result — see *Signatures*), `claimLimitNotice returns true for the next hour and for a stored value of another form` (`it.each`: next hour, `abc`, empty, a later hour), `claimLimitNotice returns true for exactly one of five concurrent calls`, `claimLimitNotice keeps each event in its own row and leaves the delivery_count and last_delivery rows untouched` | `src/store/meta.test.ts` |
| AC7 | new: `insertOutboxRow writes a pending row with the notification as JSON and returns its id` | `src/store/outbox.test.ts` |

## Approach

`src/webhook.ts`: `withinBound` becomes `limitedEvent`, which returns the bounded event when the delivery is counted
and refused, else `undefined` (so the `limited` branch has the event as `BoundedEvent` without a second, uncoverable
check). In the `limited` branch, after `refreshLastDeliveryQuietly`, `sendLimitNoticeQuietly(event, settings,
receivedAt, deps)` runs, then the branch answers 202 `limited` as today:

1. `claimLimitNotice(db, event, receivedAt)`; false → return.
2. `notification = limitNotice(event, receivedAt, BOUNDED_DELIVERIES_PER_HOUR, settings.language)`.
3. `id = insertOutboxRow(db, { notification, buttonUrl: undefined, silent: false }, receivedAt)`.
4. `deps.waitUntil(deliverMessages([{ id, text: renderTelegramText(notification), buttonUrl: undefined, silent: false, notification }], settings, <the same delivery deps as the reported path>))`.

Any throw in 1–4 is caught and dropped (no log entry beyond the sent row's own). The claim comes first so a notice is
sent at most once per event and hour; a failed row write after the claim loses that hour's notice (accepted,
decision 0043). No new `WebhookDecision`.

`src/store/meta.ts`: `claimLimitNotice` runs
`INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE meta.value IS NOT excluded.value`
with `?1 = 'limit_notice:' || event` and `?2 = String(Math.floor(time.getTime() / DELIVERY_COUNT_WINDOW_MS))`; true
iff `meta.changes === 1`. The key is built only from `BoundedEvent`.

`src/limit-notice.ts` (pure, no I/O): the hour `h = time.getUTCHours()`; `from = HH:00` of `h`, `to = HH:00` of
`(h + 1) % 24`, two digits each.

**Layout** (a `StoredNotification`; repository `""`, number `undefined`, no `lines`, no button; rendered by
`renderTelegramText` as title alone, bold, on line 1, then line 2 and line 3):

| Field | English | German |
| ----- | ------- | ------ |
| title | `Notifications left out` | `Benachrichtigungen ausgelassen` |
| line 2 (`subject`) | `<kind>: more than <limit> between <from> and <to> UTC` | `<kind>: mehr als <limit> zwischen <from> und <to> UTC` |
| line 3 (`context`) | `Further ones in that hour are not reported; GitHub still shows them.` | `Weitere in dieser Stunde werden nicht gemeldet; GitHub zeigt sie weiterhin.` |

| Event | `<kind>` English | `<kind>` German |
| ----- | ---------------- | --------------- |
| `issues` | `Issues` | `Issues` |
| `issue_comment` | `Comments` | `Kommentare` |
| `star` | `Stars and unstars` | `Sterne und entfernte Sterne` |
| `fork` | `Forks` | `Forks` |
| `pull_request` | `Pull requests` | `Pull Requests` |
| `workflow_run` | `CI failures` | `CI-Fehlschläge` |

`<limit>` is the number passed in (20), written with `String`. Example, issues at `NOW` in English, as Telegram HTML:
`<b>Notifications left out</b>\nIssues: more than 20 between 12:00 and 13:00 UTC\nFurther ones in that hour are not reported; GitHub still shows them.`

The texts live in `src/i18n/en.ts` and `src/i18n/de.ts` through new `MessageTexts` members (*Signatures*). The notice is
sent at once also under a star and fork digest, and silent per the quiet hours at sending, like every row.

## Options considered

Weighed in decision 0043 (options 20–26): the notice per event and hour with a separate claim (chosen); a status page
line (the issue's alternative: seen only on a visit, and counting drops costs a write each); letting the counter count
one past the bound (changes the guard's statement); claim and row in one batch with a nonce (more SQL on every
dropped delivery for a loss that needs a D1 failure); row first or read-then-write (double notices under
concurrency); a notice at the end of the hour with the number dropped (a write per drop); the hour in the owner's time
zone (the bound counts UTC hours).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/webhook.ts` | `withinBound` → `limitedEvent`; `sendLimitNoticeQuietly`; the `limited` branch calls it |
| Worker | `src/store/meta.ts` | `LIMIT_NOTICE_META_PREFIX`, `claimLimitNotice` |
| Worker | `src/store/outbox.ts` | `insertOutboxRow` |
| Worker | `src/limit-notice.ts` (new) | `limitNotice` |
| Worker | `src/i18n/messages.ts`, `src/i18n/en.ts`, `src/i18n/de.ts` | four new `MessageTexts` members |

## Signatures (for the Dev's skeleton)

- `src/store/meta.ts`: `export const LIMIT_NOTICE_META_PREFIX = "limit_notice:";` and
  `export async function claimLimitNotice(db: D1Database, event: BoundedEvent, time: Date): Promise<boolean>` — TSDoc:
  "Claims the limit notice of `event` for the UTC hour of `time` in one conditional statement; true when this call
  changed the row. D1 errors are not caught." (The Tester reads `meta.changes`/`rows_written` for AC6 by running the
  same call against a `D1Database` wrapper that records each statement's `run()` result; no extra export.)
- `src/store/outbox.ts`: `export async function insertOutboxRow(db: D1Database, row: NewOutboxRow, createdAt: Date): Promise<number>` — rejects with a `TypeError` when the insert returns no numeric id.
- `src/limit-notice.ts`: `export function limitNotice(event: BoundedEvent, time: Date, limit: number, language: Language): StoredNotification` (`Language` from `src/setup/language`).
- `src/i18n/messages.ts`, `MessageTexts`: `readonly limitNoticeTitle: string;`, `readonly limitNoticeKinds: Readonly<Record<BoundedEvent, string>>;` (`import type { BoundedEvent } from "../store/meta"`), `readonly limitNoticeLine: (kind: string, limit: number, from: string, to: string) => string;`, `readonly limitNoticeContext: string;` — the skeleton fills `en.ts`/`de.ts` with the texts of *Approach* (data, not logic).
- `src/webhook.ts` (module-private, not part of the skeleton): `limitedEvent(db, event, payload, owner, time): Promise<BoundedEvent | undefined>`, `sendLimitNoticeQuietly(event: BoundedEvent, settings: NotificationSettings, time: Date, deps: WebhookDeps): Promise<void>`.

No existing file is final; the skeleton rewrites none beyond these additions.

## Test files

`src/webhook.test.ts`, `src/store/meta.test.ts`, `src/store/outbox.test.ts`, `src/limit-notice.test.ts` (new).

Existing tests whose input the new criteria handle differently — adapted by the **Tester** in step 5 (expectations
change; no signature changes):

- `src/webhook.test.ts:1859` `processWebhook records 20 issues of one hour and answers 202 limited for the 21st without a row or a message` → 21 `outbox` rows (the 21st is the notice), 21 `waitUntil` calls, 21 Telegram requests; rename to drop "without a row or a message".
- `:1971` `it.each` `processWebhook answers 202 limited for $case when 20 deliveries of its event were counted this hour` (9 cases) → one notice row with the case's kind, one `waitUntil`, one Telegram request.
- `:2024` `processWebhook reports a limited issue once when it is redelivered in the next hour` → 2 `outbox` rows and 2 Telegram requests (the notice, then the issue).
- `:2217` (pull requests, as `:1859`), `:2323` `it.each` (4 failed-run cases, as `:1971`), `:2403` (as `:2024`).

Unchanged (no limited delivery, or no outbox assertion): `:1984`, `:1994`, `:2008`, `:2106`, `:2152`, `:2198`,
`:2246`, `:2343`, `:2379`; `src/store/meta.test.ts` `countBoundedDelivery` tests; `src/i18n/messages.test.ts`
(gets no new test; the key parity is enforced by the type).

Files no unit test can cover: none.

## Areas

- `docs/areas/notifications.md` — the notice (*Processing a delivery* steps 5 and 7, a new section *Limit notice*,
  the bound bullets of the rule sections, *Languages*, *Delivery channels*, *Message format*, *Limits and errors*,
  *Related decisions*).
- `docs/areas/storage.md` — the `meta` rows `limit_notice:<event>`.

## Documentation updates

All by the Dev, after the code is green, against the code as built:

- `docs/areas/notifications.md`:
  - *Processing a delivery*, step 5: past the bound the first refused delivery of the event in the hour writes and sends the limit notice ([Limit notice](#limit-notice)); step 7: a `limited` delivery is still not recorded, its only row is that notice.
  - new section *Limit notice* (after *Processing a delivery* or beside *The digest*): when it is written (claim, then row, at most one per event and UTC hour, the six events), the layout and texts of *Approach* in both languages, no button, sent at once also under a digest, quiet hours at sending, failure ignored and its consequence (a failed row write loses that hour's notice), a redelivery sends a notice only as the first refused delivery of its hour, the `limited` decision unchanged.
  - the bound bullets: *Issue and comment rules* → *Volume* (`:266-270`), *Stars and forks* → *The hourly bound* (`:311-313`), *Pull request rules* (`:112`) and *CI failure rules* (`:162`): "further ones of that hour are `limited`" gets "and the owner gets one limit notice".
  - *Message format* `:429` "The release notice … is a second kind of row besides the rules' notifications" — enumeration: name the limit notice as a further kind of row with fixed texts.
  - *Languages* `:463-474` "The tables hold …" — enumeration: add the notice's title, kinds, line 2 and line 3.
  - *Delivery channels* `:488` "A batch of rows (the rows of a delivery, the rows of one cron retry run, the release notice)" — enumeration: add the limit notice.
  - *Limits and errors* `:587`: a redelivered `limited` delivery gets no second notice in the same hour.
  - *Related decisions*, 0043 entry: add "one limit notice per event and UTC hour".
- `docs/areas/storage.md`: the `meta` enumeration `:108` ("`meta` holds …") adds the limit notice claims; a new bullet after the `delivery_count:` bullet: rows `limit_notice:<event>` for the six events, value `<hour>` (whole UTC hours since 1970-01-01, decimal), written by one conditional statement that changes the row only for another value, overwritten each hour, never deleted, at most six.
- `docs/ARCHITECTURE.md`: step 4 of the flow (`:64-66`): "a further one is handled like a delivery without effect" gets "and the first of an hour sends the owner one notice per event"; D1 table list `:121` `meta`: add the limit notice claims, and fix its stale "the hourly counts of issue, comment, star and fork deliveries" to the six events (a related documentation defect left by #140).
- `.squad/project.md`, *Security areas* → *Bound on deliveries of other senders*: one sentence — past the bound the first refused delivery of an event in a UTC hour writes one notice (`claimLimitNotice` on `meta` `limit_notice:<event>`, then `insertOutboxRow`), fixed texts only, its failure ignored.
- `README.md`, *What you get notified about* (enumeration): a row "Messages were left out because more than 20 of one kind (issues, comments, stars, forks, pull requests, CI failures) arrived in an hour — one notice per kind and hour | available".
- `CHANGELOG.md`, `## [Unreleased]` → *Changed*, the existing bound entry (unreleased): "further ones in that hour send nothing" becomes "further ones in that hour send nothing, and you get one notice per kind and hour that messages were left out".

## Architecture check

- "A delivery that led to a message or an `activity` change is processed once": unchanged for recorded deliveries;
  a limited delivery stays unrecorded. The notice is a message of an event's hour, not of the delivery, and is sent at
  most once per event and hour, so no message is ever sent twice (decision 0043 *Consequences*). The guarantee's text
  in `docs/ARCHITECTURE.md` and `.squad/project.md` stays as it is.
- "A matched event is written to the outbox before delivery is attempted": the notice is written, then sent, and
  retried by the cron like any row.
- The D1 write budget the bound protects: at most 6 notices an hour (claim, row, send update, cleanup: a few hundred
  rows a day); each further dropped delivery adds one statement that writes nothing (fact 8).
- Rules stay pure; the notice is built outside `src/rules/`.

## Security considerations

- [ ] No limits on parsed input: the notice holds no payload text; its only inputs are the `BoundedEvent` (a fixed set,
  also the only part of the `meta` key) and the clock.
- [ ] Exceptions: none reaches a user; a failure of the claim or the row is dropped, the answer stays 202 `limited`,
  and no error text is logged.
- A stranger can cause at most 6 notices an hour, 144 a day, with sound outside the quiet hours (decision 0043).

## Decision records

- `docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md` (Accepted, unreleased, extended in place as
  for #140): issue #141 in *Context*, option 11 updated, options 20–26, one sentence in *Decision*, the *Consequences*
  on the notice.

## Out of scope / follow-ups

- The number of dropped deliveries and which ones (needs a write per drop).
- A switch to turn the notice off; a status page line.
