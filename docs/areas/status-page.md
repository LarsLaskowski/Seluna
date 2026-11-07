# Status page

## Scope

The start page of the setup wizard (`GET /setup` with a session) and its forms: what the instance's status shows,
how the GitHub App is checked against GitHub, the notification settings, the Messengers card that chooses the active
delivery channel, and the reset of credentials that no longer decrypt. The owner relies on it to see whether the
instance works and to change what it reports; delivery relies on the settings and the active channel it writes.

## Behavior

### The start page

- `GET /setup` answers **200**. In this order its main column shows: the heading, the _start body_ and a notice if
  any; then, each in its own card, the status section ([Status](#status)), the reset section when a reset is needed
  ([Reset](#reset)), the Messengers card ([Messengers](#messengers)), the setup steps as links (_Telegram chat_, to
  `/setup/telegram`, and _GitHub App_, to `/setup/github`) and the settings form ([Settings](#settings)); last the
  sign-out form in the actions area, without a card ([Setup login](setup-login.md#sign-out)).
- The **notice-only start page** shows in its main column the heading, the _start body_ and the notice, the step
  links card and the sign-out form in the actions area. `GET /setup` with a D1 failure answers **503** with it and
  _unavailable_. The 403 answers of the sign-out, settings, reset, activate and remove forms (_form expired_,
  [Setup login](setup-login.md#csrf-protection)) render it too and read no D1.
- Every form of the page reads its body first ([Setup wizard](setup-wizard.md#forms)) and then checks its
  session-bound CSRF token.

### Status

- The status section lists:
  - _Version:_ the version of the build.
  - _Messenger:_ the name of the active messenger, followed by _(not set up)_ when it is not set up
    ([Messengers](#messengers)).
  - _Telegram bot token:_ _set by the Worker secret_ when `TELEGRAM_BOT_TOKEN` is a non-empty string (well-formed or
    not), _saved in the setup_ for a usable saved token, _none saved yet_, or _cannot be read_ when the saved token
    cannot be read with the current `SELUNA_SECRET` or its row is damaged
    ([Telegram step](telegram-step.md#the-bot-token)). The value is never shown and Telegram is not called.
  - _Telegram chat:_ the saved chat id, _set by the Worker secret_ (no value shown) when `TELEGRAM_CHAT_ID` is a
    non-empty string, or _none saved yet_.
  - _GitHub App:_ a link `https://github.com/apps/<slug>` with the slug as text and `(App ID <id>)` when the `meta`
    slug row belongs to the saved App ID, the App ID alone otherwise; the _Worker secrets_ or _partial Worker
    secrets_ text when those are set (no value shown); _none saved yet_; or _cannot be read_ when the saved App ID
    cannot be read with the current `SELUNA_SECRET` (a reset can also be needed while the App ID is still shown, when
    another saved credential does not decrypt).
  - _Last delivery from GitHub:_ the time in the configured time zone as `YYYY-MM-DD HH:MM (<time zone>)` (24-hour;
    the zone is the runtime's name of the configured one), or _none received yet_ until the first delivery from
    GitHub is received ([Notifications](notifications.md#processing-a-delivery)); the time may lag the latest
    delivery by up to a minute. When the runtime rejects the zone or the time at render, the time is written in UTC
    from its UTC fields, as `(UTC)`; the page never fails on it.

### The app on GitHub

- Below _GitHub App:_ the section shows the owner line, the app check and _Installations:_ when the _GitHub App:_
  line names a usable app, that is for the _Worker secrets_ text and for a saved app (and for nothing else: no line,
  no owner, no check and no request for _none saved yet_, _partial Worker secrets_ and _cannot be read_). With
  credentials that sign, the page makes one app token and asks GitHub, beside each other, for the app itself
  ([GitHub API](github-api.md#app-read), `GET /app`) and for the app's installations
  ([GitHub API](github-api.md#installations-list), one request of up to 100). The answer of `GET /app` counts only
  when its `id` is the App ID of the credentials; otherwise, and when it fails or has unusable access, the app is
  _unchecked_.
- **Owner line:** `GitHub App owner: <login>` followed by _(personal account)_ or _(organization)_, the login written
  as escaped text. The owner is the one GitHub's answer names, else the one stored for the App ID
  ([Storage](storage.md#tables)), else _owner unavailable_. When the answer names an owner that differs from the
  stored one, or none is stored, the page stores it; a failed write is dropped and the page is still answered.
  Without credentials that work (_no-app_, _key unusable_, an app token that cannot be signed) no request is made
  and the owner is the stored one or _owner unavailable_. For an organization's app a paragraph follows
  (_organization owner_): it says that Seluna cannot tell the owner's own actions from anyone else's, so the activity
  of every account is reported, the owner's too ([Notification rules](notification-rules.md#the-sender)).
- **App check:** after the owner, a paragraph _Missing on the app:_ with the list and a link to the app's settings
  on GitHub when the app lacks permissions or events the manifest asks for
  ([GitHub App step](github-app-step.md#starting-the-flow)); the link is left out when no safe URL can be built (no
  slug from the answer or stored for the App ID, an owner or login that fails its check). When the app was not read,
  the paragraph says that Seluna could not read the app's permissions from GitHub; when nothing is missing there is
  no paragraph. The list is the permissions, each marked read-only, joined by `, `, then, when events are missing,
  the events after an _events:_ label, the two parts joined by `; `; names are GitHub's, as on the review page, in
  manifest order. A `write` or `admin` level counts as granted, and permissions and events beyond the manifest are
  not reported.
- **Installations:** a list with one entry per installation in GitHub's order: the login or slug, the account type
  in parentheses and the repository selection (all or selected repositories), with _suspended_ after it for a
  suspended installation. The account type is _personal account_ for `User`, _organization_ for `Organization`,
  _enterprise_ for an account with a slug and no login, and _other account_ for any other or a missing type; an
  account without both name and type is shown as _Unknown account_. The login and slug are written as escaped text,
  never as markup or a link. When the app was read, the installation is checked against what the app itself has:
  _missing:_ with the list and a link to review and accept on GitHub (the link only when a URL can be built: a
  `User` or `Organization` account with an allow-listed login), _access not checked_ when the installation's
  `permissions` or `events` are unusable, and nothing when it is complete or the app was not read. Suspended
  installations are checked too.
- In place of the list, on the same line: _not installed_ for an empty list; _installations unavailable_ when the
  request fails (refused, timed out, redirected, unreadable) or the Worker secret `GITHUB_APP_ID` is not a positive
  whole number or a saved app has no saved private key, without a request in the last two cases; _key unusable_ when
  the private key cannot sign (not an RSA key, more than 4096 bits, or a saved key that does not decrypt). The _more
  installations_ text follows the list exactly when the answer's `Link` header has a link with `rel="next"`. The page
  answers 200 in every one of these cases.

### Settings

- The settings form posts to `POST /setup/settings` with the session-bound `csrf` field and these fields:
  `notification_language` (`en` or `de`), `time_zone` (an option per name the runtime lists, plus `UTC`, preceded by
  the configured zone as a selected option when the runtime does not list it), the checkboxes `quiet_hours`,
  `update_notice` and `rule_<id>` for the thirteen rules ([Notification rules](notification-rules.md),
  [Stars and forks](stars-and-forks.md)) (each posts the value `on` when checked, nothing otherwise), the times
  `quiet_start` and `quiet_end` (`type=time`, no `step`, shown as `22:00` and `07:00` while quiet hours are off), and
  the digest of stars and forks: the select `activity_digest` (`immediate`, `hourly` or `daily`, labelled
  immediately, hourly and daily at) with the time `digest_time` (`type=time`, shown as the stored time, or `18:00`).
  The form shows the stored values.
- **Groups:** the quiet hours switch with its label is the legend of a framed group (`<fieldset>`) holding the start
  and end times; a second group holds the thirteen rule switches and the release notice switch; a third group, _Stars
  and forks_, after the second and before the save button, holds the interval select and the time field.
- **Validation:** after the body and the CSRF token (**403**, notice-only start page, _form expired_),
  `notification_language` and `time_zone` must occur once, the language `en` or `de`, the time zone a zone name the
  runtime accepts (no offset), stored as the runtime's name of it
  ([0042](../decisions/0042-time-zone-aliases-read-as-the-listed-name.md)); a checkbox is absent (off) or occurs once
  with the value `on`; with `quiet_hours` on, `quiet_start` and `quiet_end` occur once each, are `HH:MM` from
  `00:00` to `23:59` and differ, with it off they are ignored; `activity_digest` occurs once and is one of the three
  choices, and with `daily` the single `digest_time` is `HH:MM` from `00:00` to `23:59` (with `immediate` or `hourly`
  a posted time is ignored; a form without `activity_digest` is invalid). Anything else answers **400** with the
  status page, the stored settings and the _settings invalid_ notice, which names the expected time format, and
  stores nothing.
- Valid settings are written in one batch ([Storage](storage.md#tables)) and answer **303** with `Location: /setup`;
  they apply to the next read, nothing is cached. A D1 failure answers **503** with the notice-only start page and
  _unavailable_.
- Quiet hours are stored as one value (`off`, or `<start>-<end>`), so switching them off drops the times and the form
  shows 22:00 and 07:00 again when they are next switched on. How quiet hours and the digest act:
  [Delivery](delivery.md#quiet-hours), [Stars and forks](stars-and-forks.md).

### Messengers

Seluna sends its notifications through one messenger, the active one ([Delivery](delivery.md#delivery-channels)).
Telegram is the only registered messenger today (the registry is `src/channels/registry.ts`).

- **Card:** the Messengers card holds the heading, an intro saying that notifications go through the one active
  messenger and that waiting ones are sent through a newly activated one, and a list with one entry per registered
  messenger in registry order. An entry shows the name in bold; for a messenger that is not active, a colon and its
  state, _Not set up_ or _Set up_; for the active one that is set up, a colon and _Active_; for the active one that
  is not set up, the info notice _Active, but not set up_ instead (notifications wait until it is set up). Then a
  link to the messenger's step page (`/setup/<id>`), _Set up_ when it is not set up and _Change_ when it is, and the
  forms below. A messenger is _set up_ when its destination can be resolved (for Telegram: a usable bot token and a
  chat).
- **Forms:** _Activate_ (a primary button) is shown for a messenger that is set up and not active; _Remove_ (a
  secondary button) for a messenger with credentials saved in the setup that its own step can remove (also the
  active one); for Telegram that is a saved bot token in the token card's _saved_ or _damaged_ state, so never while
  `TELEGRAM_BOT_TOKEN` is set or while the saved token cannot be read with the current `SELUNA_SECRET`. Each is a
  `POST` form with the session-bound `csrf` field and a hidden field `channel` holding the messenger's id, to
  `POST /setup/channel/activate` and `POST /setup/channel/remove`.
- **Processing** (both routes): after the body and the CSRF token (**403**, notice-only start page, _form
  expired_), the `channel` field must occur exactly once and equal, byte for byte, the id of a registered messenger
  (no trimming, no case folding, no path); otherwise **400** with the status page and the _messenger invalid_
  notice, nothing changes. A D1 failure answers **503** with the notice-only start page and _unavailable_.
- **Activate:** the active messenger answers **303** to `/setup` without a write. A messenger that is not set up
  answers **409** with the status page and the _messenger not set up_ notice, the active messenger unchanged.
  Otherwise the setting `delivery_channel` is written ([Storage](storage.md#tables)) and the answer is **303** to
  `/setup`. Rows still pending are then sent through the new messenger, with the attempts they already have. The
  settings form never writes `delivery_channel`.
- **Remove:** deletes the credentials the messenger saved in the setup, also when it is the active one (then the
  entry shows the _Active, but not set up_ notice and notifications wait); nothing saved is **303** without a
  delete. For Telegram it is the same as removing the token in its step: a bot token set by the Worker secret
  `TELEGRAM_BOT_TOKEN` answers **409** with the _messenger Worker secrets_ notice, a saved token that cannot be read
  with the current `SELUNA_SECRET` answers **409** with the _token unreadable_ notice, and otherwise the token row is
  deleted and the answer is **303** to `/setup`.

### Reset

- **When it is needed:** the key check value reports a changed `SELUNA_SECRET` or is damaged, it is absent beside
  stored credentials, or a stored credential does not decrypt ([Storage](storage.md#key-check)). `GET /setup` then
  answers **200**, never an error status, with the reset section: the _reset heading_, the _reset text_ and a form
  `POST /setup/reset` with the session-bound `csrf` field and the danger button.
- The _reset text_ says what a reset deletes (the saved GitHub credentials, the installation tokens and the saved bot
  token) and what it keeps (the chat and the settings), that setting the earlier `SELUNA_SECRET` again is the
  alternative, and that the old app is then deleted on GitHub by hand (in the settings of the account or organization
  that owns it).
- `POST /setup/reset`, after the body and the CSRF token (**403**, notice-only start page, _form expired_):
  - when a reset is needed, it deletes every `secrets` row (the GitHub App credentials and a saved Telegram bot
    token), every `token_cache` row and the `meta` row `key_check` and answers **303** with
    `Location: /setup/github`;
  - when none is needed, it answers **409** with the status page and _reset not needed_ and deletes nothing;
  - a D1 failure answers **503** with _unavailable_.
- The settings, the Telegram chat, `login_attempts` and `last_delivery` stay. Nothing outside D1 is called; the old
  GitHub App stays on GitHub.
- **Guard:** the delete runs only while the key check value and the fingerprint of the `secrets` rows are the ones
  the reset read, so a credential written between the check and the delete leaves everything in place. The three
  deletes run in one batch in this order: `token_cache` and `secrets` while both pins hold, then `key_check` while
  its value is the one read and no `secrets` row is left ([Storage](storage.md#key-check)). The answer is the 303
  whether or not the guarded batch deleted anything; the next `GET /setup` shows the true state.
- Afterwards `GET /setup/github` shows the form, and the Telegram step shows the token form unless
  `TELEGRAM_BOT_TOKEN` is set.

## Limits and errors

- Every start page answer whose status section lists installations makes two requests under one app token
  (`GET /app` and the installations list): the `GET /setup` 200, the 400 _settings invalid_ of
  `POST /setup/settings` and the 409 _reset not needed_ of `POST /setup/reset`. The request's 10-second timeout
  covers the wait for the answer and the reading of its body ([GitHub API](github-api.md#limits-and-errors)), so such
  a page takes at most about 10 seconds longer when GitHub is slow, and never fails because of GitHub. The
  notice-only pages (503, 403) make no request to GitHub.
- After a reset the old GitHub App stays on GitHub; the owner deletes it there by hand.
- No value of a Worker secret or a saved credential appears on the page.

## Related decisions

- [`decisions/0018-settings-and-status-page.md`](../decisions/0018-settings-and-status-page.md) — the status page,
  the settings form and the reset of unreadable credentials.
- [`decisions/0026-github-app-authentication-and-installation-tokens.md`](../decisions/0026-github-app-authentication-and-installation-tokens.md)
  — the installations list on the status page, the app token behind it.
- [`decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md`](../decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md)
  — the active messenger on the start page, _Activate_ and _Remove_, no fallback, removing the active messenger
  allowed.
- [`decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md`](../decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)
  — the stored owner and the app check on the status page.
- [`decisions/0042-time-zone-aliases-read-as-the-listed-name.md`](../decisions/0042-time-zone-aliases-read-as-the-listed-name.md)
  — the time zone stored as the runtime's name of it.

## Not here

- The paths, form reading, cookies, page rules and languages: [Setup wizard](setup-wizard.md).
- The login, the session and the CSRF check: [Setup login](setup-login.md).
- The Telegram step page and its token card: [Telegram step](telegram-step.md).
- The GitHub App step and the manifest: [GitHub App step](github-app-step.md).
- The setting keys, their formats and defaults, the key check: [Storage](storage.md).
- The GitHub requests behind the app check and the installations: [GitHub API](github-api.md).
- What the settings change in delivery: [Delivery](delivery.md), [Notification rules](notification-rules.md),
  [Stars and forks](stars-and-forks.md).
