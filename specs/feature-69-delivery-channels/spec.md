# Spec: Channel-neutral outbox and switchable delivery channel

Source: Issue #69
Status: Draft

## Problem

Seluna delivers only through Telegram: the rules' channel-neutral notification is rendered into Telegram HTML when
its `outbox` row is written ([decision 0023](../../docs/decisions/0023-webhook-processing-and-delivery-through-the-outbox.md),
option 8), and `src/delivery.ts` calls the Telegram client directly. Owners want other messengers (one follow-up
issue each); they need one place where a messenger plugs in, an outbox without one messenger's markup, and a way to
see the messengers and choose the one that sends. Telegram stays the only messenger here, and what a Telegram user
receives does not change.

## Scenarios

- S1: Given Telegram is set up and active, when a rule reports a delivery, then the row stores the notification
  without markup and Telegram receives, when it is sent, exactly the `sendMessage` request it receives today for that
  notification (same text, `parse_mode`, `disable_notification`, link preview option and button).
- S2: Given `outbox` rows written before the update (Telegram HTML in `text`), when the update's migration has run
  and such a row is sent with Telegram active, then Telegram receives the stored text unchanged, with the button as
  today.
- S3: Given a pending row and the owner activates another set-up messenger, when the row is sent next (the cron
  retry, or the release check's own row), then it goes out through the newly active messenger, rendered by it;
  every send that starts after the switch uses the new messenger.
- S4: Given the owner opens the start page, then a card _Messengers_ lists every messenger Seluna offers, in the
  registry's order, also those not set up, each with its name, its state and its actions:
  - not set up, not active: _Not set up_, link _Set up_ to the messenger's setup page (`/setup/telegram`);
  - set up, not active: _Set up_, link _Change_ to its setup page, buttons _Activate_ and _Remove_;
  - set up and active: _Active_, link _Change_, the text _To remove it, activate another messenger first._;
  - active but not set up: _Active, but not set up: notifications wait until it is set up._, link _Set up_.
  The card follows the reset section and comes before the setup steps card; the steps card and the step navigation
  stay as they are.
- S5: Given a set-up messenger that is not active, when the owner selects _Activate_, then it becomes the active
  messenger and the answer is **303** to `/setup`, whose card and status section show it active.
- S6: Given a set-up messenger that is not active, when the owner selects _Remove_, then what the setup saved for it
  is deleted as its own setup step would delete it (Telegram: the saved bot token, exactly as _Remove token_; the
  saved chat and the settings stay) and the answer is **303** to `/setup`.
- S7: Given any state, when the owner opens the start page, then the status section names the active messenger:
  _Messenger:_ with its name, followed by _(not set up)_ when it is not set up.
- S8: Given the active messenger is not set up (Telegram: no usable bot token, or no chat), when rows are sent, then
  the messenger is not called and the rows stay `pending` with their attempts unchanged, as today; once it is set up
  the cron sends them. Seluna never falls back to another messenger.
- S9: Given the cron retry and the daily release notice, when they send, then they send through the active messenger
  with the same rules as a webhook's rows (quiet hours as _silent_, the button label in the language at sending).

Texts (English; the German ones are their translation in `src/setup/texts.ts`): the card heading "Messengers" and
its intro "Seluna sends its notifications through one messenger, the active one. Set up a messenger, then activate
it; notifications still waiting are then sent through it."; the states, links and hint as quoted in S4; the buttons
"Activate" (primary) and "Remove" (secondary); the status label "Messenger:" and "(not set up)"; the messenger name
"Telegram"; the notices _messenger invalid_ "Please choose a messenger from the list.", _messenger not set up_ "This
messenger is not set up yet. Set it up first, then activate it." and _remove active refused_ "The active messenger
cannot be removed. Activate another messenger first, then remove this one." Every notice is an error notice.

## Errors and edge cases

- E1: _Remove_ posted for the active messenger (a stale page, a crafted request): **409** with the start page and the
  notice _remove active refused_; nothing is deleted.
- E2: _Remove_ refused by the messenger's own step: for Telegram the refusals of _Remove token_ — `TELEGRAM_BOT_TOKEN`
  set (**409**, start page, notice _worker secret token_), the saved token unreadable (**409**, start page, notice
  _token unreadable_). _Remove_ of a messenger with nothing saved answers **303** and deletes nothing.
- E3: _Activate_ for a messenger that is not set up at the moment of the request: **409** with the start page and the
  notice _messenger not set up_; the active messenger stays. _Activate_ for the already active messenger: **303**,
  nothing changes.
- E4: _Activate_ or _Remove_ with a missing, repeated, empty or unknown `channel` field (also `../telegram`, an upper-case
  or padded id): **400** with the start page and the notice _messenger invalid_; nothing changes.
- E5: Either form: body above 1 MiB **413**, unreadable **400** (empty bodies); invalid CSRF token **403** with the
  notice-only start page and _form expired_; a D1 failure **503** with _unavailable_; no session: the login page.
- E6: The stored `delivery_channel` names no registered messenger (edited by hand, or a messenger a later version no
  longer has): it reads as `telegram`, and the start page shows Telegram active.
- E7: The owner removes the Telegram token in the Telegram step while Telegram is active: allowed as today; Telegram is
  then _Active, but not set up_ and rows wait (S8).
- E8: The switch happens while a batch is being sent (a webhook's rows, a cron run of up to 10 rows): that batch
  finishes through the messenger it started with; the next batch uses the new one. A row keeps its attempt count
  across a switch; `sent` and `failed` rows are never sent again.
- E9: Two _Activate_ requests at once: the last write wins; the active messenger is always one registered messenger.
- E10: A new row whose stored notification cannot be read (damaged by hand): the send counts an attempt with the result
  `failed`, so the row ends `failed` after its fifth attempt instead of waiting forever.
- E11: A pre-migration row sent while a messenger other than Telegram is active: that messenger delivers it with the
  same title, repository, number, lines 2 and 3 and button as the stored text holds (tags removed, entities decoded).
- E12: The earlier version runs between the migration and the new deploy (or after a failed deploy): its inserts still
  succeed, and the rows it writes are pre-migration rows to the new version (S2).

## Non-functional requirements

- **Compatibility:** with Telegram active the Bot API requests are unchanged, byte for byte in their JSON body and URL;
  existing delivery, retry and release-check tests stay green except where a row's stored form is asserted. Existing
  `pending`, `sent` and `failed` rows survive the migration with their status, attempts and times.
- **Storage:** a new row holds the notification (title, repository, number, line 2, line 3, button URL) as text without
  any messenger's markup; the button URL is stored only under today's rules. The migration is a new file
  `migrations/0002_*.sql`; `0001` is not edited.
- **Rules:** no module under `src/rules/` depends on a messenger or produces markup.
- **Security:** a messenger's credentials are stored only encrypted in `secrets`, under the key check, and deleted by
  the reset (which already deletes every `secrets` row); the shared HTTP code every messenger uses calls out only, with
  the injected fetch, a 10-second timeout per request, the answer read bounded to 1 MiB counted in bytes, and at most one
  retry after a 429 whose wait is 1 to 5 seconds — so at most two requests per row, which keeps the cron inside the free
  plan's 50 subrequests per invocation. The two new forms are signed-in forms with the session-bound CSRF token.
- **Configuration:** new setting `delivery_channel`, default `telegram`, written only by _Activate_ (the settings form
  neither shows nor changes it); no new Worker secret or binding. A messenger id matches `^[a-z][a-z0-9-]{0,31}$` and
  is none of the paths the wizard already owns (`login`, `logout`, `settings`, `reset`, `github`, `channel`).
- **Logs:** each sent row still logs exactly the row id and one of today's results (`sent`, `rate-limited`,
  `token-rejected`, `failed`, `no-token`, `no-chat`, `store-failed`), with Telegram's meanings unchanged; never a
  credential, a destination, a request URL, a message text or a messenger's answer. The new forms log only the request
  line of [HTTP routes](../../docs/areas/http-routes.md#logging).
- **Time:** sending reads the active messenger once per batch: one more D1 read per batch.

## Acceptance criteria

- [ ] AC1: For each rule notification and the release notice, the Telegram request sent for a row written after the
  migration equals the request sent before this change for the same notification, silent flag and language (S1, S9).
- [ ] AC2: A row written after the migration holds the neutral notification and no Telegram markup; a row written
  before it (text only) is delivered with Telegram active as an unchanged `sendMessage` with its stored text (S2, E12).
- [ ] AC3: The migration applies to a database holding `pending`, `sent` and `failed` rows and keeps each row's text,
  button URL, silent flag, attempts, status and time; the earlier version's insert still succeeds after it (E12).
- [ ] AC4: With a second (test) messenger registered and set up, activating it makes the next send of a pending row,
  in the cron retry and in the release check, go through it and not through Telegram; a batch in progress keeps the
  messenger it started with; attempts carry over (S3, S9, E8).
- [ ] AC5: The start page's _Messengers_ card lists every registered messenger with the state and actions of S4, also
  when only Telegram is registered or none is set up; _Activate_ appears only for a set-up messenger that is not
  active; the status section shows _Messenger:_ as in S7 (S4, S7, E6).
- [ ] AC6: `POST /setup/channel/activate` with field `channel` activates a set-up messenger (303) and answers E3, E4
  and E5 as specified (S5, E3, E4, E5, E9).
- [ ] AC7: `POST /setup/channel/remove` with field `channel` removes a non-active messenger as its step would (303),
  refuses the active one with _remove active refused_ and answers E2, E4 and E5 as specified (S6, E1, E2, E4, E5).
- [ ] AC8: With the active messenger not set up, no messenger is called, rows keep status and attempts and log
  `no-token` or `no-chat` as today; no other messenger is used (S8, E7).
- [ ] AC9: An unknown stored `delivery_channel` reads as `telegram`; saving the settings form leaves `delivery_channel`
  unchanged (E6).
- [ ] AC10: A row whose stored notification cannot be read counts a `failed` attempt (E10); a pre-migration row sent by
  a test messenger reaches it as the title, repository, number, lines and button its text holds (E11).
- [ ] AC11: The shared HTTP code times out after 10 seconds, reads at most 1 MiB, retries once only after a 429 with a
  wait of 1 to 5 seconds and never puts a credential, URL or text into a log entry or result.
- [ ] AC12: No module under `src/rules/` imports `src/message.ts`, `src/telegram.ts` or anything under `src/channels/`
  (checked by a lint rule or a test, as the plan decides).
- [ ] AC13: A decision record superseding the rendering choice of decision 0023 (released) exists, and the area documents below,
  `docs/ARCHITECTURE.md`, `.squad/project.md`, `README.md` and `CHANGELOG.md` describe the built behavior (review).

## Out of scope

- The ntfy, Gotify, Matrix and Discord clients, their setup pages and credentials (one follow-up each); a follow-up
  that adds a messenger with an owner-chosen server URL decides its redirect and address rules there.
- Sending to several messengers at once, and any fallback to a messenger other than the active one.
- Entering the Telegram bot token (#68, done); changes to the Telegram step, the step navigation or the reset texts.
- An extra log field naming the messenger; a database the new migration was not applied to behaves as with any
  outdated column today ([Deployment](../../docs/areas/deployment.md)).
- Resetting a row's attempts when the messenger is switched.
- Running an earlier version on the migrated database after the new version wrote rows (a reverted update): those rows
  are not guaranteed to be delivered by it.

## Open questions

- How do pre-migration rows reach the new model? Answered: they stay as they are and are told apart by having no
  stored notification; with Telegram active their text is sent as stored (S2); another messenger gets the same lines
  without markup (E11), which the writer's fixed format makes recoverable (`src/message.ts`: escaped fields, only `<b>`
  around the title, line feeds between lines). No message is dropped by the transition.
- Removing the active messenger: refusal or fallback? Answered: refusal (E1) — the issue's default; a fallback would
  send to a destination the owner did not choose. _Remove_ is not offered for the active messenger (S4).
- The active messenger becomes unconfigured? Answered: rows wait without counting attempts, as today without a token
  ([decision 0036](../../docs/decisions/0036-telegram-bot-token-in-the-setup-wizard.md)); no fallback (S8). The Telegram
  step's _Remove token_ stays allowed while Telegram is active (E7): it is credential maintenance in the step, released
  in 0.6.0, and refusing it would leave a leaked token undeletable in the wizard while Telegram is the only messenger.
- When do pending rows go out after a switch? Answered: at their next send, which for an older row is the 10-minute
  cron retry (rows older than 60 seconds, 10 per run, [Scheduled jobs](../../docs/areas/scheduled-jobs.md#retry)); the
  messenger is resolved once at the start of each batch (S3, E8). Activation sends nothing by itself.
- Do the log results change? Answered: no; the values stay, so the log contract and the existing tests hold (NFR Logs).
- Does the reset need a change? Answered: no code change — `resetCredentials` deletes every `secrets` row
  ([Storage](../../docs/areas/storage.md#key-check)); its text names the Telegram token, the only messenger credential.

## Area documents

- `docs/areas/notifications.md`: the notification stored neutral and rendered by the active messenger at sending;
  Telegram's rendering (today's message format) as the Telegram messenger's; pre-migration rows; the active messenger
  resolved once per batch, no fallback; the shared HTTP rules; log results.
- `docs/areas/storage.md`: the new `outbox` column and the old rows, the `delivery_channel` setting, messenger
  credentials in `secrets`.
- `docs/areas/setup-wizard.md`: the _Messengers_ card, its states, actions, forms, answers and texts; the _Messenger:_
  status line; the two forms in *Paths* and the CSRF list.
- `docs/areas/scheduled-jobs.md`: retry and release notice through the active messenger.
- `docs/areas/http-routes.md`: the two new body-reading `POST` routes in the body limit list.
