# Storage

## Scope

The state an instance keeps in its D1 database: the tables and columns, the units of their values, how
credentials are encrypted and how a changed `SELUNA_SECRET` is detected. The Worker's components (webhook
processing, outbox, cron, setup wizard) rely on it, and so does the owner, whose credentials it protects against
anyone who can only read the database.

## Behavior

### Data access

- Only the modules under `src/store/` read or write D1; every other component goes through them.
- Every time is stored as an integer count of milliseconds since 1970-01-01 00:00 UTC.
- An error of D1 itself (unreachable, a failed statement) is never turned into an empty or a "not found" result:
  it reaches the caller, which decides how to answer (for the webhook: 503, never 202).

### Tables

The first migration (`migrations/0001_initial_schema.sql`) creates exactly these six tables. Columns are
`NOT NULL` unless marked nullable.

| Table         | Column            | Type    | Holds                                                                                |
| ------------- | ----------------- | ------- | ------------------------------------------------------------------------------------ |
| `settings`    | `key`             | TEXT    | Primary key: the name of a setting                                                   |
|               | `value`           | TEXT    | The setting's value as text                                                          |
| `secrets`     | `key`             | TEXT    | Primary key: `github_app_id`, `github_private_key` or `github_webhook_secret`        |
|               | `iv`              | TEXT    | Base64 of the 12-byte IV; the table rejects any value that is not 16 characters long |
|               | `ciphertext`      | TEXT    | Base64 of the AES-256-GCM ciphertext with its 16-byte tag                            |
| `deliveries`  | `id`              | TEXT    | Primary key: the `X-GitHub-Delivery` value                                           |
|               | `event`           | TEXT    | The `X-GitHub-Event` value                                                           |
|               | `received_at`     | INTEGER | When the delivery was received (indexed)                                             |
| `outbox`      | `id`              | INTEGER | Primary key, assigned by the database                                                |
|               | `text`            | TEXT    | The message text as sent to Telegram                                                 |
|               | `button_url`      | TEXT    | Nullable: the URL of the message's button                                            |
|               | `silent`          | INTEGER | `1` to send without sound, otherwise `0` (default `0`; nothing else is accepted)     |
|               | `attempts`        | INTEGER | Delivery attempts so far (default `0`, never negative)                               |
|               | `status`          | TEXT    | `pending` (default), `sent` or `failed`; nothing else is accepted                    |
|               | `created_at`      | INTEGER | When the row was written; indexed together with `status`                             |
| `token_cache` | `installation_id` | INTEGER | Primary key: the GitHub App installation id                                          |
|               | `iv`              | TEXT    | As in `secrets`                                                                      |
|               | `ciphertext`      | TEXT    | The installation token, encrypted as in `secrets`                                    |
|               | `expires_at`      | INTEGER | When the token expires                                                               |
| `meta`        | `key`             | TEXT    | Primary key: the name of a value the instance keeps for itself                       |
|               | `value`           | TEXT    | The value as text                                                                    |

- `settings` holds the owner's choices: the language, the time zone, the quiet hours, the enabled rules, the
  update notice and the Telegram chat id. The keys and their formats are defined by the change that introduces
  each setting.
- `meta` holds the last notified release, the time of the last delivery and the key check value
  (`key_check`, below).
- Wrangler keeps its own record of the applied migrations in the table `d1_migrations`; no Seluna code reads or
  writes it.

### Encryption

- Nothing secret is kept in D1 in plain text: the GitHub App credentials (`secrets`) and the installation tokens
  (`token_cache`) are stored only encrypted.
- Everything else is plain text on purpose, so a reader of the database sees it: `settings` (including the
  Telegram chat id), `deliveries`, `meta` apart from the key check value, and the `outbox` rows, whose `text` and
  `button_url` name repositories, pull request titles and branches, also of private repositories. None of these
  grants access to anything.
- A value is encrypted with AES-256-GCM under a random 12-byte IV drawn for every single write, with the default
  16-byte tag. The plaintext is the UTF-8 encoding of the value. IV and ciphertext are stored as standard base64
  with padding.
- The key is derived with HKDF-SHA256 from the UTF-8 bytes of the Worker secret `SELUNA_SECRET`; salt and info
  are both the UTF-8 bytes of `seluna/secrets/v1`. The key never leaves the Worker's memory and is never stored.
- The key is used only for the values in D1. Any other key taken from `SELUNA_SECRET` (for example one that signs
  the setup login's session, issue #8) is derived with an HKDF info of its own, never this one.
- Each value is bound to its place as additional authenticated data, the UTF-8 bytes of:
  - `secrets/<key>` for a row of `secrets`;
  - `token_cache/<installation_id>/<expires_at>` for a row of `token_cache`, both numbers in decimal without
    leading zeros, as JavaScript's `String()` writes an integer. This is the contract for the code that writes
    and reads installation tokens (issue #15): its tests check that a stored token decrypts with exactly this
    text. Because `expires_at` is part of it, a row whose expiry was changed afterwards does not decrypt and is
    treated like a missing token;
  - `meta/key_check` for the key check value.

  A ciphertext copied into another row does not decrypt there.

- `SELUNA_SECRET` counts as configured only when it is a string of at least 32 characters (Unicode code points,
  so a character outside the Basic Multilingual Plane counts once); the value is used as it is, without trimming.
  The only way the code obtains the key is from the Worker environment, through the same check, so no caller can
  derive a key from a shorter secret.
- Without a configured `SELUNA_SECRET` there is no key: nothing is encrypted or decrypted and nothing is written.
  The setup wizard refuses to start (issue #8), and a component that needs a credential from D1 cannot read it
  and answers as if the credential were missing — the webhook answers 503 without a body, as it does today
  without a webhook secret ([HTTP routes](http-routes.md)).

### Key check

- `meta` row `key_check` holds `<iv>.<ciphertext>`, both base64: the text `seluna/key-check/v1` encrypted as
  above with the additional data `meta/key_check`.
- The first credential written stores the key check value in the same transaction as the credential. Later
  writes leave it unchanged.
- Before a credential is read or written, the key check value is decrypted with the current key:

| Key check value                            | Read of a stored credential | Write of a credential        |
| ------------------------------------------ | --------------------------- | ---------------------------- |
| decrypts to `seluna/key-check/v1`          | the value                   | stored                       |
| does not decrypt (another `SELUNA_SECRET`) | **secret changed**          | **secret changed**, no write |
| absent, and `secrets` is empty             | **missing** (none stored)   | stored, key check written    |
| absent, but `secrets` holds a credential   | **corrupt**                 | **corrupt**, no write        |
| malformed, or decrypts to another text     | **corrupt**                 | **corrupt**, no write        |

- Reading a credential that was never stored reports **missing**, without looking at the key check value.
- A stored credential whose own ciphertext does not decrypt (altered, copied from another row, malformed
  base64 or IV, a plaintext that is not valid UTF-8) reports **corrupt**.
- A credential is only written while the key check value in the database is still the one checked before the
  write (or, for the first credential, the one written in the same transaction). If another write or a reset
  changed it in between, the write is not applied and is tried once more from the check; the second attempt
  reports what it finds (stored, **secret changed** or **corrupt**). So no credential is ever stored without a
  key check value that covers it: two first writes under the same `SELUNA_SECRET` both succeed, and a first
  write under another `SELUNA_SECRET` at the same moment reports **secret changed** and writes nothing.
- **Secret changed** is the dedicated result the setup wizard shows; its remedy is a reset that clears the
  stored credentials and the key check value and runs the setup again. **Corrupt** leads to the same reset.
  The reset always creates new GitHub App credentials and never stores old ones again: D1's Time Travel keeps
  earlier states of the database, including the deleted rows, for a while after the reset (Cloudflare documents
  up to 30 days).

## Limits and errors

- None of the results above carries the value, the key, the IV or the ciphertext, and nothing in this area is
  logged.
- A value is limited only by D1's own row size limit; the credentials are a few kilobytes at most.

## Related decisions

- [`decisions/0007-github-app-credentials-encrypted-in-d1.md`](../decisions/0007-github-app-credentials-encrypted-in-d1.md)
  — credentials and installation tokens encrypted in D1, the key derivation, the binding to the row and the key
  check.
- [`decisions/0014-d1-schema-and-data-access.md`](../decisions/0014-d1-schema-and-data-access.md) — one schema
  migration for all tables, data access only through `src/store/`, times in milliseconds, text columns for
  encrypted values, migrations frozen once on `main`.

## Not here

- How and when migrations are applied to an instance's database: [Deployment](deployment.md#d1-database).
- What each setting means and how the setup wizard writes it: the setup wizard
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md#components)).
- When rows of `deliveries`, `outbox` and `token_cache` are removed: the cron jobs
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md#cron-triggers)).
