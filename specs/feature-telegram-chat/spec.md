# Spec: Wizard step: Telegram chat

Status: Approved by Lead

Source: Issue #9 (dependency #8, setup login, is merged on `main`: PR #36, CSRF binding PR #39).

## Problem / motivation

Seluna delivers through the owner's own Telegram bot (`TELEGRAM_BOT_TOKEN`), but it does not know which chat to
send to. Finding a chat id by hand (calling the Bot API in a browser, reading JSON) is error-prone. The setup wizard
finds it: the owner talks to the bot (or adds it to a group), the wizard lists the chats the bot has seen, the owner
picks one, a test message proves it works, and the chat id is saved.

## Behavior

1. The start page of the signed-in owner links to the Telegram step at `/setup/telegram` instead of saying that the
   setup steps follow later.
2. The Telegram step page tells the owner to open their bot in Telegram and send `/start`, or to add the bot to a
   group, and then to search for chats (a link that loads the page again).
3. Each time the step page is loaded (signed in, `TELEGRAM_CHAT_ID` not set, bot token usable), the wizard calls the
   Bot API method `getUpdates` exactly once and lists the chats found: private chats and groups (a supergroup counts
   as a group), each with its name (private chat: first and last name, plus `@username` when there is one; group:
   its title) and its kind. Channels and other chat types are not listed. Each chat is listed once.
4. A chat the bot was removed from or blocked in (its newest update says so), and a group that Telegram converted
   to a supergroup (the old id), is not listed.
5. When no chat is found, the page says so and repeats what to do.
6. The owner chooses one listed chat and confirms. The wizard sends a fixed test message to that chat; only when
   Telegram accepts it is the chat id stored in the D1 `settings` table (key `telegram_chat_id`), replacing an
   earlier one. The owner then sees the step page again, which shows the saved chat id.
7. If the test message fails, nothing is stored and the page says that the test message could not be sent.
8. A missing `TELEGRAM_BOT_TOKEN`, a value that does not have the form of a bot token, and a token Telegram rejects
   each show an understandable error that says what to do; with a missing or malformed token Telegram is not called.
9. A bot that already has a webhook (or whose updates another program polls) shows an error that explains it; Seluna
   does not remove the webhook.
10. Telegram unreachable, or an answer Seluna cannot read, shows an error that asks to try again.
11. Seluna never sets a webhook for the bot and exposes no route Telegram could call; the only Bot API methods it
    calls are `getUpdates` (in this step) and `sendMessage`.
12. When the Worker secret `TELEGRAM_CHAT_ID` is set (a non-empty string), it takes precedence: the step says that
    the chat is configured by that secret (without showing its value), calls no Telegram method, offers no form, and
    a submitted confirm form stores nothing and sends nothing.
13. Chat names are shown as text only: escaped, isolated against bidirectional reordering, and cut to 128 characters.
14. The step is in English and German like every wizard page, and the test message is in the page's language.
15. The step is behind the setup login, and its form carries the session-bound CSRF token like every signed-in form.

## Acceptance criteria

- [ ] A private chat and a group are both recognized and the test message arrives (issue #9).
- [ ] A missing or invalid `TELEGRAM_BOT_TOKEN` shows an understandable error (issue #9).
- [ ] The detailed criteria AC1–AC14 in [plan.md](plan.md).

## Out of scope

- Channels as a target (the issue asks for a private chat or a group).
- Sending the test message to a chat configured through `TELEGRAM_CHAT_ID`, and validating that secret's value.
- Showing the saved chat's name (only the id is stored, as the issue asks).
- Delivery of notifications to the saved chat (outbox, issue #12) — it will use the same precedence rule.
- A language setting in D1, the GitHub App step (#10), settings and reset (#11).

## Open questions

- None. A real sample of the Bot API answers is not provided: the Product Manager decided that the client is built
  from the Bot API reference, with the residual risk recorded in decision 0016 and a live check before the pull
  request is marked ready (*Runtime details* in plan.md).
