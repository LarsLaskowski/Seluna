# Telegram step

## Scope

The setup step under `/setup/telegram` that takes the owner's Telegram bot token and tells Seluna which Telegram
chat to send to: the bot token and its sources, the chat search, the test message and the proof that the chat is the
owner's. The owner relies on it to set up delivery without a stranger's chat being saved; delivery relies on the
token and chat it resolves ([Delivery](delivery.md#sending-a-row)).

## Behavior

- The bot never gets a webhook: Seluna neither sets nor removes one and exposes no Telegram route. The only Bot API
  methods called are `getMe` (at most once per submitted token form whose token matches the bot token form, and
  never for one that does not), `getUpdates` (this step's page) and `sendMessage` (its test message, and delivery).
  Every request goes to `https://api.telegram.org/bot<token>/<method>` as one JSON `POST` with a 10-second abort,
  and its answer is read at most 1 MiB, counted in bytes before decoding.
- **Chat precedence:** when the Worker secret `TELEGRAM_CHAT_ID` is a non-empty string, it decides the chat.
  `GET /setup/telegram` then answers **200** with the token card exactly as without it
  ([The bot token](#the-bot-token)) and a chat card holding only the _Chat_ heading and the _chat id secret_ text as
  an info notice (no intro, no saved-chat line, no form, no search link). The page reads the saved token's state from
  D1 but calls Telegram zero times: no chat search runs, so a saved token Telegram no longer accepts is not detected
  there and its notice (_saved token rejected_) is not shown in this state. The token and remove forms work as
  without it. The confirm and verify forms answer **409** with the same view (a D1 failure while reading the token's
  state: **503**, the notice-only page, _unavailable_). No page shows the secret's value. Delivery uses
  `TELEGRAM_CHAT_ID` first, then the `settings` key `telegram_chat_id` ([Storage](storage.md#tables)).
- **Bot token form:** a bot token, from either source, is never trimmed and must match exactly
  `^\d{1,20}:[A-Za-z0-9_-]{1,200}$` (digits, a colon, then letters, digits, `-` and `_`; at most 221 characters, all
  ASCII), because it is placed into the request URL path, where `/`, `\`, `?`, `#`, `%`, `.`, whitespace, control
  characters and non-ASCII characters would change the method or the path. A value that does not match never
  reaches a Bot API URL.
- **Chat id:** a chat id is text matching `^-?[1-9]\d{0,15}$` whose number is a safe integer. The form field `chat`
  and a stored `telegram_chat_id` are checked this way; a stored value that is not a chat id is shown as _no saved
  chat_.
- The page shows the info notice _Telegram active, not set up_ as the first element of the token card, after its
  heading, exactly while Telegram is the active messenger (also when no messenger is stored) and not set up
  ([Status page](status-page.md#messengers)). Failing to read the active messenger there only leaves the notice out.
- Every form of the step reads its body first ([Setup wizard](setup-wizard.md#forms)) and then checks its
  session-bound CSRF token; a rejected token answers **403** with the notice-only page and _form expired_.

### The bot token

- **Source:** the Worker secret `TELEGRAM_BOT_TOKEN` when it is a non-empty string, otherwise the token saved in this
  step (the `secrets` row `telegram_bot_token`, encrypted, [Storage](storage.md#key-check)). A set Worker secret wins
  also when it is malformed, without falling back to a saved token, and then no D1 row is read; a saved token is
  neither used nor deleted while the secret is set. The same resolution serves the step, the confirm form, the status
  page and delivery. Its outcomes, and what the token card shows for each below its heading:
  - _Worker secret_ (`TELEGRAM_BOT_TOKEN` matches the form): the _worker secret token_ info notice, which says the
    secret takes precedence and is deleted in the Cloudflare dashboard to enter a token here, preceded by the _token
    rejected_ notice after a 401 or 404 of the chat search.
  - _Worker secret malformed_ (`TELEGRAM_BOT_TOKEN` set but not of the form): the _token malformed_ notice only.
  - _missing_ (no Worker secret and no saved token, also without a usable `SELUNA_SECRET`): the _token intro_ and the
    token form.
  - _saved_ (a saved token that decrypts and is of the form): the _token saved_ text, a disclosure holding the token
    form, and the remove form; after a 401 or 404 of the chat search the _saved token rejected_ notice comes first and
    the disclosure is open.
  - _unreadable_ (the key check value reports a changed `SELUNA_SECRET` or is damaged): the _token unreadable_ notice
    only, no form and no remove form.
  - _damaged_ (the key check value matches, but the token's row does not decrypt or decrypts to a value not of the
    form): the _token damaged_ notice, the token form and the remove form.
- **Token form:** `POST /setup/telegram/token` with the session-bound `csrf` field and one field `token`: a label, an
  `<input id="token" type="password" name="token" autocomplete="off" spellcheck="false" maxlength="221" required>`
  that never carries a `value`, and a primary button. **Remove form:** `POST /setup/telegram/token/remove` with the
  `csrf` field and a secondary button. The disclosure is a `<details>` element with a `<summary>`, so it needs no
  script. The token is never shown again once saved.
- `POST /setup/telegram/token` in this order, each step that rejects ending the request: body and CSRF token (above);
  `TELEGRAM_BOT_TOKEN` set (well-formed or not): **409** with the _worker secret token_ notice; exactly one `token`
  field matching the form, else **400** with the token form and _token invalid_ (a missing, repeated, empty or
  space-padded field included); the saved token unreadable: **409** with the _token unreadable_ notice; the key check
  value reports a changed or damaged state (no token saved, but other credentials cannot be read): **409** with
  _token not saved_; then one `getMe` (JSON `{}`): **401** or **404** answers **502** with the token form and _token
  not accepted_; a 2xx answer whose body has `ok: true` is accepted (also for a bot with a webhook, which the
  following chat search then shows as _conflict_); any other answer (a failed or aborted request, 429, another
  status, an oversized or non-JSON body, `ok` not `true`) answers **502** with the token form and _token unverified_.
  An accepted token is written encrypted, replacing a saved or damaged one, and the answer is **303** with
  `Location: /setup/telegram`; a write the key check refuses answers **409** with _token not saved_.
  `TELEGRAM_CHAT_ID` is not looked at.
- `POST /setup/telegram/token/remove` in this order: body and CSRF token (above); `TELEGRAM_BOT_TOKEN` set: **409**
  with the _worker secret token_ notice; the saved token unreadable: **409** with the _token unreadable_ notice;
  otherwise the saved token's row is deleted ([Storage](storage.md#key-check)) and the answer is **303** with
  `Location: /setup/telegram`, also when no token was saved. The saved chat and the settings stay; outbox rows wait
  unsent until a token is available again. Telegram is not called. The _Remove_ form of the Messengers card does the
  same ([Status page](status-page.md#messengers)).
- The 400, 409 and 502 answers of both forms show the step page with the token card only (no chat card), so they
  call no further Telegram API and read nothing more from D1; the notice given replaces the one the state implies.
  A D1 failure in either form answers **503** with the notice-only page and _unavailable_; the stored state is then
  the one before or after the request. No answer, header or log entry contains the submitted or the saved token, and
  no page is built from the submitted value.
- The token notices that reject a value (_token invalid_, _token malformed_) describe the token form and say to copy
  the token again from @BotFather; those that report a rejected token (_token not accepted_, _token rejected_,
  _saved token rejected_) say to fetch the bot's current token from @BotFather (with `/mybots`); a notice about a
  Worker secret says where it is replaced (the Cloudflare dashboard, _Settings_, _Variables and Secrets_); _token
  unreadable_ and _token not saved_ offer setting the earlier `SELUNA_SECRET` again or the reset on the start page.

### The step page

- `GET /setup/telegram` resolves the bot token ([The bot token](#the-bot-token)) and, unless `TELEGRAM_CHAT_ID` is
  set, reads the saved chat from `settings`. Only with a usable token does it then call `getUpdates` **once**, with
  the body `{"offset":-100,"limit":100,"timeout":0}` (no `allowed_updates`). The negative offset returns the newest
  100 updates and makes Telegram discard the bot's older ones, so every load changes the bot's state at Telegram
  (not Seluna's); only Seluna reads this bot's updates, and another program polling the same bot is a conflict.
- **Answers:** 2xx with `ok: true` and a `result` array lists the chats; **401** or **404** marks the token in use as
  rejected (the token card shows _token rejected_ for the Worker secret, _saved token rejected_ for a saved token) and
  the chat card shows no search; **409** is _conflict_ (a webhook, or another program receiving the updates; Seluna
  does not remove it); every other status, a failed or aborted request, a body above 1 MiB, a body that is not UTF-8
  JSON and a 2xx body of another shape are _Telegram unavailable_. A Telegram `description`, the token or a runtime
  error text never reaches a page or the log. The _conflict_ notice says that Seluna needs a bot of its own: a new
  one from @BotFather, or the webhook removed from this one.
- **Chats:** each update's `message`, `edited_message` or `my_chat_member` supplies a `chat`. A private chat
  (`type` `private`) is named by `first_name`, a space and `last_name` when present; a group (`group`,
  `supergroup`) by `title`; a missing name falls back to the decimal id. A private chat's `username` is kept when it
  matches `^\w{1,64}$`. Names are cut to 128 code points. A chat is listed once, newest first, named by its newest
  update; channels, other types, ids that are not safe integers and updates without one of the three fields are
  skipped. A chat whose newest update is a `my_chat_member` with `new_chat_member.status` `left` or `kicked`, or a
  message carrying `migrate_to_chat_id`, is left out until a newer update of it arrives.
- **Page:** the heading, then the token card (its heading and the content of [The bot token](#the-bot-token)), then
  the chat card: the _Chat_ heading, the intro, a notice for a problem, the saved chat (the id, or _no saved chat_),
  a link to `/setup/telegram` (_search_) and then either the _chats intro_ with a form `POST /setup/telegram` (one
  required radio input `chat` per chat with the decimal id as value, a label with the name, the `@username` and the
  kind, private chat or group, the session-bound CSRF field and the confirm button) or, with no chat, the _no chats_
  text and no form. Every name is HTML-escaped and wrapped in its own `<bdi>`; a username is shown as `@<username>`
  in a separate `<bdi class="username">` after the name, so a name cannot pose as a username. A _conflict_ or
  _Telegram unavailable_ shows its notice instead of the chats, with the saved-chat line and the search link. Without
  a usable token, or after a 401 or 404, the chat card shows only the intro and the saved-chat line (no search link,
  no chats).
- The _chats intro_ warns that anyone who messages the bot appears in the list and that a chat is saved only once
  the code of its test message is entered; _no chats_ says to send `/start` to the bot (again, just before searching,
  when the bot receives many messages), since Telegram keeps updates for 24 hours and Seluna sees only the newest 100.
- When reading the saved token or `settings` fails, the answer is **503** with the notice-only page (the heading,
  then one card with the intro, the notice and the search link) and the _unavailable_ notice; Telegram is not
  called.

### Confirming a chat

- `POST /setup/telegram` sends a test message with a six-digit code to the chosen chat and stores nothing. In this
  order: body and CSRF token (above); `TELEGRAM_CHAT_ID` set: **409**; the field `chat` must occur once and be a chat
  id, else **400** and _invalid chat_; the bot token is resolved ([The bot token](#the-bot-token)): missing,
  unreadable or damaged answers **503** _token missing_, a malformed Worker secret **503** _token malformed_, a D1
  failure **503** _unavailable_; then one `sendMessage` with the JSON
  `{"chat_id":<id as a number>,"text":"<test message> <code>"}` and no `parse_mode`. The test message is in the page
  language, names its purpose and tells a reader who did not ask for it to ignore it.
- `sendMessage` 401 or 404 answers **502** with _token rejected_ on the notice-only page when the token is the Worker
  secret; for a saved token it answers **502** with the step page holding only the token card in its _saved_ state
  marked rejected: the _saved token rejected_ notice, the _token saved_ text, the open disclosure with the token form,
  and the remove form (no chat card). Any other failure (status, `ok` not `true`, rejected fetch, unreadable or
  oversized answer) answers **502** with _send failed_. Telegram is not called in the 413, 400, 403, 409 and 503
  cases.
- Success answers **200** with the code page: the heading, then one card with a notice when one is given (_wrong
  code_, below), the _code sent_ text with the chat id, the _code intro_, a form `POST /setup/telegram/verify` with
  the session-bound CSRF field, a hidden field `proof` ([Chat proof](#chat-proof)), a text input `code` (`required`,
  `inputmode="numeric"`, `autocomplete="one-time-code"`, `pattern="[0-9]{6}"`, `maxlength="6"`), the primary button
  and the search link. The code appears in the message to Telegram only, never in the page or the headers. Reloading
  the code page re-posts the confirm form, which sends a new code; an older code stays usable until it expires.

### Chat proof

- The pending chat and the code live only in the signed form token `proof` and in the test message; nothing is kept
  in D1 or a cookie. The code is six decimal digits drawn uniformly from a cryptographic random source (without
  modulo bias), zero-padded.
- `proof` is `v1.<chatId>.<expires>.<mac>`: `<expires>` is the time of the test message plus 600,000 ms in decimal,
  `<mac>` the HMAC-SHA256 (base64url without padding, 43 characters) of the ASCII text
  `chat-proof.v1.<chatId>.<expires>.<session token>.<code>`. The key is derived like the session key with salt and
  info `seluna/setup-telegram/v1` ([Setup login](setup-login.md#session)). The MAC binds the chat, the expiry, the
  request's session token and the code: the code of one chat cannot save another, and a proof is useless in another
  session, under another `SELUNA_SECRET`, or after 10 minutes.
- A proof is **invalid** unless it matches `^v1\.(-?[1-9]\d{0,15})\.([1-9]\d{0,14})\.([\w-]{43})$`, the chat id is a
  chat id, the MAC text is canonical base64url and `now < expires ≤ now + 600,000 ms`. Otherwise it is a **wrong
  code** unless the submitted code is exactly six digits and the MAC verifies in constant time for the request's
  session and that code, which is **valid**.
- `POST /setup/telegram/verify` in this order: body and CSRF token (above); `TELEGRAM_CHAT_ID` set (**409**);
  exactly one `proof` field, else **400** and the notice-only page with _code expired_; an invalid proof, **400** the
  same; a wrong code (another code, a missing, repeated or malformed `code` field, an altered chat id, another
  session or key) **400** with the code page for the proof's chat id, the same proof and _wrong code_; a valid proof
  writes `settings` `telegram_chat_id` (replacing an earlier value) and answers **303** with
  `Location: /setup/telegram`. A failing D1 write answers **503** with _unavailable_. Telegram is not called, and
  nothing is stored unless the answer is the 303.
- Tries are not limited: only the signed-in owner can submit, and a million codes in ten minutes gain them nothing
  over choosing again.

## Limits and errors

- Anyone who messages the bot appears in the chat list with a name of their choosing, so a label proves nothing: a
  chat is saved only after its code is typed back. The owner who types in a code a stranger gave them can still save
  a wrong chat; choosing again replaces the earlier value. A stranger who sends the bot many messages can push the
  owner's chat out of the newest 100 updates (_no chats_: send `/start` again just before searching) or make the
  answer exceed 1 MiB (_Telegram unavailable_ until 100 newer, smaller updates arrived); both fail closed, and the
  workaround for both is the `TELEGRAM_CHAT_ID` Worker secret.
- The `getMe` answer was built from the Bot API reference, not captured from a real run, when the token form was
  written; the live check on a deployed copy (a valid, a revoked, a mistyped token and a bot with a webhook) is
  pending. A deviation fails closed: the token is not saved and the owner sees a fixed notice.
- Whether browsers fill the token field (`type="password"`, `autocomplete="off"`) with the saved `SELUNA_SECRET`, or
  offer to replace the saved login with the token, was not observed; a hex `SELUNA_SECRET` filled into the field
  fails the bot token form and answers 400 before any request.
- Telegram's answers and errors never reach a page or a log entry; only the fixed notices above are shown.

## Related decisions

- [`decisions/0016-telegram-chat-in-the-setup-wizard.md`](../decisions/0016-telegram-chat-in-the-setup-wizard.md) —
  `getUpdates` on page load with a negative offset, the token allow-list, the chat stored only after its code is
  typed back, the pending chat in a signed session-bound token.
- [`decisions/0036-telegram-bot-token-in-the-setup-wizard.md`](../decisions/0036-telegram-bot-token-in-the-setup-wizard.md)
  — the bot token entered in the Telegram step and kept encrypted, `getMe` as its check, the precedence of a set
  `TELEGRAM_BOT_TOKEN` without fallback, a damaged token row repairable in the step.

## Not here

- The paths, form reading, cookies, page rules and languages: [Setup wizard](setup-wizard.md).
- The session and the CSRF check: [Setup login](setup-login.md).
- The Messengers card that activates Telegram and removes its token: [Status page](status-page.md#messengers).
- The GitHub App step: [GitHub App step](github-app-step.md).
- The `secrets` and `settings` rows and the key check: [Storage](storage.md).
- Sending a notification through Telegram: [Delivery](delivery.md#sending-a-row).
