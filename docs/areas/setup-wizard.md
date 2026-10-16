# Setup wizard

## Scope

The pages under `/setup` through which the owner sets up an instance: who gets in (the setup login and its
session), how forms are protected, what every page and response looks like, and in which language. The owner
relies on it to keep everyone else out; the wizard steps (Telegram chat, GitHub App, settings and status) build on
it and add their pages behind the login.

## Behavior

### Paths

- The wizard owns `/setup` and every path that starts with `/setup/`. Other paths are not part of it, also
  `/setupx`, `/SETUP` or `/setup%2F` ([HTTP routes](http-routes.md)). The path is matched after the URL is parsed,
  so dot segments are already resolved: `/setup/../health` is `/health`.
- Every request under `/setup` is decided in this order:
  1. **No usable `SELUNA_SECRET`** (absent, not a string, or shorter than 32 characters as counted in
     [Storage](storage.md#encryption)): **503** with the _not configured_ page, for every method and path. No body
     is read and no cookie other than the language cookie is set.
  2. **`POST /setup/login`**: the login (below), with or without a session.
  3. **No valid session**: **200** with the login page, for every other method and path.
  4. **With a valid session**: `GET /setup` answers **200** with the start page, `POST /setup/logout` signs out
     (below), `GET` and `POST /setup/telegram` and `POST /setup/telegram/verify` are the Telegram step
     ([Telegram chat](#telegram-chat)), everything else answers **404** with an empty body.
- The start page says that the owner is signed in, lists the setup steps as links (today one: _Telegram chat_, to
  `/setup/telegram`) and carries the sign-out form. The wizard steps add their pages in this branch.

### Login

- The login page has one form: `POST /setup/login` with the password field `secret` and the hidden field `csrf`.
- `POST /setup/login` is processed in this order, and each step that rejects ends the request:
  1. The body is read with the 1 MiB limit of [HTTP routes](http-routes.md#request-body-size): **413** above it,
     **400** when it cannot be read, both with an empty body.
  2. The body is parsed as `application/x-www-form-urlencoded`, whatever the `Content-Type` says (`+` is a space,
     `%XX` is decoded as UTF-8, a broken escape stays as it is, names are decoded like values).
  3. The CSRF token (below) must be valid, else **403** with the login page and the _form expired_ notice.
  4. The attempt is counted (below). When the login is locked: **429** with the login page and the _locked_
     notice; the secret is not checked.
  5. The field `secret` is compared with `SELUNA_SECRET`: equal only when its UTF-8 bytes are exactly those of
     `SELUNA_SECRET` (no trimming, no case or Unicode normalization). The comparison takes the same time whatever
     the position of the first difference: both values are run through HMAC-SHA256 under a fresh random key and the
     results are compared by the runtime's constant-time `verify`. A missing or repeated `secret` field counts as
     a wrong secret.
  6. Correct: the count is reset, and the answer is **303** with `Location: /setup` and the session cookie. Wrong:
     **403** with the login page and the _wrong secret_ notice.
- A D1 failure while counting or resetting answers **503** with the login page and the _unavailable_ notice; no
  session is set.
- A browser's password field cannot hold a line break, so a `SELUNA_SECRET` that contains one cannot be entered.

### Failed attempts and the lock

- The count is one value for the whole instance, in the `meta` row `login_attempts` ([Storage](storage.md)): a
  JSON object `{"failures":<n>,"last":<ms>}`, `last` being the time of the latest counted attempt in milliseconds
  since 1970-01-01 UTC.
- Every login attempt with a valid CSRF token is counted **before** the secret is checked, in one atomic
  statement, so attempts that arrive at the same time are counted one after the other: of any number of parallel
  attempts at most five have their secret checked.
- When an attempt is counted at time `now`:
  - if there is no row, or `now` is 15 minutes (900,000 ms) or more after `last`, or the row is not such an object
    with integer `failures` ≥ 0 and integer `last`, the count starts again: `failures` 1, `last` `now`;
  - otherwise, if `failures` is below 5, it becomes `failures + 1` with `last` `now`;
  - otherwise (5 or more) the login is **locked**: `failures` grows by one and `last` stays, so a rejected
    attempt does not extend the lock.
- An attempt whose count is 5 or less has its secret checked; one whose count is above 5 is rejected with 429.
- So after five wrong secrets, each within 15 minutes of the one before, the login is locked from the fifth until
  15 minutes after it; every attempt in that time is rejected, the correct secret too. At 15 minutes after the
  fifth failure the next attempt starts a new count.
- A correct secret deletes the row.
- The lock is global: anyone who can reach the instance can keep it locked by sending five wrong attempts every
  15 minutes. The owner then waits, or deletes the `meta` row `login_attempts` in the Cloudflare dashboard.

### Session

- The session cookie `seluna_session` holds `v1.<expires>.<mac>`: `<expires>` is the expiry in milliseconds since
  1970-01-01 UTC, written in decimal without leading zeros, 12 hours (43,200,000 ms) after the login; `<mac>` is
  the HMAC-SHA256 of the ASCII text `v1.<expires>`, written as base64url without padding (43 characters).
- Base64url text is read only in its canonical form: no padding, no `+`, `/` or whitespace, and the unused low bits
  of the last character zero, so each MAC and token has exactly one accepted text.
- The HMAC key is derived with HKDF-SHA256 from `SELUNA_SECRET`, salt and info `seluna/setup-session/v1`
  ([Storage](storage.md#encryption) keeps every key apart). Changing `SELUNA_SECRET` therefore ends every session.
- A session is valid at time `now` when the cookie value has exactly that form (`<expires>` at most 15 digits),
  its MAC verifies in constant time, and `now < <expires> ≤ now + 12 hours`. Anything else (expired, altered,
  signed under another `SELUNA_SECRET`, quoted, padded, another version) is no session.
- The cookie header may carry the name more than once; the request has a session when one of the first four
  values is valid.
- Login sets `seluna_session=<token>; Max-Age=43200` with the cookie attributes below.
- A navigation started on another site (a link, or a redirect back from GitHub) carries none of the wizard's
  cookies (`SameSite=Strict`), so it is answered as signed out, and the 303 after a login always goes to `/setup`
  without a query. A wizard step that another site returns to (the manifest flow of #10) must handle that return
  while signed out.

### Sign-out

- `POST /setup/logout` (with a valid session) reads its body like the login (413, 400), then needs a valid CSRF
  token, else **403** with the start page and the _form expired_ notice and the session stays. With a valid token
  it answers **303** with `Location: /setup` and clears the cookie (`seluna_session=; Max-Age=0`).
- Sign-out ends the session in this browser only: a copy of the token stays valid until it expires.

### CSRF protection

- Every form carries the hidden field `csrf`. There are two kinds of form: the **login form** (the login page) and
  the **signed-in forms** (every form on a page answered with a valid session; today the sign-out form on the start
  page and the confirm and verify forms of the Telegram step). The key is derived like the session key with salt and info `seluna/setup-csrf/v1`.
- Login form: the value is the HMAC-SHA256 (base64url without padding) of the value of the cookie `seluna_csrf`.
- Signed-in form: the value is the HMAC-SHA256 (base64url without padding), under the same key, of the ASCII text
  `session.<session token>.<cookie value>`, where `<session token>` is the first valid `seluna_session` value of the
  request (the order of _Session_) and `<cookie value>` the value of `seluna_csrf` the page uses. The page renders
  it for its own cookie value.
- `seluna_csrf` holds 32 random bytes as base64url without padding (43 characters). A page with a form takes the
  first well-formed value among the first four `seluna_csrf` values of the request; when there is none it draws a new one and sets the cookie (no
  `Max-Age`, so it ends with the browser session).
- A submitted form is valid when its body has exactly one `csrf` field and that field verifies, in constant time,
  against one of the well-formed values among the first four `seluna_csrf` values of the request, with the scheme of
  the form: a signed-in form is valid only with a token of the session the request carries, and `POST /setup/login`
  accepts only the login form's token, also when a session is present. A missing, empty, repeated or wrong field, a
  missing cookie, a token from another cookie value, another session or another `SELUNA_SECRET`, an unbound
  login-form token on a signed-in form, or a session-bound token on the login form is rejected.
- What this protects: a cookie planted by a host under the same registrable domain (on a custom domain, or another
  Worker of the same account under `<subdomain>.workers.dev`) is useless on a signed-in form, because its token needs
  the owner's session. On the login form it still yields a valid token, which is harmless there because a login also
  needs `SELUNA_SECRET`.

### Telegram chat

The step that tells Seluna which Telegram chat to send to. The bot token is the Worker secret
`TELEGRAM_BOT_TOKEN`; the bot never gets a webhook, Seluna neither sets nor removes one and exposes no Telegram
route. The only Bot API methods called are `getUpdates` (this step's page) and `sendMessage` (its test message).

- **Precedence:** when the Worker secret `TELEGRAM_CHAT_ID` is a non-empty string, it decides the chat. `GET
/setup/telegram` then answers **200** with the _chat id secret_ text, no form and no saved-chat line, and calls
  neither Telegram nor D1; both POSTs answer **409** with the same view. No page shows the secret's value.
  Delivery uses `TELEGRAM_CHAT_ID` first, then the `settings` key `telegram_chat_id` ([Storage](storage.md)).
- **Bot token:** read from the environment and never trimmed. It must match exactly `^\d{1,20}:[A-Za-z0-9_-]{1,200}$`
  (digits, a colon, then letters, digits, `-` and `_`), because it is placed into the request URL path, where
  `/`, `\`, `?`, `#`, `%`, `.`, whitespace, control characters and non-ASCII characters would change the method or
  the path. A missing (absent, not a string or empty) token is _token missing_, any other value that does not match
  is _token malformed_; neither calls Telegram.
- **Chat id:** a chat id is text matching `^-?[1-9]\d{0,15}$` whose number is a safe integer. The form field `chat`
  and a stored `telegram_chat_id` are checked this way; a stored value that is not a chat id is shown as _no saved
  chat_.

#### The step page

- `GET /setup/telegram` (signed in) reads the saved chat from `settings`, then calls `getUpdates` **once**:
  `POST https://api.telegram.org/bot<token>/getUpdates` with `Content-Type: application/json`, body
  `{"offset":-100,"limit":100,"timeout":0}` (no `allowed_updates`) and a 10 second abort. The negative offset
  returns the newest 100 updates and makes Telegram discard the bot's older ones, so every load changes the bot's
  state at Telegram (not Seluna's); only Seluna reads this bot's updates, and another program polling the same bot
  is a conflict.
- Answers: 2xx with `ok: true` and a `result` array lists the chats; **401** or **404** is _token rejected_; **409**
  is _conflict_ (a webhook, or another program receiving the updates; Seluna does not remove it); every other
  status, a failed or aborted request, a body above 1 MiB (counted in bytes before decoding), a body that is not
  UTF-8 JSON and a 2xx body of another shape are _Telegram unavailable_. A Telegram `description`, the token or a
  runtime error text never reaches a page or the log.
- **Chats:** each update's `message`, `edited_message` or `my_chat_member` supplies a `chat`. A private chat
  (`type` `private`) is named by `first_name`, a space and `last_name` when present; a group (`group`,
  `supergroup`) by `title`; a missing name falls back to the decimal id. A private chat's `username` is kept when it
  matches `^\w{1,64}$`. Names are cut to 128 code points. A chat is listed once, newest first, named by its newest
  update; channels, other types, ids that are not safe integers and updates without one of the three fields are
  skipped. A chat whose newest update is a `my_chat_member` with `new_chat_member.status` `left` or `kicked`, or a
  message carrying `migrate_to_chat_id`, is left out until a newer update of it arrives.
- **Page:** heading, intro, the saved chat (_Saved chat:_ and the id, or _no saved chat_), a link to
  `/setup/telegram` (_search_) and then either the _chats intro_ with a form `POST /setup/telegram` (one required
  radio input `chat` per chat with the decimal id as value, a label with the name, the `@username` and the kind,
  the session-bound CSRF field and the confirm button) or, with no chat, the _no chats_ text and no form. Every name
  is HTML-escaped and wrapped in its own `<bdi>`; a username is shown as `@<username>` in a separate
  `<bdi class="username">` after the name, so a name cannot pose as a username. A problem (token missing,
  malformed or rejected, conflict, unavailable) shows its notice instead of the chats, with the saved-chat line.
- When reading `settings` fails, the answer is **503** with the notice-only page (heading, intro, notice, search
  link) and the _unavailable_ notice; Telegram is not called.

#### Confirming a chat

- `POST /setup/telegram` sends a test message with a six-digit code to the chosen chat and stores nothing. In this
  order: the body is read (**413** above 1 MiB, **400** unreadable, empty bodies); the CSRF token (signed-in form)
  must be valid, else **403**, the notice-only page and _form expired_; `TELEGRAM_CHAT_ID` set: **409**; the field
  `chat` must occur once and be a chat id, else **400** and _invalid chat_; the bot token must be present (**503**
  _token missing_) and well-formed (**503** _token malformed_); then one `sendMessage`
  (`POST https://api.telegram.org/bot<token>/sendMessage`, JSON `{"chat_id":<id as a number>,"text":"<test message
in the page language> <code>"}`, no `parse_mode`, 10 second abort). `sendMessage` 401 or 404 answers **502** with
  _token rejected_; any other failure (status, `ok` not `true`, rejected fetch, unreadable or oversized answer)
  answers **502** with _send failed_. Telegram is not called in the 413, 400, 403, 409 and 503 cases.
- Success answers **200** with the code page: heading, the _code sent_ text with the chat id, the _code intro_, a
  form `POST /setup/telegram/verify` with the session-bound CSRF field, a hidden field `proof`, a text input `code`
  (`required`, `inputmode="numeric"`, `autocomplete="one-time-code"`, `pattern="[0-9]{6}"`, `maxlength="6"`), the
  _code button_ and the search link. The code appears in the message to Telegram only, never in the page or the
  headers. Reloading the code page re-posts the confirm form, which sends a new code; an older code stays usable
  until it expires.

#### Chat proof

- The pending chat and the code live only in the signed form token `proof` and in the test message; nothing is kept
  in D1 or a cookie. The code is six decimal digits drawn uniformly (`crypto.getRandomValues` into a `Uint32`,
  redrawn while it is at least 4,294,000,000, then modulo 1,000,000, zero-padded).
- `proof` is `v1.<chatId>.<expires>.<mac>`: `<expires>` is the time of the test message plus 600,000 ms in decimal,
  `<mac>` the HMAC-SHA256 (base64url without padding, 43 characters) of the ASCII text
  `chat-proof.v1.<chatId>.<expires>.<session token>.<code>`. The key is derived like the session key with salt and
  info `seluna/setup-telegram/v1`. The MAC binds the chat, the expiry, the request's session token and the code: the
  code of one chat cannot save another, and a proof is useless in another session, under another `SELUNA_SECRET`,
  or after 10 minutes.
- A proof is **invalid** unless it matches `^v1\.(-?[1-9]\d{0,15})\.([1-9]\d{0,14})\.([\w-]{43})$`, the chat id is a
  chat id, the MAC text is canonical base64url and `now < expires ≤ now + 600,000 ms`. Otherwise it is a **wrong
  code** unless the submitted code is exactly six digits and the MAC verifies in constant time for the request's
  session and that code, which is **valid**.
- `POST /setup/telegram/verify` in this order: body (**413**, **400**); CSRF (**403**, notice-only page, _form
  expired_); `TELEGRAM_CHAT_ID` set (**409**); exactly one `proof` field, else **400** and the notice-only page with
  _code expired_; an invalid proof, **400** the same; a wrong code (another code, a missing, repeated or malformed
  `code` field, an altered chat id, another session or key) **400** with the code page for the proof's chat id,
  the same proof and _wrong code_; a valid proof writes `settings` `telegram_chat_id` (replacing an earlier value)
  and answers **303** with `Location: /setup/telegram`. A failing D1 write answers **503** with _unavailable_.
  Telegram is not called, and nothing is stored unless the answer is the 303.
- Tries are not limited: only the signed-in owner can submit, and a million codes in ten minutes gain them nothing
  over choosing again.

### Cookies

- Every cookie the wizard sets has `Path=/setup; HttpOnly; Secure; SameSite=Strict`, so the browser sends it to
  `/setup` and the paths below it only and never with a request started by another site.
- Cookie values are read as they appear in the `Cookie` header (pairs split at `;`, name and value trimmed of
  spaces, the value neither unquoted nor decoded); a value that does not have the expected form is ignored.

### Pages and response headers

- Pages are complete HTML documents rendered on the server, UTF-8, without a framework, without any script,
  without any external resource (no script, font, style or image is loaded from anywhere), and with one inline
  `<style>` element.
- Every text placed in a page is HTML-escaped (`&`, `<`, `>`, `"`, `'`). No page echoes anything from the request:
  not the secret, not a token other than the page's own CSRF token, not a header, not the path.
- Every response under `/setup` (pages, redirects, 404, 413, 400) carries:

  | Header                    | Value                                                                                                        |
  | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `Content-Security-Policy` | `default-src 'none'; style-src 'sha256-<hash>'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` |
  | `X-Content-Type-Options`  | `nosniff`                                                                                                    |
  | `X-Frame-Options`         | `DENY`                                                                                                       |
  | `Referrer-Policy`         | `no-referrer`                                                                                                |
  | `Cache-Control`           | `no-store`                                                                                                   |

  `<hash>` is the base64 (with padding) SHA-256 of the UTF-8 bytes of the content of the page's `<style>` element.
  A page also carries `Content-Type: text/html; charset=utf-8` and `Content-Language` with its language.

### Language

- The interface is in English (`en`) and German (`de`); every text exists in both.
- The language of a response is, in this order: the query parameter `lang` when it is exactly `en` or `de`; else
  the first of the first four `seluna_lang` cookie values that is exactly `en` or `de`; else the `Accept-Language` header; else
  English.
- A valid `lang` parameter also sets the cookie `seluna_lang` to it, with `Max-Age=31536000` (one year).
- Every page links to exactly `/setup?lang=en` and `/setup?lang=de`, whatever path it is answered on (a page
  answered on `/setup/logout` or `/setup/login` links to `/setup` too), and its `<html lang>` is its language.
- `Accept-Language` is read as RFC 9110 defines it: a comma-separated list of language ranges, each with an
  optional weight `;q=<0 to 1, at most three decimals>`. A range counts for German when its first subtag is `de`
  and for English when it is `en`, in any case (`de`, `de-DE`, `DE-at`). The language with the highest weight
  wins; on equal weights the one listed first. A weight of 0 excludes the range; `*`, other languages and entries
  that do not fit the grammar are skipped. Examples: `de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7` → German,
  `en-US,en;q=0.9` → English, `fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7` → German, `de;q=0,en;q=0.1` → English,
  `fr` → English.

### Texts

The notices, the Telegram step and the _not configured_ page, in English (the German texts are their translation, in
`src/setup/texts.ts`):

- _wrong secret_: "That is not the SELUNA_SECRET of this instance."
- _locked_: "Too many failed attempts. Signing in is locked for 15 minutes after the fifth failed attempt; try
  again later."
- _form expired_: "The form has expired. Please submit it again."
- _unavailable_: "The setup is unavailable right now. Please try again in a moment."
- _token missing_: "The Worker secret TELEGRAM_BOT_TOKEN is not set. In Telegram, send /newbot to @BotFather and
  copy the token it returns. In the Cloudflare dashboard open this Worker, then Settings, then Variables and
  Secrets, and add a secret named TELEGRAM_BOT_TOKEN with that token. Or run: npx wrangler secret put
  TELEGRAM_BOT_TOKEN"
- _token malformed_: "The Worker secret TELEGRAM_BOT_TOKEN is not a bot token. A token from @BotFather is digits, a
  colon, then letters, digits, - and _, without spaces. Copy it again from @BotFather and replace the secret in the
  Cloudflare dashboard under Settings, then Variables and Secrets."
- _token rejected_: "Telegram does not accept the Worker secret TELEGRAM_BOT_TOKEN: it is mistyped or was revoked.
  Send /mybots to @BotFather, copy your bot's current token and replace the secret in the Cloudflare dashboard under
  Settings, then Variables and Secrets."
- _conflict_: "Telegram does not hand the bot's chats to Seluna because another program receives its updates (a
  webhook, or a program that polls the bot). Seluna needs a bot of its own: create one with /newbot at @BotFather, or
  remove the webhook from this bot."
- _Telegram unavailable_: "Telegram could not be reached or gave an answer Seluna cannot read. Please try again in
  a moment."
- _send failed_: "The test message could not be sent, so the chat was not saved. Check that the bot is still in the
  chat and not blocked, then search again."
- _invalid chat_: "Please choose a chat from the list."
- _wrong code_: "The code does not match the test message. Check the code in your chat and enter it again."
- _code expired_: "The code has expired or the form is no longer valid. Search for chats again and send a new test
  message."
- Start page: "Set up your instance step by step:" and the link "Telegram chat".
- _intro_: "Seluna sends its notifications to one Telegram chat. Open your bot in Telegram and send /start, or add the
  bot to a group. Then search for chats."
- _search_: "Search for chats".
- _chat id secret_: "The chat is set by the Worker secret TELEGRAM_CHAT_ID, which takes precedence over a chat chosen
  here. To choose the chat here, delete that secret."
- _Saved chat:_ and _No chat is saved yet._
- _chats intro_: "Chats your bot has seen recently. Anyone who messages your bot appears here, so choose only your
  own chat: Seluna sends a test message with a code to it, and the chat is saved once you enter that code."
- _no chats_: "No chat found. Send /start to your bot or add it to a group, then search again. Telegram keeps
  messages to the bot for 24 hours, and Seluna sees only the newest 100: if your bot receives many messages, send
  /start again just before you search."
- _Private chat_, _Group_, _confirm button_ "Send test message".
- _test message_ (followed by a space and the code): "Seluna setup: to send the notifications of your instance to
  this chat, enter this code on your setup page. If you did not ask for it, ignore this message. Code:"
- _code sent_ (followed by the id): "Test message sent to chat:"; _code intro_: "Enter the six-digit code from that
  message to save the chat. If no message arrived, the chat is not yours: search again and choose another."; _Code_;
  _code button_ "Save chat".
- _not configured_: the heading "SELUNA_SECRET is not set", then: the setup cannot start because the Worker secret
  `SELUNA_SECRET` is missing or shorter than 32 characters; create a random string of at least 32 characters (a
  password manager, or `openssl rand -hex 32`); in the Cloudflare dashboard open this Worker, then _Settings_ →
  _Variables and Secrets_, and add a secret named `SELUNA_SECRET` with that string, or run
  `npx wrangler secret put SELUNA_SECRET`; then reload the page. The page does not say whether the secret is
  missing or too short.

## Limits and errors

- 404, 413 and 400 under `/setup` carry no body; 503 and the 403 and 429 answers carry a page with a fixed
  notice and never a reason from the runtime or D1.
- Anyone who messages the bot appears in the chat list with a name of their choosing, so a label proves nothing: a
  chat is saved only after its code is typed back. The owner who types in a code a stranger gave them can still save
  a wrong chat; choosing again replaces the earlier value. A stranger who sends the bot many messages can push the
  owner's chat out of the newest 100 updates (_no chats_: send `/start` again just before searching) or make the
  answer exceed 1 MiB (_Telegram unavailable_ until 100 newer, smaller updates arrived); both fail closed, and the
  workaround for both is the `TELEGRAM_CHAT_ID` Worker secret.
- A login, logout or Telegram form body is limited to 1 MiB counted in bytes before decoding; the parsed text is never longer than
  that number of bytes.
- At most four values per cookie name are looked at; the `Accept-Language` and `Cookie` headers are otherwise
  limited only by the platform's header size, and reading them takes time proportional to their length, also for
  adversarial input such as long runs of spaces, `;` or `,`.
- A host under the same registrable domain that plants cookies can still make a page look signed out or a form fail
  (at most four values per cookie name are read, and the browser sends a cookie with a longer path first), but it
  cannot make a form succeed.
- Nothing in this area is logged beyond the per-request entry of [HTTP routes](http-routes.md#logging) (method,
  path, status).

## Related decisions

- [`decisions/0015-setup-login.md`](../decisions/0015-setup-login.md) — stateless signed session, signed
  double-submit CSRF token bound to the session on signed-in forms, one global attempt count taken before the check, the lock's timing, the hashed inline
  style, the language cookie.
- [`decisions/0016-telegram-chat-in-the-setup-wizard.md`](../decisions/0016-telegram-chat-in-the-setup-wizard.md) —
  `getUpdates` on page load with a negative offset, the token allow-list, the chat stored only after its code is
  typed back, the pending chat in a signed session-bound token.
- [`decisions/0007-github-app-credentials-encrypted-in-d1.md`](../decisions/0007-github-app-credentials-encrypted-in-d1.md)
  — the 32-character minimum of `SELUNA_SECRET` and separate keys per purpose.

## Not here

- The routes outside `/setup`, the body size limit and the request log: [HTTP routes](http-routes.md).
- The `meta` table and the encryption key: [Storage](storage.md).
- How `SELUNA_SECRET` is set at deploy time: [Deployment](deployment.md#worker-secrets).
