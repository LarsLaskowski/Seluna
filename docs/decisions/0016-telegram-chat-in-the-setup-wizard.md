# 0016: Telegram chat in the setup wizard

- **Status:** Proposed
- **Date:** 2026-10-16
- **Area:** Setup wizard
- **Source:** Issue #9
- **Supersedes:** —

## Context

Seluna delivers through the owner's own bot (`TELEGRAM_BOT_TOKEN`, a Worker secret,
[decision 0013](0013-deploy-to-cloudflare-and-workers-builds.md)) but needs the id of the chat to send to. Issue #9
asks the setup wizard to find it: the owner sends `/start` to the bot or adds it to a group, the wizard calls
`getUpdates` once, lists the private chats and groups with their names, sends a test message to the confirmed one and
stores its id in `settings`; the bot never gets a webhook, and a `TELEGRAM_CHAT_ID` Worker secret takes precedence.
Until now the architecture said that Telegram is only ever called and never a source of input, and the security
areas named `sendMessage` as the only method. `getUpdates` returns data that anyone who messages the bot can shape
(names, titles). The wizard runs behind the setup login ([decision 0015](0015-setup-login.md)) on the Workers free
plan.

## Options considered

When `getUpdates` runs:

1. **Once on every load of the signed-in step page** — no extra form; "search again" is a reload; a GET changes no
   Seluna state, and a cross-site navigation arrives signed out. Chosen.
2. **Behind a POST "search" form** — a second form and CSRF check for the same effect.

Which updates are asked for:

3. **The newest 100 (`offset` −100, `limit` 100, `timeout` 0, no `allowed_updates`)** — the owner's fresh `/start` is
   among them even when a group is busy; Telegram forgets older updates, which only Seluna would read.
   `allowed_updates` is left out because Telegram keeps it for later calls. Chosen.
4. **No offset** — Telegram returns the oldest 100 unconfirmed updates, so a fresh `/start` can be missing.

How the token gets into the request URL (`/bot<token>/<method>`):

5. **An allow-list (digits, a colon, then letters, digits, `-`, `_`) checked before any call** — no value can change
   the path or method, and a paste error is reported as such without a call. Chosen.
6. **`encodeURIComponent`** — also safe for the path, but a garbage token reaches Telegram, and "malformed" cannot be
   told apart from "revoked".

A bot that already has a webhook (Telegram answers 409):

7. **Explain it and stop** — Seluna wants a bot of its own and never changes the bot's configuration. Chosen.
8. **Call `deleteWebhook`** — a second, state-changing method that breaks whatever else uses the bot.

Where the chat id is kept:

9. **Plain text in `settings` (`telegram_chat_id`)** — a chat id grants nothing without the bot token; the storage
   area already lists it as plain. Chosen.
10. **Encrypted in `secrets`** — the key check and reset machinery for a value that is not secret.

`TELEGRAM_CHAT_ID`:

11. **Takes precedence; the step says it is configured, without its value, and offers no form** — no Worker secret is
    returned in a response. Chosen.
12. **Show the value** — the chat id is not sensitive, but the rule "no secret in a response" would gain an exception.

Which chats are listed:

13. **Private chats and groups (supergroups included), each keyed by its newest update; a chat whose newest update
    removed or blocked the bot, or moved the group to a supergroup, is left out** — the list holds what a test
    message can reach. Chosen.
14. **Every chat seen in any update** — removed chats and the old id of an upgraded group would fail the test
    message.

How the Worker reaches Telegram:

15. **A `fetch` function injected into the wizard's dependencies** — typed test double per test, reusable by the
    outbox (#12). Chosen.
16. **A stub on `globalThis.fetch`** — global state shared between tests.

## Decision

The signed-in step `/setup/telegram` calls `getUpdates` once per page load for the newest 100 updates, lists the
private chats and groups a test message can reach, and on confirmation sends a fixed test message and only then
stores the chat id in `settings`; the bot token is allow-listed before it enters a URL, a webhook on the bot is
reported and never removed, and a non-empty `TELEGRAM_CHAT_ID` takes precedence without being shown. The Worker
still exposes nothing Telegram can call and calls only `getUpdates` and `sendMessage`; the `getUpdates` answer is the
one input it takes from Telegram, read bounded and narrowed. The rules are in the area document
[`areas/setup-wizard.md`](../areas/setup-wizard.md).

## Consequences

- The outbound-only rule is reworded in `docs/ARCHITECTURE.md` and `.squad/project.md`: Telegram never calls the
  Worker, and its only input is the `getUpdates` answer of the signed-in step. A further Bot API method is a
  `security`-tier change.
- Anyone who knows the bot's username can appear in the list; names are rendered as inert, bounded text, and the
  owner recognizes their own chat by the test message arriving.
- Delivery (#12) uses `TELEGRAM_CHAT_ID` when set, else `settings` `telegram_chat_id`, and reuses the client's
  `sendMessage`.
- Telegram's answers for an unknown token (401, sometimes 404), a webhook (409) and the updates of a newly added group
  are taken from the Bot API reference; the session could not reach Telegram. Every other answer fails closed
  (nothing stored, a fixed notice). Revisit if a live run shows other codes.
