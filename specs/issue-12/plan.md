# Plan: Message format, languages and delivery through the outbox

Source: Issue #12
Status: Draft
Tier: security — the change processes the webhook body after the signature check (*Parsing of external input*),
widens what the Worker reads from Telegram's `sendMessage` answer (*Outbound-only Telegram*) and adds log fields
(*Logging of external data*), three security areas of `.squad/project.md`.

## Problem / root cause

`POST /webhook` answers 202 to every validly signed delivery and does nothing else (`src/router.ts:66`,
`verifyWebhook`); the `fetch` handler has no execution context to hand work past the response
(`src/index.ts:16`). Issue #12 asks for the pipeline behind the signature check, the rule interface, the message
format with its languages and the delivery from the outbox.

Claims of the issue and of the task, checked against the code:

- **`deliveries`, `outbox`, `meta` exist** — confirmed: `migrations/0001_initial_schema.sql` creates all three;
  `outbox` has `text`, `button_url`, `silent`, `attempts`, `status` (`pending`/`sent`/`failed`), `created_at`, and
  **no** column for a button label or a language. No store module for `deliveries` or `outbox` exists yet
  (`src/store/` has `login-attempts`, `meta`, `schema`, `secrets`, `settings`), as decision 0014 planned.
- **Settings with rule switches** — confirmed: `src/settings.ts` has `RULE_IDS` (eight ids), `NotificationSettings`
  with `language` (`en`/`de`) and `rules`, read by `readNotificationSettings` (`src/store/settings.ts:38`).
- **Encrypted bot token** (task) — refuted: the bot token is the Worker secret `TELEGRAM_BOT_TOKEN`
  (`botTokenFromEnv`, `src/telegram.ts:28`), never stored in D1; only the GitHub App credentials are encrypted
  (decision 0007). The chat is `TELEGRAM_CHAT_ID` (Worker secret) or `settings` `telegram_chat_id`
  (`src/store/settings.ts:5`), as decision 0016 says delivery uses it.
- **Telegram client** — exists for the setup wizard: `sendMessage` sends plain text without `parse_mode`
  (`src/telegram.ts:219`), maps 429 to `failed` and never reads a non-2xx body (`callBotApi`, `src/telegram.ts:197`).
  There is no 429 handling, no `parse_mode`, no inline button.
- **"Update `meta` with the time of the last delivery"** — confirmed as the time of the last **received** webhook
  delivery: `meta` key `last_delivery` exists with a reader only (`src/store/meta.ts:2`, `readLastDelivery`); the
  storage area defines it as "the time of the last received webhook delivery … The webhook handler writes it (issue
  12)" and the status page labels it "Last delivery from GitHub" (`src/setup/texts.ts:193`). Not a Telegram send time.
- **Rules** — no rule exists (`src/rules/` does not exist). #13 (pull requests), #16 (CI) and #17 (security alerts)
  all depend on #12, and `.squad/project.md` (*Test doubles*) forbids hand-invented payloads for a rule test; the
  repository holds no `pull_request` payload. **Scope decision:** this issue builds the pipeline, the rule interface,
  the message format, the languages and the delivery with an **empty rule list**; every part is tested with rules
  defined in the tests (decision 0023, option 1).
- **i18n** — no `src/i18n/` exists; the setup wizard's typed per-language tables (`src/setup/texts.ts`) are the
  pattern.
- **Payload format** — the only real webhook sample is `test/fixtures/ping/form-delivery.json`: a real, signed
  `ping` sent with `content_type=form`, whose `payload` field holds real JSON (`zen`, `hook_id`, `hook`,
  `repository` with `full_name` `LarsLaskowski/test`, `sender`). It covers both framings this change reads: the form
  variant as is, and the JSON variant as the decoded `payload` text sent raw (the JSON framing is that text
  unchanged). The processing reads only `action` and `repository.full_name` from the payload; the event payloads
  the rules read arrive with their rule issues and their real fixtures. No escalation for a sample is needed.

Related defect found: none. Stale statements that this change makes untrue are listed under *Documentation updates*.

## Acceptance criteria

Each criterion names the tests the Tester writes first (step 5). "Test rule" means a `Rule` defined in the test file
that returns a fixed notification for event `ping`; the pipeline tests feed the real ping payload of
`test/fixtures/ping/form-delivery.json` (form framing as is; JSON framing = its decoded `payload` text).

- [ ] **AC1 — `<`, `>` and `&` in a pull request title are displayed correctly.** `formatMessage` escapes `&`, `<`,
  `>` (in this order) in every text, so Telegram's HTML parser shows them literally; the stored and sent text uses
  `parse_mode` `HTML`.
  - `src/message.test.ts`: "formatMessage escapes <, > and & in line 2 as &lt;, &gt; and &amp;" — subject
    `Use <T> & Map<K, V> > list` gives line 2 `Use &lt;T&gt; &amp; Map&lt;K, V&gt; &gt; list`, line 1
    `<b>New pull request</b> · octo/repo #7`, exact full text compared.
  - `src/message.test.ts`: table "escapeTelegramHtml makes <case> inert" — `&lt;` → `&amp;lt;`; `&#60;b&#62;` →
    `&amp;#60;b&amp;#62;`; `<a href="tg://user?id=1">x</a>` → `&lt;a href="tg://user?id=1"&gt;x&lt;/a&gt;`;
    `<tg-spoiler>s</tg-spoiler>`; `<blockquote expandable>q</blockquote>`; `<b>` (every `<`/`>`/`&` replaced,
    nothing else changed; `"` stays).
  - `src/webhook.test.ts`: "processWebhook sends the escaped title with parse_mode HTML to sendMessage" — test rule
    with subject `Fix <b> & </b>`; the Telegram double's recorded `sendMessage` body has that line as
    `Fix &lt;b&gt; &amp; &lt;/b&gt;` and `parse_mode` `"HTML"`.
- [ ] **AC2 — the same delivery received twice produces exactly one message.**
  - `src/webhook.test.ts`: "processWebhook answers 200 to a second delivery with the same id and sends one message"
    — two calls with one id: statuses `[202, 200]`, one `outbox` row, one `sendMessage` request, second outcome
    decision `duplicate`.
  - `src/webhook.test.ts`: "processWebhook stores one outbox row for two concurrent deliveries with the same id" —
    `Promise.all` of two calls; sorted statuses `[200, 202]`, one `deliveries` row, one `outbox` row.
  - `src/webhook.test.ts`: "processWebhook leaves last_delivery unchanged for a known delivery id" (second call with a
    later clock; `readLastDelivery` still the first time).
  - `src/store/deliveries.test.ts`: "recordDelivery returns duplicate and writes no outbox row and no last_delivery
    for a recorded id" (the race path: no prior read, the batch's plain insert conflicts and the whole batch rolls
    back).
- [ ] **AC3 — a Telegram error leaves the message pending in the outbox.**
  - `src/delivery.test.ts`: table "deliverMessages leaves the row pending with attempts 1 and logs <result> when
    sendMessage <case>" — 500 → `failed`; 400 `{"ok":false}` (an HTML parse error) → `failed`; 200 with
    `{"ok":false}` → `failed`; network rejection → `failed`; 401 → `token-rejected`; 404 → `token-rejected`; 429
    without `parameters` → `rate-limited`; 429 with `retry_after` 6 → `rate-limited` (no wait); 429 then 429 →
    `rate-limited`.
  - `src/delivery.test.ts`: "deliverMessages marks the row sent with attempts 1 after a successful answer".
  - `src/delivery.test.ts`: "deliverMessages sends the next row after a failing one" (two rows, first 500 then 200:
    first pending, second sent — needs the answer sequence of the double, below).
  - `src/webhook.test.ts`: "processWebhook answers 202 and leaves the row pending when Telegram answers 500".
- [ ] **AC4 — the message is stored before it is sent, and the answer does not wait for the send.**
  - `src/webhook.test.ts`: "processWebhook resolves 202 with the row pending while the send has not finished" —
    Telegram fetch that never settles; the outcome is 202, the row is `pending` with attempts 0, and exactly one
    promise was handed to `waitUntil`.
  - `src/webhook.test.ts`: "processWebhook hands nothing to waitUntil when no row was written" (the real ping, no
    rule matches).
- [ ] **AC5 — rule interface: pure function of event, payload and settings; only enabled rules report.**
  - `src/rules/rule.test.ts`: "runRules passes the event name, the payload and the settings to every rule".
  - `src/rules/rule.test.ts`: "runRules returns the notifications of enabled rules in rule order with decision
    reported".
  - `src/rules/rule.test.ts`: "runRules drops the notification of a disabled rule and returns decision disabled".
  - `src/rules/rule.test.ts`: "runRules returns decision reported when an enabled and a disabled rule both match".
  - `src/rules/rule.test.ts`: "runRules returns no-match when no rule returns a notification".
  - `src/webhook.test.ts`: "processWebhook records the real ping delivery with event ping, answers 202 and writes no
    outbox row" (with `RULES`, the empty production list).
  - `src/webhook.test.ts`: "processWebhook writes no outbox row for a disabled rule and returns decision disabled"
    (settings row `rule_pull_request_opened` = `off`, test rule with that id).
- [ ] **AC6 — a signed delivery that cannot be processed answers 400 and stores nothing; both framings of the real
  payload are read.** Code path: `processWebhook` steps 1 and 3 (`parseWebhookPayload`).
  - `src/webhook.test.ts`: table "processWebhook answers 400 and stores nothing for <case>" — delivery header `null`;
    event header `null`; body `not json`; body `[1]`; body `"text"`; body `null`; form without `payload`; form with
    two `payload` fields; body with byte `0xFF` (invalid UTF-8); JSON prefixed with a BOM (bytes `EF BB BF`).
    Each: outcome `{ status: 400, decision: "invalid" }`, no `deliveries` row, no `last_delivery`.
  - `src/webhook.test.ts`: table "parseWebhookPayload reads the real ping payload with Content-Type <case>" —
    `application/x-www-form-urlencoded` (form body); `Application/X-WWW-Form-Urlencoded ; charset=utf-8` (form
    body); `application/json` (JSON body); `application/json; charset=utf-8` (JSON body); `null` (JSON body) — each
    returns an object whose `repository.full_name` is `LarsLaskowski/test`.
  - `src/webhook.test.ts`: "parseWebhookPayload reads a JSON body as JSON when Content-Type is
    text/plain" — any media type other than form reads the whole body as JSON.
- [ ] **AC7 — `meta` `last_delivery` holds the time of the last new delivery.**
  - `src/webhook.test.ts`: "processWebhook stores the clock time as last_delivery for a new delivery"
    (`readLastDelivery` equals the injected `now`).
  - `src/store/deliveries.test.ts`: "recordDelivery stores the delivery, its outbox rows and last_delivery and
    returns the row ids in order".
  - `src/store/meta.test.ts`: "lastDeliveryUpsert stores the time readLastDelivery reads".
- [ ] **AC8 — a database failure answers 503 and stores and sends nothing.**
  - `src/webhook.test.ts`: "processWebhook answers 503 with decision unavailable and calls no rule and no Telegram
    when the database has no tables" (`migrationTestDb()`; a test rule spy is not called; no `sendMessage`).
- [ ] **AC9 — message format and field cleaning** (area *Message format*).
  - `src/message.test.ts`: "formatMessage writes the bold title, the repository and the number on line 1 and lines 2
    and 3 below" (exact text `<b>T</b> · o/r #7\nS\nC`).
  - `src/message.test.ts`: table "formatMessage leaves out the number <case>" — `undefined`, `0`, `-1`, `1.5`,
    `2 ** 53`; and "formatMessage shows the number 9007199254740991".
  - `src/message.test.ts`: "formatMessage leaves out an empty line 3" and "… an empty line 2".
  - `src/message.test.ts`: table "cleanField <case>" (written with escapes in the test source) — `"a\u0000b"` → `a b`;
    `"a\nb"` → `a b`; `"a\r\nb"` → `a  b`; `"a\u007Fb"` → `a b`; `"a\u0085b"` → `a b`; `"a\u2028b"` → `a b`;
    `"a\u202Eb"` → `ab`; `"a\u2066b\u2069"` → `ab`; `"a\u200Eb"` → `ab`; `"\uD800x"` → U+FFFD followed by `x` (if the test
    input lost its backslash, `uD800x` ≠ the expected U+FFFD and the test fails); `"  a  "` → `a`; 256 × `a` with
    limit 256 → unchanged; 257 × `a` → 255 × `a` + `…`; 256 × U+1F600 with limit 256 → unchanged (a code point
    counts once).
  - `src/message.test.ts`: "formatMessage cuts line 2 to 256 code points before escaping" (256 × `&` stays 256
    entities `&amp;`, not a cut entity).
  - `src/message.test.ts`: table "buttonUrl <case>" — accepted: `https://github.com/o/r/pull/1` → same;
    `HTTPS://GitHub.COM/o/r` → `https://github.com/o/r`; `https://github.com:443/o` → `https://github.com/o`;
    `https:\\github.com\o` (a backslash form the URL parser accepts for `https`) → `https://github.com/o`;
    `https://%67ithub.com/o` → `https://github.com/o`. Rejected (`undefined`): `http://github.com/o`;
    `https://github.com.evil.example/o`; `https://evil.example/github.com`; `https://github.com./o`;
    `https://github.com:8443/o`; `https://user:pw@github.com/o`; `https://user@github.com/o`;
    `https://xn--gthub-zsa.com/o`; `javascript:alert(1)`; `//github.com/o`; `not a url`; a
    `https://github.com/` URL whose normalized form has 2,049 characters (2,048 accepted).
  - `src/message.test.ts`: "formatMessage stores no button URL for a URL buttonUrl rejects".
- [ ] **AC10 — texts in English and German, a missing key fails the type check.**
  - `src/i18n/messages.test.ts`: "MESSAGE_TEXTS labels the button Open on GitHub in en and Auf GitHub öffnen in de".
  - `src/i18n/messages.test.ts`: "a text table without openOnGitHub is a type error" — a
    `// @ts-expect-error -- a table must have every key` line assigning `{}` to `MessageTexts`; `npm run typecheck`
    fails if that line stops being an error.
  - `src/delivery.test.ts`: table "deliverMessages labels the button <label> for language <language>" (the
    `reply_markup` of the recorded request is `{"inline_keyboard":[[{"text":"<label>","url":"<url>"}]]}`).
  - `src/delivery.test.ts`: "deliverMessages sends no reply_markup for a row without a button URL".
- [ ] **AC11 — chat and token.**
  - `src/delivery.test.ts`: "deliverMessages sends to TELEGRAM_CHAT_ID over the stored chat".
  - `src/delivery.test.ts`: "deliverMessages sends to the stored telegram_chat_id without the Worker secret".
  - `src/delivery.test.ts`: table "deliverMessages calls no Telegram, keeps the row pending with attempts 0 and logs
    <result> when <case>" — `TELEGRAM_CHAT_ID` `abc` with a stored chat → `no-chat`; no secret and no stored chat →
    `no-chat`; stored chat `0` → `no-chat`; no `TELEGRAM_BOT_TOKEN` → `no-token`; malformed token `x` → `no-token`.
  - `src/delivery.test.ts`: "deliverMessages sets disable_notification for a silent row" (and `false` otherwise,
    asserted in the success test).
  - `src/delivery.test.ts`: "deliverMessages logs store-failed and calls no Telegram when the chat cannot be read"
    and "deliverMessages logs store-failed when the row cannot be updated" (a `D1Database` wrapper whose `prepare`
    throws for the statement in question).
- [ ] **AC12 — one retry after a 429 within the request.**
  - `src/telegram.test.ts`: "sendNotification posts chat_id, text, parse_mode HTML, disable_notification and the
    inline button as JSON to sendMessage" (exact body).
  - `src/telegram.test.ts`: "sendNotification waits retry_after seconds and sends once more after a 429" (sleep spy
    called once with 2000, two requests, result `sent`).
  - `src/telegram.test.ts`: table "sendNotification returns rate-limited without waiting when retry_after is
    <case>" — missing `parameters`; `0`; `6`; `1.5`; `"2"`; `-1`; body not JSON.
  - `src/telegram.test.ts`: "sendNotification returns rate-limited after a second 429 without a second wait".
  - `src/telegram.test.ts`: "sendNotification returns token-rejected for a 401 after a 429 wait".
  - `src/telegram.test.ts`: table "parseRetryAfter returns <expected> for <case>" (`{ok:false,parameters:
    {retry_after:3}}` → 3; `{ok:true,…}` → `undefined`; `2 ** 53` → `undefined`; non-object → `undefined`).
  - `src/delivery.test.ts`: "wait resolves after the given milliseconds" (`vi.useFakeTimers()`, advanced 1999 ms not
    resolved, 2000 ms resolved).
  - Existing `findChats` / `sendMessage` 429 tests (`src/telegram.test.ts:453`, `:522`) stay green unchanged.
- [ ] **AC13 — log entries carry delivery, event, action, repository and decision, never payload texts.** Code path:
  `handleRequest` (`src/router.ts`) builds the entry from the bounded headers and the `WebhookOutcome`;
  `deliverMessages` logs `{ outbox, result }`.
  - `src/router.test.ts`: "handleRequest logs delivery, event, action, repository and decision of a processed
    webhook" (stub processor returning `action: "opened"`, `repository: "octo/repo"`, `decision: "reported"`).
  - `src/router.test.ts`: the existing log tests ("logs the real delivery with status 202 …", "logs a webhook with a
    wrong signature …", the header table) expect `action`, `repository` and `decision` — `null` when the processor
    did not run (401, 413, 400 unreadable, 503 secret).
  - `src/webhook.test.ts`: table "processWebhook returns repository <expected> for full_name <case>" —
    `LarsLaskowski/test` → same; missing `repository` → `null`; `a b/c` → `null`; 40-character owner → `null`;
    `o/` → `null`; `o/r/x` → `null`; a number → `null`. And "processWebhook returns action null for an action
    `Opened`" / "action opened for `opened`".
  - `src/delivery.test.ts`: "deliverMessages logs exactly the row id and the result" (`toEqual([{ outbox: <id>,
    result: "sent" }])`).
- [ ] **AC14 — the router hands a signed delivery to the processor and answers its status.**
  - `src/router.test.ts`: "handleRequest passes delivery, event, content type and body of a signed webhook to the
    webhook processor and answers its status" (stub returns 200; body bytes equal the request body).
  - `src/router.test.ts`: "handleRequest does not call the webhook processor for a wrong signature".
- [ ] **AC15 — the Worker wires the pipeline.**
  - `src/index.test.ts`: "POST /webhook through the Worker answers 202 to the real ping delivery and 200 to its
    redelivery" (migrations applied, `deliveries` emptied before and after).
- [ ] **AC16 — store modules.**
  - `src/store/deliveries.test.ts`: "isKnownDelivery returns true only for a recorded id".
  - `src/store/outbox.test.ts`: "markSent marks a pending row sent and counts the attempt";
    "markAttempted counts the attempt and keeps the row pending"; table "<function> changes no row whose status is
    <status>" (`sent`, `failed`); "outboxInsert stores text, button URL, silent and created_at and returns the id".

## Approach

Processing order, status codes, payload rules, message format, cleaning, URL check, languages, sending, retry and log
fields are specified in `docs/areas/notifications.md` (written in this step; the Dev builds to it and reports a
deviation instead of editing it silently).

1. **Router** (`src/router.ts`): after a valid signature, call `deps.webhook({ delivery, event, contentType, body })`
   with the bounded header values (`boundedHeader`, existing patterns) and answer `new Response(null, { status })`
   from the outcome. The `POST /webhook` log entry always has `action`, `repository` and `decision` (from the
   outcome; `null` when the processor did not run). One entry per request stays.
2. **Pipeline** (`src/webhook.ts`, `processWebhook`): steps 1–6 of the area. Pre-read with `isKnownDelivery`; parse
   with `parseWebhookPayload`; `readNotificationSettings`; `runRules`; `formatMessage` per notification (`silent`
   false); `recordDelivery` (one batch); on `recorded` with at least one id, `deps.waitUntil(deliverMessages(…,
   settings.language, …))`. Every D1 error (pre-read, settings, batch other than duplicate) → 503 `unavailable`.
   One `deps.now()` per delivery.
3. **Store**: `src/store/deliveries.ts` (`isKnownDelivery`, `recordDelivery` — batch: plain
   `INSERT INTO deliveries (id, event, received_at) VALUES (?1, ?2, ?3)`, then one
   `INSERT INTO outbox (text, button_url, silent, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id` per message,
   then `lastDeliveryUpsert`; on a rejected batch, `isKnownDelivery` → `duplicate`, else rethrow);
   `src/store/outbox.ts` (`outboxInsert`, `markSent`, `markAttempted`, both updates guarded by
   `AND status = 'pending'`); `src/store/meta.ts` (`lastDeliveryUpsert`). The ids come from the `RETURNING` rows,
   narrowed (`typeof id === "number"`).
4. **Rules** (`src/rules/rule.ts`, `src/rules/registry.ts`): types, `runRules`, and `RULES = []`.
5. **Message** (`src/message.ts`): `cleanField`, `escapeTelegramHtml`, `buttonUrl`, `formatMessage`. Cleaning order:
   `toWellFormed()`, controls and U+2028/U+2029 → space, directional marks removed, trim, cut (code points, `…`),
   escape.
6. **i18n** (`src/i18n/messages.ts`, `src/i18n/en.ts`, `src/i18n/de.ts`): `MessageTexts` with `openOnGitHub`;
   `en.ts`/`de.ts` export `const …: MessageTexts` (a type annotation, so a missing or extra key fails `tsc`);
   `MESSAGE_TEXTS: Readonly<Record<Language, MessageTexts>>`. The rule issues add their keys.
7. **Delivery** (`src/delivery.ts`): `chatTarget` (Worker secret first, no fallback when it is set but invalid),
   `deliverMessages` (never rejects: every D1 or unexpected error is caught and logged as `store-failed`; rows one
   after the other), `wait`.
8. **Telegram** (`src/telegram.ts`): `callBotApi` also reads the body of a 429 answer (bounded, 1 MiB,
   `readJsonWithLimit`); `parseRetryAfter`; `sendNotification` (one request; on 429 with `retry_after` 1–5 → `sleep`
   then one more request; result mapping as the area). `sendMessage` of the setup wizard stays unchanged.
9. **Worker** (`src/index.ts`): `fetch(request, env, ctx)`; `webhook: (d) => processWebhook(d, { db: env.DB, env,
   now: () => new Date(), rules: RULES, waitUntil: (p) => { ctx.waitUntil(p); }, telegramFetch: outboundFetch,
   sleep: wait, log })`, log entries through `console.log`.

## Options considered

The alternatives and why they lost are in decision 0023 (*Options considered*): scope with an empty rule list vs.
including #13's rules; one-batch deduplication vs. `INSERT OR IGNORE` then inserts vs. a read alone; button label
from the language at sending vs. a new column; text rendered when written vs. when sent; 429 wait bound 1–5 s vs.
any wait vs. no retry; 400 for an unprocessable signed delivery vs. 202 and recording it; the pipeline as an
injected module vs. inside the router. Two smaller choices not in the record:

- **Cleaning of directional and control characters** — chosen as hardening so a title cannot break the three-line
  layout or reorder line 1 visually; the alternative (escape only, as the issue says) leaves a `\n` in a commit line
  able to forge a line 3.
- **`TELEGRAM_CHAT_ID` set but invalid → no chat** vs. falling back to the stored chat — the secret "decides the
  chat" (setup-wizard area, *Precedence*); a fallback would send to a chat the owner meant to override.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/router.ts` | `RouteDeps.webhook`, `RequestLogEntry` fields, delegation after the signature check |
| Worker | `src/index.ts` | `ctx`, pipeline wiring |
| Worker | `src/webhook.ts` (new) | pipeline, payload parsing, log fields |
| Worker | `src/rules/rule.ts`, `src/rules/registry.ts` (new) | rule interface, `runRules`, empty `RULES` |
| Worker | `src/message.ts` (new) | message rendering, cleaning, escaping, button URL |
| Worker | `src/i18n/messages.ts`, `src/i18n/en.ts`, `src/i18n/de.ts` (new) | message texts |
| Worker | `src/delivery.ts` (new) | chat resolution, sending rows, `wait` |
| Worker | `src/telegram.ts` | 429 body read, `parseRetryAfter`, `sendNotification` |
| Worker | `src/store/deliveries.ts`, `src/store/outbox.ts` (new); `src/store/meta.ts` | D1 access |
| Tests | `test/telegram.ts` | `sendMessage` answer may be a sequence (one answer per request, the last repeated) |
| Tests | `test/fixtures/telegram/send-message-too-many-requests.json` (new), its `README.md` row | reference-built 429 answer: `{"ok":false,"error_code":429,"description":"Too Many Requests: retry after 3","parameters":{"retry_after":3}}` (Bot API reference, *ResponseParameters*) |

No migration, no new binding, no new dependency, no new GitHub App permission, no new Bot API method.

## Signatures (for the Dev's skeleton)

```ts
// src/rules/rule.ts
import type { NotificationSettings, RuleId } from "../settings";
/** A webhook payload: a JSON object, its fields still unknown. */
export type WebhookPayload = Readonly<Record<string, unknown>>;
export interface Notification {
  /** Line 1, bold: the case, in the notification language. */
  readonly title: string;
  /** Line 1: `owner/repo`. */
  readonly repository: string;
  /** Line 1: pull request or alert number; `undefined` when the case has none. */
  readonly number: number | undefined;
  /** Line 2. */
  readonly subject: string;
  /** Line 3. */
  readonly context: string;
  /** Target of the button: `html_url` from the payload. */
  readonly url: string;
}
export interface Rule {
  readonly id: RuleId;
  readonly evaluate: (event: string, payload: WebhookPayload, settings: NotificationSettings) => Notification | undefined;
}
export type RuleDecision = "reported" | "no-match" | "disabled";
export interface RuleRun {
  readonly notifications: readonly Notification[];
  readonly decision: RuleDecision;
}
export function runRules(
  rules: readonly Rule[], event: string, payload: WebhookPayload, settings: NotificationSettings,
): RuleRun;

// src/rules/registry.ts
export const RULES: readonly Rule[]; // = []

// src/message.ts
export const MAX_TITLE_CHARACTERS = 64;
export const MAX_REPOSITORY_CHARACTERS = 140;
export const MAX_LINE_CHARACTERS = 256;
export const MAX_BUTTON_URL_LENGTH = 2048;
export interface OutboxMessage {
  /** Telegram HTML (`parse_mode` `HTML`). */
  readonly text: string;
  readonly buttonUrl: string | undefined;
}
export function escapeTelegramHtml(text: string): string;
export function cleanField(text: string, maxCharacters: number): string; // cleaned and cut, not escaped
export function buttonUrl(url: string): string | undefined;               // normalized href or undefined
export function formatMessage(notification: Notification): OutboxMessage;

// src/i18n/messages.ts
import type { Language } from "../setup/language";
export interface MessageTexts {
  /** Label of the inline button that opens the case on GitHub. */
  readonly openOnGitHub: string;
}
export const MESSAGE_TEXTS: Readonly<Record<Language, MessageTexts>>;
// src/i18n/en.ts — export const EN: MessageTexts = { openOnGitHub: "Open on GitHub" };
// src/i18n/de.ts — export const DE: MessageTexts = { openOnGitHub: "Auf GitHub öffnen" };

// src/store/outbox.ts
export interface NewOutboxRow {
  readonly text: string;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}
/** `INSERT … RETURNING id`, for a batch. */
export function outboxInsert(db: D1Database, row: NewOutboxRow, createdAt: Date): D1PreparedStatement;
/** Marks a pending row sent and counts the attempt. D1 errors are not caught. */
export async function markSent(db: D1Database, id: number): Promise<void>;
/** Counts an attempt of a pending row, which stays pending. D1 errors are not caught. */
export async function markAttempted(db: D1Database, id: number): Promise<void>;

// src/store/meta.ts (added)
/** Upsert of `last_delivery` with `time`, for a batch. */
export function lastDeliveryUpsert(db: D1Database, time: Date): D1PreparedStatement;

// src/store/deliveries.ts
export interface NewDelivery {
  readonly id: string;
  readonly event: string;
  readonly receivedAt: Date;
}
export type RecordDeliveryResult =
  | { readonly kind: "recorded"; readonly outboxIds: readonly number[] }
  | { readonly kind: "duplicate" };
export async function isKnownDelivery(db: D1Database, id: string): Promise<boolean>;
/** One batch: the delivery, one outbox row per message, `last_delivery`. D1 errors other than a known id reject. */
export async function recordDelivery(
  db: D1Database, delivery: NewDelivery, messages: readonly NewOutboxRow[],
): Promise<RecordDeliveryResult>;

// src/telegram.ts (added; sendMessage, findChats unchanged)
/** Longest `retry_after`, in seconds, waited for within one attempt. */
export const MAX_RETRY_AFTER_SECONDS = 5;
export interface OutgoingMessage {
  readonly text: string;
  readonly buttonText: string;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}
export type SendNotificationResult = "sent" | "token-rejected" | "rate-limited" | "failed";
/** `parameters.retry_after` of an unsuccessful answer as a positive safe integer, else `undefined`. */
export function parseRetryAfter(body: unknown): number | undefined;
/** One `sendMessage` with `parse_mode` HTML, retried once after a 429 of 1–5 s. Never throws. */
export async function sendNotification(
  token: string, chatId: number, message: OutgoingMessage, fetcher: TelegramFetch,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<SendNotificationResult>;

// src/delivery.ts
import type { Language } from "./setup/language";
export interface PendingMessage {
  readonly id: number;
  readonly text: string;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}
export type DeliveryResult =
  "sent" | "rate-limited" | "token-rejected" | "failed" | "no-token" | "no-chat" | "store-failed";
export interface DeliveryLogEntry {
  readonly outbox: number;
  readonly result: DeliveryResult;
}
export interface DeliveryDeps {
  readonly env: object;
  readonly db: D1Database;
  readonly fetch: TelegramFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (entry: DeliveryLogEntry) => void;
}
/** `TELEGRAM_CHAT_ID` when set (no fallback if it is not a chat id), else `settings` `telegram_chat_id`. D1 errors reject. */
export async function chatTarget(env: object, db: D1Database): Promise<number | undefined>;
/** Sends each row once, in order, updates it and logs it. Never rejects. */
export async function deliverMessages(
  messages: readonly PendingMessage[], language: Language, deps: DeliveryDeps,
): Promise<void>;
/** Resolves after `milliseconds` (a timer). */
export function wait(milliseconds: number): Promise<void>;

// src/webhook.ts
export interface SignedDelivery {
  /** `X-GitHub-Delivery` when it matches its pattern, else `null`. */
  readonly delivery: string | null;
  /** `X-GitHub-Event` when it matches its pattern, else `null`. */
  readonly event: string | null;
  readonly contentType: string | null;
  readonly body: Uint8Array;
}
export type WebhookDecision = "reported" | "no-match" | "disabled" | "duplicate" | "invalid" | "unavailable";
export interface WebhookOutcome {
  readonly status: 200 | 202 | 400 | 503;
  readonly decision: WebhookDecision;
  readonly action: string | null;
  readonly repository: string | null;
}
export interface WebhookDeps {
  readonly db: D1Database;
  readonly env: object;
  readonly now: () => Date;
  readonly rules: readonly Rule[];
  readonly waitUntil: (promise: Promise<void>) => void;
  readonly telegramFetch: TelegramFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (entry: DeliveryLogEntry) => void;
}
/** The payload: a JSON object from the body (or its form field `payload`), else `undefined`. Never throws. */
export function parseWebhookPayload(body: Uint8Array, contentType: string | null): WebhookPayload | undefined;
/** `action` and `repository.full_name` when they match their log patterns, else `null`. */
export function logFieldsOf(payload: WebhookPayload): { readonly action: string | null; readonly repository: string | null };
export async function processWebhook(delivery: SignedDelivery, deps: WebhookDeps): Promise<WebhookOutcome>;

// src/router.ts (changed)
export interface RequestLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly delivery?: string | null;
  readonly event?: string | null;
  /** `POST /webhook` only: from the outcome, `null` when the processor did not run. */
  readonly action?: string | null;
  readonly repository?: string | null;
  readonly decision?: WebhookDecision | null;
}
export interface RouteDeps {
  readonly version: string;
  readonly log: (entry: RequestLogEntry) => void;
  readonly webhookSecret: WebhookSecretSource;
  readonly webhook: (delivery: SignedDelivery) => Promise<WebhookOutcome>;
  readonly setup: SetupDeps;
}
```

Existing files the skeleton rewrites: `src/router.ts`, `src/index.ts`, `src/telegram.ts` (additions only besides
`callBotApi`), `src/store/meta.ts` (addition). Read and found final for this change: `src/settings.ts`,
`src/store/settings.ts`, `src/body.ts`, `src/signature.ts`, `src/webhook-secret.ts`, `migrations/`,
`wrangler.jsonc`, `src/github/manifest.ts`.

## Test files

New: `src/webhook.test.ts`, `src/message.test.ts`, `src/delivery.test.ts`, `src/rules/rule.test.ts`,
`src/i18n/messages.test.ts`, `src/store/deliveries.test.ts`, `src/store/outbox.test.ts`. Extended:
`src/telegram.test.ts`, `src/store/meta.test.ts`, `src/router.test.ts`, `src/index.test.ts`. Test double:
`test/telegram.ts` (answer sequence for `sendMessage`); fixture `test/fixtures/telegram/send-message-too-many-requests.json`.
`src/rules/registry.ts`, `src/i18n/en.ts` and `src/i18n/de.ts` hold data only and are covered through the modules
that import them; they get no test file of their own.

Existing test code affected by a changed signature:

- `src/router.test.ts` `makeDeps` — `RouteDeps` gains `webhook`: the **Dev** adds a stub
  `webhook: () => Promise.resolve({ status: 202, decision: "no-match", action: null, repository: null })` in step 4,
  mechanically, so *Build* passes. The log assertions that then fail (`"logs the real delivery with status 202 …"`,
  `"logs a webhook with a wrong signature …"`, the header table) are behavior changes and are moved by the
  **Tester** in step 5 (AC13).
- `src/index.test.ts` — no signature change, but behavior: `"POST /webhook answers 202 for the real GitHub ping
  delivery with the configured secret"` now needs migrated D1 and a fresh delivery id, and `"POST /webhook uses the
  webhook secret stored in D1 through the Worker"` sends the same ping again (200 if not cleaned). The **Tester**
  adapts both in step 5 (migrations applied, `deliveries` emptied before and after, like `withEmptyCredentials`);
  AC15 replaces the first.

Files no unit test can cover: none. The `waitUntil` arrow in `src/index.ts` is not reached by the Worker tests
while `RULES` is empty (two lines); it stays in the coverage measure and the gate's figure is expected to absorb it.

## Areas

- **Notifications** (new, `docs/areas/notifications.md`, index row added): written in this step by the Lead —
  processing order, payload, rules, message format, languages, sending, log entries.
- **HTTP routes** (`docs/areas/http-routes.md`): the route table gains `POST /webhook` 200 (known delivery), 400
  (unprocessable signed delivery) and 503 (database failure while processing), each linked to Notifications; "A 202
  has no further effect yet …" is replaced by "A 202 means the delivery was recorded ([Notifications])"; *Logging*
  gains `action`, `repository`, `decision` and the per-row delivery entry; *Request body size* names the
  `sendMessage` 429 answer as read through the same reader; *Not here* points to Notifications.
- **Storage** (`docs/areas/storage.md`): `outbox.text` is the Telegram HTML text rendered when the row is written;
  `button_url` only an `https://github.com` URL ([Notifications]); the button label is not stored; `deliveries`,
  `outbox` rows and `last_delivery` are written by the webhook processing in one transaction — "The webhook handler
  writes it (issue 12)" becomes that link.
- **Setup wizard** (`docs/areas/setup-wizard.md:143`): "until the webhook handler writes `last_delivery` (issue 12)"
  → "until the first delivery from GitHub is recorded ([Notifications](notifications.md))".

## Documentation updates

Sweep done: `docs/areas/*.md`, `docs/ARCHITECTURE.md`, `.squad/project.md`, `README.md`, `SECURITY.md` searched for
"issue 12", "later change", "no further effect", "only … getUpdates and sendMessage", "MarkdownV2", the D1 table
list and the log field lists.

| File | Change | Owner |
| ---- | ------ | ----- |
| `docs/areas/notifications.md` (new), `docs/areas/README.md` (index row) | as *Areas* | Lead (done) |
| `docs/ARCHITECTURE.md` | Components (Webhook processing row, Rules and Outbox rows), *Webhook to Telegram* steps 2–4, the Telegram-input sentence (429 `retry_after`), links to 0023 | Lead (done) |
| `docs/decisions/0023-…md`, index row | Proposed | Lead (done) |
| `docs/areas/http-routes.md`, `docs/areas/storage.md`, `docs/areas/setup-wizard.md` | as *Areas* | Dev |
| `.squad/project.md` | *Outbound-only Telegram*: the input from `sendMessage` is its status and, for a 429, `parameters.retry_after`, read bounded and narrowed (`src/telegram.ts`), sent from `src/delivery.ts`; *Parsing of external input*: the webhook body (JSON or the form field `payload`) is narrowed in `src/webhook.ts`, fields are cleaned, length-limited and escaped for Telegram HTML in `src/message.ts` ("MarkdownV2/HTML" → "HTML"); *Logging of external data*: the webhook entry adds `action`, `repository` (pattern-checked) and `decision`, each sent row logs its id and result; *Integration surface* "A new or changed rule": add `src/rules/registry.ts` and the texts in `src/i18n/en.ts`/`de.ts`; *Test doubles* Telegram: the 429 fixture and the `sendMessage` answer sequence | Dev |
| `CHANGELOG.md` | `## [Unreleased]` → `### Added`: "Webhook deliveries are recorded once each (a redelivery is acknowledged and ignored), and the status page shows the time of the last delivery from GitHub; messages are stored in the outbox and sent to Telegram in a fixed format in English or German once the notification rules arrive." | Dev |
| `test/fixtures/telegram/README.md` | row for `send-message-too-many-requests.json` (*Making requests*, *ResponseParameters*, status 429) | Tester |

`README.md` (settings table), `docs/setup.md` and `SECURITY.md`: no change (no setting, secret or step changes).

## Architecture check

- **A delivery is processed once** — strengthened into code: the pre-read plus the one-batch plain insert; the
  concurrent case is tested (AC2).
- **A matched event is written to the outbox before delivery is attempted, and unsent rows are retried** — the batch
  commits before `waitUntil` receives the send (AC4); rows stay `pending` on every failure (AC3); the cron retry is
  #18, which reuses `deliverMessages`.
- **An invalid signature has no effect** — unchanged: the processor runs only after `verifySignature` returned true
  (AC14).
- **Draft pull requests trigger nothing** — no rule exists; #13 owns it.
- **Outbound-only Telegram** — still only `sendMessage` and `getUpdates`, no webhook, no route; the new input (429
  `retry_after`) is bounded and narrowed to an integer of 1–5 before use. `docs/ARCHITECTURE.md` and
  `.squad/project.md` are reworded accordingly (not weakened).
- No guarantee of `.squad/project.md` is weakened; no Product Manager decision is needed.

## Security considerations

- [x] Limits and decoding: the webhook body limit (1 MiB) applies before decoding (existing reader); the Telegram
  answer limit (1 MiB) before decoding; the text limits (64/140/256/256) count code points **after** decoding and
  cleaning and **before** escaping, so escaping can grow a line to at most 5 × 256 UTF-16 units and a whole message
  stays below Telegram's 4,096-character limit (worst case all astral: about 1,500 UTF-16 units before escaping,
  under 4,096 after parsing of entities, since Telegram counts the parsed text); the button URL limit (2,048) counts
  the normalized `href`.
- [x] User-visible failure text: none. Every answer of `POST /webhook` has an empty body; D1, Telegram and parse
  errors reach neither a response nor a log entry with their message, only the fixed decision/result values.
- **Guard: Telegram HTML escaping.** Forms Telegram's HTML parser accepts (Bot API reference, *HTML style*): the
  tags `b`, `strong`, `i`, `em`, `u`, `ins`, `s`, `strike`, `del`, `span class="tg-spoiler"`, `tg-spoiler`,
  `a href`, `tg-emoji`, `code`, `pre`, `blockquote` (also `expandable`), the named entities `&lt;`, `&gt;`,
  `&amp;`, `&quot;` and numeric entities (`&#60;`, `&#x3C;`). Every one of them starts with `<` or `&`, both
  always escaped, so no input forms a tag or an entity; the AC1 table covers a tag with attribute, a custom
  `tg-` tag, `blockquote expandable`, a named and a numeric entity. Only the formatter's own `<b>…</b>` is markup.
- **Guard: button URL.** Forms the WHATWG URL parser accepts and the check's result: scheme in any case
  (normalized → accepted); host in any case, percent-encoded host bytes (normalized → accepted only when it is
  `github.com`); backslashes for a special scheme (normalized → accepted); ASCII tab/newline inside and C0/space at
  the ends (stripped by the parser → normalized); default port `:443` (dropped → accepted); another port, a trailing
  dot, a user name or password, a punycode look-alike, another scheme, a scheme-relative or unparsable text →
  rejected. The check compares `protocol === "https:"`, `host === "github.com"` (host, not hostname, so a port
  fails), `username === ""`, `password === ""` and stores the normalized `href` — Telegram receives the canonical
  form, never the input. AC9 enumerates these.
- **Guard: payload framing.** `Content-Type` forms: missing, `application/json` with or without parameters, the form
  type in any case with parameters and spaces, any other type (read as JSON). Form decoding is UTF-8
  (`URLSearchParams` over the fatal-decoded text); exactly one `payload` field. AC6 enumerates these.
- **Log fields** come from signed payload fields but are logged only when they match strict patterns
  (`action` `^[a-z_]{1,64}$`; repository `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`), so no free text reaches a log.
  Field names avoid CodeQL's sensitive-name list (`outbox`, `result`, `decision`, `repository`, `action`).
- **Unverified claims, each failing closed:**
  1. *Workers `waitUntil` window of about 30 s after the response* (Cloudflare documentation) — not measurable in
     the session; the retry bound (5 s) and the 10 s request timeout keep one row's attempt at ≤ 25 s; a send cut off
     leaves the row pending. Stated as "according to Cloudflare's documentation" in the area document, never as
     measured.
  2. *A D1 batch is one transaction and a failing statement rolls back the whole batch* — settled for the test
     pool's D1 by AC2's store test ("recordDelivery returns duplicate and writes no outbox row …"); production D1
     follows Cloudflare's documentation of `batch()`. If it did not roll back, the duplicate would leave orphan
     `outbox` rows — the test is the guard.
  3. *Telegram's behavior* (HTML parse mode, the inline keyboard, the 429 body with `parameters.retry_after`) — built
     from the Bot API reference, no captured answer and no egress to `api.telegram.org` (decision 0016). A deviation
     leaves the row pending (fails closed). No production path sends a notification until a rule exists, so the live
     check against the real API is #13's first real notification; decision 0023 records this.
  4. *`String.prototype.toWellFormed` in the Workers runtime* — the Dev confirms it once by running the AC9 lone
     surrogate test in the test pool (which is the Workers runtime); if it is missing, the Dev reports it and replaces
     lone surrogates by a code-point scan instead.

## Decision records

- `docs/decisions/0023-webhook-processing-and-delivery-through-the-outbox.md` (Proposed, indexed) — area
  Notifications.

## Out of scope / follow-ups

- The rules themselves: #13, #16, #17 (each adds its file under `src/rules/`, its entry in `RULES`, its texts in
  `src/i18n/`, its real fixtures).
- Quiet hours setting `silent`: #14 (sending already honors the column).
- The cron resend, marking rows `failed`, cleanup of `deliveries`/`outbox`: #18 (reuses `deliverMessages`).
- The duplicate-code treatment of `src/i18n/en.ts`/`de.ts` once the rule issues grow them (decision 0023,
  *Consequences*).

## Challenge notes

Minor objections of the plan challenge, recorded verbatim; Dev and Tester follow them or report a deviation.

1. **A throwing rule or `formatMessage` is not specified (minor).**
   - `processWebhook` maps only D1 errors to 503. The area document (`docs/areas/notifications.md`) and AC8 never say what happens when `rule.evaluate` or `formatMessage` throws.
   - The rules are separate code that reads untrusted payloads, so an unexpected shape could throw. Without handling, the exception escapes `processWebhook` into the `fetch` handler, and the delivery ends as an unlogged 500. GitHub does not auto-retry, so the message is lost.
   - Instruction for the Dev and Tester: wrap rule evaluation and formatting so a throw answers 503 with decision `unavailable` and stores nothing. Better still, isolate each rule so one failing rule cannot suppress the others. Add one test with a throwing test rule that asserts no `deliveries` row.

2. **"Never lost" has a gap on the 503 path (minor).**
   - A 503 (database down) or a 400 stores nothing, and GitHub does not redeliver on its own. A manual redelivery works because the ID is not recorded.
   - This tradeoff is probably acceptable. Make the area document and decision 0023 say it explicitly, so the Reviewer does not read it as a violation of the "never lost" goal.

3. **Test-only rules in the pipeline tests (minor).**
   - AC1 and AC2 are proven only with test rules, because the production `RULES` list is empty. The first real end-to-end check is #13's.
   - The plan acknowledges this, so no plan change is needed. The Tester should keep one `index.test.ts` path that goes through `waitUntil` with a test rule, so the `index.ts` wiring is not the only untested piece.

## Security notes

Non-blocking findings of the Security plan review (verdict APPROVED), recorded verbatim; Dev and Tester follow them or report a deviation.

1. **The form framing lets invalid UTF-8 through as U+FFFD, which contradicts the area document.**
   - notifications.md (*Payload*) says "The JSON text must be valid UTF-8 (an invalid byte sequence answers 400)". In the plan that holds only for raw bytes: the security considerations say "URLSearchParams over the fatal-decoded text".
   - Measured in workerd: `new URLSearchParams("?payload=%FF%7B%7D")` yields `payload` = U+FFFD `{}`. A percent-encoded invalid sequence is silently replaced, not rejected. A leading `?` is also stripped.
   - Not exploitable: the body is signed, and U+FFFD passes through cleaning harmlessly. But the documented guarantee is wrong for the form framing.
   - Fix: either state in the area document that percent-decoded invalid sequences become U+FFFD, and add an AC6 case pinning it, or reject them.
   - Related: the AC6 BOM case only holds if the JSON decoder uses `ignoreBOM: true`, as `readJsonWithLimit` does. The default `TextDecoder` silently strips the BOM (measured: length 1 against 2). The plan should name `ignoreBOM: true` for the Dev.
2. **The bidi cleaning set misses U+061C (ARABIC LETTER MARK).**
   - U+061C has the Unicode Bidi_Control property, like U+200E/U+200F, which step 3 already removes. Add it to step 3 of *Message format* and to the AC9 `cleanField` table.
   - The plan's rationale, that a title cannot "reorder line 1 visually", is also stronger than the guard. Ordinary RTL letters in a title or repository still reorder the neutral characters `·` and `#` around them. Either soften the wording or wrap each field in isolates (U+2068 … U+2069) when line 1 is rendered.
3. **Link previews of attacker-chosen URLs.**
   - Pull request titles and commit lines are attacker-controlled. With `parse_mode` HTML, Telegram still auto-links a bare URL in the text and builds a link-preview card for it, fetched by Telegram. A title like `Fix https://evil.example/login` would then show a rich preview card for an arbitrary site in the owner's chat.
   - Recommended: send `link_preview_options: { is_disabled: true }` in `sendNotification` and assert it in the AC12 exact-body test. It is a Bot API reference field, not a new method.
4. **The signature does not cover the headers.**
   - `X-GitHub-Delivery` and `X-GitHub-Event` are not covered by the HMAC (it is over the body only).
   - A captured signed body replayed with a fresh delivery id passes deduplication and produces a second message. A changed event header feeds the payload to rules of another event.
   - This is inherent to GitHub's webhook design, not a defect of this plan. It deserves one sentence of residual risk in decision 0023 or the area document. The rules of #13, #16 and #17 should also check that the payload's shape matches the event, and not rely on the header alone. The area document already requires every field to be narrowed.
