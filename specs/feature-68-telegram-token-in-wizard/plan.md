# Plan: Enter the Telegram bot token in the setup wizard

Source: Issue #68 | [spec.md](spec.md)
Status: Draft
Tier: security — the change adds a stored, encrypted credential, two signed-in CSRF-protected forms that write and delete it, and a new Bot API method (decision 0016 makes that `security`).
Security areas touched: Encrypted credentials (`src/store/secrets.ts`, new `src/bot-token.ts`), Setup login (two new signed-in forms in `src/setup/handler.ts`, `src/setup/telegram-step.ts`), Outbound-only Telegram (`getMe` in `src/telegram.ts`, the token from D1 in `src/delivery.ts`), Request body size (the two new routes read their body through `readForm`), Parsing of external input (the `getMe` answer, narrowed in `src/telegram.ts`), Logging of external data (the token must reach no log), build configuration (`package.json` `cloudflare.bindings`, the deploy form)

## Problem / root cause

Feature: see [spec.md](spec.md) (S1–S10, E1–E18, AC1–AC16).

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | The token's only source today is the env | `botTokenFromEnv`, `src/telegram.ts:29-36`; callers `src/delivery.ts:52`, `src/setup/telegram-step.ts:26,87` | confirmed |
| 2 | The allow-list is `^\d{1,20}:[A-Za-z0-9_-]{1,200}$`; in JS without `m`/`u`, `\d` is ASCII 0-9 and `$` matches only at the end of input (no trailing-newline match), so `/`, `\`, `?`, `#`, `%`, `.`, `+`, whitespace, tab, line breaks and non-ASCII digits all fail | `src/telegram.ts:3`; ECMAScript RegExp semantics | confirmed |
| 3 | The WHATWG URL parser strips ASCII tab and newline and reinterprets `\`, `.`, `%`; the allow-list admits none of them, so the path cannot change | `docs/areas/setup-wizard.md` *Telegram chat*; row 2 | confirmed |
| 4 | Form bodies are decoded with `URLSearchParams`: `+` becomes a space, `%2F` becomes `/` | `readForm`, `src/setup/handler.ts:170-183` | confirmed |
| 5 | `TELEGRAM_CHAT_ID` precedence has no fallback when malformed | `chatTarget`, `src/delivery.ts:36-44` | confirmed |
| 6 | The `secrets` table has no CHECK on `key`: a new name needs no migration | `migrations/0001_initial_schema.sql:6-10` | confirmed |
| 7 | `writeSecret` writes one credential guarded by the key check, writing the key check with the first credential; refuses on changed/corrupt | `src/store/secrets.ts:157-208`; `docs/areas/storage.md` *Key check* | confirmed |
| 8 | `readSecret` reports `corrupt` both for a damaged key check and for a row that does not decrypt under a matching one; `checkKey` tells them apart (`match`) | `src/store/secrets.ts:120-142`, `105-117` | confirmed |
| 9 | `needsReset` covers every `secrets` row (a non-decrypting token row needs a reset), and `resetCredentials` deletes every row: the token needs no reset code change | `src/store/secrets.ts:268-323` | confirmed |
| 10 | `writeSecrets` takes `Record<SecretName, string>`: adding a name to `SecretName` would force the token into the GitHub write | `src/store/secrets.ts:214-224`, call `src/setup/github-step.ts:226` | confirmed |
| 11 | Without the env token and a usable `SELUNA_SECRET`, `keyFromEnv` gives `undefined`, so delivery tests without `SELUNA_SECRET` keep logging `no-token` | `src/crypto.ts:87-90`; `src/delivery.test.ts:14,220-233` | confirmed |
| 12 | `POST /setup/telegram` is already the chat confirm form | `stepRoute`, `src/setup/handler.ts:529-541` | confirmed |
| 13 | Page notices render as `p.notice.error`; info texts as `p.notice.info`; STYLE is pinned by the CSP hash, and `details`/`summary` need neither script nor style | `src/setup/pages.ts:94-108,478`; `contentSecurityPolicy` | confirmed |
| 14 | The reset text names only the GitHub credentials | `resetText`, `src/setup/texts.ts` (English) | confirmed |
| 15 | `telegram-step.ts` has no test file of its own; it is tested through `handler.test.ts` | `ls src/setup` | confirmed |
| 16 | The issue's other claims (`BOT_TOKEN_FORM`, `resolveTarget`, `keyFromEnv`, `ALLOWED_METHODS`, `cloudflare.bindings`); "the reset notice covers it" is refuted by row 14 | read; spec *Open questions* | confirmed |
| 17 | `getMe` with a valid token answers 200 `{"ok":true,"result":<User>}`, an unknown token 401 (sometimes 404), and a bot with a webhook answers 200 too | to verify: the Product Manager's live check on a deployed copy before the pull request is marked ready (save a valid, a revoked and a mistyped token; a bot with a webhook), as decision 0016 set it; Tester builds `get-me.json` from the Bot API reference in step 5 | unverified |

## Tests per criterion

Every handler test runs through `handleSetup` with the Telegram double; "no token in D1" means a scan of every row of
every table for the token text. A saved token is seeded with `writeSecret(db, key, "telegram_bot_token", …)`.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | "handleSetup shows the token form and calls no Telegram API when no bot token is available"; "renderTelegramPage renders the token card with a masked token field for a missing token" | `src/setup/handler.test.ts`; `src/setup/pages.test.ts` |
| AC2 | "handleSetup saves a token Telegram accepts and redirects to the Telegram step" (one `getMe` with that token, 303 `/setup/telegram`, `readSecret` returns it, no D1 row holds it); "handleSetup shows the saved token with Change and Remove and searches chats with it"; "handleSetup saves a token of a bot with a webhook and then shows the conflict notice"; "writeSecret and readSecret round-trip telegram_bot_token"; "verifyBotToken reports accepted for a getMe answer with ok true and posts JSON to getMe" | `src/setup/handler.test.ts`; `src/store/secrets.test.ts`; `src/telegram.test.ts` |
| AC3 | "resolveBotToken returns the saved token when TELEGRAM_BOT_TOKEN is not set"; "handleSetup sends the test message with the saved token"; "deliverMessages sends with the saved token when TELEGRAM_BOT_TOKEN is not set" | `src/bot-token.test.ts`; `src/setup/handler.test.ts`; `src/delivery.test.ts` |
| AC4 | "handleSetup replaces the saved token with an accepted one and keeps the saved chat"; it.each "handleSetup keeps the saved token and the saved chat when the new token is $case" (malformed, rejected 401, unavailable) | `src/setup/handler.test.ts` |
| AC5 | it.each "handleSetup answers 400, saves nothing and calls no Telegram API for the token $case" — empty, leading space, trailing `%0A`, a `+`, `%2F`, `?`, `#`, `%25`, `.`, `%5C`, Arabic-Indic digit U+0663 (`%D9%A3`), 21 digits, 201 characters after the colon, field missing, field twice; each asserts the *not a bot token* notice and that the page does not contain the submitted value; "isBotToken accepts exactly the bot token form" | `src/setup/handler.test.ts`; `src/telegram.test.ts` |
| AC6 | it.each "handleSetup answers 502 and saves nothing when getMe answers $status" (401, 404); it.each "handleSetup answers 502 and saves nothing when getMe $case" (rejects, 429, 500, body above 1 MiB, not JSON, 200 with ok false); it.each "verifyBotToken reports $result for $case"; "handleSetup shows the saved-token-rejected notice with the open token form and Remove when getUpdates answers 401" | `src/setup/handler.test.ts`; `src/telegram.test.ts` |
| AC7 | "resolveBotToken prefers TELEGRAM_BOT_TOKEN over a saved token without reading D1"; "resolveBotToken reports malformed for a malformed TELEGRAM_BOT_TOKEN without falling back"; "handleSetup shows the Worker secret note and no token form when TELEGRAM_BOT_TOKEN is set"; it.each "handleSetup answers 409 to $form while TELEGRAM_BOT_TOKEN is set and keeps the saved token"; "deliverMessages uses TELEGRAM_BOT_TOKEN over a saved token" | `src/bot-token.test.ts`; `src/setup/handler.test.ts`; `src/delivery.test.ts` |
| AC8 | "handleSetup removes the saved token, keeps the saved chat and shows the token form again"; "handleSetup answers a removal without a saved token like a removal"; "deleteSecret deletes only the named row"; existing "deliverMessages calls no Telegram, keeps the row pending with attempts 0 and logs $result when $case" (case "there is no bot token") | `src/setup/handler.test.ts`; `src/store/secrets.test.ts`; `src/delivery.test.ts` |
| AC9 | "resetCredentials deletes a saved telegram_bot_token"; "texts word the English reset text as the spec does" (adapted from the status page text test) | `src/store/secrets.test.ts`; `src/setup/texts.test.ts` |
| AC10 | it.each "resolveBotToken reports $kind" (token under another `SELUNA_SECRET`: unreadable; malformed key check: unreadable; row damaged under a matching key check: damaged; a saved value outside the allow-list: damaged); "handleSetup shows the unreadable notice without form or Telegram request for a token saved under another SELUNA_SECRET"; it.each "handleSetup answers 409 to $form when the saved token cannot be read"; "handleSetup shows the damaged notice with the token form and Remove"; "handleSetup replaces a damaged token row and keeps the GitHub credentials"; "handleSetup answers 409 with the token-not-saved notice when the GitHub credentials cannot be read and no token is saved"; "deliverMessages logs no-token when the saved token cannot be read" | `src/bot-token.test.ts`; `src/setup/handler.test.ts`; `src/delivery.test.ts` |
| AC11 | "resolveBotToken lets a D1 error reach the caller"; it.each "handleSetup answers 503 unavailable without a Telegram request when D1 fails on $route" (GET step without env token, token form, remove form); "deliverMessages logs store-failed when the saved token cannot be read from D1" | `src/bot-token.test.ts`; `src/setup/handler.test.ts`; `src/delivery.test.ts` |
| AC12 | it.each "statusView reports the bot token as $botToken" (worker-secret, malformed worker secret as worker-secret, saved, none, unreadable, damaged as unreadable); "renderStartPage shows the Telegram bot token line before the Telegram chat line" | `src/setup/status.test.ts`; `src/setup/pages.test.ts` |
| AC13 | it.each "handleSetup returns the token in no body, header or log entry when $case" (save 303, each 400/409/502 case, 403, 413, 503, the step page with a saved token, the status page; `console` spied); it.each "handleSetup answers 403 form expired to $form with a bad CSRF token and changes nothing"; it.each "handleSetup answers 413 to an oversized $form and changes nothing" | `src/setup/handler.test.ts` |
| AC14 | "writeSecret of telegram_bot_token from two calls at once leaves one whole value"; existing "resetCredentials deletes nothing when a credential was rewritten after its check" (name-independent) | `src/store/secrets.test.ts` |
| AC15 | no unit test: read-only check by the Reviewer in step 8 of `package.json` `cloudflare.bindings`, `.dev.vars.example`, `README.md` and `docs/setup.md`, with *Build* passing | — (Reviewer) |
| AC16 | "handleSetup shows the token form and the chat id note when TELEGRAM_CHAT_ID is set and no token is available"; "handleSetup saves a token while TELEGRAM_CHAT_ID is set with exactly one getMe and no getUpdates"; "handleSetup shows a saved token with the chat id note and calls no Telegram API when TELEGRAM_CHAT_ID is set"; existing confirm and verify 409 tests with `chatSecretDeps` stay | `src/setup/handler.test.ts` |

## Approach

**Token resolution** (new module `src/bot-token.ts`, `resolveBotToken`): `botTokenFromEnv(env)` first — `usable` or
`malformed` returns at once with source `worker-secret`, no D1 read. Otherwise `keyFromEnv(env)`; no key → `missing`.
Otherwise `readSecret(db, key, "telegram_bot_token")`: `ok` and `isBotToken(value)` → `usable`/`saved`; `ok` outside
the allow-list → `damaged`; `missing` → `missing`; `secret-changed` → `unreadable`; `corrupt` → `checkKey` is `match` ?
`damaged` : `unreadable`. D1 errors reject.

**Telegram client** (`src/telegram.ts`): `isBotToken` exposes the existing allow-list; `verifyBotToken` sends one
`getMe` through `callBotApi` with body `{}`: 401/404 → `rejected`; 2xx with a body `ok === true` → `accepted`;
everything else (failed fetch, abort after 10 s, 429, other status, oversized or unreadable body) → `unavailable`.
Only `ok` of the answer is read.

**Store** (`src/store/secrets.ts`): `SecretName` gains `telegram_bot_token` through a split
(`GitHubSecretName` for `writeSecrets`); `deleteSecret` runs `DELETE FROM secrets WHERE key = ?1` and, in the same
batch, deletes the `key_check` row when no `secrets` row is left (Challenge note 1, Security note 1).

**Step** (`src/setup/telegram-step.ts`):

- `telegramStepView`: token state from `resolveBotToken` (with `worker-secret`/`saved` carrying `rejected`), chat part:
  `TELEGRAM_CHAT_ID` set → `chat-id-secret` (no Telegram call); else read the saved chat; token not usable → `hidden`;
  else `findChats`: `found` → `chats`, `token-rejected` → `hidden` with `rejected: true` on the token state, `conflict`
  / `unavailable` → `problem`.
- `saveBotToken`, in this order: Worker secret set (`botTokenFromEnv` not `missing`) → `worker-secret`; exactly one
  `token` field matching the allow-list, else `invalid`; `resolveBotToken` `unreadable` → `unreadable`; `checkKey`
  `changed`/`corrupt` → `not-writable`; `verifyBotToken` → `rejected`/`unavailable`; `writeSecret` `ok` → `saved`,
  otherwise `not-writable`. `TELEGRAM_CHAT_ID` is not looked at.
- `removeBotToken`: Worker secret set → `worker-secret`; `resolveBotToken` `unreadable` → `unreadable`; else
  `deleteSecret` → `removed` (also when no row existed).
- `confirmTelegramChat` takes `db` and resolves the token: `missing`, `unreadable`, `damaged` → `token-missing`;
  `malformed` → `token-malformed`; `sendMessage` 401/404 → `token-rejected` with the token's source.

**Handler** (`src/setup/handler.ts`): routes `POST /setup/telegram/token` and `POST /setup/telegram/token/remove`
through `readTelegramForm` (413/400, 403 *form expired* with the notice-only page). Answers, view in brackets with token
state / chat part:

| Result | Save | Remove |
| ------ | ---- | ------ |
| `saved` / `removed` | 303 `/setup/telegram` | 303 `/setup/telegram` |
| `worker-secret` | 409 [`worker-secret` / `omitted`] | same |
| `invalid` | 400 [`entry` / `omitted`] + `telegram-token-invalid` | — |
| `unreadable` | 409 [`unreadable` / `omitted`] | same |
| `not-writable` | 409 [`unreadable` / `omitted`] + `telegram-token-not-saved` | — |
| `rejected` | 502 [`entry` / `omitted`] + `telegram-token-not-accepted` | — |
| `unavailable` | 502 [`entry` / `omitted`] + `telegram-token-unverified` | — |
| D1 error | 503 notice-only + `unavailable` | same |

`confirmTelegram` catches a D1 error (503 *unavailable*) and maps `token-rejected` to `telegram-token-rejected`
(source `worker-secret`) or `telegram-saved-token-rejected` (source `saved`).

**Delivery** (`resolveTarget`): `resolveBotToken` inside the existing `try`; not usable → `no-token`; D1 error →
`store-failed`.

**Status** (`statusView`): `botToken` from `resolveBotToken`: `usable`/`malformed` from the env → `worker-secret`,
`usable` saved → `saved`, `missing` → `none`, `unreadable`/`damaged` → `unreadable`. No Telegram call.

**Layout of the Telegram step** (the `step` view): the `h1` heading, then a token card, then a chat card (none for
`omitted`). The `notice` parameter of `renderTelegramPage` goes into the token card in place of the derived token
notice; the `notice-only` and `code` views are unchanged.

- Token card: `<h2>` *Bot token* (`telegramTokenHeading`), then by state:
  - `missing`: the intro paragraph (S1 text), the token form;
  - `entry`: the notice, the token form;
  - `saved`: the notice when `rejected` (`telegram-saved-token-rejected`), the paragraph "A bot token is saved. It is
    not shown again.", `<details>` (with `open` when `rejected`) holding `<summary>Change token</summary>` and the
    token form, then the remove form;
  - `damaged`: notice `telegram-token-damaged`, the token form, the remove form;
  - `unreadable`: notice `telegram-token-unreadable` only;
  - `worker-secret`: `<p class="notice info">` with the S6 text, preceded by notice `telegram-token-rejected` when
    `rejected`;
  - `worker-secret-malformed`: notice `telegram-token-malformed` only.
- Token form: `<form method="post" action="/setup/telegram/token">`, the CSRF input, `<label for="token">Bot
  token</label>`, `<input id="token" type="password" name="token" autocomplete="off" spellcheck="false"
  maxlength="221" required>` (never a `value`), `<button type="submit" class="primary">Save token</button>`.
- Remove form: `<form method="post" action="/setup/telegram/token/remove">`, the CSRF input, `<button type="submit"
  class="secondary">Remove token</button>`.
- Chat card: `<h2>` *Chat* (`telegramChatHeading`), then `chat-id-secret`: the info notice of today only; `hidden`:
  the intro and the saved-chat line; `problem`: intro, notice, saved-chat line, search link (as today); `chats`: as
  today.
- Status page: `<p>Telegram bot token: <text></p>` directly before the *Telegram chat:* line.

**Texts** (English exact; German written by the Dev in the style of the existing German texts, checked in step 8):
new keys `telegramTokenHeading` "Bot token", `telegramChatHeading` "Chat", `telegramTokenIntro` (S1),
`telegramTokenLabel` "Bot token", `telegramTokenSaveButton` "Save token", `telegramTokenSaved` (S2),
`telegramTokenChange` "Change token", `telegramTokenRemoveButton` "Remove token", `telegramTokenWorkerSecret` (S6),
`botTokenLabel` "Telegram bot token:", `botTokenSecret` "Set by the Worker secret TELEGRAM_BOT_TOKEN.", `botTokenSaved`
"Saved in the setup." (the status reuses `noneSavedYet` and `cannotBeRead`). New notices: `telegram-token-invalid`
(E1), `telegram-token-not-accepted` (E3), `telegram-token-unverified` (E4), `telegram-saved-token-rejected` (E10),
`telegram-token-unreadable` (E11), `telegram-token-damaged` (E17), `telegram-token-not-saved` (E12), each the spec's
text. Changed: `telegram-token-missing` → "No usable bot token is available. Open the Telegram chat step and check the
bot token there."; `resetText` → "The saved credentials cannot be read with the current SELUNA_SECRET: it was changed,
or a saved value is damaged. If you still know the earlier SELUNA_SECRET, set it again instead. Otherwise reset: Seluna
deletes the saved GitHub credentials, the installation tokens and the saved Telegram bot token; you then create the
GitHub App again and enter the bot token again in the Telegram chat step. Delete the old app on GitHub afterwards: in
the settings of your account or organization, under Developer settings, then GitHub Apps. The Telegram chat and the
settings are kept."

**Configuration**: `package.json` `cloudflare.bindings` keeps only `SELUNA_SECRET`; `.dev.vars.example` keeps
`TELEGRAM_BOT_TOKEN` commented out as optional, with the precedence explained.

## Options considered

- **`getMe` vs `getUpdates` vs no check** for the verification — `getMe` chosen; reasons in decision 0036.
- **Resolver in `src/telegram.ts`** (as the issue suggests) vs a new module `src/bot-token.ts` — the client module stays
  free of D1 and crypto imports, and the resolver is shared by the step, the status and delivery; new module chosen.
- **Change token as a disclosure (`details`)** vs a separate page or query parameter — the disclosure needs no script,
  no route and no state; chosen.
- **A failed save re-renders the whole step** (D1 read, `getUpdates`) vs a token-only page (`chat` `omitted`) — the
  token-only page keeps every failure free of Telegram calls and further D1 reads (E1, E8); chosen.
- **Damaged token row: repair in the step** vs only the reset — decision 0036, option 9.
- **New `SecretReadResult` kind** for a damaged row vs `checkKey` after a `corrupt` read — the second leaves the four
  callers of `readSecret` untouched, at one D1 round trip on that error path only; chosen.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/bot-token.ts` (new) | `resolveBotToken` and its types |
| Worker | `src/telegram.ts` | `isBotToken`, `verifyBotToken` (`getMe`) |
| Worker | `src/store/secrets.ts` | `SecretName` split, `deleteSecret`, `writeSecrets` parameter type |
| Worker | `src/setup/telegram-step.ts` | view types, `saveBotToken`, `removeBotToken`, `confirmTelegramChat` with `db`, paths |
| Worker | `src/setup/handler.ts` | two routes, confirm error handling |
| Worker | `src/setup/pages.ts` | Telegram step layout, status line |
| Worker | `src/setup/status.ts` | `BotTokenStatus`, `StatusView.botToken` |
| Worker | `src/setup/texts.ts` | new keys and notices, two changed texts |
| Worker | `src/delivery.ts` | `resolveTarget` uses `resolveBotToken` |
| Tests | `test/telegram.ts`, `test/fixtures/telegram/get-me.json`, its `README.md` | `getMe` allowed and answered |
| Config | `package.json`, `.dev.vars.example` | deploy form asks only for `SELUNA_SECRET` |

## Signatures (for the Dev's skeleton)

In src/bot-token.ts (new; TSDoc as in *Approach*):

- `export type BotTokenSource = "worker-secret" | "saved"`
- `export type ResolvedBotToken = { readonly kind: "usable"; readonly token: string; readonly source: BotTokenSource } | { readonly kind: "malformed" } | { readonly kind: "missing" } | { readonly kind: "unreadable" } | { readonly kind: "damaged" }`
- `export async function resolveBotToken(env: object, db: D1Database): Promise<ResolvedBotToken>`

In src/telegram.ts:

- `export function isBotToken(value: string): boolean`
- `export type BotTokenCheck = "accepted" | "rejected" | "unavailable"`
- `export async function verifyBotToken(token: string, fetcher: TelegramFetch): Promise<BotTokenCheck>`

In src/store/secrets.ts:

- `export type GitHubSecretName = "github_app_id" | "github_private_key" | "github_webhook_secret"`
- `export type SecretName = GitHubSecretName | "telegram_bot_token"`
- `export function writeSecrets(db: D1Database, key: CryptoKey, values: Readonly<Record<GitHubSecretName, string>>): Promise<SecretWriteResult>`
- `export async function deleteSecret(db: D1Database, name: SecretName): Promise<void>`

In src/setup/telegram-step.ts:

- `export const TELEGRAM_TOKEN_PATH = "/setup/telegram/token"`
- `export const TELEGRAM_TOKEN_REMOVE_PATH = "/setup/telegram/token/remove"`
- `export const TOKEN_FIELD = "token"`
- `export type TokenState = { readonly kind: "worker-secret"; readonly rejected: boolean } | { readonly kind: "worker-secret-malformed" } | { readonly kind: "missing" } | { readonly kind: "entry" } | { readonly kind: "saved"; readonly rejected: boolean } | { readonly kind: "unreadable" } | { readonly kind: "damaged" }`
- `export type TelegramProblem = "conflict" | "unavailable"`
- `export type ChatPart = { readonly kind: "chat-id-secret" } | { readonly kind: "omitted" } | { readonly kind: "hidden"; readonly savedChatId: number | undefined } | { readonly kind: "problem"; readonly problem: TelegramProblem; readonly savedChatId: number | undefined } | { readonly kind: "chats"; readonly chats: readonly TelegramChat[]; readonly savedChatId: number | undefined }`
- `export type TelegramStepView = { readonly kind: "step"; readonly token: TokenState; readonly chat: ChatPart }`
- `export async function telegramStepView(env: object, db: D1Database, fetcher: TelegramFetch): Promise<TelegramStepView>`
- `export type ConfirmChatResult = { readonly kind: "code-sent"; readonly chatId: number; readonly proof: string } | { readonly kind: "chat-id-secret" } | { readonly kind: "invalid-chat" } | { readonly kind: "token-missing" } | { readonly kind: "token-malformed" } | { readonly kind: "token-rejected"; readonly source: BotTokenSource } | { readonly kind: "send-failed" }`
- `export async function confirmTelegramChat(env: object, db: D1Database, fetcher: TelegramFetch, proofKey: CryptoKey, session: string, chatFields: readonly string[], language: Language, now: Date): Promise<ConfirmChatResult>`
- `export type SaveTokenResult = { readonly kind: "saved" } | { readonly kind: "worker-secret" } | { readonly kind: "invalid" } | { readonly kind: "unreadable" } | { readonly kind: "not-writable" } | { readonly kind: "rejected" } | { readonly kind: "unavailable" }`
- `export async function saveBotToken(env: object, db: D1Database, fetcher: TelegramFetch, tokenFields: readonly string[]): Promise<SaveTokenResult>`
- `export type RemoveTokenResult = { readonly kind: "removed" } | { readonly kind: "worker-secret" } | { readonly kind: "unreadable" }`
- `export async function removeBotToken(env: object, db: D1Database): Promise<RemoveTokenResult>`

In src/setup/status.ts:

- `export type BotTokenStatus = "worker-secret" | "saved" | "none" | "unreadable"`
- `StatusView.botToken: BotTokenStatus`

In src/setup/texts.ts: SetupTexts gains the keys of *Approach* and Notice the seven new values; the skeleton writes
the English texts and German placeholders the Dev completes in step 6.

Files the skeleton rewrites besides the new module: src/setup/pages.ts (the switch of renderTelegramPage over the new
view, its step branch throwing until step 6, the other pages unchanged), src/setup/handler.ts (the confirm call passes
the database; the two routes come in step 6), src/setup/status.ts (the bot token status stubbed). Existing Telegram
page tests then fail until step 6, as expected.

## Test files

`src/bot-token.test.ts` (new), `src/telegram.test.ts`, `src/store/secrets.test.ts`, `src/setup/handler.test.ts`,
`src/setup/pages.test.ts`, `src/setup/status.test.ts`, `src/setup/texts.test.ts`, `src/delivery.test.ts`; the double
`test/telegram.ts` (`ALLOWED_METHODS` gains `getMe`, `TelegramAnswers.getMe`, default answer `get-me.json`, the
`onTestFinished` message names the three methods) and the reference-built fixture `test/fixtures/telegram/get-me.json`
with its row in `test/fixtures/telegram/README.md` (Tester, step 5).

Existing test code that a changed signature affects:

- `src/setup/pages.test.ts`: every Telegram view literal (`CHATS_VIEW`, `NO_CHATS_VIEW`, the `chats`, `problem` and
  `chat-id-secret` literals at lines 61-62, 159, 174, 455-469, 884, 1107, 1125) — the old shapes go away, so the **Dev**
  rewrites them in step 4 to `{ kind: "step", token: { kind: "worker-secret", rejected: false }, chat: … }`
  mechanically, `problem: "token-missing"` becoming `token: { kind: "missing" }` with `chat: { kind: "hidden", … }`; no
  assertion touched. The snapshots in `src/setup/__snapshots__/pages.test.ts.snap` change in step 6: the **Tester**
  updates them and checks the diff against *Approach*.
- `src/setup/status.test.ts`: the expected views (`EMPTY` and the `toEqual` cases) gain `botToken` — **Tester**, step 5.
- `src/setup/texts.test.ts`: the pinned `telegram-token-missing` and `resetText` — **Tester**, step 5.
- `src/setup/handler.test.ts`: "handleSetup shows the token-missing notice and calls no Telegram API" (line 1135) now
  expects the token form — **Tester**, step 5; the other Telegram tests use `TELEGRAM_BOT_TOKEN` and keep their inputs.
- `src/delivery.test.ts`, `src/webhook.test.ts`, `src/index.test.ts`, `src/scheduled.test.ts`,
  `src/release-check.test.ts`, `src/outbox-retry.test.ts`: unchanged — their environments either set
  `TELEGRAM_BOT_TOKEN` or lack `SELUNA_SECRET` (row 11), so no input is handled differently.

Files no unit test can cover: none.

## Areas

`docs/areas/setup-wizard.md`, `storage.md`, `deployment.md`, `notifications.md` and `http-routes.md`, with the content
the spec's *Area documents* outlines; the rows and owners are under *Documentation updates*.

## Documentation updates

Sweep over `docs/areas/`, `docs/ARCHITECTURE.md`, `README.md`, `SECURITY.md` and `docs/*.md` (Bot API methods,
deploy form secrets, signed-in forms, `secrets` keys, body-reading routes); every hit is listed.

| File | Change | Owner |
| ---- | ------ | ----- |
| `docs/areas/setup-wizard.md` (lines 114-115, 138-260, 516-640) | *Telegram chat*, *Paths*, *CSRF protection*, *Status and settings*, *Reset*, *Texts* | Lead |
| `docs/areas/storage.md` (lines 28, 71, 109-110, *Key check*) | the `secrets` keys, encryption, key check | Lead |
| `docs/areas/deployment.md` (lines 44-56) | *Worker secrets* | Lead |
| `docs/areas/notifications.md` (lines 262-265) | the token's sources, `no-token`/`store-failed` | Lead |
| `docs/areas/http-routes.md` (lines 70-72) | the two new body-reading routes | Lead |
| `docs/areas/scheduled-jobs.md` (*Retry* step 5) | a failed read of the saved token logs `store-failed` (found in step G4) | Lead |
| `docs/ARCHITECTURE.md` (lines 64-69: methods; 117-123: Worker secrets) | `getMe`; the token optional as a Worker secret, else encrypted in D1; link decision 0036 | Lead |
| `docs/decisions/0036-telegram-bot-token-in-the-setup-wizard.md` and its index row | written (Proposed) | Lead |
| `.squad/project.md` | *Encrypted credentials* (the bot token in `secrets`, `TELEGRAM_BOT_TOKEN` optional with precedence), *Outbound-only Telegram* (`getMe` in the step, the token from D1 in delivery), *Test doubles* (the double answers `getMe`) | Dev |
| `docs/setup.md` | *Before you deploy*, *Deploy* step 2, *Next steps* (enter the token first), *Status and settings* (the reset deletes the saved token) | Dev |
| `README.md` (lines 61-64) | the token is entered in the wizard | Dev |
| `.dev.vars.example`, `package.json` `cloudflare.bindings` | as *Approach* | Dev |
| `CHANGELOG.md` | `## [Unreleased]`: the token is entered, changed and removed in the setup wizard; the deploy form asks only for `SELUNA_SECRET` | Dev |
| `test/fixtures/telegram/README.md` | the `get-me.json` row | Tester |

## Architecture check

- "Telegram never calls the Worker" holds: `getMe` is outbound from the signed-in step; no route, no webhook.
- "GitHub App credentials are only ever stored encrypted" is not weakened; the bot token joins them under the same
  encryption, key check and reset.
- The other guarantees are untouched; the token is still only in the request URL to Telegram, never logged.

## Security considerations

- [x] Limits: request bodies 1 MiB in bytes before decoding (`readBodyWithLimit`); the `getMe` answer 1 MiB in bytes
  before decoding (`readJsonWithLimit`); the token's length (at most 221 characters) is checked after form decoding by
  the allow-list, which admits only ASCII, so characters and bytes agree.
- [x] Exceptions: D1 errors in the step, the two forms and confirm are caught in the handler and answer the fixed
  *unavailable* notice; fetch errors, aborts and unreadable answers in `verifyBotToken` become `unavailable` and the
  fixed *token not saved* notice; no Telegram `description`, error text or token reaches a page or log. In delivery
  every error becomes `store-failed` or `no-token`.
- The guard (the allow-list) is applied to the form value before any Bot API URL is built and again to a value read
  from D1 (`damaged` otherwise); accepted forms per row 2-4; the cases of AC5 cover each class.
- The form field is never rendered with a `value`; failure pages are rendered from the result, never from the input.
- CSRF: both forms are signed-in forms bound to the session (`readTelegramForm`).

## Decision records

- `docs/decisions/0036-telegram-bot-token-in-the-setup-wizard.md` (Proposed) — amends 0013 and 0016 (both released).

## Out of scope / follow-ups

As in the spec. No follow-up issue.

## Challenge notes

1. (minor) **`deleteSecret` leaves the key check value behind.** Without this change the key check exists only while `secrets` has rows: it is written with the first credential (`src/store/secrets.ts:30-32`) and the reset removes it with the last one (`:235-237`). Under the plan, removing the token when it is the only `secrets` row leaves `meta.key_check` with no credentials. This happens whenever the GitHub App comes from Worker secrets or has not been created yet. If `SELUNA_SECRET` is then changed: `checkKey` reports `changed` (`:105-117`); the token form answers E12 ("saved credentials cannot be read") and `startGitHubApp`/`finishGitHubApp` answer reset-needed (`src/setup/github-step.ts:104-107,180-183`); the start page offers a reset of credentials that do not exist. **Instruction:** `deleteSecret` runs, in the same batch after the row delete, `DELETE FROM meta WHERE key = 'key_check' AND NOT EXISTS (SELECT 1 FROM secrets)` (the guard of `DELETE_KEY_CHECK`). A concurrent `writeEntries` still succeeds through its retry, which inserts a new key check. Add the test "deleteSecret deletes the key check with the last credential and keeps it while others remain" in `src/store/secrets.test.ts`, and state the rule in `docs/areas/storage.md` *Key check*.
2. (minor) **The AC16 tests do not cover what AC16 lists, and one listed state cannot occur.** AC16 and S10 ask for the token part "for each token state" with `TELEGRAM_CHAT_ID` set, including the E10 and E12 notices. The plan has three AC16 tests (missing, save, saved). E10 cannot appear on a page load in this state: that load makes no `getUpdates` call (S10), so a revoked saved token is never detected there. E12 appears only as the answer to a token form. **Instruction for the Tester:** add an `it.each` over `chatSecretDeps`-style envs for the S6 note, E9 (malformed Worker secret), E11 (unreadable) and E17 (damaged), each asserting the token card plus the chat-id note and zero Telegram requests. Add one POST test for E12 with `TELEGRAM_CHAT_ID` set. Record in `docs/areas/setup-wizard.md` that E10 is not shown while `TELEGRAM_CHAT_ID` is set.
3. (minor) **AC8 delivery evidence does not exercise the new path.** The plan reuses the existing case "there is no bot token" (`src/delivery.test.ts:223-227`). Its env `{ TELEGRAM_CHAT_ID: "222" }` has no `SELUNA_SECRET`, so `resolveBotToken` returns `missing` without reading D1. After a real removal, `SELUNA_SECRET` is set and the resolver reads an absent row. **Instruction for the Tester:** add "deliverMessages calls no Telegram, keeps the row pending with attempts 0 and logs no-token when SELUNA_SECRET is set and no token is saved" (env `{ SELUNA_SECRET, TELEGRAM_CHAT_ID }`, empty `secrets`).
4. (minor) **The `getMe` live check has no task.** The `getMe` answer is built from the Bot API reference, not from a real sample. No real Telegram sample exists in the repo: `test/fixtures/telegram/README.md` says every fixture is hand-written, as decision 0016 allowed. The reader takes only the status and the envelope's `ok`, which `findChats` and `sendNotification` already rely on, so this is not a major. But the plan's mitigation (verified-facts row 17 and decision 0036 *Consequences*: the Product Manager's live check before the PR is marked ready) does not appear in `tasks.md`. **Instruction:** add a `tasks.md` row, owner Product Manager via the orchestrator, gating "ready for review". On a deployed copy it saves a valid token, a revoked token, a mistyped token and the token of a bot with a webhook, and checks 303 / 502 *not accepted* / 502 *not accepted* / 303 + conflict notice. Also add a `get-me.json` row to the fixture README naming the reference sections (*Making requests*, *getMe*, *User*).

## Security notes

1. (non-blocking) **Removing the last secret leaves the key check value behind.** `deleteSecret` (`DELETE FROM secrets WHERE key = ?1`) on an instance where the bot token is the only `secrets` row leaves the `meta` key check value with no credential. That state was not possible before: the key check is inserted only with the first credential and deleted by the reset only once no credential is left (`DELETE_KEY_CHECK`, `src/store/secrets.ts`). After a later `SELUNA_SECRET` rotation, every write is refused (E12's text then says saved credentials cannot be read when none exist), and the owner has to run the reset. It is safe, but confusing. Suggestion: `removeBotToken` deletes the key check value in the same batch under the same guard as `DELETE_KEY_CHECK` (pinned value, no `secrets` row left), or the spec names this state.
2. (non-blocking) **The getMe live check is not tracked in `tasks.md`.** Row 17 gives it to the Product Manager before the PR is marked ready. Add it to the hand-back or the PR checklist so it is not lost (`.squad/team.md`, *Test doubles that model a real component*).
3. (non-blocking) **Browser autofill is not measured.** S1/AC1 promise a field "not filled by the browser" through `type="password"` and `autocomplete="off"` (plan, *Layout*). Major browsers ignore `autocomplete="off"` on password fields. On the `/setup` origin, where the login already saved `SELUNA_SECRET`, a browser may fill that secret into the token field, or offer to replace the saved login password with the bot token. The allow-list stops a hex `SELUNA_SECRET` before any request (400), so nothing leaks. But a password manager that replaces the saved `SELUNA_SECRET` would cost the owner their key. Suggestion: the live check also observes autofill and save prompts, or the field uses `autocomplete="new-password"` (or another measured choice), and the spec's wording follows what was observed.
