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
  so dot segments are already resolved: `/setup/../health` is `/health`. The root `/` is not part of the wizard
  either; `GET /` and `HEAD /` redirect to `/setup` ([HTTP routes](http-routes.md)).
- Every request under `/setup` is decided in this order:
  1. **No usable `SELUNA_SECRET`** (absent, not a string, or shorter than 32 characters as counted in
     [Storage](storage.md#encryption)): **503** with the _not configured_ page, for every method and path. No body
     is read and no cookie other than the language cookie is set.
  2. **`POST /setup/login`**: the login (below), with or without a session.
  3. **`GET /setup/github/callback`**: GitHub's return ([GitHub App](#github-app)), with or without a session.
  4. **No valid session**: **200** with the login page, for every other method and path (a `POST
/setup/github/callback` without a session included).
  5. **With a valid session**: `GET /setup` answers **200** with the status page, `POST /setup/logout` signs out
     (below), `POST /setup/settings` saves the settings and `POST /setup/reset` resets the saved credentials
     ([Status and settings](#status-and-settings), [Reset](#reset)), `POST /setup/channel/activate` and
     `POST /setup/channel/remove` are the forms of the Messengers card ([Messengers](#messengers)), `GET` and `POST /setup/telegram`, `POST /setup/telegram/verify`, `POST /setup/telegram/token` and
     `POST /setup/telegram/token/remove` are the Telegram step ([Telegram chat](#telegram-chat)), `GET` and `POST /setup/github` and `POST /setup/github/callback` are the
     GitHub App step ([GitHub App](#github-app)), everything else answers **404** with an empty body.
- The start page (`GET /setup`) is the status page. In this order its main column
  ([Pages and response headers](#pages-and-response-headers)) shows: the heading, the _start body_ and a notice if
  any; then, each in its own card, the status section, the reset section when a reset is needed ([Reset](#reset)),
  the Messengers card ([Messengers](#messengers)), the setup steps as links (_Telegram chat_, to `/setup/telegram`, and _GitHub App_, to `/setup/github`) and the
  settings form; last the sign-out form in the actions area. `GET` on `/setup/settings` or `/setup/reset` answers
  **404** with a session.

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
- A D1 failure while counting or resetting answers **503** with the login page and no session. The notice is
  _migrations missing_ when the database lacks a table of the schema (the table names are read from `sqlite_master`
  after the failure; no error is read), otherwise _unavailable_, which is also the answer when that read fails. The
  secret is not checked when counting failed, so the answer is the same for a wrong secret.
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
  without a query. The step that another site returns to, the manifest flow of the [GitHub App](#github-app) step,
  handles that return while signed out.

### Sign-out

- `POST /setup/logout` (with a valid session) reads its body like the login (413, 400), then needs a valid CSRF
  token, else **403** with the start page and the _form expired_ notice and the session stays. With a valid token
  it answers **303** with `Location: /setup` and clears the cookie (`seluna_session=; Max-Age=0`).
- Sign-out ends the session in this browser only: a copy of the token stays valid until it expires.

### CSRF protection

- Every form carries the hidden field `csrf`. There are two kinds of form: the **login form** (the login page) and
  the **signed-in forms** (every form on a page answered with a valid session; today the sign-out form on the start
  page, the settings, reset, activate and remove forms of the start page, the token, remove, confirm and verify forms of the Telegram step and the account form of the GitHub App step). The key is
  derived like the session key with salt and info `seluna/setup-csrf/v1`. Two forms carry no `csrf` field: the form
  of the GitHub review page, which posts to github.com, and the GitHub finish form, which is protected by its
  session-bound state instead ([GitHub App](#github-app)).
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

### Status and settings

- The status section lists: _Version:_ (the version of the build); _Messenger:_ the name of the active messenger,
  followed by _(not set up)_ when it is not set up ([Messengers](#messengers)); _Telegram bot token:_ _set by the Worker secret
  TELEGRAM_BOT_TOKEN_ when that secret is a non-empty string (well-formed or not), _saved in the setup_ for a usable
  saved token, _none saved yet_, or _cannot be read_ when the saved token cannot be read with the current
  `SELUNA_SECRET` or its row is damaged ([The bot token](#the-bot-token)); the value is never shown and Telegram is not
  called; _Telegram chat:_ the saved chat id, _set by the
  Worker secret TELEGRAM_CHAT_ID_ (no value shown) when that secret is a non-empty string, or _none saved yet_;
  _GitHub App:_ a link `https://github.com/apps/<slug>` with the slug as text and `(App ID <id>)` when the `meta` slug
  row belongs to the saved App ID, the App ID alone otherwise, the _Worker secrets_ or _partial Worker secrets_ text
  when those are set (no value shown), _none saved yet_, or _cannot be read_ when the saved App ID cannot be read with the current `SELUNA_SECRET` (a reset can also be needed while the App ID is still shown, when another saved credential does not decrypt); _Last delivery
  from GitHub:_ the time in the configured time zone as `YYYY-MM-DD HH:MM (<time zone>)` (24-hour), or _none
  received yet_ until the first delivery from GitHub is recorded ([Notifications](notifications.md)). When the runtime rejects the zone or the
  time at render, the time is written in UTC from its UTC fields, as `(UTC)`; the page never fails on it.
- Below _GitHub App:_ the section shows the owner line, the app check and _Installations:_ when the _GitHub App:_
  line names a usable app, that is for the _Worker secrets_ text and for a saved app (and for nothing else: no line,
  no owner, no check and no request for _none saved yet_, _partial Worker secrets_ and _cannot be read_). With
  credentials that sign, the page makes one app token and asks GitHub, beside each other, for the app itself
  ([GitHub API](github-api.md#app-read), `GET /app`) and for the app's installations
  ([GitHub API](github-api.md#installations-list), one request of up to 100). The answer of `GET /app` counts only
  when its `id` is the App ID of the credentials; otherwise, and when it fails or has unusable access, the app is
  _unchecked_.
- **Owner line:** `<p>GitHub App owner: <login> (personal account)</p>`, or `(organization)`, the login written as
  escaped text. The owner is the one GitHub's answer names, else the one stored for the App ID
  ([Storage](storage.md#tables)), else _owner unavailable_ ("Cannot be read from GitHub right now."). When the
  answer names an owner that differs from the stored one, or none is stored, the page stores it; a failed write is
  dropped and the page is still answered. Without credentials that work (_no-app_, _key unusable_, an app token that
  cannot be signed) no request is made and the owner is the stored one or _owner unavailable_. For an
  organization's app a paragraph follows (_organization owner_): Seluna cannot tell the owner's own actions from
  anyone else's, so the activity of every account is reported, the owner's too.
- **App check:** after the owner, `<p>Missing on the app: <list> <a href="…">Add them in the app's settings on
GitHub</a></p>` when the app lacks permissions or events the manifest asks for; the link is left out when no safe
  URL can be built (no slug from the answer or stored for the App ID, an owner or login that fails its check). When
  the app was not read, `<p>Missing on the app: Seluna could not read the app's permissions from GitHub.</p>`; when
  nothing is missing there is no paragraph. `<list>` is the permissions as `<Name> (read-only)` joined by `, `, then,
  when events are missing, `events: <Name>, <Name>`, the two parts joined by `; `; names are GitHub's, as on the
  review page, in manifest order. A `write` or `admin` level counts as granted, and permissions and events beyond
  the manifest are not reported.
- **Installations:** a list with one entry per
  installation in GitHub's order, `<login or slug> (<account type>), <repository selection>` with `, suspended` after
  it for a suspended installation, the login and slug written as escaped text, never as markup or a link, and, when
  the app was read, the check of the installation against what the app itself has: `, missing: <list> <a href="…">Review and accept on GitHub</a>`
  (the link only when a URL can be built: a `User` or `Organization` account with an allow-listed login),
  `, access not checked` when the installation's `permissions` or `events` are unusable, and nothing when it is
  complete or the app was not read. Suspended installations are checked too. _not
  installed_ on the same line for an empty list; the _more installations_ text after the list exactly when the
  answer's `Link` header has a link with `rel="next"`; _installations unavailable_ on the same line when the request
  fails (refused, timed out, redirected, unreadable) or the Worker secret `GITHUB_APP_ID` is not a positive whole
  number or a saved app has no saved private key, without a request in the last two cases; _key unusable_ on the same line
  when the private key cannot sign (not an RSA key, more than 4096 bits, or a saved key that does not decrypt). The
  page answers 200 in every one of these cases.
- The settings form posts to `POST /setup/settings` with the session-bound `csrf` field and these fields:
  `notification_language` (`en` or `de`), `time_zone` (an option per name the runtime lists, plus `UTC`), the
  checkboxes `quiet_hours`, `update_notice` and `rule_<id>` for the thirteen rules, among them _New star on a
  repository_ and _New fork of a repository_ (each posts the value `on` when checked, nothing otherwise), the times
  `quiet_start` and `quiet_end` (`type=time`, no `step`, shown as `22:00` and `07:00` while quiet hours are off), and the
  digest of stars and forks: the select `activity_digest` (`immediate`, `hourly` or `daily`, labelled _Immediately_,
  _Hourly_ and _Daily at_) with the time `digest_time` (`type=time`, shown as the stored time, or `18:00`). The form
  shows the stored values.
- Validation: the body is read with the 1 MiB limit (413, 400), then the CSRF token is checked (**403**, notice-only
  start page, _form expired_). `notification_language` and `time_zone` must occur once, the language `en` or `de`,
  the time zone exactly a listed name; a checkbox is absent (off) or occurs once with the value `on`; with
  `quiet_hours` on, `quiet_start` and `quiet_end` occur once each, are `HH:MM` from `00:00` to `23:59` and differ,
  with it off they are ignored; `activity_digest` occurs once and is one of the three choices, and with `daily` the
  single `digest_time` is `HH:MM` from `00:00` to `23:59` (with `immediate` or `hourly` a posted time is ignored; a
  form without `activity_digest` is invalid). Anything else answers **400** with the status page, the stored settings and the
  _settings invalid_ notice, and stores nothing. Valid settings are written in one batch and answer **303** with
  `Location: /setup`; they apply to the next read, nothing is cached. A D1 failure answers **503** with the
  notice-only start page and _unavailable_.
- Quiet hours are stored as one value (`off`, or `<start>-<end>`), so switching them off drops the times and the form
  shows 22:00 and 07:00 again when they are next switched on.
- `GET /setup` with a D1 failure answers **503** with the notice-only start page (in its main column the heading,
  the _start body_ and the notice, the step links card and the sign-out form in the actions area) and _unavailable_.
  The 403 answers of the sign-out, settings, reset, activate and remove forms render the notice-only page too and read no D1.

### Messengers

Seluna sends its notifications through one messenger, the active one ([Notifications](notifications.md#delivery-channels)).
Telegram is the only registered messenger today; further ones register in `src/channels/registry.ts`.

- **Card:** the Messengers card sits between the reset section and the step links. It holds the heading
  _Messengers_, an intro paragraph and a list with one entry per registered messenger in registry order. An entry shows
  the name in bold; for a messenger that is not active, a colon and its state, _Not set up_ or _Set up_; for the active
  one that is set up, a colon and _Active_; for the active one that is not set up, an info notice _Active, but not set
  up_ instead (notifications wait until it is set up). Then a link to the messenger's step page (`/setup/<id>`), _Set
  up_ when it is not set up and _Change_ when it is, and the forms below. A messenger is _set up_ when its
  destination can be resolved (for Telegram: a usable bot token and a chat).
- **Forms:** _Activate_ (a primary button) is shown for a messenger that is set up and not active; _Remove_ (a
  secondary button) for a messenger with credentials saved in the setup that its own step can remove (also the
  active one); for Telegram that is a saved bot token in the token card's _saved_ or _damaged_ state, so never while
  `TELEGRAM_BOT_TOKEN` is set or while the saved token cannot be read with the current `SELUNA_SECRET`. Each is a `POST` form
  with the session-bound `csrf` field and a hidden field `channel` holding the messenger's id, to
  `POST /setup/channel/activate` and `POST /setup/channel/remove`.
- **Processing** (both routes): the body is read with the 1 MiB limit (**413**, **400** when it cannot be read), then the
  CSRF token is checked (**403**, notice-only start page, _form expired_). The `channel` field must occur exactly once
  and equal, byte for byte, the id of a registered messenger (no trimming, no case folding, no path); otherwise **400**
  with the status page and the _messenger invalid_ notice, nothing changes. A D1 failure answers **503** with the
  notice-only start page and _unavailable_.
- **Activate:** the active messenger answers **303** to `/setup` without a write. A messenger that is not set up
  answers **409** with the status page and the _messenger not set up_ notice, the active messenger unchanged.
  Otherwise the setting `delivery_channel` is written ([Storage](storage.md)) and the answer is **303** to
  `/setup`. Rows still pending are then sent through the new messenger, with the attempts they already have. The
  settings form never writes `delivery_channel`.
- **Remove:** deletes the credentials the messenger saved in the setup, also when it is the active one (then the
  entry shows the _Active, but not set up_ notice and notifications wait); nothing saved is **303** without a
  delete. For Telegram it is the same as _Remove token_ of the step: a bot token set by the Worker secret
  `TELEGRAM_BOT_TOKEN` answers **409** with the _messenger Worker secrets_ notice, a saved token that cannot be read
  with the current `SELUNA_SECRET` answers **409** with the _token unreadable_ notice, and otherwise the token row is
  deleted and the answer is **303** to `/setup`.
- The Telegram step page shows an info notice _Telegram active, not set up_ as the first element of the token card,
  after its heading, exactly while Telegram is the active messenger (also when no messenger is stored) and not set up.
  Failing to read the active messenger there only leaves the notice out.

### Reset

- Precondition (`needsReset`, [Storage](storage.md#key-check)): the key check value reports a changed
  `SELUNA_SECRET` or is damaged, it is absent beside stored credentials, or a stored credential does not decrypt.
  `GET /setup` then answers **200**, never an error status, with the reset section: the _reset heading_, the _reset
  text_ and a form `POST /setup/reset` with the session-bound `csrf` field and the _reset button_.
- `POST /setup/reset` reads its body (413, 400), checks the CSRF token (**403**, notice-only start page, _form
  expired_) and then calls `resetCredentials`: `reset` deletes every `secrets` row (the GitHub App credentials and a saved Telegram
  bot token) and every `token_cache` row and the `meta` row `key_check` and answers **303** with `Location: /setup/github`; `not-needed` answers **409** with the status
  page and _reset not needed_ and deletes nothing; a D1 failure answers **503** with _unavailable_.
- The settings, the Telegram chat, `login_attempts` and `last_delivery` stay. Nothing outside D1 is called; the old
  GitHub App stays on GitHub and the _reset text_ tells the owner to delete it there.
- Guard: the delete runs only while the key check value and the fingerprint of the `secrets` rows are the ones the
  reset read, so a credential written between the check and the delete leaves everything in place. The three
  deletes run in one batch in this order: `token_cache` and `secrets` while both pins hold, then `key_check` while
  its value is the one read and no `secrets` row is left ([Storage](storage.md#key-check)). The answer is _reset_
  whether or not the guarded batch deleted anything; the next `GET /setup` shows the true state.
- Afterwards `GET /setup/github` shows the form, and the Telegram step shows the token form unless
  `TELEGRAM_BOT_TOKEN` is set.

### Telegram chat

The step that takes the owner's Telegram bot token and tells Seluna which Telegram chat to send to. The bot never
gets a webhook, Seluna neither sets nor removes one and exposes no Telegram route. The only Bot API methods called
are `getMe` (at most once per submitted token form whose token matches the bot token form, and never for one
that does not), `getUpdates` (this step's page) and `sendMessage` (its test message, and delivery).

- **Chat precedence:** when the Worker secret `TELEGRAM_CHAT_ID` is a non-empty string, it decides the chat. `GET
/setup/telegram` then answers **200** with the token card exactly as without it ([The bot token](#the-bot-token))
  and a chat card holding only the _Chat_ heading and the _chat id secret_ text as an info notice (no intro, no
  saved-chat line, no form, no search link). The page reads the saved token's state from D1 but calls Telegram zero
  times: no chat search runs, so a saved token Telegram no longer accepts is not detected there and its notice
  (_saved token rejected_) is not shown in this state. The token and remove forms work as without it. The confirm and
  verify forms answer **409** with the same view (a D1 failure while reading the token's state: **503**, the
  notice-only page, _unavailable_). No page shows the secret's value.
  Delivery uses `TELEGRAM_CHAT_ID` first, then the `settings` key `telegram_chat_id` ([Storage](storage.md)).
- **Bot token form:** a bot token, from either source, is never trimmed and must match exactly
  `^\d{1,20}:[A-Za-z0-9_-]{1,200}$` (digits, a colon, then letters, digits, `-` and `_`; at most 221 characters, all
  ASCII), because it is placed into the request URL path, where `/`, `\`, `?`, `#`, `%`, `.`, whitespace, control
  characters and non-ASCII characters would change the method or the path. A value that does not match never
  reaches a Bot API URL.
- **Chat id:** a chat id is text matching `^-?[1-9]\d{0,15}$` whose number is a safe integer. The form field `chat`
  and a stored `telegram_chat_id` are checked this way; a stored value that is not a chat id is shown as _no saved
  chat_.

#### The bot token

- **Source:** the Worker secret `TELEGRAM_BOT_TOKEN` when it is a non-empty string, otherwise the token saved in this
  step (the `secrets` row `telegram_bot_token`, encrypted, [Storage](storage.md#key-check)). A set Worker secret wins
  also when it is malformed, without falling back to a saved token, and then no D1 row is read; a saved token is
  neither used nor deleted while the secret is set. The same resolution serves the step, the confirm form, the status
  page and delivery ([Notifications](notifications.md#sending-a-row)). Its outcomes and what the token card shows
  for each, below its _Bot token_ heading:

  - _Worker secret_ (`TELEGRAM_BOT_TOKEN` matches the form): the _worker secret token_ info notice, preceded by the
    _token rejected_ notice after a 401 or 404 of the chat search.
  - _Worker secret malformed_ (`TELEGRAM_BOT_TOKEN` set but not of the form): the _token malformed_ notice only.
  - _missing_ (no Worker secret and no saved token, also without a usable `SELUNA_SECRET`): the _token intro_ and the
    token form.
  - _saved_ (a saved token that decrypts and is of the form): the _token saved_ text, a disclosure _Change token_
    holding the token form, and the remove form; after a 401 or 404 of the chat search the _saved token rejected_
    notice comes first and the disclosure is open.
  - _unreadable_ (the key check value reports a changed `SELUNA_SECRET` or is damaged): the _token unreadable_ notice
    only, no form and no remove form.
  - _damaged_ (the key check value matches, but the token's row does not decrypt or decrypts to a value not of the
    form): the _token damaged_ notice, the token form and the remove form.

- **Token form:** `POST /setup/telegram/token` with the session-bound `csrf` field and one field `token`: a label
  _Bot token_, an `<input id="token" type="password" name="token" autocomplete="off" spellcheck="false"
maxlength="221" required>` that never carries a `value`, and the primary button _Save token_. **Remove form:**
  `POST /setup/telegram/token/remove` with the `csrf` field and the secondary button _Remove token_. The disclosure is
  a `<details>` element with a `<summary>`, so it needs no script.
- `POST /setup/telegram/token` in this order, each step that rejects ending the request: the body is read (**413**
  above 1 MiB, **400** unreadable, empty bodies); the CSRF token must be valid, else **403**, the notice-only page
  and _form expired_; `TELEGRAM_BOT_TOKEN` set (well-formed or not): **409** with the _worker secret token_ notice;
  exactly one `token` field matching the form, else **400** with the token form and _token invalid_ (a missing,
  repeated, empty or space-padded field included); the saved token unreadable: **409** with the _token unreadable_
  notice; the key check value reports a changed or damaged state (no token saved, but other credentials cannot be
  read): **409** with _token not saved_; then one `getMe` (`POST https://api.telegram.org/bot<token>/getMe`, JSON
  `{}`, 10 second abort, answer read up to 1 MiB in bytes): **401** or **404** answers **502** with the token form and
  _token not accepted_; a 2xx answer whose body has `ok: true` is accepted (also for a bot with a webhook, which the
  following chat search then shows as _conflict_); any other answer (a failed or aborted request, 429, another
  status, an oversized or non-JSON body, `ok` not `true`) answers **502** with the token form and _token unverified_.
  An accepted token is written encrypted, replacing a saved or damaged one, and the answer is **303** with `Location:
/setup/telegram`; a write the key check refuses answers **409** with _token not saved_. `TELEGRAM_CHAT_ID` is not
  looked at.
- `POST /setup/telegram/token/remove` in this order: body (**413**, **400**); CSRF (**403**, notice-only page, _form
  expired_); `TELEGRAM_BOT_TOKEN` set: **409** with the _worker secret token_ notice; the saved token unreadable:
  **409** with the _token unreadable_ notice; otherwise the saved token's row is deleted
  ([Storage](storage.md#key-check)) and the answer is **303** with `Location: /setup/telegram`, also when no token was
  saved. The saved chat and the settings stay; outbox rows wait unsent until a token is available again. Telegram is
  not called.
- The 400, 409 and 502 answers of both forms show the step page with the token card only (no chat card), so they
  call no further Telegram API and read nothing more from D1; the notice given replaces the one the state implies.
  A D1 failure in either form answers **503** with the notice-only page and _unavailable_; the stored state is then
  the one before or after the request. No answer, header or log entry contains the submitted or the saved token, and
  no page is built from the submitted value.

#### The step page

- `GET /setup/telegram` (signed in) resolves the bot token ([The bot token](#the-bot-token)) and, unless
  `TELEGRAM_CHAT_ID` is set, reads the saved chat from `settings`. Only with a usable token does it then call
  `getUpdates` **once**:
  `POST https://api.telegram.org/bot<token>/getUpdates` with `Content-Type: application/json`, body
  `{"offset":-100,"limit":100,"timeout":0}` (no `allowed_updates`) and a 10 second abort. The negative offset
  returns the newest 100 updates and makes Telegram discard the bot's older ones, so every load changes the bot's
  state at Telegram (not Seluna's); only Seluna reads this bot's updates, and another program polling the same bot
  is a conflict.
- Answers: 2xx with `ok: true` and a `result` array lists the chats; **401** or **404** marks the token in use as
  rejected (the token card shows _token rejected_ for the Worker secret, _saved token rejected_ for a saved token) and
  the chat card shows no search; **409**
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
- **Page:** the heading, then the token card (the _Bot token_ heading and the content of
  [The bot token](#the-bot-token)), then the chat card: the _Chat_ heading, the intro, a notice for a problem, the
  saved chat (_Saved chat:_ and the id, or _no saved chat_), a link to
  `/setup/telegram` (_search_) and then either the _chats intro_ with a form `POST /setup/telegram` (one required
  radio input `chat` per chat with the decimal id as value, a label with the name, the `@username` and the kind,
  the session-bound CSRF field and the confirm button) or, with no chat, the _no chats_ text and no form. Every name
  is HTML-escaped and wrapped in its own `<bdi>`; a username is shown as `@<username>` in a separate
  `<bdi class="username">` after the name, so a name cannot pose as a username. A _conflict_ or _Telegram
  unavailable_ shows its notice instead of the chats, with the saved-chat line and the search link. Without a usable
  token, or after a 401 or 404, the chat card shows only the intro and the saved-chat line (no search link, no
  chats).
- When reading the saved token or `settings` fails, the answer is **503** with the notice-only page (the heading,
  then one card with the intro, the notice and the search link) and the _unavailable_ notice; Telegram is not
  called.

#### Confirming a chat

- `POST /setup/telegram` sends a test message with a six-digit code to the chosen chat and stores nothing. In this
  order: the body is read (**413** above 1 MiB, **400** unreadable, empty bodies); the CSRF token (signed-in form)
  must be valid, else **403**, the notice-only page and _form expired_; `TELEGRAM_CHAT_ID` set: **409**; the field
  `chat` must occur once and be a chat id, else **400** and _invalid chat_; the bot token is resolved
  ([The bot token](#the-bot-token)): missing, unreadable or damaged answers **503** _token missing_, a malformed Worker
  secret **503** _token malformed_, a D1 failure **503** _unavailable_; then one `sendMessage`
  (`POST https://api.telegram.org/bot<token>/sendMessage`, JSON `{"chat_id":<id as a number>,"text":"<test message
in the page language> <code>"}`, no `parse_mode`, 10 second abort). `sendMessage` 401 or 404 answers **502** with
  _token rejected_ on the notice-only page when the token is the Worker secret; for a saved token it answers **502**
  with the step page holding only the token card in its _saved_ state marked rejected: the _saved token rejected_
  notice, the _token saved_ text, the open _Change token_ disclosure with the token form, and the remove form (no chat
  card) ([The bot token](#the-bot-token)); any other failure (status, `ok` not `true`, rejected fetch, unreadable or oversized answer)
  answers **502** with _send failed_. Telegram is not called in the 413, 400, 403, 409 and 503 cases.
- Success answers **200** with the code page: the heading, then one card with a notice when one is given (_wrong
  code_, below), the _code sent_ text with the chat id, the _code intro_, a
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

### GitHub App

The step that creates the private GitHub App through GitHub's manifest flow ([decision
0017](../decisions/0017-github-app-manifest-flow.md)) and stores its App ID, private key and webhook secret
encrypted ([Storage](storage.md)). The Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and
`GITHUB_WEBHOOK_SECRET` stay a manual alternative and take precedence.

- **Worker secrets:** each of the three that is a non-empty string counts as set. All three set: the step's main
  column shows the heading and one card with the _Worker secrets_ text as an info notice, and no form. One or two
  set: the same with the _partial Worker secrets_ text as an error notice. While any of the
  three is set, both POSTs answer **409** with the same view and call neither GitHub nor D1. No page shows a value.
- **Account name:** the account or organization name is checked against `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`
  (1 to 39 letters, digits and inner hyphens) before it enters a URL or the app name, and is never encoded or
  trimmed. The account type is exactly `personal` or `organization`.
- **Manifest code:** the `code` of GitHub's return must match `^[A-Za-z0-9_-]{1,100}$` before it enters the URL of
  the conversion. The app's slug must match `^[a-z0-9-]{1,100}$` before it enters the install link.

#### The step page

- `GET /setup/github` (signed in) answers **200** with one of: the _Worker secrets_ view, the _partial Worker
  secrets_ view, the _reset needed_ view (the stored `github_app_id` cannot be read with the current `SELUNA_SECRET`,
  or the key check value is damaged; the heading and one card with the _reset needed_ text as an error notice and
  nothing else, no form; the start page is reached through the step navigation), or the form. The form view shows the heading and one card with the
  _intro_, a notice when one is given, the saved App ID (or _no saved app_ and, with an app, the _replace hint_) and
  the form: two radio inputs `account_type` (`personal`, `organization`), a text input
  `account`, the session-bound CSRF field and the _next_ button. A stored value that is not an App ID is shown as _no
  saved app_. The view reads D1 only when none of the Worker secrets is set; a D1 failure answers **503** with the
  notice-only page (the heading, then one card with the notice and the link back to the step) and _unavailable_.

#### Starting the flow

- `POST /setup/github` in this order: the body is read (**413**, **400**); the CSRF token (signed-in form) must be
  valid, else **403**, the notice-only page and _form expired_; any Worker secret set, **409**; exactly one
  `account_type` that parses and exactly one `account` that is an account name, else **400** with the form page and
  _invalid account_; the key check changed or corrupt, **409** with the _reset needed_ view; a D1 failure, **503**
  with _unavailable_.
- Success answers **200** with the **review page**: the heading, then one card with the review intro, the account
  and its type, the app name, the permissions, the events, and one form `method="post"` whose `action` is
  `https://github.com/settings/apps/new?state=<state>` for a personal account or `https://github.com/organizations/<account>/settings/apps/new?state=<state>` for an
  organization, with the hidden field `manifest` as its only field (no `csrf` field: the form posts to another
  site). This is the only page whose `Content-Security-Policy` has `form-action https://github.com` in place of
  `form-action 'self'`.
- **Manifest** (the JSON of the field `manifest`, keys in this order): `name` `seluna-<account>` cut to its first 34
  characters; `url` `https://github.com/LarsLaskowski/Seluna`; `hook_attributes` `{"url":"<origin>/webhook","active":true}`;
  `redirect_url` `<origin>/setup/github/callback`; `public` `false`; `default_permissions` read-only `actions`,
  `contents`, `issues`, `pull_requests`, `vulnerability_alerts`, `security_events`, `secret_scanning_alerts` and
  `metadata`; `default_events` `pull_request`, `workflow_run`, `dependabot_alert`, `code_scanning_alert`,
  `secret_scanning_alert`, `issues`, `issue_comment`, `fork` and `star` (decision
  [0039](../decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)). `<origin>` is the origin of the request. The owner can edit the app's name on GitHub's page.
- **State:** `v1.<type>.<account>.<expires>.<nonce>.<mac>`: `<type>` is `personal` or `organization`, `<account>` the
  name as entered, `<expires>` the time of the request plus 3,600,000 ms in decimal, `<nonce>` 16 random bytes as
  base64url (22 characters), `<mac>` the HMAC-SHA256 (base64url without padding, 43 characters) of the ASCII text
  `github-state.v1.<type>.<account>.<expires>.<nonce>.<session token>`. The key is derived like the session key with
  salt and info `seluna/setup-github/v1`. The state has at most 139 characters and consists of letters, digits, `-`,
  `_` and `.`. Nothing is kept in D1 or a cookie.
- A state is **valid** for a session when it has exactly that form (canonical base64url, an expiry without leading
  zero of at most 15 digits), its MAC verifies in constant time for the request's session token, and `now < expires
≤ now + 1 hour`. It then yields the account type and account it was issued for.

#### GitHub's return and finishing

- GitHub redirects to `/setup/github/callback?code=<code>&state=<state>` without the wizard's cookies
  (`SameSite=Strict`). `GET /setup/github/callback` answers, signed in or not and after the `SELUNA_SECRET` check,
  **200** with the **finish page** when the query has exactly one `code` that passes the manifest code allow-list and
  exactly one `state` of the form above. Its main column shows the heading, then one card with the finish intro, a
  notice when one is given (_GitHub unavailable_, below) and the page's one form, which posts the hidden fields
  `code` and `state` (escaped) to `/setup/github/callback` and carries no `csrf` field. Otherwise it answers **400** with the notice-only page and
  _invalid return_. Neither answer calls GitHub or D1 or sets a cookie (a valid `lang` parameter still sets the
  language cookie); the response carries `Referrer-Policy: no-referrer`.
- The finish form is a request from the instance's own page, so the browser sends the session cookie. The valid state
  takes the place of the `csrf` field: its MAC is bound to this session, so neither a page on another site nor a host
  under the same registrable domain can submit it. The finish page sets no `seluna_csrf` cookie, which would replace
  the owner's and expire every other open form.
- `POST /setup/github/callback` without a session answers the login page and calls nothing. With one, in this order:
  1. the body is read (**413**, **400**);
  2. exactly one `state` field that is valid for the session, else **403** with the notice-only page and _state
     invalid_; GitHub is not called;
  3. any Worker secret set, **409** with that view;
  4. exactly one `code` field that passes the allow-list, else **400** and _invalid return_;
  5. the key check changed or corrupt, **409** with the _reset needed_ view; a D1 failure, **503** with
     _unavailable_; GitHub is not called in these cases;
  6. the conversion (below): _rejected_ **400** and _code rejected_; _unavailable_ **502** with the finish page again
     (same `code` and `state`) and _GitHub unavailable_; _malformed_ **502** with the notice-only page and _answer
     invalid_;
  7. the **owner check**: the answer's `owner.login` must pass the account name allow-list and equal the state's
     account ignoring ASCII letter case, and `owner.type` must be exactly `User` for `personal` or `Organization`
     for `organization`, else **403** with the notice-only page and _owner mismatch_; nothing is stored, no install
     link is shown and the key is not converted. Without it, anyone could send the owner's browser to the return path
     with a code of their own app and the owner's state;
  8. the private key is converted to PKCS#8 and must import as an RS256 signing key, else **502** with _answer
     invalid_;
  9. the three credentials are stored in one transaction ([Storage](storage.md)); a result other than stored, or a D1
     failure, answers **503** with _store failed_;
  10. stored: **200** with the **created page**: the heading, then one card with _app saved_ as an info notice, the
      _install intro_ and a link to
      `https://github.com/apps/<slug>/installations/new`, or, when the answer has no slug that passes the allow-list,
      the _install manually_ text and no link. After the three credentials were stored, the slug is kept in `meta`
      `github_app_slug` as `<appId>:<slug>` (only when the answer has an allow-listed slug), and the owner in `meta`
      `github_app_owner` as `<appId>:<ownerId>:<type>:<login>` (only when the answer's `owner` has a positive safe
      integer `id`, a `login` that is an account name and a `type` of exactly `User` or `Organization`, parsed apart
      from the owner check so that an unusable `id` never makes the answer _malformed_); a failure of either write
      is dropped and the page is still _created_.
- **The conversion:** one `POST https://api.github.com/app-manifests/<code>/conversions` with `Accept:
application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: seluna/<version>`, no
  `Authorization`, no body, `redirect: "manual"` and a 10 second abort signal. A 2xx answer of at most 1 MiB (counted in
  bytes before decoding) that is UTF-8 JSON is narrowed to: `id` (a positive safe integer), `owner` (`login`, a string
  of at most 39 characters, and `type`, a string), `slug` (kept only when it passes the allow-list), `pem` (a string of
  at most 16,384 characters) and `webhook_secret` (a non-empty string of at most 1,024 characters). Any other 2xx body
  (also `webhook_secret: null`, a missing or enterprise `owner`) is _malformed_. **404** and **422** are _rejected_; any
  other status, a redirect among them, and a failed or aborted request are _unavailable_; the body of every non-2xx
  answer is cancelled unread. The client secret and every other field are discarded.
- **Stored values:** `github_app_id` the decimal App ID, `github_private_key` the PKCS#8 PEM (`-----BEGIN PRIVATE
KEY-----`, lines of 64 characters), `github_webhook_secret` the webhook secret as GitHub generated it. The key is
  accepted as a PKCS#1 (`RSA PRIVATE KEY`) or PKCS#8 (`PRIVATE KEY`) PEM of at most 16,384 characters with canonical
  base64 and nothing around it; nothing is ever decrypted or logged.

### Cookies

- Every cookie the wizard sets has `Path=/setup; HttpOnly; Secure; SameSite=Strict`, so the browser sends it to
  `/setup` and the paths below it only and never with a request started by another site.
- Cookie values are read as they appear in the `Cookie` header (pairs split at `;`, name and value trimmed of
  spaces, the value neither unquoted nor decoded); a value that does not have the expected form is ignored.

### Pages and response headers

- Pages are complete HTML documents rendered on the server, UTF-8, without a framework, without any script,
  without any external resource (no script, font, style or image is loaded from anywhere), and with one inline
  `<style>` element.
- **Frame:** the body of every page starts with a header bar (`<header>`) that holds the page title ("Seluna setup",
  "Seluna-Einrichtung") as text, not as a heading, then the step navigation on the pages that have it, then the
  language navigation (a `<nav>` named _Language_, "Sprache", through `aria-label`, with the visible text
  "Language:" and the two language links, [Language](#language)); below it one centred main column (`<main>`,
  limited by a maximum width only) holds the page's only `<h1>` and the rest of the page. The descriptions of a page
  or view elsewhere in this area (what it shows, shows only, or in which order) list the content of the main column.
- **Step navigation:** a `<nav class="steps">` named _Setup steps_ ("Einrichtungsschritte") through `aria-label`,
  separate from the language navigation. It lists three items in this order, separated by " | ": _Start page_
  (`/setup`), _Telegram chat_ (`/setup/telegram`) and _GitHub App_ (`/setup/github`), labelled with the texts of
  [Texts](#texts) in the page's language. The current item is plain text in a `<span aria-current="page">`, not a
  link, and is the only element of the page with `aria-current`; the other two are links to exactly those addresses,
  without query or fragment. The current item is fixed by the page that is rendered, not by the request path or the
  session: _Start page_ on every view of the start page, _Telegram chat_ on every view of the Telegram step page, and
  _GitHub App_ on every view of the GitHub App step page (the created page included) and on the review and finish
  pages — the finish page and the notice-only page of _invalid return_ carry it also when answered without a session.
  The login page and the _not configured_ page have no step navigation and no `aria-current` attribute, so they link to
  nothing but the two language links.
- **Cards:** the parts of a page sit in cards (a bordered box whose background differs from the page's, cards
  separated by at least 0.75rem). The login page has its heading, intro and notice above one card with the form;
  the _not configured_ page its heading above one card with the paragraphs; the start page its heading, _start
  body_ and notice above one card each for the status, the reset, the setup steps and the settings, and the
  sign-out form last in an actions area without a card ([Paths](#paths)). The Telegram step page has its heading
  above the token card and, unless an answer omits it, the chat card ([The step page](#the-step-page)); its
  notice-only and code views, the GitHub App step page in every view, and the review, finish and created pages have
  their heading above one card with everything else, in the order their sections above give. A part that is not shown leaves no empty card or notice behind.
- **Settings groups:** in the settings form, the quiet hours switch with its label is the legend of a framed group
  (`<fieldset>`) holding _Start_ and _End_; "Notify me about" is the legend of a second group holding the thirteen rule
  switches and the release notice switch; _Stars and forks_ is the legend of a third group, after the second and
  before the save button, holding the interval select and the time field.
- **Buttons:** _Sign out_, _Remove token_ and _Remove_ (Messengers card) are secondary buttons, _Reset and create the GitHub App again_ a danger button, and every
  other submit button (_Sign in_, _Save settings_, _Activate_, _Save token_, _Send test message_, _Save chat_, _Next_, _Continue
  to GitHub_, _Finish_) a primary button. Buttons are at least 2.75rem high.
- **Notices:** every notice of [Texts](#texts) is shown as an error notice with `role="alert"`. The _partial Worker
  secrets_ and _reset needed_ texts of the GitHub App step are error notices too, and the _chat id secret_ text, the
  _worker secret token_ text of the Telegram step, the _Worker secrets_ text of the GitHub App step and the created
  page's _app saved_ are info notices, and so are the _Active, but not set up_ text of the Messengers card and the _Telegram active, not set up_ text of the Telegram step; these eight carry no role.
- **Colours:** the pages follow the system setting: light colours by default, dark colours under
  `@media (prefers-color-scheme: dark)`, and `color-scheme: light dark`, so the browser's own controls (selects,
  time fields, checkboxes, radio buttons) follow too; a browser without the media query shows the light colours.
  Each mode declares its colours once, as `#rrggbb` custom properties on `:root` (the dark set inside the media
  query), and every rule uses them through `var(...)`. In each mode the WCAG 2.1 contrast ratio is at least 4.5:1
  for text on the page and card backgrounds, links on both, the current item of the step navigation (text colour) on
  the header background, the text of each button kind and of each notice kind on its background, and at least 3:1 for the card border on the page, the control border on the card and the page,
  the primary and danger button backgrounds and the notice borders on the card (the notice borders on the page too),
  and the focus ring on both. The current item of the step navigation is bold (`.steps [aria-current=page]`), in the
  text colour and without underline, so it differs from the links in more than colour.
- **Focus and borders:** links, buttons, inputs (checkboxes and radio buttons included) and selects get a 3px
  outline in the focus colour under `:focus-visible`; no rule removes the outline under plain `:focus`, so a browser
  without `:focus-visible` keeps its default. Cards, buttons, inputs, selects and notices have a border, so they stay
  distinguishable in forced-colours mode.
- **Width:** a 360 px viewport needs no sideways scrolling: the body wraps long words (`overflow-wrap: anywhere`),
  inputs, selects and buttons are `box-sizing: border-box` with `max-width: 100%`, and the style has no `white-space:
nowrap` or `pre`, no width above 20rem, no fixed height, and font sizes only in `rem`, `em` or `%`, so zoom and a
  large default font scale the page. The `viewport` meta element is `width=device-width, initial-scale=1`. Nothing
  is animated.
- **Style limits:** the content of the `<style>` element is one constant, the same on every page and response; no
  page has another `<style>` element, a `style=` attribute, a `<link>`, `<img>`, `<iframe>` or `xlink:href`, and
  the only external addresses in `src`, `href` and `action` are the status section's app link, its app settings and
  installation review links (`https://github.com/settings/...` and `https://github.com/organizations/...`, built
  only from allow-listed parts), the created page's install link and the review page's form action; the internal addresses of the step navigation are fixed
  (`/setup`, `/setup/telegram`, `/setup/github`). The style loads nothing: no `url(`, no at-rule but `@media`, no
  CSS escape (`\`), none of the functions `image-set(`, `-webkit-image-set(`, `image(`, `src(`, `cross-fade(` and
  `element(`; it names only system and generic font families, is printable ASCII without `<` (so the bytes the
  browser hashes are the bytes the policy names) and is at most 8,192 bytes as UTF-8.
- Every text placed in a page is HTML-escaped (`&`, `<`, `>`, `"`, `'`). No page echoes anything from the request
  (not the secret, not a token other than the page's own CSRF token, not a header, not the path) except the GitHub
  finish page, which echoes the `code` and `state` of the return in hidden fields after their allow-lists, escaped.
  The review page shows the account as entered, after its allow-list, escaped.
- Every response under `/setup` (pages, redirects, 404, 413, 400) carries:

  | Header                    | Value                                                                                                        |
  | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `Content-Security-Policy` | `default-src 'none'; style-src 'sha256-<hash>'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` |
  | `X-Content-Type-Options`  | `nosniff`                                                                                                    |
  | `X-Frame-Options`         | `DENY`                                                                                                       |
  | `Referrer-Policy`         | `no-referrer`                                                                                                |
  | `Cache-Control`           | `no-store`                                                                                                   |

  `<hash>` is the base64 (with padding) SHA-256 of the UTF-8 bytes of the content of the page's `<style>` element.
  The GitHub review page alone has `form-action https://github.com` instead of `form-action 'self'`, so that its form
  can post the manifest. A page also carries `Content-Type: text/html; charset=utf-8` and `Content-Language` with its language.

### Language

- The interface is in English (`en`) and German (`de`); every text exists in both.
- The language of a response is, in this order: the query parameter `lang` when it is exactly `en` or `de`; else
  the first of the first four `seluna_lang` cookie values that is exactly `en` or `de`; else the `Accept-Language` header; else
  English.
- A valid `lang` parameter also sets the cookie `seluna_lang` to it, with `Max-Age=31536000` (one year).
- Every page links to exactly `/setup?lang=en` and `/setup?lang=de`, whatever path it is answered on (a page
  answered on `/setup/logout` or `/setup/login` links to `/setup` too), and its `<html lang>` is its language. A page
  with the step navigation ([Pages and response headers](#pages-and-response-headers)) also links to its items other
  than the current one.
- `Accept-Language` is read as RFC 9110 defines it: a comma-separated list of language ranges, each with an
  optional weight `;q=<0 to 1, at most three decimals>`. A range counts for German when its first subtag is `de`
  and for English when it is `en`, in any case (`de`, `de-DE`, `DE-at`). The language with the highest weight
  wins; on equal weights the one listed first. A weight of 0 excludes the range; `*`, other languages and entries
  that do not fit the grammar are skipped. Examples: `de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7` → German,
  `en-US,en;q=0.9` → English, `fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7` → German, `de;q=0,en;q=0.1` → English,
  `fr` → English.

### Texts

The notices, the Telegram step, the GitHub App step and the _not configured_ page, in English (the German texts are their translation, in
`src/setup/texts.ts`):

- _wrong secret_: "That is not the SELUNA_SECRET of this instance."
- _locked_: "Too many failed attempts. Signing in is locked for 15 minutes after the fifth failed attempt; try
  again later."
- _form expired_: "The form has expired. Please submit it again."
- _unavailable_: "The setup is unavailable right now. Please try again in a moment."
- _migrations missing_: "The database of this instance is missing its tables: the database migrations have not
  run. In the Cloudflare dashboard open Workers & Pages, this Worker, Settings and Build, set the Deploy command to
  npm run deploy and retry the latest build, as the setup guide describes."
- _token missing_ (answer of the confirm form): "No usable bot token is available. Open the Telegram chat step and
  check the bot token there."
- _token malformed_: "The Worker secret TELEGRAM_BOT_TOKEN is not a bot token. A token from @BotFather is digits, a
  colon, then letters, digits, - and _, without spaces. Copy it again from @BotFather and replace the secret in the
  Cloudflare dashboard under Settings, then Variables and Secrets."
- _token rejected_: "Telegram does not accept the Worker secret TELEGRAM_BOT_TOKEN: it is mistyped or was revoked.
  Send /mybots to @BotFather, copy your bot's current token and replace the secret in the Cloudflare dashboard under
  Settings, then Variables and Secrets."
- _token invalid_: "That is not a bot token. A token from @BotFather is digits, a colon, then letters, digits, - and
  _, without spaces. Copy it again from @BotFather. Nothing was saved."
- _token not accepted_: "Telegram does not accept this token: it is mistyped or was revoked. Send /mybots to
  @BotFather, copy your bot's current token and enter it again. Nothing was saved."
- _token unverified_: "Telegram could not be reached or gave an answer Seluna cannot read, so the token was not
  saved. Please try again in a moment."
- _saved token rejected_: "Telegram does not accept the saved bot token: it was revoked or the bot was deleted. Send
  /mybots to @BotFather, copy your bot's current token and enter it here."
- _token unreadable_: "The saved bot token cannot be read with the current SELUNA_SECRET: it was changed, or the
  saved values are damaged. Set the earlier SELUNA_SECRET again, or reset the saved credentials on the start page and
  enter the token again."
- _token damaged_: "The saved bot token is damaged and cannot be read. Enter the token again, or remove it."
- _token not saved_: "The token was not saved because the saved credentials cannot be read with the current
  SELUNA_SECRET. Set the earlier SELUNA_SECRET again, or reset the saved credentials on the start page first."
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
- Messengers: the heading "Messengers"; the intro "Seluna sends its notifications through one messenger, the active one. Set up a messenger, then activate it; notifications still waiting are then sent through it."; the states "Not set up", "Set up" and "Active"; the notice "Active, but not set up: notifications wait until it is set up."; the links "Set up" and "Change"; the buttons "Activate" and "Remove"; in the status section the label "Messenger:" and the suffix "(not set up)".
- _messenger invalid_: "Please choose a messenger from the list."; _messenger not set up_: "This messenger is not set up yet. Set it up first, then activate it."; _messenger Worker secrets_: "This messenger is set by Worker secrets, which Seluna cannot remove. Delete them in the Cloudflare dashboard under Settings, then Variables and Secrets."
- Telegram step: the info notice "Telegram is the active messenger: notifications wait until a bot token and a chat are set up here."
- Start page: "Set up your instance step by step:" and the links "Telegram chat" and "GitHub App".
- Step navigation: the name "Setup steps" and the items "Start page", "Telegram chat" and "GitHub App" (the last two
  are the headings of the two step pages); the language navigation is named "Language", the label it already shows.
- Status: the heading "Status"; "Version:"; "Telegram bot token:" with "Set by the Worker secret
  TELEGRAM_BOT_TOKEN.", "Saved in the setup.", "None saved yet." or "Cannot be read with the current SELUNA_SECRET.";
  "Telegram chat:" with "None saved yet." or "Set by the Worker secret
  TELEGRAM_CHAT_ID."; "GitHub App:" with "None saved yet.", "Set by the Worker secrets GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET.", "Only some of the Worker secrets GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are set.", "App ID" or "Cannot be read with the current
  SELUNA_SECRET."; "Last delivery from GitHub:" with "None received yet.".
- Owner and app check (below "GitHub App:"): the label "GitHub App owner:" with the login and "(personal account)" or
  "(organization)", or "Cannot be read from GitHub right now."; for an organization "The app belongs to an
  organization, so Seluna cannot tell your own actions from anyone else's: activity of every account is reported,
  yours too."; the label "Missing on the app:" with the list, the link "Add them in the app's settings on GitHub", or
  "Seluna could not read the app's permissions from GitHub."; in the list "(read-only)" after a permission and
  "events:" before the events.
- Installations (below "GitHub App:"): the label "Installations:"; an entry "<login or slug> (<account type>),
  <repository selection>" with ", suspended" for a suspended installation, then ", missing: <list>" with the link
  "Review and accept on GitHub" or ", access not checked"; the account types "personal account"
  (`User`), "organization" (`Organization`), "other account" (any other or a missing type) and "enterprise" (an
  account with a slug and no login); "Unknown account" in place of name and type for an account without both;
  the repository selections "all repositories" and "selected repositories"; _not installed_: "Not installed on any
  account yet."; _more installations_: "Only the first 100 installations are shown."; _installations unavailable_:
  "Cannot be loaded from GitHub right now."; _key unusable_: "The app's private key cannot be used.".
- Reset: the heading "The saved credentials cannot be read"; the text "The saved credentials cannot be read with the
  current SELUNA_SECRET: it was changed, or a saved value is damaged. If you still know the earlier SELUNA_SECRET, set
  it again instead. Otherwise reset: Seluna deletes the saved GitHub credentials, the installation tokens and the
  saved Telegram bot token; you then create the GitHub App again and enter the bot token again in the Telegram chat
  step. Delete the old app on GitHub afterwards: in the settings of your account or organization, under Developer
  settings, then GitHub Apps. The Telegram chat and the settings are kept."; the button "Reset and create the GitHub App again".
- Settings: the heading "Settings"; "Language of the notifications"; "Time zone"; "Quiet hours: notifications arrive
  without sound" with "Start" and "End"; "Notify me about" with "New pull request", "Pull request ready for review",
  "Review requested", "CI failed on the default branch", "CI failed in a pull request", "Dependabot alert", "Code
  scanning alert", "Secret scanning alert", "New issue", "New comment on an issue", "New comment on a pull
  request", "New star on a repository" and "New fork of a repository" (German "Neues Issue", "Neuer Kommentar zu einem Issue" and "Neuer Kommentar zu einem Pull Request", "Neuer Stern für ein Repository" and "Neuer Fork eines Repositorys"); "Stars and forks" (German "Sterne und Forks") with the options "Immediately", "Hourly" and "Daily at" (German "Sofort", "Stündlich" and "Täglich um") and the field "Time" (German "Uhrzeit"); "Tell me when a new Seluna release is available"; the button "Save
  settings".
- _settings invalid_: "The settings were not saved. Check the values: quiet hours need a start and an end in the
  form 22:00, and the two must differ; a daily digest of stars and forks needs a time in the form 18:00."; _reset not
  needed_: "The saved credentials can be read with the current
  SELUNA_SECRET, so nothing was reset."
- Telegram step token card: the heading "Bot token"; _token intro_ "Seluna sends its notifications through your own
  Telegram bot. In Telegram, send /newbot to @BotFather and enter the token it returns here. Seluna checks the token
  with Telegram and saves it encrypted; it is not shown again."; the label "Bot token"; the button "Save token";
  _token saved_ "A bot token is saved. It is not shown again."; the disclosure "Change token"; the button "Remove
  token"; _worker secret token_ "The bot token is set by the Worker secret TELEGRAM_BOT_TOKEN, which takes precedence
  over a token saved here. To enter the token here, delete that secret."
- Telegram step chat card: the heading "Chat".
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
- GitHub App step: the heading "GitHub App"; the _intro_ "Seluna receives the events of your repositories through a
  private GitHub App of its own. Create it here for your personal account or for an organization: Seluna sends GitHub
  a manifest with the app's name, the webhook address of this instance and read-only permissions, and saves the app's
  credentials encrypted once you have confirmed on GitHub."; _Worker secrets_ "The GitHub App is set by the Worker
  secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET, which take precedence over an app created
  here. To create the app here, delete those secrets."; _partial Worker secrets_ "Some, but not all, of the Worker
  secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are set. Set all three to configure the app
  by hand, or delete them to create the app here."; _reset needed_ "The saved GitHub credentials cannot be read with
  the current SELUNA_SECRET: it was changed, or the saved values are damaged. Set the earlier SELUNA_SECRET again, or
  reset the saved credentials on the start page and create the app again."; _Saved GitHub App, App ID:_ (followed by the id) and _No GitHub App is
  saved yet._; _replace hint_ "Creating a new app replaces the saved one. Delete the old app on GitHub afterwards: in
  the settings of your account or organization, under Developer settings, then GitHub Apps."; _My personal account_,
  _An organization_, the account label "Name of the account or organization, as in github.com/name" and the button
  "Next".
- GitHub review page: "Seluna asks GitHub to create this app. On GitHub, check the details and select Create GitHub
  App; GitHub then sends you back here. Seluna saves the app only if GitHub created it for the account shown here.";
  the labels "Account:" (followed by the account and, in parentheses, the account type), "App name:", "Permissions,
  all read-only:" with "Actions, Contents, Issues, Pull requests, Dependabot alerts, Code scanning alerts, Secret
  scanning alerts, Metadata", "Events:" with "Pull request, Workflow run, Dependabot alert, Code scanning alert,
  Secret scanning alert, Issues, Issue comment, Fork, Star", and the button "Continue to GitHub".
- GitHub finish page: "GitHub has created the app. Select Finish so that Seluna fetches and saves its
  credentials." and the button "Finish". Created page: "The GitHub App is saved.", "Now install it on your account or
  organization. Choosing Only select repositories is recommended: Seluna then sees only the repositories you pick,
  and you add a new repository to the installation by hand." with the link
  "Install the app on GitHub", or "Install it on GitHub: in the settings of your account or organization, open
  Developer settings, then GitHub Apps, choose the app and select Install App. Choosing Only select repositories is
  recommended: Seluna then sees only the repositories you pick, and you add a new repository to the installation by
  hand." The created page has no link back.
- GitHub notice-only page (the GitHub step's answers with _unavailable_ or _form expired_, and those with _invalid
  return_, _state invalid_, _code rejected_, _answer invalid_, _owner mismatch_ or _store failed_): after the notice,
  the link "Back to the GitHub App step".
- _invalid account_: "Choose your personal account or an organization and enter its name: 1 to 39 letters, digits
  and hyphens, not starting or ending with a hyphen."
- _invalid return_: "This page needs the code and state GitHub sends back after creating the app. Start again from
  the GitHub App step."
- _state invalid_: "This return from GitHub does not belong to your current sign-in or is older than one hour, so
  nothing was saved. If GitHub created an app, delete it on GitHub and start again."
- _code rejected_: "GitHub no longer accepts this return: the code was already used or is older than one hour. Open
  the GitHub App step and compare the App ID saved there with the one GitHub shows in the app's settings: if they
  match, the app is saved; otherwise delete the app on GitHub and start again."
- _GitHub unavailable_: "GitHub could not be reached. Select Finish again in a moment; the return stays valid for
  one hour."
- _answer invalid_: "GitHub created the app, but its answer could not be read, so nothing was saved. Delete the app
  on GitHub and start again."
- _owner mismatch_: "This app does not belong to the account you chose in Seluna, so nothing was saved. If you
  created it yourself, delete it on GitHub and start again with the name of the account you are signed in to on
  GitHub, or of the organization."
- _store failed_: "GitHub created the app, but saving its credentials failed, so nothing was saved. Delete the app
  on GitHub and start again."
- _not configured_: the heading "SELUNA_SECRET is not set", then: the setup cannot start because the Worker secret
  `SELUNA_SECRET` is missing or shorter than 32 characters; create a random string of at least 32 characters (a
  password manager, or `openssl rand -hex 32`); in the Cloudflare dashboard open this Worker, then _Settings_ →
  _Variables and Secrets_, and add a secret named `SELUNA_SECRET` with that string, or run
  `npx wrangler secret put SELUNA_SECRET`; then reload the page. The page does not say whether the secret is
  missing or too short.

## Limits and errors

- 404, 413 and the 400 of an unreadable body under `/setup` carry no body; 503, the 403 and 429 answers and the Telegram and GitHub steps' 400, 409 and 502 answers carry a page with a fixed notice or text and never a reason from the runtime, D1, Telegram or GitHub.
- An app that GitHub created but Seluna did not save (a session that expired during the detour, an unreadable answer,
  an app of another account than the one entered, a failed write, a code an earlier attempt used while its answer was
  lost) stays on GitHub and is deleted there by hand; the notices say so. GitHub's rejection of a used code does not
  tell whether an earlier attempt saved the app, so the _code rejected_ notice has the owner compare the saved App ID
  with the app's own before deleting it. GitHub's own limit of one hour for the flow, and the state's, bound the return. A session that
  expires during the detour loses the return: sign in again and start over.
- Every signed-in start page answer makes two requests under one app token (`GET /app` and the installations list) when its status section lists installations: the
  `GET /setup` 200, the 400 _settings invalid_ of `POST /setup/settings` and the 409 _reset not needed_ of
  `POST /setup/reset`. The request's 10-second timeout covers the wait for the answer and the reading of its body
  ([GitHub API](github-api.md#limits-and-errors)), so such a page takes at most about 10 seconds longer when GitHub is
  slow, and never fails because of GitHub. The signed-out pages (login, lock, _not configured_) call neither GitHub
  nor D1, and the notice-only pages (503, 403) make no installations request.
- The conversion request carries a 10 second timeout, which also covers reading its body (the body is read from the
  response of the request that carries the timeout, as for the [GitHub API](github-api.md#limits-and-errors) calls),
  and its answer is read up to 1 MiB.
- Whether GitHub returns `code` and `state` as documented, whether the browser sends the session cookie with the
  finish form and whether `form-action https://github.com` lets GitHub's own redirects through were not captured from
  a real run when this step was written; each deviation fails closed (a fixed notice, nothing stored).
- Anyone who messages the bot appears in the chat list with a name of their choosing, so a label proves nothing: a
  chat is saved only after its code is typed back. The owner who types in a code a stranger gave them can still save
  a wrong chat; choosing again replaces the earlier value. A stranger who sends the bot many messages can push the
  owner's chat out of the newest 100 updates (_no chats_: send `/start` again just before searching) or make the
  answer exceed 1 MiB (_Telegram unavailable_ until 100 newer, smaller updates arrived); both fail closed, and the
  workaround for both is the `TELEGRAM_CHAT_ID` Worker secret.
- The _migrations missing_ notice is shown to anyone who submits the login form with a valid CSRF token, before the
  secret is checked; it tells them only that the database lacks a table of the schema. A database with every table but an outdated
  column still shows _unavailable_, and the signed-in pages show _unavailable_ for every D1 failure. The table names
  are read after the failure and an error of that read answers _unavailable_; production D1 answers that read
  (decision 0021).
- After a reset the old GitHub App stays on GitHub; the owner deletes it there by hand.
- The `getMe` answer was built from the Bot API reference, not captured from a real run, when the token form was
  written; the live check on a deployed copy (a valid, a revoked, a mistyped token and a bot with a webhook) is
  pending. A deviation fails closed: the token is not saved and the owner sees a fixed notice. Whether browsers fill
  the token field (`type="password"`, `autocomplete="off"`) with the saved `SELUNA_SECRET`, or offer to replace the
  saved login with the token, was not observed either; a hex `SELUNA_SECRET` filled into the field fails the bot
  token form and answers 400 before any request.
- A login, logout, settings, reset, messenger (activate, remove), Telegram (token, remove, confirm, verify) or GitHub form body is limited to 1 MiB counted in bytes before decoding; the parsed text is never longer than
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
- [`decisions/0021-missing-tables-notice-on-the-setup-login.md`](../decisions/0021-missing-tables-notice-on-the-setup-login.md)
  — the _migrations missing_ notice on the login, the table names read after a failed D1 access.
- [`decisions/0016-telegram-chat-in-the-setup-wizard.md`](../decisions/0016-telegram-chat-in-the-setup-wizard.md) —
  `getUpdates` on page load with a negative offset, the token allow-list, the chat stored only after its code is
  typed back, the pending chat in a signed session-bound token.
- [`decisions/0036-telegram-bot-token-in-the-setup-wizard.md`](../decisions/0036-telegram-bot-token-in-the-setup-wizard.md)
  — the bot token entered in the Telegram step and kept encrypted, `getMe` as its check, the precedence of a set
  `TELEGRAM_BOT_TOKEN` without fallback, a damaged token row repairable in the step.
- [`decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md`](../decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md)
  — the active messenger on the start page, _Activate_ and _Remove_, no fallback, removing the active messenger allowed.
- [`decisions/0017-github-app-manifest-flow.md`](../decisions/0017-github-app-manifest-flow.md) — the manifest flow,
  the signed-out return and the finish form protected by its state, the owner check, the PKCS#8 conversion, the
  one-transaction write and the precedence of the Worker secrets.
- [`decisions/0007-github-app-credentials-encrypted-in-d1.md`](../decisions/0007-github-app-credentials-encrypted-in-d1.md)
  — the 32-character minimum of `SELUNA_SECRET` and separate keys per purpose.
- [`decisions/0026-github-app-authentication-and-installation-tokens.md`](../decisions/0026-github-app-authentication-and-installation-tokens.md)
  — the installations list on the status page, the app token and the installation tokens behind it.
- [`decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md`](../decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)
  — the four new events and their permissions, the stored owner, the app check on the status page and the
  recommendation of _Only select repositories_.
- [`decisions/0034-setup-page-layout-checked-on-the-style.md`](../decisions/0034-setup-page-layout-checked-on-the-style.md)
  — the page layout and its colours as custom properties per mode, verified on the style and the rendered markup
  instead of in a browser.

## Not here

- The routes outside `/setup`, the body size limit and the request log: [HTTP routes](http-routes.md).
- The `meta` table and the encryption key: [Storage](storage.md).
- How `SELUNA_SECRET` is set at deploy time: [Deployment](deployment.md#worker-secrets).
