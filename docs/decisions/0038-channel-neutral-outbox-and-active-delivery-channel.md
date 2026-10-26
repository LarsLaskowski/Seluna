# 0038: Channel-neutral outbox and one active delivery channel

- **Status:** Accepted
- **Date:** 2026-10-26
- **Area:** Notifications
- **Source:** Issue #69
- **Supersedes:** — (amends [0023](0023-webhook-processing-and-delivery-through-the-outbox.md): an `outbox` row no
  longer holds the message rendered as Telegram HTML when it is written, but the neutral notification, rendered by the
  active channel when it is sent)

## Context

Delivery was Telegram-only: the rules return a channel-neutral notification, but decision 0023 (option 8) rendered
it into Telegram HTML at write time, and the sender called the Telegram client directly. Issue #69 asks for a channel
interface with Telegram as its first adapter, an outbox that stores the neutral notification, exactly one active
channel the owner switches on the start page, and no change in what Telegram receives. Its scope names a migration
`0002` for the new storage. `outbox.text` is `TEXT NOT NULL` since the first migration
([decision 0014](0014-d1-schema-and-data-access.md)), and every row written so far starts with `<b>`. Migrations are
applied only by the deploy command `npm run deploy`; with Workers Builds' default `npx wrangler deploy` none is applied,
and the setup login's _migrations missing_ check ([decision 0021](0021-missing-tables-notice-on-the-setup-login.md))
sees only missing tables.

## Options considered

How the neutral notification is stored:

1. **The JSON object in the existing `text` column; a new row starts with `{`, every earlier row with `<b>`** — no
   migration, so no deploy can leave the webhook writing into a table of the wrong shape; the first character tells
   the two forms apart for certain. After a reverted update the earlier version sends a new row's JSON as the message
   text (shown raw, or refused by Telegram when a field holds `<` or `&`); the column name `text` no longer describes
   everything it holds. Chosen by the Product Manager, who waived the issue's migration on this point.
2. **A nullable column `notification` added by migration `0002`; new rows write `text` as `''`** — typed and explicit,
   what the issue's scope lists. Rejected: until the migration is applied (a deploy command other than
   `npm run deploy`) every webhook insert fails, the delivery answers 503 and GitHub does not resend it, so its message
   is lost unless redelivered by hand; the start page would need a schema check of its own (decision 0021 sees only
   tables) and a live check against production D1; after a reverted update the earlier version sends the empty `text`,
   which Telegram refuses, so those rows end `failed`.
3. **Rebuild `outbox` with `text` nullable** — a multi-statement migration on every copy's live table, with the risks
   of option 2.
4. **Convert the old rows to JSON** — SQL would have to parse HTML; the old rows are few and short-lived.

How rows of the earlier version are sent: **as stored by Telegram, and recovered into the neutral fields for any
other channel** (chosen; their format is fixed by `formatMessage`), against keeping them Telegram-only (they would
wait forever after a switch, since a pending row is never deleted).

What happens when the active channel is not usable: **rows wait, attempts unchanged, no fallback** (chosen, as
without a bot token today), against falling back to another set-up channel (sends to a destination the owner did not
choose). Removing the active channel's credentials is allowed from the start page and from its step, with a notice
that notifications wait; refusing it would make the Telegram step's _Remove token_ (decision 0036) always refused
while Telegram is the only channel.

Where the active channel is kept: **the setting `delivery_channel`, written alone by _Activate_, an unknown value read
as `telegram`** (chosen), against a row of the notification settings batch (the settings form would overwrite it).

## Decision

Each `outbox` row written from now on holds the cleaned, cut notification as a JSON object in `text` and is rendered
by the channel active at the start of each send batch; Telegram renders it exactly as before, and rows of the earlier
version keep their Telegram HTML. One channel is active (`delivery_channel`, default `telegram`), with no fallback.
The behavior is in [`areas/notifications.md`](../areas/notifications.md),
[`areas/storage.md`](../areas/storage.md) and [`areas/setup-wizard.md`](../areas/setup-wizard.md).

## Consequences

- A channel plugs in through the registry and its adapter; the rules stay free of any channel (a lint rule keeps
  `src/rules/` from importing one).
- No schema change: a deploy without migrations behaves as before, and the earlier version's inserts keep working.
- A row whose `text` starts with `{` but does not decode, or is not a string, counts a failed attempt and ends
  `failed`; it never stops the other rows.
- Downgrades are not supported: an earlier version run after this one wrote rows sends their JSON as text (accepted).
- Switching the channel does not reset a row's attempts, and a batch already running finishes on its channel.
- Every send batch makes one more D1 read (the active channel).
