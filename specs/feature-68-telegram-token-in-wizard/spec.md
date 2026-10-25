# Spec: Enter the Telegram bot token in the setup wizard

Source: Issue #68
Status: Draft

## Problem

Every Seluna owner runs their own instance and delivers through their own Telegram bot. Today the bot token can only
be the Worker secret `TELEGRAM_BOT_TOKEN` (`botTokenFromEnv` in `src/telegram.ts`, the only source; asked for by the
deploy form through `cloudflare.bindings` in `package.json`). An owner who mistyped it, revoked it at @BotFather or
wants another bot has to leave the setup, find the Worker's *Variables and Secrets* in the Cloudflare dashboard and
replace the secret there; the Telegram step can only say that the secret is missing, malformed or rejected. The
GitHub App credentials, by contrast, are created in the wizard and kept encrypted in D1 (decision 0007). The deploy
form asks for two secrets although only `SELUNA_SECRET` (setup login and key derivation) cannot be set anywhere else.

## Scenarios

Texts are quoted in English; each has a German counterpart in the German page language.

- S1: Given a signed-in owner, no Worker secret `TELEGRAM_BOT_TOKEN` and no saved token, when they open
  *Telegram chat* (`/setup/telegram`), then the step shows the text "Seluna sends its notifications through your own
  Telegram bot. In Telegram, send /newbot to @BotFather and enter the token it returns here. Seluna checks the token
  with Telegram and saves it encrypted; it is not shown again.", a field *Bot token* whose input is masked and not
  filled by the browser, and the button *Save token*. No chat search runs and no chat list or search link is shown
  (the *Saved chat* line stays). Telegram is not called.
- S2: Given S1, when the owner enters a token of the form @BotFather issues and selects *Save token*, then Seluna asks
  Telegram once whether it accepts the token; on acceptance it saves the token encrypted and returns to the Telegram
  step, which now shows "A bot token is saved. It is not shown again." with the actions *Change token* and *Remove
  token*, and below them the chat search of today, run with the saved token.
- S3: Given a saved token and no Worker secret `TELEGRAM_BOT_TOKEN`, when the step searches for chats, sends the test
  message of a chosen chat, or Seluna sends a notification (after a webhook, by the cron's retry, or the release
  notice), then each Bot API request uses the saved token.
- S4: Given a saved token, when the owner selects *Change token*, enters another token and saves it, then the new
  token replaces the old one once Telegram accepted it, and the saved chat is kept (if the new bot cannot reach it,
  the owner searches and chooses again).
- S5: Given a saved token, when the owner selects *Remove token*, then the saved token is deleted and the step shows
  the form of S1 again. The saved chat and the settings are kept; notifications that arrive meanwhile wait unsent,
  without counting an attempt, until a token is available again.
- S6: Given the Worker secret `TELEGRAM_BOT_TOKEN` is a non-empty string, when the owner opens the Telegram step, then
  instead of the form, *Change token* and *Remove token* it shows "The bot token is set by the Worker secret
  TELEGRAM_BOT_TOKEN, which takes precedence over a token saved here. To enter the token here, delete that secret.",
  followed by the chat search with that token, as today. Every Bot API request uses the Worker secret; a token saved
  in the setup earlier is neither used nor deleted while the secret is set.
- S7: Given the status page (`/setup`), when the owner opens it, then the status section shows *Telegram bot token:*
  before *Telegram chat:*, with one of: "Set by the Worker secret TELEGRAM_BOT_TOKEN.", "Saved in the setup.", "None
  saved yet." or "Cannot be read with the current SELUNA_SECRET." The token's value is never shown and the status
  page does not call Telegram.
- S8: Given a saved token and a `SELUNA_SECRET` changed since it was saved, when the owner resets the saved
  credentials on the start page, then the saved token is deleted together with the GitHub credentials and the
  installation tokens; the reset text says so before the owner confirms ("…Otherwise reset: Seluna deletes the saved
  GitHub credentials, the installation tokens and the saved Telegram bot token; you then create the GitHub App again
  and enter the bot token again in the Telegram chat step. …The Telegram chat and the settings are kept."), and the
  Telegram step afterwards shows the form of S1.
- S9: Given a new user deploying with the Deploy to Cloudflare button, when the deploy form asks for secrets, then it
  asks for `SELUNA_SECRET` only; `.dev.vars.example`, the README and the setup guide describe entering the bot token
  in the Telegram chat step and name `TELEGRAM_BOT_TOKEN` as an optional Worker secret with precedence. An existing
  instance whose `TELEGRAM_BOT_TOKEN` is set keeps working unchanged after the update.

## Errors and edge cases

- E1: A token that does not match the bot token form (digits, a colon, then letters, digits, `-` and `_`): empty,
  with a leading or trailing space or line break, with `/`, `?`, `#`, `%`, `.`, a backslash or a percent escape such
  as `%2F` (decoded by the form parser to `/`), non-ASCII digits or letters, more than 20 digits before the colon or
  more than 200 characters after it. It is not saved, Telegram is not called, and the step answers 400 with "That is
  not a bot token. A token from @BotFather is digits, a colon, then letters, digits, - and _, without spaces. Copy it
  again from @BotFather. Nothing was saved." The field is empty again: the entered value is never written back into
  the page.
- E2: A token form whose token field is missing or occurs more than once: handled as E1.
- E3: Telegram rejects the token (401 or 404): not saved, 502 with "Telegram does not accept this token: it is
  mistyped or was revoked. Send /mybots to @BotFather, copy your bot's current token and enter it again. Nothing was
  saved." A token saved earlier stays.
- E4: Telegram cannot be reached, does not answer within 10 seconds, answers 429, another error status, a body above
  1 MiB, a body that is not JSON or a 2xx body without `ok: true`: not saved, 502 with "Telegram could not be reached
  or gave an answer Seluna cannot read, so the token was not saved. Please try again in a moment." A token saved
  earlier stays.
- E5: Telegram accepts the token but the bot has a webhook or another program receives its updates: the token is
  saved (it is valid), and the step then shows today's *conflict* notice in place of the chats.
- E6: A token form or *Remove token* form with a missing, foreign or expired CSRF token (also one bound to another
  session): 403 with the notice-only page and *form expired*; nothing is saved or deleted and Telegram is not called.
- E7: A body above 1 MiB answers 413, an unreadable body 400, both with an empty body; nothing is saved or deleted.
- E8: A token form or *Remove token* form submitted while the Worker secret `TELEGRAM_BOT_TOKEN` is set (a page
  opened before the secret was added): 409 with the view of S6; nothing is saved or deleted and Telegram is not
  called.
- E9: The Worker secret `TELEGRAM_BOT_TOKEN` is set but not of the bot token form: it still takes precedence, without
  falling back to a saved token. The step shows today's *token malformed* notice naming the Worker secret and no form;
  notifications log `no-token`.
- E10: The saved token was revoked after it was saved: the step's chat search gets 401 or 404 and shows "Telegram
  does not accept the saved bot token: it was revoked or the bot was deleted. Send /mybots to @BotFather, copy your
  bot's current token and enter it here." with the token form and *Remove token*; a test message and a notification
  fail as `token-rejected`, as today for the Worker secret.
- E11: The saved token cannot be read (`SELUNA_SECRET` changed, or the stored value is damaged): the step shows "The
  saved bot token cannot be read with the current SELUNA_SECRET: it was changed, or the saved value is damaged. Set the
  earlier SELUNA_SECRET again, or reset the saved credentials on the start page and enter the token again.", no form,
  no *Remove token* and no chat search, and calls no Telegram; a token or remove form answers 409 with that view and
  changes nothing. The status line says "Cannot be read with the current SELUNA_SECRET.", the start page offers the
  reset, and notifications log `no-token`.
- E12: No token is saved, but the saved GitHub credentials cannot be read with the current `SELUNA_SECRET` (so no new
  credential can be written until the reset): a submitted token is not saved; the answer is 409 with "The token was
  not saved because the saved credentials cannot be read with the current SELUNA_SECRET. Set the earlier
  SELUNA_SECRET again, or reset the saved credentials on the start page first."
- E13: D1 fails while the step page reads the saved token: 503 with the notice-only page and *unavailable*, Telegram
  is not called; D1 fails while a token is saved or removed: 503 with *unavailable*, and the stored state is the one
  before the request or the one after it, never a partial one.
- E14: Two token forms are saved at the same time (two tabs) or a save meets a reset: each saved token was accepted by
  Telegram, the stored value is one of them as a whole, and a save that lands between a reset's check and its delete
  leaves everything in place, as for the GitHub credentials today.
- E15: *Remove token* when no token is saved (a second click, another tab removed it): nothing to delete; the answer
  is the same as for a successful removal.
- E16: Notification delivery cannot read the saved token: a D1 error logs `store-failed` and leaves the row unchanged;
  a missing or unreadable token (also without a usable `SELUNA_SECRET`) logs `no-token` and leaves the row pending
  with its attempts unchanged.

## Non-functional requirements

- Secrecy: the token travels only in the body of the signed-in token form; it never appears in a Seluna URL or query,
  a page (also not after a rejected save), a response header, a cookie, a log entry or a plain-text D1 row, and a
  Telegram `description` or runtime error text never reaches a page or the log. It is stored only encrypted, in the
  same way and under the same key from `SELUNA_SECRET` as the GitHub credentials, covered by the key check.
- The token is checked against the bot token form before it enters any Bot API URL (as today for the Worker secret),
  and it is not trimmed.
- Telegram: one Bot API request per save, aborted after 10 seconds, its answer read within 1 MiB and narrowed. Seluna
  still sets no webhook, exposes no Telegram route, and calls Telegram only from the signed-in step and from delivery.
- Limits: request bodies within the existing 1 MiB bound; the token at most the length the form allows (20 digits, a
  colon, 200 characters).
- Pages: no script and no external resource, the Content-Security-Policy unchanged; every new text in English and
  German, in the page's language.
- Compatibility: an instance whose `TELEGRAM_BOT_TOKEN` is set behaves as before (precedence); existing D1 databases
  need no manual step; the saved chat, the settings and the stored GitHub credentials are untouched by this change.
- New configuration: none. `TELEGRAM_BOT_TOKEN` becomes optional (default: unset, the token comes from the setup);
  the deploy form asks only for `SELUNA_SECRET`.
- Logs: no new log fields; delivery results stay `sent`, `rate-limited`, `token-rejected`, `failed`, `no-token`,
  `no-chat` and `store-failed`; the request log keeps method, path without query and status.

## Acceptance criteria

- [ ] AC1: Without the Worker secret and without a saved token, `GET /setup/telegram` answers 200 with the token form
  (the S1 text, a masked field the browser does not fill, *Save token*, a session-bound CSRF field) and without chat
  list or search link, and calls Telegram zero times (S1).
- [ ] AC2: A well-formed token that Telegram accepts, including a bot with a webhook, is saved: reading it back
  through the credential store returns exactly the entered token, no D1 row holds it in plain text, and the step then
  shows "A bot token is saved. It is not shown again." with *Change token* and *Remove token* and the chat search run
  with that token (S2, E5).
- [ ] AC3: With a saved token and no Worker secret, the chat search, the test message and the delivery of outbox rows
  send their Bot API requests with the saved token (S3).
- [ ] AC4: Saving another token replaces the saved one only when Telegram accepted it; after a malformed, rejected or
  failed save the earlier token is still the saved one, and in every case the saved chat is unchanged (S4, E3, E4).
- [ ] AC5: A token that does not match the bot token form, and a missing or repeated token field, answers 400 with the
  *not a bot token* notice in the page's language, saves nothing, calls Telegram zero times, and the page does not
  contain the submitted value (E1, E2).
- [ ] AC6: On saving, a Telegram 401 or 404 answers 502 with the *token not accepted* notice, and every other failure of
  E4 answers 502 with the *token not saved, Telegram unavailable* notice, both saving nothing; on the step page, a 401
  or 404 for the saved token shows the *saved token not accepted* notice with the token form and *Remove token*
  (E3, E4, E10).
- [ ] AC7: When `TELEGRAM_BOT_TOKEN` is a non-empty string, well-formed or not, it is the token of every Bot API
  request and delivery (malformed: no request, `no-token`), the step shows the S6 note or the *token malformed* notice
  without form, *Change token* or *Remove token*, and a token or remove form answers 409 changing nothing; a saved
  token stays stored and unused (S6, E8, E9).
- [ ] AC8: *Remove token* deletes the saved token and redirects to the step, which shows the token form; the saved chat
  and settings stay; pending outbox rows are not attempted while no token is available; a removal with no saved token
  answers the same (S5, E15).
- [ ] AC9: The reset deletes the saved token together with the GitHub credentials, and the reset text names the saved
  Telegram bot token among what it deletes (S8).
- [ ] AC10: A saved token that cannot be read shows the E11 notice without form, *Remove token* or Telegram call, a
  token or remove form then answers 409 changing nothing, and delivery logs `no-token`; with unreadable GitHub
  credentials and no saved token a submitted token answers 409 with the E12 notice and is not saved (E11, E12).
- [ ] AC11: D1 failures answer 503 with *unavailable* on the step page (no Telegram call) and on saving or removing,
  and in delivery log `store-failed` with the row unchanged; a missing or unreadable token in delivery logs `no-token`
  (E13, E16).
- [ ] AC12: The status section shows *Telegram bot token:* with "Set by the Worker secret TELEGRAM_BOT_TOKEN.", "Saved
  in the setup.", "None saved yet." or "Cannot be read with the current SELUNA_SECRET." for the four states, without
  the value and without a Telegram request (S7).
- [ ] AC13: For every answer of the token and remove forms and of the step page (success, each rejection, 403, 409,
  413, 503), no response body, header or log entry contains the submitted or saved token; a form with a bad CSRF token
  answers 403 *form expired* and an oversized body 413, each saving and deleting nothing without a Telegram call
  (E6, E7).
- [ ] AC14: Two saves at once leave exactly one of the two accepted tokens stored, whole; a save between a reset's
  check and its delete leaves the stored rows in place (E14).
- [ ] AC15: `cloudflare.bindings` in `package.json` lists only `SELUNA_SECRET`; `.dev.vars.example`, `README.md` and
  `docs/setup.md` describe the token in the Telegram chat step and `TELEGRAM_BOT_TOKEN` as optional with precedence
  (S9).

## Out of scope

- Other messengers and the channel switch (separate issues).
- Moving `SELUNA_SECRET` out of the Worker secrets: it stays for the login and the key derivation.
- Registering, setting or deleting a Telegram webhook.
- Copying an existing `TELEGRAM_BOT_TOKEN` Worker secret into D1 automatically: the owner deletes the secret and enters
  the token in the step.
- Showing which bot a token belongs to (its name or username).
- Renaming the step *Telegram chat*, and changing the reset button's text or the reset's redirect to the GitHub App
  step.
- Checking the token against Telegram on the status page.

## Open questions

- Which token wins when the Worker secret and a saved token both exist? Answered: the Worker secret, as the issue
  asks and as `TELEGRAM_CHAT_ID` does today (`chatTarget` in `src/delivery.ts`, lines 36-44), so existing instances
  keep working (S6).
- Does a malformed Worker secret fall back to the saved token? Answered: no. `chatTarget` uses no fallback when
  `TELEGRAM_CHAT_ID` is not a chat id (`src/delivery.ts`, line 36; `docs/areas/notifications.md`, *Sending a row*);
  the token follows the same rule, so the source the owner set is the one reported (E9).
- `getMe` or `getUpdates` to verify a token? Answered: the issue leaves it to the Lead's plan and decision record; the
  spec fixes only the outcome — accepted is saved (E5 included), 401/404 is rejected, everything else is unavailable
  and saves nothing.
- Does the reset already cover the saved token? Answered: the deletion yes, the text no. `resetCredentials` deletes
  every `secrets` row (`src/store/secrets.ts`, lines 234 and 317-321), but only while the credentials cannot be read
  (`needsReset`), and the reset text in `src/setup/texts.ts` names only the GitHub credentials and installation tokens,
  so the issue's note "the reset notice covers it" is refuted; S8 changes the text.
- Is the saved chat kept when the token changes or is removed? Answered: yes. The chat id is the separate setting
  `telegram_chat_id`, which the reset keeps as well (`docs/areas/setup-wizard.md`, *Reset*); a chat the new bot cannot
  reach fails like any send today and the owner chooses again (S4, S5).
- Is the entered token trimmed? Answered: no. The Worker secret is "never trimmed" (`botTokenFromEnv`,
  `src/telegram.ts` line 28; `docs/areas/setup-wizard.md`, *Telegram chat*) and the login compares `SELUNA_SECRET`
  without trimming; one accepted text, and the E1 notice says "without spaces".
- Can a token be written while no GitHub credential is stored? Answered: yes. The first credential written stores the
  key check value with it (`docs/areas/storage.md`, *Key check*); a write is refused only while the key check value
  reports a changed or damaged state (E12).

## Area documents

- `docs/areas/setup-wizard.md`: *Telegram chat* — the token form, *Change token* and *Remove token*, the precedence of
  `TELEGRAM_BOT_TOKEN`, the bot token rule for both sources, the order of checks and answers of the new forms, the new
  notices; *Status and settings* — the *Telegram bot token:* line; *Reset* — the saved token among the deleted values;
  *CSRF protection* — the new signed-in forms in its list; *Paths* and *Texts*.
- `docs/areas/storage.md`: the `secrets` key list with the bot token; *Encryption* — the bot token among the encrypted
  values; *Key check* and the reset — the bot token as a credential like the others.
- `docs/areas/deployment.md`: *Worker secrets* — `TELEGRAM_BOT_TOKEN` optional with precedence, the deploy form asks
  only for `SELUNA_SECRET`.
- `docs/areas/notifications.md`: *Sending a row* — the bot token is the Worker secret when set, otherwise the saved
  token; `no-token` and `store-failed` when it is missing, unreadable or cannot be read from D1.
- `docs/areas/http-routes.md`: the list of setup routes that read a request body gains the new form route(s).
