# 0038: Channel-neutral outbox and one active delivery channel

- **Status:** Proposed
- **Date:** 2026-10-26
- **Area:** Notifications
- **Source:** Issue #69
- **Supersedes:** — (amends [0023](0023-webhook-processing-and-delivery-through-the-outbox.md): an `outbox` row no
  longer holds the message rendered as Telegram HTML when it is written, but the neutral notification, rendered by the
  active channel when it is sent; amends [0021](0021-missing-tables-notice-on-the-setup-login.md): _migrations
  missing_ also covers an `outbox` table without the column of the second migration, and the start page checks for it)

## Context

Delivery was Telegram-only: the rules return a channel-neutral notification, but decision 0023 (option 8) rendered
it into Telegram HTML at write time, and the sender called the Telegram client directly. Issue #69 asks for a channel
interface with Telegram as its first adapter, an outbox that stores the neutral notification, exactly one active
channel the owner switches on the start page, and no change in what Telegram receives. The `outbox` table has a
`text NOT NULL` column since the first migration ([decision 0014](0014-d1-schema-and-data-access.md)); migrations are
frozen once on `main`, every copy applies them with `npm run deploy` before the Worker is deployed, and between the
two steps the earlier Worker keeps running on the new schema. The second migration is the first that changes an
existing table, and the setup login's _migrations missing_ check (decision 0021) only sees missing tables.

## Options considered

How the neutral notification is stored:

1. **A nullable column `notification` (JSON) added by `ALTER TABLE`; new rows write `text` as `''`; a row without it
   is a row of the earlier version, whose `text` is Telegram HTML** — one statement, every existing row, index and
   check stays, and the earlier Worker's inserts still succeed. Chosen.
2. **Rebuild `outbox` with `text` nullable and copy the rows** — a cleaner schema, but a multi-statement migration
   on every copy's live table for a constraint nothing relies on.
3. **Convert the old rows in the migration** — SQL would have to parse HTML; the old rows are few and short-lived.

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

How a database without the second migration is detected: **the `sql` text of `outbox` in `sqlite_master`, which
SQLite rewrites on `ALTER TABLE … ADD COLUMN`** (chosen; production D1 answers `sqlite_master`, decision 0021),
against `pragma_table_info` (not yet used in production) or a probing statement (its failure cannot be told from
another without reading the error text).

## Decision

Each `outbox` row written from now on holds the cleaned, cut notification as JSON and is rendered by the channel
active at the start of each send batch; Telegram renders it exactly as before, and rows of the earlier version keep
their Telegram HTML. One channel is active (`delivery_channel`, default `telegram`), there is no fallback, and a
database without the column is reported as _migrations missing_. The behavior is in
[`areas/notifications.md`](../areas/notifications.md) and [`areas/setup-wizard.md`](../areas/setup-wizard.md).

## Consequences

- A channel plugs in through the registry and its adapter; the rules stay free of any channel (a lint rule keeps
  `src/rules/` from importing one).
- Until the migration is applied (a deploy command other than `npm run deploy`), every webhook delivery answers 503
  and stores nothing; GitHub does not resend it on its own, so its message is lost unless the owner redelivers it
  after fixing the deploy command. The start page says so.
- An earlier version run on the migrated database (a reverted update) sends the new rows' empty `text`, which
  Telegram is expected to refuse: those rows end `failed`. Accepted; downgrades are not supported.
- Switching the channel does not reset a row's attempts, and a batch already running finishes on its channel.
- The start page makes one more D1 read (the schema check), and every send batch one more (the active channel).
