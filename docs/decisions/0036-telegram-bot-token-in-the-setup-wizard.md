# 0036: Telegram bot token entered in the setup wizard and checked with getMe

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Setup wizard
- **Source:** Issue #68
- **Supersedes:** — (amends [0013](0013-deploy-to-cloudflare-and-workers-builds.md): the bot token is no longer a
  required Worker secret asked for by the deploy form, but entered in the setup wizard and kept encrypted in D1, with
  `TELEGRAM_BOT_TOKEN` as an optional Worker secret that takes precedence; amends
  [0016](0016-telegram-chat-in-the-setup-wizard.md): the Telegram step also takes the token, and the Worker calls the
  Bot API method `getMe` besides `getUpdates` and `sendMessage`)

## Context

Since 0.1.0 the bot token is the Worker secret `TELEGRAM_BOT_TOKEN`, asked for by the deploy form (decision 0013). An
owner who mistyped it, revoked it at @BotFather or wants another bot has to leave the setup and edit the secret in the
Cloudflare dashboard; the Telegram step can only say that it is missing, malformed or rejected. The GitHub App
credentials, by contrast, are created in the wizard and kept AES-256-GCM-encrypted in the D1 table `secrets` under a
key derived from `SELUNA_SECRET`, with a key check value and a reset for a changed secret (decision 0007, decision
0018). Issue #68 asks for the same for the bot token, while existing instances keep working. Decision 0016 made every
further Bot API method a `security`-tier change; the session cannot reach `api.telegram.org`, so a new answer can only
be built from the Bot API reference and checked live on a deployed copy.

## Options considered

Where the token lives:

1. **Only the Worker secret (as today)** — no new stored credential, but the owner keeps leaving the setup for every
   change.
2. **Encrypted in `secrets` as `telegram_bot_token`, entered in the Telegram step; a non-empty `TELEGRAM_BOT_TOKEN`
   takes precedence** — the same storage, key check and reset as the GitHub credentials, and instances that set the
   secret behave as before. Chosen.
3. **Only in D1, the Worker secret dropped** — one source, but every existing instance stops delivering until the
   owner enters the token again.

How a token is checked before it is saved:

4. **`getMe`** — the Bot API's own check of a token: no side effect on the bot's updates, an answer of one small
   object, and a bot with a webhook answers like any other. A third Bot API method, with a reference-built fixture and
   the double's allow-list extended. Chosen.
5. **`getUpdates`** — no new method, but each call makes Telegram discard the bot's older updates, the answer can be
   up to 1 MiB that is read for nothing, and a bot with a webhook answers 409: reading that 409 as "the token is valid"
   rests on Telegram authenticating the token before it looks at the webhook, which no one here can measure.
6. **No check, only the token form** — a revoked or mistyped token would show up only at the next chat search; the
   spec requires the check.

A Worker secret that is set but malformed:

7. **It still wins, without falling back to a saved token** — as `TELEGRAM_CHAT_ID` does; the source the owner set is
   the one the step reports. Chosen.
8. **Fall back to the saved token** — delivery might work, but the step would report one source and use another.

A saved token whose own row does not decrypt while the key check matches:

9. **Repairable in the step: the token form and _Remove token_ stay offered** — a write succeeds under a matching key
   check, so the GitHub credentials survive. Chosen.
10. **Only the reset** — it would delete working GitHub credentials to replace one damaged row.

## Decision

The bot token is the Worker secret `TELEGRAM_BOT_TOKEN` when that is a non-empty string, otherwise the token saved in
the Telegram step as the `secrets` row `telegram_bot_token`, encrypted like the GitHub credentials. The step saves a
token only after it matches the bot token allow-list and Telegram's `getMe` accepted it; the deploy form no longer asks
for the token. The rules are in [`areas/setup-wizard.md`](../areas/setup-wizard.md), the storage in
[`areas/storage.md`](../areas/storage.md).

## Consequences

- The Worker calls three Bot API methods: `getUpdates` and `getMe` in the signed-in Telegram step, `sendMessage` there
  and in delivery. `getMe` is read only for its status and `ok`, bounded to 1 MiB like every Bot API answer.
- The `getMe` answer and its fixture are built from the Bot API reference, not captured. Like decision 0016, the one
  check against the real API is the Product Manager's live check on a deployed copy before the pull request is marked
  ready; a deviation fails closed (the token is not saved, the owner sees a fixed notice).
- Delivery reads the token from D1 when no Worker secret is set: one more D1 batch and one key derivation per delivery
  run. A D1 failure there logs `store-failed`, a missing or unreadable token `no-token`, and the rows wait.
- The Telegram step reads D1 also while `TELEGRAM_CHAT_ID` is set, because the token part stays usable then.
- A changed `SELUNA_SECRET` makes the saved token unreadable together with the GitHub credentials; the reset deletes it
  with them, and its text says so. D1 Time Travel keeps a deleted token for a while, as it keeps deleted credentials;
  a token that may have leaked is revoked at @BotFather.
- The bot token can be the only credential, so removing it can remove the last `secrets` row. The key check value is
  then deleted with it, so that no key check outlives the credentials and makes a later change of `SELUNA_SECRET`
  look like unreadable credentials. Unlike the reset, this delete pins no key check value: it runs in the same batch
  as the row delete, guarded only by an empty `secrets` table, and a write that checked the deleted value retries and
  stores a new one ([`areas/storage.md`](../areas/storage.md#key-check)).
- Instances that set `TELEGRAM_BOT_TOKEN` keep it; to move the token into the setup, the owner deletes the secret and
  enters the token in the step. Copying it over automatically was left out.
- Revisiting this means changing the token resolution in one module (`src/bot-token.ts`) and the step's forms.
