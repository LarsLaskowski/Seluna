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
- A value is encrypted with AES-256-GCM under a random 12-byte IV drawn for every single write, with the default
  16-byte tag. The plaintext is the UTF-8 encoding of the value. IV and ciphertext are stored as standard base64
  with padding.
- The key is derived with HKDF-SHA256 from the UTF-8 bytes of the Worker secret `SELUNA_SECRET`; salt and info
  are both the UTF-8 bytes of `seluna/secrets/v1`. The key never leaves the Worker's memory and is never stored.
- Each value is bound to its place as additional authenticated data: the UTF-8 bytes of `secrets/<key>` for a
  row of `secrets`, `token_cache/<installation_id>` (the id in decimal) for a row of `token_cache`, and
  `meta/key_check` for the key check value. A ciphertext copied into another row does not decrypt there.
- `SELUNA_SECRET` counts as configured only when it is a string of at least 32 characters (Unicode code points,
  so a character outside the Basic Multilingual Plane counts once). Without a configured `SELUNA_SECRET` nothing
  is encrypted or decrypted.

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
| absent                                     | **corrupt**                 | stored, key check written    |
| malformed, or decrypts to another text     | **corrupt**                 | **corrupt**, no write        |

- Reading a credential that was never stored reports **missing**, without looking at the key check value.
- A stored credential whose own ciphertext does not decrypt (altered, copied from another row, malformed
  base64 or IV) reports **corrupt**.
- **Secret changed** is the dedicated result the setup wizard shows; its remedy is a reset that clears the
  stored credentials and the key check value and runs the setup again. **Corrupt** leads to the same reset.

## Limits and errors

- None of the results above carries the value, the key, the IV or the ciphertext, and nothing in this area is
  logged.
- A value is limited only by D1's own row size limit; the credentials are a few kilobytes at most.
- Two first writes under different `SELUNA_SECRET` values at the same moment can leave a credential that later
  reports **secret changed**; one instance has one `SELUNA_SECRET`, so this needs a change of the Worker secret
  during setup.

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
