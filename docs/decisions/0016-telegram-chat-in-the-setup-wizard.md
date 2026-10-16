# 0016: Telegram chat in the setup wizard

- **Status:** Accepted
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
Every later notification (private repository names, pull request titles, security alerts) goes to the stored chat.
Until now the architecture said that Telegram is only ever called and never a source of input, and the security
areas named `sendMessage` as the only method. `getUpdates` returns data that anyone who messages the bot can shape
(names, titles), and `sendMessage` succeeds for any chat that has talked to the bot, the stranger's too. The wizard
runs behind the setup login ([decision 0015](0015-setup-login.md)) on the Workers free
plan.

## Options considered

When `getUpdates` runs:

1. **Once on every load of the signed-in step page** — no extra form; "search again" is a reload; the GET changes no
   Seluna state, and a cross-site navigation arrives signed out. It does change Telegram's: each load makes Telegram
   discard the bot's updates older than the newest 100 (option 3). Chosen.
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

What the client and its fixtures are built from (the session cannot reach Telegram):

17. **The Bot API reference; the test fixtures are written from it and marked as such** — no real answers are
    available; the Product Manager chose this over waiting for captured samples. Chosen.
18. **Captured answers of a real bot** — fixtures that show what Telegram really sends, but none were provided.

When a chosen chat is stored:

19. **After the owner typed back a six-digit code the test message carried** — a chat's label proves nothing (a
    stranger can copy the owner's name, put a fake `@name` into a name, use homoglyphs or copy a group title), and
    the code shows that the owner reads the chat. Chosen.
20. **As soon as `sendMessage` succeeds** — a look-alike entry chosen by mistake would receive every notification.
21. **As soon as `sendMessage` succeeds, with a warning in the list and the username set apart** — leaves the choice
    to the owner's eye and needs the Product Manager to accept that residual risk. Its username element is kept as
    hardening.

Where the pending chat and code are kept between sending and typing back:

22. **A form token: chat id and expiry, with an HMAC over them, the session token and the code under a key of its
    own, valid for 10 minutes** — no table, no cleanup; unforgeable, tied to one chat and one session, and the code
    is not in the page. Chosen.
23. **A D1 row** — a key, an expiry and a cleanup for a value that lives ten minutes.
24. **A cookie** — another cookie with the same contents as the form token, for no gain.

## Decision

The signed-in step `/setup/telegram` calls `getUpdates` once per page load for the newest 100 updates, lists the
private chats and groups a test message can reach, and on confirmation sends a test message with a six-digit code;
the chat id is stored in `settings` only when the owner types that code back within 10 minutes in the same session; the bot token is allow-listed before it enters a URL, a webhook on the bot is
reported and never removed, and a non-empty `TELEGRAM_CHAT_ID` takes precedence without being shown. The Worker
still exposes nothing Telegram can call and calls only `getUpdates` and `sendMessage`; the input it takes from
Telegram is the `getUpdates` answer of the signed-in step and the status of each `sendMessage` answer, read bounded
and narrowed. The client is built from the Bot API reference,
without captured answers, and checked live before release. The rules are in the area document
[`areas/setup-wizard.md`](../areas/setup-wizard.md).

## Consequences

- The outbound-only rule is reworded in `docs/ARCHITECTURE.md` and `.squad/project.md`: Telegram never calls the
  Worker, and its input is the `getUpdates` answer of the signed-in step and the status of each `sendMessage`
  answer. A further Bot API method is a `security`-tier change.
- Anyone who knows the bot's username can appear in the list; names are rendered as inert, bounded text, and a
  stranger's chat is kept out by the code, not by the label: the stranger receives a code but has no session to
  enter it. What remains is an owner who types in a code a stranger sends them; the texts of the test message and
  the code page speak against it, and choosing again replaces a wrong chat.
- The setup step gains a third signing key (`seluna/setup-telegram/v1`), so changing `SELUNA_SECRET` also voids every
  pending code.
- A stranger who sends the bot many messages can push the owner's chat out of the newest 100 updates (sending
  `/start` again lists it) or make the answer exceed 1 MiB (_Telegram unavailable_ until 100 newer updates arrived).
  Both store nothing, and `TELEGRAM_CHAT_ID` bypasses them; this is accepted, because any window or size limit can be
  filled by someone who can message the bot.
- The bot token sits in the request URL as the Bot API requires; Seluna never logs it, but Workers traces turned on
  in the dashboard would record it, which the deployment area says.
- Delivery (#12) uses `TELEGRAM_CHAT_ID` when set, else `settings` `telegram_chat_id`, and reuses the client's
  `sendMessage`.
- Residual risk: the client and its fixtures under `test/fixtures/telegram/` (marked in the `README.md` there) rest on
  the Bot API reference, not on captured answers, so the unit tests share its assumptions and cannot reveal where
  Telegram deviates from it — the status codes for an unknown token (401, sometimes 404) and a webhook (409), which
  updates a newly added group produces, whether a negative `offset` returns the newest updates, and the field shapes
  of chats and member updates. Each deviation fails closed (an update skipped, a fixed notice, nothing stored), so
  the worst outcome of a deviation is a chat that is not listed or a less precise notice; it cannot store a chat whose
  code was not typed back. The Product
  Manager's live check on a deployed copy before the pull request is marked ready is the one check against the real
  API; a deviation it or a later run finds is fixed in a new issue, with the captured answer replacing the fixture.
