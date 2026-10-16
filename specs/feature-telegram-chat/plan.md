# Plan: Wizard step: Telegram chat

Source: Issue #9 | [spec.md](spec.md)
Status: Draft
Tier: security — the change calls a new Telegram Bot API method and reads its answer (security area *Outbound-only
Telegram* and *Parsing of external input*), adds pages and forms behind the setup login (*Setup login*), adds a
signed, session-bound form token and a signing key purpose, puts a Worker secret into an outbound URL, and widens
the bounded body reader (*Request body size*).

## Problem / root cause

Feature; summary of [spec.md](spec.md): a signed-in step `/setup/telegram` calls `getUpdates` once per page load,
lists private chats and groups by name, sends a test message carrying a six-digit code to the chosen chat and stores
its id in `settings` (`telegram_chat_id`) only once the owner has typed that code back (proof that the owner reads the
chat; revision after the Security plan review, *Challenge* B1); a `TELEGRAM_CHAT_ID` Worker secret takes precedence;
missing or invalid bot tokens give understandable errors; the bot never gets a webhook.

Claims of the issue, checked against the code:

- "Dependency #8 [Setup] Wizard login and protection" — **confirmed** on `main`: issue #8 is closed, PR #36
  (`9ad6bdf`) added the login, PR #39 (`8f824ed`) bound the signed-in CSRF token to the session
  (`src/setup/handler.ts`, `src/setup/csrf.ts`). The signed-in branch today serves only `GET /setup` and
  `POST /setup/logout` (`src/setup/handler.ts:171-180`); everything else answers 404.
- "stores the chat ID in `settings`" — **confirmed** possible without a migration: `settings (key, value)` exists
  (`migrations/0001_initial_schema.sql`, `docs/areas/storage.md` *Tables*), and decision 0014 says `settings` takes
  new keys without one. **No access module exists yet** for `settings` (only `src/store/secrets.ts` and
  `src/store/login-attempts.ts`); decision 0014 assigns it to the first issue that reads or writes the table — this one.
- "`TELEGRAM_BOT_TOKEN`" — **confirmed** as a Worker secret asked by the deploy form (`.dev.vars.example`,
  `package.json` `cloudflare.bindings`, `docs/areas/deployment.md` *Worker secrets*, decision 0013). **No code reads
  it yet** (`grep -rn TELEGRAM src` finds nothing); `Env` in `worker-configuration.d.ts` declares only `DB`, so
  secrets are read from `env: object` and narrowed, as `src/webhook-secret.ts` does.
- "The bot never gets a webhook; Seluna only sends" — **confirmed as intended** and kept: no route is added outside
  `/setup`, and no `setWebhook` / `deleteWebhook` call is made. The *wording* of the guarantee in
  `docs/ARCHITECTURE.md:43-45` ("Telegram is only ever called, never a source of input") and of the security area
  *Outbound-only Telegram* in `.squad/project.md` ("only calls … (`sendMessage`)", "accepts no input from Telegram")
  is **made untrue by the issue's own scope** (`getUpdates` reads data from Telegram); both are reworded below, with
  the reasoning in decision 0016. This is the Product Manager's own request, so no escalation.
- "`TELEGRAM_CHAT_ID` Worker secret" — **new**: not mentioned anywhere yet; it is optional and set by hand, so it is
  **not** added to `.dev.vars.example` or `cloudflare.bindings` (the deploy form asks exactly for what those list,
  `docs/areas/deployment.md:43`).

Related defects found on the way: none in code. Two documentation points become stale with this change and are
updated here: the start page text "The setup steps follow in a later version" (`src/setup/texts.ts:28`,
`docs/areas/setup-wizard.md:25`, `docs/setup.md:23`), and the body-size rule that lists only the login and logout
forms as body readers under `/setup` (`docs/areas/http-routes.md:207`). `.squad/project.md` *Integration surface*
names "the setting table in `README.md`", which does not exist; nothing is added to `README.md` (the settings are
documented in the area documents and `docs/setup.md`).

## Acceptance criteria

Exact English texts are in *Texts* below; tests compare against `TEXTS.en` and the area document carries the same
wording. "Telegram is called" means a request reaches the injected `fetch` (the Telegram double).

- [ ] **AC1 — Chats are recognized from `getUpdates`.** Given a successful `getUpdates` answer, `parseChats` returns
  each private chat (`type` `private`, name = `first_name`, plus a space and `last_name` when present; `username`
  when it matches `^[A-Za-z0-9_]{1,64}$`) and each group (`type` `group` or `supergroup`, name = `title`) found in the
  `chat` of an update's `message`, `edited_message` or `my_chat_member`, each once, newest update first (array order
  is oldest first), named by its newest update. A chat whose id is not a safe integer, a chat of another type
  (`channel`), and an update without one of those three fields are skipped. A missing name falls back to the
  decimal id. An answer that is not an object with `ok: true` and an array `result` yields `undefined`.
  Tests (`src/telegram.test.ts`): `parseChats lists the private chat and the group of the getUpdates fixture`,
  `parseChats lists a supergroup as a group`, `parseChats lists each chat once, newest first, named by its newest update`,
  `parseChats skips channels, ids that are not safe integers and updates without a chat`,
  `parseChats names a chat without a name by its id`,
  `parseChats returns undefined for an answer that is not ok or has no result array`.
- [ ] **AC2 — Removed and migrated chats are left out.** A chat whose newest update is a `my_chat_member` with
  `new_chat_member.status` `left` or `kicked`, and a chat whose newest update is a message carrying
  `migrate_to_chat_id`, are not listed; a later update of the same chat lists it again.
  Tests: `parseChats leaves out a chat whose newest update removed or blocked the bot`,
  `parseChats lists a chat again after an update newer than its removal`,
  `parseChats leaves out a group that was migrated to a supergroup`.
- [ ] **AC3 — Names are bounded and rendered as inert text.** A name (and a username) is cut to its first 128 code
  points; on the page every name is HTML-escaped and wrapped in its own `<bdi>`, and a username is shown as
  `@<username>` in a separate `<bdi class="username">` after the name's element, so a name cannot pose as a
  username. Tests: `parseChats cuts a name to 128 code points` (`src/telegram.test.ts`),
  `renderTelegramPage escapes each chat name and wraps it in bdi`,
  `renderTelegramPage shows the username in an element of its own after the name` (`src/setup/pages.test.ts`).
- [ ] **AC4 — One `getUpdates` request, outbound only.** `findChats` makes exactly one request:
  `POST https://api.telegram.org/bot<token>/getUpdates`, `Content-Type: application/json`, body
  `{"offset":-100,"limit":100,"timeout":0}` (no `allowed_updates`), with an abort signal (10 s). Answers:
  2xx with a body `parseChats` accepts → `found`; 401 or 404 → `token-rejected`; 409 → `conflict`; any other status,
  a rejected `fetch` (network, abort), a body above 1 MiB (counted in bytes before decoding, through
  `readBodyWithLimit`), a body that is not UTF-8 JSON, or a 2xx body `parseChats` rejects → `unavailable`. No other
  Bot API method than `getUpdates` and `sendMessage` is ever called.
  Tests: `findChats sends one getUpdates request with offset -100, limit 100 and timeout 0`,
  `findChats returns the chats of a successful answer`,
  `findChats maps 401 and 404 to token-rejected`, `findChats maps 409 to conflict`,
  `findChats maps another status, a failed fetch, a body over 1 MiB and a body that is not JSON to unavailable`.
- [ ] **AC5 — Bot token from the environment, with an allow-list.** `botTokenFromEnv` returns `missing` when
  `TELEGRAM_BOT_TOKEN` is absent, not a string or empty; `malformed` unless the value matches exactly
  `^[0-9]{1,20}:[A-Za-z0-9_-]{1,200}$` (no trimming); otherwise `usable` with the value. Every form in *Guard: bot
  token* below is `malformed`. Tests: `botTokenFromEnv reports missing for an absent, empty or non-string token`,
  `botTokenFromEnv reports malformed for every form the URL parser would reinterpret`,
  `botTokenFromEnv accepts a token of digits, a colon and letters, digits, - and _`.
- [ ] **AC6 — The step page.** `GET /setup/telegram` with a valid session (and `TELEGRAM_CHAT_ID` not set) answers
  200 with the Telegram page: heading, intro, the saved chat (`Saved chat:` and the id read from `settings`, or
  *no saved chat*), and the link `/setup/telegram` (*search*). With chats found: the chats intro, one radio input
  `name="chat"` (`required`) per chat with value = decimal id and a label of name, `@username` when present and the
  kind (*private chat* / *group*), the session-bound CSRF field and the confirm button, in a form
  `method="post" action="/setup/telegram"`. With none found: the *no chats* text and no form. `getUpdates` is called
  exactly once per request. The start page links to `/setup/telegram` (link text = the Telegram heading) instead of
  the old "later version" text. Without a session the request gets the login page and Telegram is not called.
  Tests (`src/setup/handler.test.ts` unless named): `handleSetup shows the Telegram step with the private chat and the group found`,
  `handleSetup calls getUpdates exactly once per Telegram step page`,
  `handleSetup shows the no-chats text and no form when getUpdates finds no chat`,
  `handleSetup shows the saved chat id on the Telegram step`,
  `handleSetup answers GET /setup/telegram without a session with the login page and calls no Telegram API`,
  `renderStartPage links to the Telegram step` (`src/setup/pages.test.ts`).
- [ ] **AC7 — Confirm: a test message with a code, nothing stored yet.** `POST /setup/telegram` with a valid
  session-bound CSRF token and exactly one field `chat` that is a chat id (*Guard: chat id*) draws a code
  (`newChatCode`) and sends one `sendMessage` request (`POST https://api.telegram.org/bot<token>/sendMessage`, JSON
  `{"chat_id":<id as JSON number>,"text":"<telegramTestMessage in the page language> <code>"}`, no `parse_mode`).
  Only when Telegram answers 2xx with `{"ok":true,…}` does it answer **200** with the *code* page: heading, the
  *code sent* text with the decimal chat id, the *code intro*, a form `method="post" action="/setup/telegram/verify"`
  with the session-bound CSRF field, a hidden field `proof` = `createChatProof(key, session, chatId, code, now)`, a
  text input `name="code"` (`required`, `inputmode="numeric"`, `autocomplete="one-time-code"`, `pattern="[0-9]{6}"`,
  `maxlength="6"`) and the *code button*, and the search link. `settings` is not written; the code appears in the
  request to Telegram only, never in the page or the response headers. Works for a private chat id and a negative
  group id. Tests: `handleSetup sends a test message with a six-digit code to the confirmed private chat and stores nothing yet`,
  `handleSetup sends a test message with a six-digit code to the confirmed group and stores nothing yet`,
  `handleSetup shows the code form with a proof for the chat and without the code`,
  `sendMessage posts chat_id and text as JSON to sendMessage` (`src/telegram.test.ts`).
- [ ] **AC8 — Confirm failures send no code and store nothing.** In this order: body over 1 MiB → 413, unreadable →
  400 (empty bodies); CSRF missing/wrong/unbound → **403** notice *form expired*; `TELEGRAM_CHAT_ID` set → **409**
  with the *chat id secret* view; `chat` missing, repeated or not a chat id → **400** notice *invalid chat*; token
  missing → **503** notice *token missing*; malformed → **503** notice *token malformed*; `sendMessage` 401/404 →
  **502** notice *token rejected*; any other failure (status, `ok` not `true`, fetch rejected, unreadable or
  oversized answer) → **502** notice *send failed*. No confirm request writes `settings` or shows a code form on
  failure; in the 413, 400, 403, 409 and 503-token cases Telegram is not called. Error pages are the *notice-only*
  Telegram page (heading, intro, notice, search link; no `getUpdates` call).
  Tests: `handleSetup rejects the confirm form without a valid session-bound CSRF token with 403 and calls no Telegram API`,
  `handleSetup rejects a missing, repeated or malformed chat field with 400 and calls no Telegram API`,
  `handleSetup shows no code form and answers 502 when the test message fails`,
  `handleSetup answers 502 with the token-rejected notice when sendMessage answers 401`,
  `handleSetup answers a confirm body over 1 MiB with 413`,
  `sendMessage maps 401 and 404 to token-rejected and every other failure to failed` (`src/telegram.test.ts`).
- [ ] **AC9 — Missing or invalid token: understandable error.** On `GET /setup/telegram`: token missing → 200 page
  with the *token missing* notice, malformed → *token malformed* notice, both without calling Telegram; `getUpdates`
  401/404 → *token rejected* notice; 409 → *conflict* notice; `unavailable` → *Telegram unavailable* notice. No
  page shows the token, a Telegram `description`, or a runtime error text.
  Tests: `handleSetup shows the token-missing notice and calls no Telegram API`,
  `handleSetup shows the token-malformed notice and calls no Telegram API`,
  `handleSetup shows the token-rejected notice when getUpdates answers 401`,
  `handleSetup shows the conflict notice when getUpdates answers 409`,
  `handleSetup shows the Telegram-unavailable notice when getUpdates fails`.
- [ ] **AC10 — `TELEGRAM_CHAT_ID` takes precedence.** When it is a non-empty string, `GET /setup/telegram` answers
  200 with the *chat id secret* text, no form, no saved-chat line, and calls neither Telegram nor D1; the page never
  shows the secret's value. `isChatIdSecretSet` is true exactly for a non-empty string.
  Tests: `handleSetup shows the Telegram step as configured by TELEGRAM_CHAT_ID without calling Telegram`,
  `handleSetup answers the confirm form with 409 while TELEGRAM_CHAT_ID is set and sends nothing`,
  `isChatIdSecretSet is true only for a non-empty string` (`src/telegram.test.ts`).
- [ ] **AC11 — Settings store.** `writeSetting` upserts `(key, value)`; `readSetting` returns the stored text or
  `undefined`; D1 errors propagate (not turned into `undefined`). A stored `telegram_chat_id` that is not a chat id is
  shown as *no saved chat*. Tests (`src/store/settings.test.ts`): `readSetting returns undefined for a key never written`,
  `writeSetting stores a value and a second write replaces it`, `readSetting and writeSetting pass D1 errors on`;
  `handleSetup shows no saved chat for a stored telegram_chat_id that is not a chat id` (`src/setup/handler.test.ts`).
- [ ] **AC12 — D1 failure on the step page.** When reading `settings` fails, `GET /setup/telegram` answers **503**
  with the notice-only page and the *unavailable* notice and calls no Telegram API.
  Test: `handleSetup answers the Telegram step with 503 and calls no Telegram API when D1 fails`.
- [ ] **AC13 — The bounded reader takes a response.** `readBodyWithLimit` accepts a `Response` as well as a
  `Request` with the same rules (declared `Content-Length` above the limit rejected before reading, counted while
  reading). Test (`src/body.test.ts`): `readBodyWithLimit reads a Response body within the limit and rejects one above it`.
- [ ] **AC14 — Texts.** Every new text exists in English and German; the English notices and step texts are word
  for word those of *Texts*; the test message is sent in the language of the request (`?lang=de` → German).
  Tests (`src/setup/texts.test.ts`, adapted): `texts define a non-empty text for every key in English and German`
  (notice count 13), `texts word the English notices as the area document does` (extended),
  `texts word the English Telegram step as the area document does`;
  `handleSetup sends the test message in German for a German page` (`src/setup/handler.test.ts`).
- [ ] **AC15 — Verify: the code saves the chat.** `POST /setup/telegram/verify` with a valid session-bound CSRF
  token, exactly one field `proof` and exactly one field `code` for which `checkChatProof(key, proof, session, code,
  now)` is `valid` writes `settings` `telegram_chat_id` = the proof's decimal chat id (replacing an earlier value)
  and answers **303** `Location: /setup/telegram`; the step page then shows it as the saved chat. Telegram is not
  called. Tests: `handleSetup saves the chat when the code of its test message is entered`,
  `handleSetup saves a group chat when the code of its test message is entered`,
  `handleSetup replaces an earlier saved chat`, `handleSetup calls no Telegram API on the verify form`.
- [ ] **AC16 — Verify failures store nothing.** In this order: body over 1 MiB → 413, unreadable → 400 (empty
  bodies); CSRF missing/wrong/unbound → **403** notice *form expired* (notice-only page); `TELEGRAM_CHAT_ID` set →
  **409** with the *chat id secret* view; `proof` missing or repeated, or `checkChatProof` `invalid` (malformed,
  expired, expiry more than 10 minutes ahead) → **400** notice-only page with the notice *code expired*;
  `checkChatProof` `wrong-code` (another code, a missing, repeated or malformed `code` field, a proof whose chat id
  was altered, a proof of another session or another `SELUNA_SECRET`) → **400** code page for the proof's chat id
  with the same proof and the notice *wrong code*; D1 write fails → **503** notice *unavailable*. None of these
  writes `settings`, and none calls Telegram. Tests:
  `handleSetup stores nothing and shows the wrong-code notice for a wrong code`,
  `handleSetup stores nothing when the code for chat A is sent with a proof altered to chat B`,
  `handleSetup stores nothing for the proof and code of another session`,
  `handleSetup stores nothing and shows the code-expired notice for a proof older than 10 minutes`,
  `handleSetup stores nothing and shows the code-expired notice for a missing, repeated or malformed proof`,
  `handleSetup rejects the verify form without a valid session-bound CSRF token with 403`,
  `handleSetup answers the verify form with 409 while TELEGRAM_CHAT_ID is set and stores nothing`,
  `handleSetup answers 503 with the unavailable notice when saving the chat fails`,
  `handleSetup answers a verify body over 1 MiB with 413`.
- [ ] **AC17 — Chat proof.** `newChatCode` returns six decimal digits (uniform: a `Uint32` from
  `crypto.getRandomValues`, redrawn while ≥ 4,294,000,000, then modulo 1,000,000, zero-padded). `createChatProof`
  returns `v1.<chatId>.<expires>.<mac>` with `<expires>` = `now` + 600,000 ms in decimal and `<mac>` the HMAC-SHA256
  (base64url without padding, 43 characters) under the `setup-telegram` key of the ASCII text
  `chat-proof.v1.<chatId>.<expires>.<session>.<code>`. `checkChatProof` returns `invalid` unless the proof matches
  `^v1\.(-?[1-9][0-9]{0,15})\.([1-9][0-9]{0,14})\.([\w-]{43})$`, the chat id passes `parseChatId`, the MAC text is
  canonical base64url (`fromBase64Url`) and `now < expires ≤ now + 600,000 ms`; otherwise `wrong-code` (with the chat
  id) unless `code` matches `^[0-9]{6}$` and the MAC verifies with `crypto.subtle.verify` (constant time) for that
  session and code, which is `valid` (with the chat id). Tests (`src/setup/chat-proof.test.ts`):
  `newChatCode returns six decimal digits`,
  `checkChatProof accepts the code and session the proof was made for`,
  `checkChatProof reports wrong-code for another code, another chat id, another session and another key`,
  `checkChatProof reports wrong-code for a code that is not six digits`,
  `checkChatProof reports invalid for an expired proof and for an expiry more than 10 minutes ahead`,
  `checkChatProof reports invalid for every malformed proof` (table: empty, `v2.…`, chat id `0` / `+1` / `01` / 17
  digits / unsafe 16 digits, expiry `0` / 16 digits, MAC of 42 or 44 characters, a non-canonical last MAC character,
  `=` padding, an extra `.` segment, whitespace).
- [ ] **AC18 — A signing key of its own.** `SigningPurpose` gains `"setup-telegram"` with the label
  `seluna/setup-telegram/v1`; its key differs from the session and CSRF keys. Tests (`src/crypto.test.ts`,
  adapted): the table of `signingKeyFromEnv derives the $purpose key with HKDF-SHA256, salt and info seluna/$purpose/v1`
  gains a `setup-telegram` row (expected value computed by the Tester with an independent HKDF run, as the existing
  rows were); `signingKeyFromEnv derives different keys for setup-session, setup-csrf and setup-telegram` (renamed
  from the two-purpose test and extended).

The issue's own criteria map as: "A private chat and a group are both recognized and the test message arrives" →
AC1, AC6, AC7, AC15 (unit level, against fixtures written from the Bot API reference) plus the live check in *Runtime details* (only a real bot shows
the message arriving); "A missing or invalid `TELEGRAM_BOT_TOKEN` shows an understandable error" → AC5, AC8, AC9.

### Texts

English, exact (German translations by the Dev in `src/setup/texts.ts`; `<…>` is not part of the text):

| Key | Text |
| --- | ---- |
| `startBody` | Set up your instance step by step: |
| `telegramHeading` (also the start page link text) | Telegram chat |
| `telegramIntro` | Seluna sends its notifications to one Telegram chat. Open your bot in Telegram and send /start, or add the bot to a group. Then search for chats. |
| `telegramSearchLink` | Search for chats |
| `telegramChatIdSecret` | The chat is set by the Worker secret TELEGRAM_CHAT_ID, which takes precedence over a chat chosen here. To choose the chat here, delete that secret. |
| `telegramSavedChat` (followed by the id) | Saved chat: |
| `telegramNoSavedChat` | No chat is saved yet. |
| `telegramChatsIntro` | Chats your bot has seen recently. Anyone who messages your bot appears here, so choose only your own chat: Seluna sends a test message with a code to it, and the chat is saved once you enter that code. |
| `telegramNoChats` | No chat found. Send /start to your bot or add it to a group, then search again. Telegram keeps messages to the bot for 24 hours, and Seluna sees only the newest 100: if your bot receives many messages, send /start again just before you search. |
| `telegramPrivateChat` | Private chat |
| `telegramGroup` | Group |
| `telegramConfirmButton` | Send test message |
| `telegramTestMessage` (followed by a space and the code) | Seluna setup: to send the notifications of your instance to this chat, enter this code on your setup page. If you did not ask for it, ignore this message. Code: |
| `telegramCodeSent` (followed by the id) | Test message sent to chat: |
| `telegramCodeIntro` | Enter the six-digit code from that message to save the chat. If no message arrived, the chat is not yours: search again and choose another. |
| `telegramCodeLabel` | Code |
| `telegramCodeButton` | Save chat |
| notice `telegram-token-missing` | The Worker secret TELEGRAM_BOT_TOKEN is not set. In Telegram, send /newbot to @BotFather and copy the token it returns. In the Cloudflare dashboard open this Worker, then Settings, then Variables and Secrets, and add a secret named TELEGRAM_BOT_TOKEN with that token. Or run: npx wrangler secret put TELEGRAM_BOT_TOKEN |
| notice `telegram-token-malformed` | The Worker secret TELEGRAM_BOT_TOKEN is not a bot token. A token from @BotFather is digits, a colon, then letters, digits, - and _, without spaces. Copy it again from @BotFather and replace the secret in the Cloudflare dashboard under Settings, then Variables and Secrets. |
| notice `telegram-token-rejected` | Telegram does not accept the Worker secret TELEGRAM_BOT_TOKEN: it is mistyped or was revoked. Send /mybots to @BotFather, copy your bot's current token and replace the secret in the Cloudflare dashboard under Settings, then Variables and Secrets. |
| notice `telegram-conflict` | Telegram does not hand the bot's chats to Seluna because another program receives its updates (a webhook, or a program that polls the bot). Seluna needs a bot of its own: create one with /newbot at @BotFather, or remove the webhook from this bot. |
| notice `telegram-unavailable` | Telegram could not be reached or gave an answer Seluna cannot read. Please try again in a moment. |
| notice `telegram-send-failed` | The test message could not be sent, so the chat was not saved. Check that the bot is still in the chat and not blocked, then search again. |
| notice `telegram-invalid-chat` | Please choose a chat from the list. |
| notice `telegram-wrong-code` | The code does not match the test message. Check the code in your chat and enter it again. |
| notice `telegram-code-expired` | The code has expired or the form is no longer valid. Search for chats again and send a new test message. |

The existing four notices and the other existing texts stay as they are; only `startBody` changes.

### Guard: bot token

The token is placed in the URL path `https://api.telegram.org/bot<token>/<method>`, which the WHATWG URL parser
(the `Request` constructor) consumes. Allow-list `^[0-9]{1,20}:[A-Za-z0-9_-]{1,200}$`, matched against the raw
value. Forms the parser treats specially, and the guard's answer on each (each one is a row of the
`botTokenFromEnv reports malformed …` table test, written with doubled backslashes where it holds one):

| Form in the token | What the URL parser would do | Guard |
| ----------------- | ---------------------------- | ----- |
| `/` (`1:a/../setWebhook`) | new path segment, then a dot segment, i.e. another method | malformed |
| `\` | treated as `/` in a special scheme (`https`) | malformed |
| `?` | starts the query, the method name moves into it | malformed |
| `#` | starts the fragment, the method name is dropped | malformed |
| `%2F`, `%2e%2e`, `%` | percent-encoded `/` passed on, `%2e%2e` is a dot segment | malformed |
| `.` | part of a dot segment after a `/` | malformed |
| tab, LF, CR inside or at the end | removed silently from the URL | malformed |
| space, leading or trailing whitespace, C0/C1 controls | percent-encoded or stripped at the ends | malformed (no trimming) |
| non-ASCII letters or digits (`١`, `ä`) | percent-encoded | malformed |
| `@`, `:` beyond the first, `;`, `=`, `+` | literal in the path | malformed |
| no colon, empty id, empty secret, more than 20 id digits or 200 secret characters | — | malformed |

### Guard: chat id

The form field `chat` (and a stored `telegram_chat_id`) is a chat id when it matches `^-?[1-9][0-9]{0,15}$` and the
number is a safe integer (`Number.isSafeInteger`; Telegram documents at most 52 significant bits). Rejected, each a
row of the test `handleSetup rejects a missing, repeated or malformed chat field …` or of
`parseChatId rejects every other form` (`src/telegram.test.ts`): empty, `0`, `-0`, leading `+`, leading zeros,
whitespace anywhere, `1e5`, `0x10`, `1.0`, non-ASCII digits (`١٢٣`), `@channelname`, 17 digits, a 16-digit value
above `9007199254740991`; and a missing or repeated field.

## Behavior coverage

| spec.md *Behavior* | Covered by |
| ------------------ | ---------- |
| 1 Start page links to the step | AC6 (`renderStartPage links to the Telegram step`), AC14 |
| 2 Instructions and search link | AC6, AC14 |
| 3 One `getUpdates` per load, private chats and groups with names, once each, no channels | AC1, AC4, AC6 |
| 4 Removed, blocked and migrated chats not listed | AC2 |
| 5 No chat found | AC6 |
| 6 Confirm → test message with a code → code entered → store → step page with saved id | AC7, AC15, AC17, AC6 (saved id), AC11 |
| 7 Test message fails → nothing stored | AC8 |
| 16 Wrong, expired or foreign code → nothing stored | AC16, AC17, AC18 |
| 8 Missing / malformed / rejected token, no call when missing or malformed | AC5, AC8, AC9 |
| 9 Webhook or other poller → explained, webhook not removed | AC4 (`conflict`, only `getUpdates`/`sendMessage` called), AC9 |
| 10 Telegram unreachable / unreadable | AC4, AC9 |
| 11 No webhook, no route for Telegram, only `getUpdates` and `sendMessage` | AC4, AC7 (request URLs asserted); the existing 404 tests of `src/router.test.ts` for paths outside `/setup` |
| 12 `TELEGRAM_CHAT_ID` precedence, value not shown, no form, confirm and verify store nothing | AC10, AC8 (409), AC16 (409) |
| 13 Names escaped, isolated, cut to 128 | AC3 |
| 14 English and German, test message in page language | AC14 |
| 15 Behind the login, session-bound CSRF | AC6 (no session → login page), AC8 (403), AC16 (403) |

## Approach

- `src/telegram.ts` (new) — the Bot API client, the only module that knows Telegram's JSON: token and chat-id
  secret from the environment, `parseChatId`, `parseChats`, `findChats` (`getUpdates`), `sendMessage`. Requests are
  built as `new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal:
  AbortSignal.timeout(TELEGRAM_TIMEOUT_MS) })` and passed to the injected `TelegramFetch`; answers are read with
  `readBodyWithLimit(response, MAX_TELEGRAM_RESPONSE_BYTES)`, decoded with a fatal `TextDecoder` and `JSON.parse`
  inside a `try`, and narrowed from `unknown`. Errors never leave the module as exceptions: every outcome is a value.
  For `sendMessage` a 2xx answer counts as sent only when its body parses and has `ok: true`.
- `src/store/settings.ts` (new) — `readSetting` / `writeSetting` (`INSERT … ON CONFLICT (key) DO UPDATE`), and the key
  constant `TELEGRAM_CHAT_ID_SETTING = "telegram_chat_id"`.
- `src/body.ts` — `readBodyWithLimit` takes `Request | Response` (both have `headers` and `body`); no rule changes.
- `src/setup/chat-proof.ts` (new) — `newChatCode`, `createChatProof`, `checkChatProof` (AC17): the pending chat
  and the code live only in the signed form token `proof` and in the test message, never in D1, a cookie or the page;
  the MAC binds chat id, expiry, the request's session token and the code, so the code of chat A cannot save chat B,
  and a proof is useless in another session.
- `src/crypto.ts` — `SigningPurpose` gains `"setup-telegram"` (label `seluna/setup-telegram/v1`, AC18); no other
  change.
- `src/setup/telegram-step.ts` (new) — `telegramStepView` (order: `TELEGRAM_CHAT_ID` → `chat-id-secret`, no D1, no
  Telegram; read the saved chat from D1, errors propagate; token `missing`/`malformed` → `problem`, no Telegram;
  `findChats` → `chats` or `problem`), `confirmTelegramChat` (order as in AC8 after the CSRF check: secret, field,
  token, `newChatCode`, `sendMessage`, `createChatProof`; no D1) and `verifyTelegramChat` (order as in AC16 after the
  CSRF check: secret, fields, `checkChatProof`, `writeSetting`; no Telegram).
- `src/setup/pages.ts` / `texts.ts` — `renderTelegramPage` for the views above plus `notice-only` and `code`; the
  start page gets a list with one link; new texts and notices.
- `src/setup/handler.ts` — `SetupDeps.fetch`; `Context` gains `telegramKey` (from `signingKeyFromEnv(env,
  "setup-telegram")`, derived and checked with the other two keys); the signed-in branch routes `GET` and
  `POST /setup/telegram` and `POST /setup/telegram/verify`; a third signed-in form kind (`telegram`, session-bound
  CSRF exactly like `start`) used by both POSTs; a D1 error is caught in the handler (dropped, as in `signIn`) and
  answered 503 *unavailable*; both POST bodies are read with `readForm` (1 MiB).
- `src/index.ts` — passes `fetch: (request) => fetch(request)` into `setup`.
- No migration, no change to `wrangler.jsonc`, `.dev.vars.example` or `package.json` `cloudflare.bindings`, no new
  dependency.

Status codes (signed in): `GET /setup/telegram` → 200 for every view, 503 when D1 fails. `POST /setup/telegram` →
200 (code page), 413, 400, 403, 409, 400, 503, 502 as in AC7/AC8. `POST /setup/telegram/verify` → 303, 413, 400, 403,
409, 400, 400, 503 as in AC15/AC16. Other methods and paths → 404 (unchanged rule). Reloading the code page re-posts
the confirm form, which sends a new code; the browser asks first, and the older code stays usable until it expires.

## Options considered

1. **When `getUpdates` runs: on every load of `GET /setup/telegram` (chosen)** vs. **a POST "search" form with CSRF.**
   The GET changes no Seluna state, and cross-site navigations arrive signed out under `SameSite=Strict`; it does
   change state at Telegram: the negative offset makes Telegram discard the bot's updates older than the newest 100
   (option 2), which only Seluna reads. A forged load needs the owner's session, and its only effect is that same
   discard. It needs no extra form, and "search again" is a reload. The POST variant adds a form and a CSRF check for
   no gain.
2. **Which updates: `offset=-100, limit=100` (chosen)** vs. **no offset.** Without an offset Telegram returns the
   *oldest* 100 unconfirmed updates, so the owner's fresh `/start` can be missing when a group is busy. The negative
   offset returns the newest 100 and makes Telegram forget older ones — harmless for a bot only Seluna uses, and
   another program polling the same bot is already a `conflict`. `allowed_updates` is not sent: it is persisted by
   Telegram for later calls, and the default already includes `message`, `edited_message` and `my_chat_member`.
3. **Bot token in the URL: allow-list check before any call (chosen)** vs. **`encodeURIComponent`.** Encoding also
   keeps the method name intact, but sends a garbage token to Telegram and cannot tell "malformed" (a paste error,
   fixable in the dashboard) from "rejected" (revoked); the allow-list gives the owner the precise error without a call.
4. **Bot with a webhook (409): explain and stop (chosen)** vs. **call `deleteWebhook`.** Deleting would break whatever
   else uses the bot and would be a second, state-changing Bot API method; Seluna wants its own bot.
5. **Chat id stored in plain text in `settings` (chosen)** vs. **encrypted in `secrets`.** A chat id grants nothing
   without the bot token (`docs/areas/storage.md` *Encryption* already lists it as plain text).
6. **`TELEGRAM_CHAT_ID` shown as "configured" without its value (chosen)** vs. **showing the value.** No Worker
   secret is ever returned in a response (`.squad/project.md`, *Encrypted credentials*).
7. **Telegram reached through an injected `fetch` in `SetupDeps` (chosen)** vs. **stubbing `globalThis.fetch`.** The
   injected function keeps the double typed and local to each test, as the webhook secret source does; #12 can pass
   the same function to the outbox.
8. **Chats keyed by the newest update (chosen)** vs. **any update.** Keying by the newest update drops a chat the bot
   was removed from or blocked in, and the old id of a migrated group, which would otherwise fail the test message.
9. **When a chosen chat is stored: after the owner types back a code from the test message (chosen)** vs. **as soon
   as `sendMessage` succeeds** (the first plan) vs. **as soon as `sendMessage` succeeds, with a warning in the list
   and the username in an element of its own.** Anyone who knows the bot's username can put a chat into the list
   whose label copies the owner's (same first and last name, a fake `@name` inside the name, homoglyphs, a copied
   group title), and `sendMessage` succeeds for that chat, so storing on success would send every later notification
   (private repository names, pull request titles, security alerts) to the stranger. The code proves that the owner
   reads the chosen chat; the warning alone leaves the choice to the owner's eye and needs the Product Manager's
   acceptance of the residual risk (Security B1 option (b)). The code costs one extra form.
10. **Where the pending chat and code are kept between the two POSTs: a signed, session-bound form token valid for
    10 minutes (chosen)** vs. **a D1 row** vs. **a cookie.** The token needs no table, no cleanup and no migration;
    the MAC over chat id, expiry, session token and code makes it unforgeable, tied to one chat and one session, and
    keeps the code out of the page. A D1 row would need a key, expiry and cleanup; a cookie would add a fourth cookie
    with the same contents for no gain. A token can be submitted again until it expires; only the signed-in owner can
    submit it, so the number of tries is not limited.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/telegram.ts` | new: Bot API client (`botTokenFromEnv`, `isChatIdSecretSet`, `parseChatId`, `parseChats`, `findChats`, `sendMessage`) |
| Worker | `src/store/settings.ts` | new: `readSetting`, `writeSetting`, `TELEGRAM_CHAT_ID_SETTING` |
| Worker | `src/setup/telegram-step.ts` | new: `telegramStepView`, `confirmTelegramChat`, `verifyTelegramChat` |
| Worker | `src/setup/chat-proof.ts` | new: `newChatCode`, `createChatProof`, `checkChatProof` |
| Worker | `src/crypto.ts` | `SigningPurpose` and `SIGNING_KEY_LABELS` gain `setup-telegram` |
| Worker | `src/body.ts` | `readBodyWithLimit` takes `Request \| Response` |
| Worker | `src/setup/handler.ts` | `SetupDeps.fetch`; `Context.telegramKey`; routes `GET`/`POST /setup/telegram`, `POST /setup/telegram/verify`; form kind `telegram` |
| Worker | `src/setup/pages.ts` | `renderTelegramPage`, `TelegramPageView` (with the `code` view); start page links to the step |
| Worker | `src/setup/texts.ts` | new texts and nine notices; `startBody` reworded |
| Worker | `src/index.ts` | passes `fetch` into `setup` |
| Tests | `test/telegram.ts` | new: the Telegram Bot API double |
| Tests | `test/fixtures/telegram/*.json`, `test/fixtures/telegram/README.md` | new: Bot API answers written from the Bot API reference, marked as such (see *Test files*) |

## Signatures (for the Dev's skeleton)

`src/telegram.ts` (new):

```ts
/** Sends one request to the Telegram Bot API; injected so tests never reach the network. */
export type TelegramFetch = (request: Request) => Promise<Response>;

export const BOT_TOKEN_NAME = "TELEGRAM_BOT_TOKEN";
export const CHAT_ID_SECRET_NAME = "TELEGRAM_CHAT_ID";
export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
/** Largest Bot API answer read, in bytes before decoding: 1 MiB. */
export const MAX_TELEGRAM_RESPONSE_BYTES = 1_048_576;
/** Each Bot API request is aborted after 10 seconds. */
export const TELEGRAM_TIMEOUT_MS = 10_000;
/** `getUpdates` asks for the newest this many updates (`offset` is its negative). */
export const GET_UPDATES_LIMIT = 100;
/** A chat name or username is cut to this many code points. */
export const MAX_CHAT_NAME_CHARACTERS = 128;

export type BotToken =
  | { readonly kind: "usable"; readonly token: string }
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" };
/** `TELEGRAM_BOT_TOKEN` from the Worker environment, checked against the allow-list; never trimmed. */
export function botTokenFromEnv(env: object): BotToken;

/** Whether the Worker secret `TELEGRAM_CHAT_ID` is a non-empty string. */
export function isChatIdSecretSet(env: object): boolean;

/** The chat id `text` denotes (`^-?[1-9][0-9]{0,15}$`, safe integer), otherwise `undefined`. */
export function parseChatId(text: string): number | undefined;

export type ChatKind = "private" | "group";
export interface TelegramChat {
  readonly id: number;
  readonly kind: ChatKind;
  /** Display name, at most `MAX_CHAT_NAME_CHARACTERS` code points. */
  readonly name: string;
  /** Without `@`; `undefined` when the chat has none or it is not a valid username. */
  readonly username: string | undefined;
}
/** The chats of a `getUpdates` answer, newest first, or `undefined` when it is not a successful answer. */
export function parseChats(body: unknown): readonly TelegramChat[] | undefined;

export type FindChatsResult =
  | { readonly kind: "found"; readonly chats: readonly TelegramChat[] }
  | { readonly kind: "token-rejected" }
  | { readonly kind: "conflict" }
  | { readonly kind: "unavailable" };
/** Calls `getUpdates` once (`token` from `botTokenFromEnv`). Never throws. */
export function findChats(token: string, fetcher: TelegramFetch): Promise<FindChatsResult>;

export type SendMessageResult = "sent" | "token-rejected" | "failed";
/** Calls `sendMessage` once with plain text (no `parse_mode`). Never throws. */
export function sendMessage(token: string, chatId: number, text: string, fetcher: TelegramFetch): Promise<SendMessageResult>;
```

`src/store/settings.ts` (new):

```ts
/** `settings` key of the Telegram chat id chosen in the setup wizard (decimal text). */
export const TELEGRAM_CHAT_ID_SETTING = "telegram_chat_id";
/** The stored value of `key`, or `undefined`. D1 errors are not caught. */
export function readSetting(db: D1Database, key: string): Promise<string | undefined>;
/** Stores `value` under `key`, replacing an earlier value. D1 errors are not caught. */
export function writeSetting(db: D1Database, key: string, value: string): Promise<void>;
```

`src/setup/telegram-step.ts` (new):

```ts
export const TELEGRAM_STEP_PATH = "/setup/telegram";
export const CHAT_FIELD = "chat";

export type TelegramProblem = "token-missing" | "token-malformed" | "token-rejected" | "conflict" | "unavailable";
export type TelegramStepView =
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "problem"; readonly problem: TelegramProblem; readonly savedChatId: number | undefined }
  | { readonly kind: "chats"; readonly chats: readonly TelegramChat[]; readonly savedChatId: number | undefined };
/** What the step page shows; calls `getUpdates` at most once. D1 errors are not caught. */
export function telegramStepView(env: object, db: D1Database, fetcher: TelegramFetch): Promise<TelegramStepView>;

export const TELEGRAM_VERIFY_PATH = "/setup/telegram/verify";
export const PROOF_FIELD = "proof";
export const CODE_FIELD = "code";

export type ConfirmChatResult =
  | { readonly kind: "code-sent"; readonly chatId: number; readonly proof: string }
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "invalid-chat" }
  | { readonly kind: "token-missing" }
  | { readonly kind: "token-malformed" }
  | { readonly kind: "token-rejected" }
  | { readonly kind: "send-failed" };
/** Sends a test message with a new code to the one chat in `chatFields` and returns the proof for it; stores nothing. */
export function confirmTelegramChat(
  env: object,
  fetcher: TelegramFetch,
  proofKey: CryptoKey,
  session: string,
  chatFields: readonly string[],
  language: Language,
  now: Date,
): Promise<ConfirmChatResult>;

export type VerifyChatResult =
  | { readonly kind: "saved" }
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "code-expired" }
  | { readonly kind: "wrong-code"; readonly chatId: number; readonly proof: string };
/** Checks the one proof and code of the verify form and stores the proof's chat. Calls no Telegram API. D1 errors are not caught. */
export function verifyTelegramChat(
  env: object,
  db: D1Database,
  proofKey: CryptoKey,
  session: string,
  proofFields: readonly string[],
  codeFields: readonly string[],
  now: Date,
): Promise<VerifyChatResult>;
```

`src/setup/chat-proof.ts` (new):

```ts
/** A proof is accepted for 10 minutes after the test message was sent. */
export const CHAT_PROOF_LIFETIME_MS = 600_000;

/** Six decimal digits drawn uniformly with `crypto.getRandomValues`. */
export function newChatCode(): string;

/** `v1.<chatId>.<expires>.<mac>`; `key` from `signingKeyFromEnv(env, "setup-telegram")`, `session` the request's valid session token. */
export function createChatProof(key: CryptoKey, session: string, chatId: number, code: string, now: Date): Promise<string>;

export type ChatProofCheck =
  | { readonly kind: "valid"; readonly chatId: number }
  | { readonly kind: "wrong-code"; readonly chatId: number }
  | { readonly kind: "invalid" };
/** Checks `proof` against `session` and `code` at `now` as the area document's *Chat proof* says; the MAC in constant time. */
export function checkChatProof(key: CryptoKey, proof: string, session: string, code: string, now: Date): Promise<ChatProofCheck>;
```

`src/crypto.ts` (changed, final in the skeleton):

```ts
export type SigningPurpose = "setup-session" | "setup-csrf" | "setup-telegram";
// SIGNING_KEY_LABELS gains "setup-telegram": "seluna/setup-telegram/v1"
```

`src/setup/pages.ts` (new export, changed body of `renderStartPage`, signature unchanged):

```ts
export type TelegramPageView =
  | TelegramStepView
  | { readonly kind: "notice-only" }
  | { readonly kind: "code"; readonly chatId: number; readonly proof: string };
/** The Telegram step page; links like the login page. A `problem` view shows the notice of its problem. */
export function renderTelegramPage(language: Language, csrfToken: string, view: TelegramPageView, notice?: Notice): string;
```

`src/setup/texts.ts` (changed): `Notice` gains `"telegram-token-missing" | "telegram-token-malformed" |
"telegram-token-rejected" | "telegram-conflict" | "telegram-unavailable" | "telegram-send-failed" |
"telegram-invalid-chat" | "telegram-wrong-code" | "telegram-code-expired"`; `SetupTexts` gains the readonly string
fields `telegramHeading`, `telegramIntro`, `telegramSearchLink`, `telegramChatIdSecret`, `telegramSavedChat`,
`telegramNoSavedChat`, `telegramChatsIntro`, `telegramNoChats`, `telegramPrivateChat`, `telegramGroup`,
`telegramConfirmButton`, `telegramTestMessage`, `telegramCodeSent`, `telegramCodeIntro`, `telegramCodeLabel`,
`telegramCodeButton`.
In the skeleton the texts are real (they are data, not bodies); the tests that compare them are the Tester's.

`src/setup/handler.ts` (changed):

```ts
export interface SetupDeps {
  readonly env: object;
  readonly db: D1Database;
  readonly now: () => Date;
  /** Reaches the Telegram Bot API. */
  readonly fetch: TelegramFetch;
}
```

`src/body.ts` (changed): `export async function readBodyWithLimit(message: Request | Response, maxBytes: number): Promise<ReadBodyResult>`.

Files the skeleton rewrites: `src/setup/handler.ts` (field only; routing is the implementation), `src/body.ts`
(parameter type — this one is final in the skeleton, the body already works for both), `src/index.ts` (final),
`src/crypto.ts` (final: the union member and its label), `src/setup/texts.ts` (final in the skeleton).
`src/setup/chat-proof.ts` is new (stubs). `src/setup/pages.ts` gets the new export as a stub.

## Test files

By *Layout* (`.squad/stack.md`) and `docs/UNIT_TESTS.md`: one test file per module, beside it.

- `src/telegram.test.ts` (new) — AC1–AC5, AC7 (`sendMessage`), AC8 (`sendMessage` mapping), AC10 (`isChatIdSecretSet`),
  *Guard: chat id* (`parseChatId rejects every other form`, `parseChatId accepts a private and a supergroup id`).
- `src/store/settings.test.ts` (new) — AC11, against the real D1 of the test pool (`test/d1.ts`).
- `src/setup/chat-proof.test.ts` (new) — AC17, with keys from `test/keys.ts` (`signingKeyFor(secret, "setup-telegram")`).
- `src/crypto.test.ts` (adapted) — AC18.
- `src/setup/telegram-step.test.ts` (new) — only what the handler tests do not reach, added in the coverage pass.
- `src/setup/handler.test.ts` (extended) — AC6–AC12, AC14 (German test message), AC15, AC16; the code is read
  from the `text` of the `sendMessage` request the double recorded, and the proof from the code page's hidden field.
- `src/setup/pages.test.ts` (extended) — AC3 (`renderTelegramPage …`), AC6 (`renderStartPage links to the Telegram step`);
  its table of pages gains the Telegram page (chats view) and the code page so the shared page rules (no script, CSP
  hash, language links) run on them.
- `src/setup/texts.test.ts` (adapted) — AC14.
- `src/body.test.ts` (extended) — AC13.
- `test/telegram.ts` (new, Tester) — the **Telegram Bot API double**: a `vi.fn<TelegramFetch>()` that records every
  request (method name taken from the URL path, parsed JSON body) and answers per method from a fixture, a status
  and body given by the test, or a rejection; it fails the test on any method other than `getUpdates` and
  `sendMessage`.
- **Fixtures** (`test/fixtures/telegram/`, the stack's fixture directory, by Bot API method), owner **Tester**:
  **written from the Bot API reference** (<https://core.telegram.org/bots/api>: *Making requests*, *getUpdates*,
  *Update*, *Message*, *Chat*, *ChatMemberUpdated*, *ChatMember*, *sendMessage*), not captured from Telegram — the
  Product Manager decided so (log, step 2; decision 0016, *Consequences*). They are marked as such in
  `test/fixtures/telegram/README.md` (JSON holds no comment): the source, the sections each file follows, and that
  they are to be replaced by captured answers once a live run yields some. Files:
  - `get-updates.json` — one `{"ok":true,"result":[…]}` answer, oldest update first, with every field the reference
    marks as always present on the objects used (`update_id`, `message_id`, `date`, `chat`, `from` with `is_bot`,
    `first_name`; `my_chat_member` with `chat`, `from`, `date`, `old_chat_member`, `new_chat_member`, each with
    `status` and `user`). Variants: a private chat after `/start` (`message`, `first_name`, `last_name`, `username`,
    an `entities` entry `bot_command`); a second private chat with `first_name` only; a basic group the bot was added
    to (`my_chat_member` `left` → `member`, and a `message` with `new_chat_members`, negative id); a supergroup
    (`-100…` 13-digit id, `title`, `message`); an `edited_message`; a chat whose newest update is `my_chat_member`
    `kicked` (private, bot blocked) and one whose newest is `left` (group); a basic group whose newest message carries
    `migrate_to_chat_id`; an update of a type the parser ignores (`callback_query` or `channel_post`). Ids, names and
    usernames are invented.
  - `get-updates-unauthorized.json` — `{"ok":false,"error_code":401,"description":"Unauthorized"}` (the reference's
    error shape: `ok` false, `error_code`, `description`).
  - `get-updates-conflict.json` — the 409 shape with `error_code` 409 and a `description` naming the webhook.
  - `send-message.json` — `{"ok":true,"result":<Message>}` with the sent text, `chat` and `from` (the bot,
    `is_bot` true). The double answers it for any `chat_id` and `text`; the tests read the code from the request.

  Variants the fixtures lack (channel, unsafe id, missing name, oversized name, a newer update after a removal) are
  built in the test by copying an object of `get-updates.json` and changing one field, never hand-typed from
  scratch. Because the fixtures share the reference's assumptions, the tests cannot catch a deviation of the real
  API from it: that is the residual risk recorded in decision 0016 and closed only by the live check in *Runtime
  details*.

Existing test call sites of the changed `SetupDeps` (a new required field, the old shape no longer compiles): the
**Dev** adapts them in step 4, mechanically, no assertion touched — `src/setup/handler.test.ts:29-31` (`depsAt`:
add a `fetch` that rejects, so an unexpected Telegram call fails), `src/router.test.ts:25-29` (`SETUP_DEPS`) and
`src/router.test.ts:34` (`makeDeps` default), each with a `fetch` that rejects. `src/index.ts` is production code (Dev).
`src/setup/texts.test.ts:25` (`number of notices` 4 → 13) and `:28-36` (notice wording) are assertion changes: the
**Tester** in step 5, as is `src/crypto.test.ts:236-275` (AC18: the two-purpose test renamed and extended, a
`setup-telegram` row in the known-HMAC table). The new `SigningPurpose` member breaks no call site (`test/keys.ts`
takes the union).

Files of the change no unit test can cover: none. (`src/index.ts` keeps being loaded by `src/index.test.ts`; the
added arrow is on a line that test executes.)

## Areas

- [Setup wizard](../../docs/areas/setup-wizard.md) (main area of the change) — *Paths*: the signed-in branch answers
  `GET` and `POST /setup/telegram` and `POST /setup/telegram/verify`, the start page links to the step (sentence on
  "later version" replaced); a new section *Telegram chat* with: when `getUpdates` runs and with which parameters,
  and that every load makes Telegram discard the bot's updates older than the newest 100 (so the GET changes no
  Seluna state but does change Telegram's); which chats are listed and how they are named (AC1–AC3); the confirm
  order and status codes (AC7, AC8); a subsection *Chat proof* with the code, the proof format, its 10-minute
  lifetime, its binding to chat, session and code, the key label `seluna/setup-telegram/v1`, and the verify order
  and status codes (AC15–AC17); the `TELEGRAM_CHAT_ID` precedence (AC10); the bot token allow-list; that no webhook
  is set or removed; the 1 MiB / 10 s bounds. *CSRF protection*: the confirm and verify forms are signed-in forms.
  *Texts*: the new English texts word for word. *Limits and errors*: Telegram answers never reach a page or the log;
  anyone who messages the bot appears in the list with a name of their choosing, so a label proves nothing, and a
  chat is saved only after its code is typed back; a wrong chat saved anyway (the owner typed a code a stranger gave
  them) is corrected by choosing again, which replaces the earlier value; a stranger who sends the bot many messages
  can push the owner's chat out of the newest 100 updates (*no chats* — send `/start` again just before searching)
  or make the answer exceed 1 MiB (*Telegram unavailable* until 100 newer, smaller updates have arrived), and the
  workaround for both is the `TELEGRAM_CHAT_ID` Worker secret. Owner: **Dev**.
- [Storage](../../docs/areas/storage.md) — *Tables*: the `settings` key `telegram_chat_id` (decimal text of a chat
  id), written only by the setup wizard after the code of a successful test message was typed back; link to Setup
  wizard. *Encryption* (the list of key labels): `seluna/setup-telegram/v1` for the chat proof key. Owner: **Dev**.
- [Deployment](../../docs/areas/deployment.md) — *Worker secrets*: a row `TELEGRAM_CHAT_ID` (optional, the chat id;
  takes precedence over the wizard's choice; set by hand; not asked by the deploy form); and below the table one
  sentence on `TELEGRAM_BOT_TOKEN`: the Bot API puts the token into the request URL, so turning on Workers traces or
  logs that record outbound requests in the Cloudflare dashboard records the token with them, and the owner who does
  so treats those traces as secret or replaces the token with `/revoke` at @BotFather afterwards. Owner: **Dev**.
- [HTTP routes](../../docs/areas/http-routes.md) — *Request body size*: `POST /setup/telegram` and
  `POST /setup/telegram/verify` join the form submissions that read a body. Owner: **Dev**.

## Documentation updates

- `docs/ARCHITECTURE.md` — the guarantee sentence on Telegram, *Security model*, *Configuration* (`TELEGRAM_CHAT_ID`),
  link to decision 0016. Owner: **Lead** (done with this plan, reworded in the revision for N2).
- `docs/decisions/0016-telegram-chat-in-the-setup-wizard.md` and its index row — **Lead** (done, `Proposed`; revised).
- `.squad/project.md` — *Security areas*, *Outbound-only Telegram*: "the Worker calls only the Telegram Bot API
  methods `getUpdates` (in the setup wizard's Telegram step, `src/setup/telegram-step.ts`) and `sendMessage`
  (`src/telegram.ts`); it never sets or deletes a webhook and exposes no Telegram route; the input it takes from
  Telegram is the `getUpdates` answer of the signed-in step and the status of each `sendMessage` answer, both read
  bounded (1 MiB) and narrowed in `src/telegram.ts`; a chat is stored only after the owner typed back the code of its
  test message (`src/setup/chat-proof.ts`); the bot token appears only in the request URL, which Seluna never logs."
  *Test doubles*, *Telegram Bot API double*: name `test/telegram.ts`, the injected `TelegramFetch` instead of a stub
  on `globalThis.fetch`, and its `getUpdates` answers from `test/fixtures/telegram/`, which are written from the Bot
  API reference (not captured; see the `README.md` there). Owner: **Dev** (the Lead may not write `.squad/`).
- `docs/setup.md` — *Next steps*: after signing in, open the Telegram step, send `/start` to the bot (or add it to a
  group), search, choose your own chat, and type the code of the test message into the setup page; optional
  `TELEGRAM_CHAT_ID`. Owner: **Dev**.
- `CHANGELOG.md` — under `## [Unreleased]` / `### Added`: "Setup wizard step *Telegram chat*: lists the private
  chats and groups your bot has seen (`getUpdates`), sends a test message with a code to the chosen one and saves its
  id once the code is entered; an optional `TELEGRAM_CHAT_ID` Worker secret takes precedence; a missing or invalid
  `TELEGRAM_BOT_TOKEN` is explained." Owner: **Dev**.
- `README.md`, `.dev.vars.example`, `package.json` `cloudflare.bindings`, `wrangler.jsonc`,
  `worker-configuration.d.ts`: no change (the new secret is optional and set by hand; Worker secrets are not part of
  the generated `Env`).

## Architecture check

- *A draft pull request triggers no notification*, *invalid signature has no effect*, *processed once*, *outbox
  before delivery*, *releases by tag*: untouched (no webhook, outbox or release code changes).
- *Each user's data stays in that user's own Cloudflare account*: kept, and now enforced for the chat too — the chat
  id is stored in the instance's D1 only after the owner proved they read the chat, so notifications cannot be
  steered to a stranger's chat by a look-alike label.
- *GitHub App credentials only encrypted*: untouched.
- `docs/ARCHITECTURE.md` "Telegram is only ever called, never a source of input": reworded, not weakened in what it
  protects — Telegram still never calls the Worker (no route, no webhook); the input taken from it is the
  `getUpdates` answer of the signed-in setup step and the status of each `sendMessage` answer, bounded and narrowed.
  The issue (the Product Manager's request) asks for exactly this; decision 0016 records it.

## Security considerations

- [x] Limits and where they apply: Telegram answer ≤ 1 MiB counted in bytes **before** UTF-8 decoding and JSON
  parsing; form body ≤ 1 MiB in bytes **before** decoding (existing reader); chat name and username cut to 128 code
  points **after** JSON decoding (so the rendered text is bounded: at most 100 chats × (128 + 128) code points,
  ×6 after HTML escaping in the worst case); `getUpdates` returns at most 100 updates; each Bot API call is aborted
  after 10 s (Security measured in workerd that `AbortSignal.timeout` interrupts both the header wait and a stalled
  body read); one `getUpdates` per page load and one `sendMessage` per confirm; a proof is accepted for 10 minutes.
- [x] Exceptions that can reach a user-visible failure: a rejected `fetch` (network, abort), a body read error, a
  `TextDecoder`/`JSON.parse` error → *Telegram unavailable* / *send failed*; a D1 error → *unavailable*. No runtime
  message, Telegram `description`, token or code reaches a page or the log; nothing new is logged (the router's
  per-request entry stays method, path, status).
- [x] The token in the URL: allow-listed (*Guard: bot token*) before it is placed there; Seluna never logs the URL;
  `wrangler.jsonc` enables no observability that would record subrequest URLs (the Reviewer checks it stays so); an
  owner who turns on Workers traces in the dashboard records it, which the Deployment area says (Security N3).
- [x] Attacker-controlled text: anyone who knows the bot's username can message it, so names in the list are
  hostile input — escaped, `<bdi>`-isolated, bounded, the username in an element of its own, never placed in an
  attribute other than the numeric `value`; the chat id posted back is re-validated (*Guard: chat id*), not trusted
  from the page.
- [x] Chosen chat: a label proves nothing (a stranger can copy the owner's name, put a fake `@name` into a name, use
  homoglyphs or copy a group title), so a chat is stored only after the owner types back the six-digit code its test
  message carried (AC15–AC17). The proof is an HMAC under a key of its own over chat id, expiry, session token and
  code: it cannot be forged without `SELUNA_SECRET`, a code for chat A cannot save chat B, a proof is useless in
  another session or after 10 minutes, and the code is never in the page, so the page source does not reveal it. A
  stranger who receives a code cannot use it (they have no session); what remains is an owner who types in a code a
  stranger sends them, which the test message's text ("If you did not ask for it, ignore this message") and the code
  page ("If no message arrived, the chat is not yours") speak against. Tries are not limited: only the signed-in owner
  can submit, and 10^6 codes in 10 minutes is no gain to them over choosing again.
- [x] CSRF: the confirm and verify forms are signed-in forms with the session-bound token (decision 0015);
  `GET /setup/telegram` changes no Seluna state, only Telegram's (older updates discarded); a cross-site navigation
  arrives signed out (`SameSite=Strict`).
- [x] `TELEGRAM_CHAT_ID` and `TELEGRAM_BOT_TOKEN` values never appear in a response.
- [x] Crowding the update window (Security N1, Devil's Advocate 2): a stranger who sends the bot 100 messages can push
  the owner's `/start` out of the list, or with long messages push the answer above 1 MiB (*Telegram unavailable*).
  Both fail closed (nothing stored); the first is undone by sending `/start` again (the `telegramNoChats` text says
  so), the second lasts until 100 newer updates arrived, and `TELEGRAM_CHAT_ID` bypasses both. A larger limit only
  raises what the stranger has to send; a smaller `limit` makes the window easier to crowd. Recorded in decision
  0016 *Consequences* and the area document.

### Runtime details no one can verify beforehand

The session cannot reach `api.telegram.org` (the egress proxy refuses it), so these rest on the Bot API reference
and are *unverified* until the live check below (no real sample is provided; the fixtures follow the same reference);
the design fails closed on each (nothing stored, a fixed notice):

1. An unknown or revoked token is answered with 401 (some malformed paths with 404): both map to *token rejected*;
   anything else is *unavailable* / *send failed*.
2. A bot with a webhook, or polled by another program, answers `getUpdates` with 409 → *conflict*.
3. Adding the bot to a group produces an update carrying the group's `chat` under the default `allowed_updates`
   (`my_chat_member`, and the `new_chat_members` service message even in privacy mode) — the live check settles it.
4. A negative `offset` returns the newest updates. If it did not, the oldest ones come back and a fresh `/start` may
   be missing: the page shows *no chats*, nothing breaks.
5. A `Request` built with `signal: AbortSignal.timeout(…)` keeps the signal in workerd — **settled**: Security measured
   it in its plan review (the signal is kept, and the timeout interrupts header wait and body read), so the test
   asserts `request.signal` is present and not aborted.
6. `chat_id` as a JSON number is accepted for a negative 13-digit supergroup id.
7. The shape of `getUpdates` and `sendMessage` answers (field names, `chat.type` values, `first_name` always present
   on a private chat, `title` on a group, ids within 52 bits) is as the reference documents it. A field that is
   missing or of another type makes `parseChats` skip the update or the answer `unavailable`, never a stored value.

Verification: a live check on a deployed copy before the PR is marked ready — a private chat and a basic group both
listed, the test message with its code arrives in both and typing the code saves the chat, a wrong token shows
*token rejected*, and a bot with a webhook shows *conflict* (points 1–4, 6 and 7; the issue's first criterion cannot
be shown otherwise). Owner: the Product Manager, requested by the orchestrator in the PR's *Next steps*. A deviation
the live check finds is a new issue, not a silent fixture edit.

## Decision records

- [`docs/decisions/0016-telegram-chat-in-the-setup-wizard.md`](../../docs/decisions/0016-telegram-chat-in-the-setup-wizard.md)
  (Proposed) — `getUpdates` on page load with a negative offset (and that it discards older updates at Telegram), the
  token allow-list, no webhook removal, the chat stored only after the code of its test message is typed back, the
  pending chat in a signed session-bound form token, the chat id in plain `settings`, `TELEGRAM_CHAT_ID` precedence
  without showing it, the reworded outbound-only rule, the crowded update window accepted, and the client built from
  the Bot API reference without a real sample, with its residual risk.
- Decision 0015 (Accepted, unreleased) is not changed: its *Consequences* already foresee the wizard steps adding
  signed-in forms with the session-bound token; the new signing key follows its key-separation rule.

## Challenge

Devil's Advocate (0 major, 3 minor), answered in the revision:

1. *A stranger's chat can be saved and receive notifications.* **Accepted**, and answered more strongly than asked:
   besides the sentence in `telegramChatsIntro` (anyone who messages the bot appears here, choose only your own chat;
   English wording asserted by `texts word the English Telegram step as the area document does`, German by the Dev)
   and the *Limits and errors* sentence that choosing again replaces an earlier value, a chat is now stored only after
   the code of its test message is typed back (Security B1 (a); AC15–AC17, option 9).
2. *A stranger can push the owner out of the list.* **Accepted**: `telegramNoChats` now says Seluna sees only the
   newest 100 and to send `/start` again just before searching; the area document names the effect and the
   `TELEGRAM_CHAT_ID` workaround; decision 0016 *Consequences* records it as accepted.
3. *`getUpdates` through a GET changes Telegram's state.* **Accepted**: decision 0016 (option 1 and *Consequences*),
   option 1 above and the area document's *Telegram chat* section state that each load makes Telegram discard the
   bot's updates older than the newest 100; "safe" is now said only of Seluna's state.

## Security review

Security (plan), CHANGES_REQUIRED, answered in the revision:

- **B1 (blocking) — a chat chosen from a spoofed list is stored.** **Accepted, option (a)** (proof of possession; the
  Lead's decision, no Product Manager acceptance needed). The confirm form now only sends a test message carrying a
  six-digit code and answers the code page (AC7, AC8); `POST /setup/telegram/verify` stores the chat only for the
  code of a valid proof (AC15, AC16); the proof is an HMAC-signed, session-bound, 10-minute form token under a new
  key `seluna/setup-telegram/v1`, no D1 (AC17, AC18, option 10). The tests Security asked for: wrong code stores
  nothing (`handleSetup stores nothing and shows the wrong-code notice for a wrong code`), expired code stores
  nothing (`… for a proof older than 10 minutes`), a code for chat A cannot save chat B (`handleSetup stores nothing
  when the code for chat A is sent with a proof altered to chat B`, and `checkChatProof reports wrong-code for …
  another chat id …`), plus another session and every malformed proof. The username is also rendered as an element
  of its own (AC3), part of option (b) taken on as cheap hardening. The false statements are corrected: decision 0016
  *Consequences* no longer says "never a wrong chat stored" (that sentence now speaks only of reference deviations,
  and the chat proof is named as what keeps a stranger's chat out), and the planned *Limits and errors* wording above
  no longer says the test message alone lets the owner recognize their chat.
- **N1 — the update window can be filled.** **Accepted** as a documented, fail-closed residual (*Security
  considerations*, last bullet): the area document names the effect and the `TELEGRAM_CHAT_ID` workaround; the 1 MiB
  limit stays, because any limit can be filled by a stranger and a larger one only costs the Worker memory; a smaller
  `limit` was weighed and rejected (easier to crowd). Recorded in 0016 *Consequences*.
- **N2 — the reworded guarantee overstates.** **Accepted**: `docs/ARCHITECTURE.md` (guarantee sentence and *Security
  model*), decision 0016 and the planned `.squad/project.md` wording now say "the `getUpdates` answer of the signed-in
  step and the status of each `sendMessage` answer, both read bounded and narrowed in `src/telegram.ts`".
- **N3 — token in the subrequest URL under Workers traces.** **Accepted**: the Deployment area gains the sentence on
  `TELEGRAM_BOT_TOKEN` and traces (*Areas*, owner Dev), and *Security considerations* says "Seluna never logs" instead
  of "never logged".

## Out of scope / follow-ups

- Channels as a target; a test message for `TELEGRAM_CHAT_ID`; showing the saved chat's name; preselecting the saved
  chat in the list; a limit on code tries.
- Delivery to the chat (issue #12) reads `TELEGRAM_CHAT_ID` first, then `settings` `telegram_chat_id` — the rule is in
  the Setup wizard area document; #12 reuses `isChatIdSecretSet`, `parseChatId` and `sendMessage`.
