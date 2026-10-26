# Plan: Channel-neutral outbox and switchable delivery channel

Source: Issue #69 | [spec.md](spec.md)
Status: Revised (2)
Tier: security — it moves output escaping (the guard against attacker-controlled titles) from write time to send time, adds two signed-in CSRF-protected routes that delete stored credentials and change where notifications go, and refactors the outbound Telegram client.
Security areas touched: Encrypted credentials (`SecretName`, credential removal from the start page through `removeBotToken`), Setup login (two new signed-in forms `POST /setup/channel/activate` and `POST /setup/channel/remove` with the session-bound CSRF token), Outbound-only Telegram (`src/telegram.ts` moved onto the shared HTTP code in `src/channels/http.ts`, delivery through `src/channels/telegram.ts`), Parsing of external input (escaping at send time in `renderTelegramText`, the stored JSON and the old-row text parsed in `src/notification.ts`), Request body size (the two new routes read through `src/body.ts`), Logging of external data (delivery log results unchanged)
Plan size: the feature spans the outbox storage, the delivery path and the setup wizard, and every one of them needs exact signatures and named tests.

## Problem / root cause

See [spec.md](spec.md), *Problem*. Every spec claim about today's code was checked (facts 1–12). Storage follows the Product
Manager's answer: the JSON goes into `outbox.text`, no migration.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | Rows are rendered to Telegram HTML at write time | `src/webhook.ts:112` (`formatMessage`), `src/webhook.ts:136`; `src/release-check.ts:33-43,86-91` | confirmed |
| 2 | `outbox.text` is `TEXT NOT NULL` (text affinity: a number written by hand is stored as text, a blob stays a blob) | `migrations/0001_initial_schema.sql` (`CREATE TABLE outbox`); SQLite type affinity rules | confirmed |
| 3 | Delivery calls the Telegram client directly and resolves token and chat once per batch | `src/delivery.ts:55-69,97-103,152-159` | confirmed |
| 4 | `formatMessage` cleans each field (`cleanField`) and then escapes it, drops an empty line 2 or 3, and stores the button URL only under `buttonUrl()` rules | `src/message.ts:44-90` | confirmed |
| 5 | The release notice is `<b>title</b> · LarsLaskowski/Seluna\nline`, unclean but from fixed texts of at most 18 + 29·2 + 46 characters | `src/release-check.ts:33-43`, `src/i18n/en.ts:15-16`, `src/i18n/de.ts:15-16` | confirmed |
| 6 | `cleanField` is idempotent on its own output (trim, cut only above the limit, no control or directional characters left), so cleaning again at render changes nothing | `src/message.ts:44-60` (read) | confirmed |
| 7 | Every `outbox.text` written so far starts with `<b>`: the only writers are the webhook (`formatMessage`, line 1 begins `<b>`) and the release check (`formatReleaseMessage`, begins `<b>`) | `src/message.ts:77`, `src/release-check.ts:36`; `grep "INTO outbox" src` outside tests: `src/store/outbox.ts:10`, `src/store/notified-release.ts:27` | confirmed |
| 8 | `JSON.stringify` of an object always starts with `{`; no old row can start with `{` (fact 7) | ECMAScript `JSON.stringify` | confirmed |
| 9 | `_Remove token_` refuses with the Worker secret set and with an unreadable token, and otherwise deletes (also when nothing is saved) | `src/setup/telegram-step.ts:246-259` | confirmed |
| 10 | The reset deletes every `secrets` row | `src/store/secrets.ts:247` (`DELETE FROM secrets WHERE <guard>`) | confirmed |
| 11 | Decision 0023 is released | `git tag --contains` of its adding commit: v0.3.0 and later | confirmed |
| 12 | `readDueRows` throws a `TypeError` for a non-string `text`, which stops the whole retry run | `src/store/outbox.ts` (`readDueRows`, shape check) | confirmed |
| 13 | After a reverted update, the earlier version sends a new row's JSON as the message text with `parse_mode` HTML: shown as raw JSON, or refused by Telegram when a field holds `<` or `&` (decision 0038 *Consequences*, out of scope) | to verify: nobody — no Telegram egress in sessions (`.squad/project.md`, *Test doubles*); stated as expected, not relied on | unverified |
| 14 | `delivery.test.ts`, `outbox-retry.test.ts`, `index.test.ts`, `scheduled.test.ts` and `cleanup.test.ts` insert rows whose `text` is HTML or `'t'`, which stay old-form rows (not starting with `{`) | `src/delivery.test.ts:38`, `src/outbox-retry.test.ts:35`, `src/index.test.ts:241`, `src/scheduled.test.ts:120`, `src/cleanup.test.ts:26` | confirmed |

## Tests per criterion

All test names are prefixed with the function under test, as `docs/UNIT_TESTS.md` asks. "Test channel" is the new
double `test/channel.ts` (below).

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `TELEGRAM_CHANNEL send posts the same sendMessage body for a stored notification as sendNotification did for formatMessage of it` (it.each over one notification per rule fixture: pull request, CI failure, Dependabot, code scanning, secret scanning; silent true/false; en/de button label) | `src/channels/telegram.test.ts` |
| AC1 | `formatReleaseMessage equals renderTelegramText of releaseNotification`; `checkForRelease sends the same sendMessage body as before for the release notice` | `src/release-check.test.ts` |
| AC1 | `renderTelegramText equals formatMessage text for the same notification` (it.each incl. empty line 2/3, number 0/undefined, over-long fields, `&<>`) | `src/message.test.ts` |
| AC2 | `processWebhook writes the cleaned notification as a JSON object in text for a matched delivery` | `src/webhook.test.ts` |
| AC2 | `storedNotificationOf cleans and cuts every field and keeps only a valid number`; `encodeStoredNotification and decodeStoredNotification round-trip a notification` | `src/notification.test.ts` |
| AC2 | `TELEGRAM_CHANNEL send posts an old-form row's text unchanged` | `src/channels/telegram.test.ts` |
| AC2 | `readDueRows returns a row starting with <b> without notification and a row starting with { with its decoded notification` | `src/store/outbox.test.ts` |
| AC3 | `deliverMessages counts a failed attempt for a damaged row, calls no channel and still sends the next row` | `src/delivery.test.ts` |
| AC3 | `decodeStoredNotification returns undefined for malformed JSON, a non-object, a missing or mistyped field and a number that is not a safe integer ≥ 1` | `src/notification.test.ts` |
| AC3 | `readDueRows marks a row as damaged whose text starts with { but does not decode, or is a blob, and still returns the other rows` | `src/store/outbox.test.ts` |
| AC4 | `deliverMessages sends through the active test channel and not through Telegram`; `deliverMessages keeps the channel it resolved for the whole batch when the setting changes during it`; `deliverMessages keeps a row's attempts across a switch` | `src/delivery.test.ts` |
| AC4 | `retryPendingRows sends a pending row through the newly activated test channel` | `src/outbox-retry.test.ts` |
| AC4 | `checkForRelease sends the notice through the active test channel` | `src/release-check.test.ts` |
| AC5 | `messengersView lists every registered channel with configured, active and removable` (Telegram only; Telegram plus a test channel; nothing set up; unknown stored id) | `src/setup/status.test.ts` |
| AC5 | `renderStartPage shows the Messengers card with the state and actions of each entry` (it.each over the four states and with/without Remove); `renderStartPage shows Messenger: with the active name and (not set up)` | `src/setup/pages.test.ts` |
| AC6 | `handleSetup POST /setup/channel/activate activates a set-up channel and answers 303`; `… answers 409 messenger-not-set-up for a channel that is not set up`; `… answers 303 without a write for the active channel`; `… answers 400 messenger-invalid for a missing, repeated, empty, unknown, padded, upper-case or ../ channel field`; `… answers 413, 400, 403 and 503 like the other start page forms` | `src/setup/handler.test.ts` |
| AC6 | `activateChannel writes delivery_channel only for a channel whose prepare is ready`; `channelOfForm accepts exactly one exact registered id` | `src/setup/messengers.test.ts` |
| AC7 | `handleSetup POST /setup/channel/remove deletes the saved bot token and answers 303 also for the active channel`; `… answers 409 messenger-worker-secrets with TELEGRAM_BOT_TOKEN set`; `… answers 409 telegram-token-unreadable for an unreadable token`; `… answers 303 without a delete when nothing is saved`; `… answers 400, 413, 403 and 503 as specified` | `src/setup/handler.test.ts` |
| AC8 | `deliverMessages calls no channel and logs no-token or no-chat while the active channel is not ready` (Telegram, and a not-ready test channel beside a ready Telegram) | `src/delivery.test.ts` |
| AC8 | `handleSetup GET /setup/telegram shows the Telegram active, not set up notice exactly while Telegram is active and not set up` | `src/setup/handler.test.ts` |
| AC8 | `renderTelegramPage shows the info notice above the token card when activeNotSetUp is true` | `src/setup/pages.test.ts` |
| AC9 | `activeChannelOf returns telegram for an absent, unknown, padded or upper-case stored id`; `CHANNELS ids match the id form, avoid the reserved segments and set setupPath to /setup/<id>` | `src/channels/registry.test.ts` |
| AC9 | `handleSetup POST /setup/settings leaves delivery_channel unchanged` | `src/setup/handler.test.ts` |
| AC10 | `legacyNotificationOf recovers title, repository, number and lines` (it.each: three lines, empty line 2 or 3 dropped, no number, release notice, `&amp;lt;` decoded once, foreign text undefined) | `src/notification.test.ts` |
| AC10 | `contentNotification returns the notification of a new row and the recovered one of an old row` | `src/channels/channel.test.ts` |
| AC11 | `postJson aborts after CHANNEL_TIMEOUT_MS`; `postJson rejects an answer above 1 MiB`; `postJson reads a non-2xx body only for a 429`; `postJsonWithRetry waits 1 to 5 seconds once and sends again`; `postJsonWithRetry does not wait for a longer, missing or second retry-after`; `postJsonWithRetry returns failed when the sleep rejects` | `src/channels/http.test.ts` |

## Verification without tests

AC12 and AC13 are verified without a unit test, although the change has production and test code:

- AC12: an ESLint `no-restricted-imports` block for `src/rules/**/*.ts` forbids `../message`, `../telegram`, `../channels/*` and `../notification`
  (pattern groups, so every relative spelling is caught); the *Analyzer gate* fails on a violation (step 7). The Dev
  shows it once in the hand-back by a scratch import in a scratch worktree.
- AC13: the Reviewer (step 8) and the PR approval checklist (step 9) check the decision record and every document of
  *Documentation updates* against the code.

## Approach

**Storage.** No migration. A new row writes into `text` the JSON of `encodeStoredNotification`: an object with
keys in this order `title`, `repository`, `number` (`null` when none), `subject`, `context` — it starts with `{`
(fact 8); every old row starts with `<b>` (fact 7). `readDueRows` classifies `text`: a string starting with `{` →
`decodeStoredNotification`, or `"damaged"` when that fails; any other string → an old-form row (no `notification`
field); a non-string (a blob written by hand) → `"damaged"` instead of today's `TypeError`, so one bad row never stops
a retry run (fact 12; the other columns keep the `TypeError`). The webhook converts each rule notification with
`storedNotificationOf` (each field through `cleanField` with today's limits, number only when a safe integer ≥ 1) and
keeps `buttonUrl(notification.url)` for `button_url`; the release check stores `releaseNotification(...)` (fixed
texts, not cleaned, as today). The webhook and release check hand the same row to `deliverMessages` with
`notification` set, so the first send needs no decode.

**Rendering.** `renderTelegramText(notification)` builds exactly `formatMessage`'s text (clean, escape, layout);
`formatMessage` becomes `{ text: renderTelegramText(fields), buttonUrl: buttonUrl(url) }`, and `formatReleaseMessage`
becomes `renderTelegramText(releaseNotification(...).notification)` with its button URL (fact 5 and 6: identical).
`legacyNotificationOf(text)` splits at `\n` and parses line 1 with `startsWith`/`indexOf`, no regular expression with
unbounded groups: it must start with `<b>`; the title runs to the first `</b> · `; the rest is the repository, and a
trailing ` #` followed by 1 to 16 digits (first not `0`, a safe integer) is cut off as the number (title and
repository decoded); the further lines are line 2 and line 3 (missing ones `''`); more than three lines
or no match → `undefined`. Decoding replaces `&lt;`, `&gt;`, then `&amp;`. Telegram never parses: it sends the old text.

**Channels.** `src/channels/channel.ts` (types), `src/channels/http.ts` (shared HTTP: the request exactly as
`callBotApi` builds it today — `POST`, `content-type: application/json`, `JSON.stringify(payload)`,
`AbortSignal.timeout(10000)`; body read through `readJsonWithLimit` with 1 MiB for 2xx and 429, cancelled otherwise;
the retry after a 429 with `retry_after` 1–5 s), `src/channels/telegram.ts` (adapter: `prepare` = `resolveBotToken`
+ `chatTarget` moved from `src/delivery.ts`; `send` = `sendNotification` with `renderTelegramText` or the old text;
`hasRemovableCredentials` = the resolved token is `usable` from `saved` or `damaged`; `remove` = `removeBotToken`),
`src/channels/registry.ts` (`CHANNELS = [TELEGRAM_CHANNEL]`, `activeChannelOf`, `readActiveChannel`). `src/telegram.ts`
keeps its exports; `callBotApi` delegates to `postJson`, `sendNotification` to `postJsonWithRetry`; its constants stay
exported with their values. `rejected` maps to the log result `token-rejected`.

**Delivery.** `deliverMessages` reads the active channel once (`readActiveChannel(db, deps.channels ?? CHANNELS)`),
calls `prepare` once, then per row: `notification === "damaged"` → `markAttempted`, result `failed`, no channel call;
otherwise `send(message, { silent, buttonLabel, outboxId }, { fetch, sleep })`. A D1 error while reading the channel
or in `prepare` is `store-failed` for every row, unchanged. `DeliveryDeps.channels` and `SetupDeps.channels` are
optional and default to `CHANNELS` (tests inject a test channel; production passes nothing).

**Setup.** `statusView` adds `messengers` from `messengersView`. Routes in
`signedIn`: `POST /setup/channel/activate` and `POST /setup/channel/remove`, both through `readStartForm` (body limit,
CSRF), then `channelOfForm` (400 `messenger-invalid`), then the action; a D1 failure → 503 notice-only `unavailable`.
Activate: already active → 303 without write; `prepare` not ready → `startPage(409, "messenger-not-set-up")`; else
`writeSetting(delivery_channel)` → 303 `/setup`. Remove: `removed` → 303 `/setup`; `worker-secret` →
`startPage(409, "messenger-worker-secrets")`; `unreadable` → `startPage(409, "telegram-token-unreadable")` (the only
channel's text; a follow-up channel brings a neutral one). `telegramStepView` sets `activeNotSetUp` when the active
channel is Telegram and its `prepare` is not ready.

**Layout** (new output). Start page order: heading, body, notice, status card, reset card (when needed),
**Messengers card**, step links card, settings card, sign-out. The card: `<h2>` _Messengers_, `<p>` intro, `<ul>`
with one `<li>` per channel in registry order. Each `<li>`: `<strong>` name, then — not active: `: ` and the state
text (_Not set up_ / _Set up_); active and set up: `: ` _Active_; active and not set up: a following
`<p class="notice info">` with the _Active, but not set up_ text — then the link (`<a href="/setup/<id>">` _Set up_
when not set up, _Change_ when set up), then the forms: _Activate_ (`class="primary"`, set up and not active) and
_Remove_ (`class="secondary"`, removable), each `<form method="post" action="…">` with the CSRF input and
`<input type="hidden" name="channel" value="<id>">`. Status card: `<p>` _Messenger:_ name [ _(not set up)_ ] right
after the _Version:_ line. Telegram step: `<p class="notice info">` _Telegram active, not set up_ as the first child of
the token card, after its heading. No new style rule.

## Options considered

- Neutral storage: JSON in `text`, told apart by its first character (chosen by the Product Manager) vs. a nullable
  column by migration (rejected: a deploy without migrations would answer every webhook with 503 and lose those
  messages, it needs a schema check on the start page, and after a reverted update the new rows end `failed`) vs. a
  table rebuild vs. converting old rows in SQL — decision 0038.
- Old rows: Telegram sends the text, other channels get it parsed (chosen) vs. Telegram-only (rows stuck after a
  switch) — decision 0038.
- Row shape in `PendingMessage`: keep `text`/`buttonUrl` and add an optional `notification` (chosen: the existing
  delivery, retry and release tests stay green and remain the evidence for AC1) vs. a content union (cleaner, but every
  test row rewritten).
- Registry injection: optional deps field defaulting to `CHANNELS` (chosen) vs. a required field (some 20 test deps
  rewritten) vs. module mocking (not used in this repository).
- Escaping: clean at write (size bound) and clean + escape at render (chosen; stored rows are D1 data, fact 6) vs.
  escape only at render without cleaning (relies on every writer).
- AC13: lint rule (chosen) vs. a test reading sources (the Workers test runtime has no file system).
- Removing the active channel: allowed with a notice (spec, *Open questions*).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/notification.ts` | new: stored notification, encode/decode, old-row parse |
| Worker | `src/message.ts` | `renderTelegramText`; `formatMessage` through it |
| Worker | `src/channels/channel.ts`, `http.ts`, `telegram.ts`, `registry.ts` | new |
| Worker | `src/telegram.ts` | `callBotApi`, `sendNotification` on `src/channels/http.ts`; `TelegramFetch` = `ChannelFetch` |
| Worker | `src/delivery.ts` | channel resolution, damaged rows, `PendingMessage.notification`, `channels` dep; `chatTarget` moved |
| Worker | `src/webhook.ts`, `src/release-check.ts`, `src/outbox-retry.ts` | neutral rows; release notification |
| Worker | `src/store/outbox.ts`, `notified-release.ts`, `deliveries.ts`, `settings.ts`, `secrets.ts` | JSON in `text`, row classification, `DELIVERY_CHANNEL_SETTING`, `ChannelSecretName` |
| Worker | `src/setup/handler.ts`, `status.ts`, `pages.ts`, `texts.ts`, `telegram-step.ts`, new `messengers.ts` | card, routes, notices |
| Config | `eslint.config.mjs` | `no-restricted-imports` for `src/rules/` |

## Signatures (for the Dev's skeleton)

src/notification.ts:
- `export interface StoredNotification { readonly title: string; readonly repository: string; readonly number: number | undefined; readonly subject: string; readonly context: string }`
- `export function storedNotificationOf(notification: Notification): StoredNotification`
- `export function encodeStoredNotification(notification: StoredNotification): string`
- `export function decodeStoredNotification(json: string): StoredNotification | undefined`
- `export function legacyNotificationOf(text: string): StoredNotification | undefined`

src/message.ts: `export function renderTelegramText(notification: StoredNotification): string`

src/release-check.ts: `export function releaseNotification(latest: Version, running: Version, language: Language): { readonly notification: StoredNotification; readonly buttonUrl: string }` (formatReleaseMessage keeps its signature)

src/channels/http.ts:
- `export type ChannelFetch = (request: Request) => Promise<Response>`
- `export const CHANNEL_TIMEOUT_MS = 10_000`, `export const MAX_CHANNEL_RESPONSE_BYTES = 1_048_576`, `export const MAX_RETRY_WAIT_SECONDS = 5`
- `export type HttpAnswer = { readonly kind: "answered"; readonly status: number; readonly ok: boolean; readonly body: unknown } | { readonly kind: "failed" }`
- `export function postJson(url: string, payload: object, fetcher: ChannelFetch): Promise<HttpAnswer>`
- `export function postJsonWithRetry(url: string, payload: object, fetcher: ChannelFetch, sleep: (milliseconds: number) => Promise<void>, retryAfterSeconds: (body: unknown) => number | undefined): Promise<HttpAnswer>`

src/channels/channel.ts:
- `export type ChannelSendResult = "sent" | "rejected" | "rate-limited" | "failed"`
- `export type OutboxContent = { readonly kind: "notification"; readonly notification: StoredNotification } | { readonly kind: "legacy"; readonly text: string }`
- `export interface ChannelMessage { readonly content: OutboxContent; readonly buttonUrl: string | undefined }`
- `export interface SendOptions { readonly silent: boolean; readonly buttonLabel: string; readonly outboxId: number }`
- `export interface ChannelSendDeps { readonly fetch: ChannelFetch; readonly sleep: (milliseconds: number) => Promise<void> }`
- `export type ChannelTarget = { readonly kind: "ready"; readonly send: (message: ChannelMessage, options: SendOptions, deps: ChannelSendDeps) => Promise<ChannelSendResult> } | { readonly kind: "unavailable"; readonly result: "no-token" | "no-chat" }`
- `export type ChannelRemoveResult = "removed" | "worker-secret" | "unreadable"`
- `export interface Channel { readonly id: string; readonly displayName: string; readonly setupPath: string; readonly prepare: (env: object, db: D1Database) => Promise<ChannelTarget>; readonly hasRemovableCredentials: (env: object, db: D1Database) => Promise<boolean>; readonly remove: (env: object, db: D1Database) => Promise<ChannelRemoveResult> }`
- `export type ChannelList = readonly [Channel, ...Channel[]]`
- `export function contentNotification(content: OutboxContent): StoredNotification | undefined`

src/channels/telegram.ts: `export const TELEGRAM_CHANNEL: Channel`; `export async function chatTarget(env: object, db: D1Database): Promise<number | undefined>` (moved, unchanged)

src/channels/registry.ts:
- `export const CHANNEL_ID_FORM: RegExp` (the id form of the spec), `export const RESERVED_SETUP_SEGMENTS: readonly string[]`
- `export const DEFAULT_CHANNEL_ID = "telegram"`, `export const CHANNELS: ChannelList`
- `export function activeChannelOf(channels: ChannelList, stored: string | undefined): Channel`
- `export async function readActiveChannel(db: D1Database, channels: ChannelList): Promise<Channel>`

src/delivery.ts: `export interface PendingMessage { readonly id: number; readonly text: string; readonly buttonUrl: string | undefined; readonly silent: boolean; readonly notification?: StoredNotification | "damaged" }`; `DeliveryDeps` gains `readonly channels?: ChannelList`, and its fetch is typed ChannelFetch.

src/store/outbox.ts: `export interface NewOutboxRow { readonly notification: StoredNotification; readonly buttonUrl: string | undefined; readonly silent: boolean }`; `OutboxRow` gains `readonly notification?: StoredNotification | "damaged"`.

src/store/settings.ts: `export const DELIVERY_CHANNEL_SETTING = "delivery_channel"`. src/store/secrets.ts: `export type ChannelSecretName = "telegram_bot_token"` with `SecretName = GitHubSecretName | ChannelSecretName`.

src/setup/status.ts:
- `export interface MessengerEntry { readonly id: string; readonly name: string; readonly setupPath: string; readonly configured: boolean; readonly active: boolean; readonly removable: boolean }`
- `export interface MessengersView { readonly entries: readonly MessengerEntry[]; readonly active: MessengerEntry }`
- `export async function messengersView(env: object, db: D1Database, channels: ChannelList): Promise<MessengersView>`; `StatusView` gains `readonly messengers: MessengersView`; `statusView` gains a last parameter `channels: ChannelList = CHANNELS`.

src/setup/messengers.ts:
- `export const CHANNEL_ACTIVATE_PATH = "/setup/channel/activate"`, `export const CHANNEL_REMOVE_PATH = "/setup/channel/remove"`, `export const CHANNEL_FIELD = "channel"`
- `export function channelOfForm(form: URLSearchParams, channels: ChannelList): Channel | undefined`
- `export type ActivateResult = "activated" | "already-active" | "not-set-up"`
- `export async function activateChannel(env: object, db: D1Database, channel: Channel, channels: ChannelList): Promise<ActivateResult>`

src/setup/telegram-step.ts: `TelegramStepView` gains `readonly activeNotSetUp?: boolean`; `telegramStepView` gains a last parameter `channels: ChannelList = CHANNELS`. src/setup/handler.ts: `SetupDeps` gains `readonly channels?: ChannelList`. src/setup/texts.ts: `Notice` gains the keys messenger-invalid, messenger-not-set-up and messenger-worker-secrets; `SetupTexts` gains `messengersHeading`, `messengersIntro`, `messengerStateNotSetUp`, `messengerStateSetUp`, `messengerStateActive`, `messengerActiveNotSetUp`, `messengerSetUpLink`, `messengerChangeLink`, `messengerActivateButton`, `messengerRemoveButton`, `messengerLabel`, `messengerNotSetUpSuffix`, `telegramActiveNotSetUp` (English texts: spec, *Texts*).

Existing files the skeleton rewrites: none is final; every file in the table above changes.

## Test files

New: `src/notification.test.ts`, `src/channels/http.test.ts`, `src/channels/telegram.test.ts`,
`src/channels/registry.test.ts`, `src/setup/messengers.test.ts`; new double `test/channel.ts`
(`testChannel({ id, configured, removable, removeResult, sendResult })` returning a `Channel` that records every
`send` call with its message and options), and `src/channels/channel.test.ts`. Changed:
`src/message.test.ts`, `src/webhook.test.ts`, `src/delivery.test.ts`, `src/outbox-retry.test.ts`,
`src/release-check.test.ts`, `src/store/outbox.test.ts`,
`src/setup/status.test.ts`, `src/setup/pages.test.ts`, `src/setup/handler.test.ts`.

Existing call sites of changed signatures, adapted by the Tester: `src/store/outbox.test.ts`,
`src/store/deliveries.test.ts` and `src/store/notified-release.test.ts` (`NewOutboxRow` now takes `notification`);
`src/webhook.test.ts` and `src/release-check.test.ts` where they assert a stored `text`; `src/setup/status.test.ts`
(three full `StatusView` comparisons) and `src/setup/pages.test.ts` (`statusViewWith` gets a `messengers` default);
`chatTarget` has no test call site outside `src/delivery.ts`. Tests kept
unchanged: every test that inserts `text`-only rows (fact 14) — those rows are old-form rows, sent unchanged.

Files no unit test can cover: none.

## Areas

- `docs/areas/notifications.md`: *Message format* becomes the Telegram channel's rendering at send time; a new
  section *Delivery channels* (the active channel read once per batch, no fallback, old-form rows, damaged rows, the
  shared HTTP rules — including that `src/channels/http.ts` follows redirects as `fetch` does by default, which the
  first follow-up with an owner-chosen server URL must decide on — `rejected` logged as `token-rejected`); *Sending a row* through the active channel; *Related
  decisions* gains 0038.
- `docs/areas/storage.md`: `outbox.text` holds the notification as JSON (new rows, `{`) or Telegram HTML (old rows,
  `<b>`); the
  `settings` key `delivery_channel`; channel credentials as `secrets` rows.
- `docs/areas/setup-wizard.md`: *Paths* (two routes; start page order), *CSRF protection* (the two forms), *Status
  and settings* (_Messenger:_ line), a new section *Messengers*, *The step page* (the Telegram notice), *Pages and
  response headers* (buttons, info notices), *Texts*.
- `docs/areas/scheduled-jobs.md`: retry and release notice through the active channel; D1 statement count + 1.
- `docs/areas/http-routes.md`: the two body-reading routes in the body limit list.

## Documentation updates

All by the Dev, after the code is green, besides the areas above:

- `docs/ARCHITECTURE.md`: component table (Outbox: the neutral notification, channels), the flow diagram and
  *Webhook to Telegram* (rendered at sending by the active channel), the D1 table list, the outbound-call paragraph;
  link decision 0038.
- `.squad/project.md`: *Security areas* "Outbound-only Telegram" → "Outbound delivery channels" (the channel layer,
  `src/channels/http.ts`, Telegram as the one channel), *Parsing of external input* (escaping at send time),
  *Encrypted credentials* (channel credentials, removal from the start page), *Setup login* (the two forms);
  *Integration surface* gains "A new delivery channel touches": registry entry, adapter, setup page `/setup/<id>`,
  `ChannelSecretName`, its texts, its test double. The *Test doubles* entry for `test/channel.ts`: Tester.
- `README.md`: settings table row "Messenger (on the start page)" default Telegram.
- `CHANGELOG.md` under `## [Unreleased]`: Added — the _Messengers_ card with the active messenger; Changed — messages
  stored without Telegram formatting (no visible change).

## Architecture check

Guarantees of `.squad/project.md`: "a matched event is written to the outbox before delivery" and the retry bound hold
(same transaction, same `markAttempted`); deduplication unchanged; the draft rules untouched (rules untouched); data
stays in the owner's account; credentials only encrypted (no new credential, removal through `deleteSecret`). No schema
change, so no deploy can leave the webhook without its table shape. No guarantee is weakened.

## Security considerations

- [ ] Limits: stored fields cut to 64/140/256/256 code points after decoding the payload, before escaping (as today);
  the stored JSON is read only from D1 and written only from cut fields (no limit beyond D1's row size); channel answers 1 MiB counted in bytes before
  decoding; form bodies 1 MiB in bytes before decoding (`src/body.ts`).
- [ ] Exceptions: none reaches a user — D1 errors become `unavailable` (503) or `store-failed`; `JSON.parse` of a
  stored row is caught into `"damaged"`; channel errors become fixed results; all notices are fixed texts.
- [ ] Escaping: every stored field is cleaned again and escaped in `renderTelegramText`; old rows are sent as written
  by the earlier version's escaping; `legacyNotificationOf` output reaches only other channels, which escape for
  their own format.
- [ ] `channel` form value is compared exactly against registered ids; it never enters a URL or a page unless it
  equals one. The link and hidden values come from the registry, escaped.

## Challenge

- M1 (store the JSON in `text`, no migration): accepted after escalation — the Product Manager chose this option and
  waived the issue's migration line. Migration 0002, the column, the schema check (`outdated`, `outboxIsCurrent`,
  `outdatedOutboxDb`), the live D1 check, spec S10/E12 and the migration criterion are gone; spec AC3 now covers
  damaged rows; criteria renumbered (AC12 lint, AC13 documentation).
- m1 (cron on a database without the migration): moot — there is no migration.
- m2 (a bad value stops a retry run): accepted — a non-string `text` and an undecodable `{` row read as `"damaged"`
  (*Approach*, AC3 rows).
- m3 (`outboxIsCurrent` loose): moot — no schema check.

## Security review

APPROVED. Notes (1) and (2) (`outboxIsCurrent`, live D1 check) are moot after the Product Manager's choice; (3) the redirect behavior of
`src/channels/http.ts` is written into the shared HTTP rules of `docs/areas/notifications.md` (*Areas*);
(4) `legacyNotificationOf` parses with `startsWith`/`indexOf`, no unbounded lazy groups (*Approach*).

### Security notes (second review, non-blocking, verbatim)

1. The optional `notification` field allows a raw send. `PendingMessage.notification` is optional, and a row without it is sent by Telegram as its stored `text` with `parse_mode` HTML. If a writer path ever passes a new row to `deliverMessages` without setting `notification`, the raw JSON goes out unescaped as HTML. `readDueRows` sets the field for retry rows, and the webhook path is guarded by `processWebhook sends the escaped title with parse_mode HTML to sendMessage` (`src/webhook.test.ts:140-148`), which must stay unchanged. Suggestion: when `notification` is absent, `deliverMessages` should still check whether `text` starts with `{` and decode it or mark it damaged, rather than trusting the caller.
2. A non-Telegram channel's handling of an unparsable old row is not defined. When `contentNotification` returns `undefined`, the plan does not say what such a channel does. It should be stated, for example as a `failed` attempt.
3. Damaged rows versus a channel that is not ready. The order is not stated. S8 says attempts stay unchanged while the active channel is not ready; the plan should say whether a damaged row still counts an attempt in that case.
4. The `text` value of a non-string row is not specified. `OutboxRow.text` (typed `string`) has no stated value for it, for example `''`. The skeleton should fix one.

## Decision records

- `docs/decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md` (Proposed; amends 0023).

## Out of scope / follow-ups

Spec, *Out of scope*. A follow-up per messenger (ntfy, Gotify, Matrix, Discord) registers its channel; the first one
with credentials of its own replaces the Telegram-specific `telegram-token-unreadable` answer of _Remove_ with a
neutral notice.
