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

| Table         | Column            | Type    | Holds                                                                                                                                                                                |
| ------------- | ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `settings`    | `key`             | TEXT    | Primary key: the name of a setting                                                                                                                                                   |
|               | `value`           | TEXT    | The setting's value as text                                                                                                                                                          |
| `secrets`     | `key`             | TEXT    | Primary key: `github_app_id`, `github_private_key`, `github_webhook_secret` or `telegram_bot_token`                                                                                  |
|               | `iv`              | TEXT    | Base64 of the 12-byte IV; the table rejects any value that is not 16 characters long                                                                                                 |
|               | `ciphertext`      | TEXT    | Base64 of the AES-256-GCM ciphertext with its 16-byte tag                                                                                                                            |
| `deliveries`  | `id`              | TEXT    | Primary key: the `X-GitHub-Delivery` value                                                                                                                                           |
|               | `event`           | TEXT    | The `X-GitHub-Event` value                                                                                                                                                           |
|               | `received_at`     | INTEGER | When the delivery was received (indexed)                                                                                                                                             |
| `outbox`      | `id`              | INTEGER | Primary key, assigned by the database                                                                                                                                                |
|               | `text`            | TEXT    | The notification as a JSON object starting with `{` (new rows), or Telegram HTML starting with `<b>` (rows of an earlier version) ([Notifications](notifications.md#message-format)) |
|               | `button_url`      | TEXT    | Nullable: the URL of the message's button, only an `https://github.com` URL ([Notifications](notifications.md#message-format)); the button label is not stored                       |
|               | `silent`          | INTEGER | `1` to send without sound at any time, otherwise `0`: the quiet hours decide at sending (default `0`; nothing else is accepted)                                                      |
|               | `attempts`        | INTEGER | Delivery attempts so far (default `0`, never negative)                                                                                                                               |
|               | `status`          | TEXT    | `pending` (default), `sent` or `failed`; nothing else is accepted                                                                                                                    |
|               | `created_at`      | INTEGER | When the row was written; indexed together with `status`                                                                                                                             |
| `token_cache` | `installation_id` | INTEGER | Primary key: the GitHub App installation id                                                                                                                                          |
|               | `iv`              | TEXT    | As in `secrets`                                                                                                                                                                      |
|               | `ciphertext`      | TEXT    | The installation token, encrypted as in `secrets`                                                                                                                                    |
|               | `expires_at`      | INTEGER | When the token expires, as GitHub's `expires_at` of the token answer                                                                                                                 |
| `meta`        | `key`             | TEXT    | Primary key: the name of a value the instance keeps for itself                                                                                                                       |
|               | `value`           | TEXT    | The value as text                                                                                                                                                                    |

- `settings` holds the owner's choices: the language, the time zone, the quiet hours, the enabled rules, the
  update notice, the Telegram chat id and the active delivery channel (`delivery_channel`, below). The notification settings are fifteen rows with these keys and formats;
  an absent row, or a value that does not fit its format, reads as the default of that row alone (code:
  `settingsFromStored` in `src/settings.ts`), and the fifteen rows are written in one batch:

| Key                     | Value                                                                                                                                                                                                                                                                                                 | Default |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `notification_language` | `en` or `de`                                                                                                                                                                                                                                                                                          | `en`    |
| `time_zone`             | a name of `Intl.supportedValuesOf("timeZone")` of the runtime, or `UTC` (exact, case-sensitive)                                                                                                                                                                                                       | `UTC`   |
| `quiet_hours`           | `off`, or `<start>-<end>` with two different `HH:MM` times (24-hour, `00:00` to `23:59`)                                                                                                                                                                                                              | `off`   |
| `rule_<id>`             | `on` or `off`, for each of `pull_request_opened`, `pull_request_ready_for_review`, `pull_request_review_requested`, `ci_failed_default_branch`, `ci_failed_pull_request`, `dependabot_alert`, `code_scanning_alert`, `secret_scanning_alert`, `issue_opened`, `issue_comment`, `pull_request_comment` | `on`    |
| `update_notice`         | `on` or `off`                                                                                                                                                                                                                                                                                         | `on`    |

The quiet hours are one row: switching them off stores `off` and drops the times. Consumers read them only
through `readNotificationSettings` or `settingsFromStored`, as `quietHours` (start inclusive, end exclusive).
The runtime of this repository (the Workers test pool) lists 418 names and does not list `UTC`, which is
therefore added; aliases such as `US/Pacific` are accepted or rejected exactly as the runtime's list says.

- The `settings` key `telegram_chat_id` holds the decimal text of the Telegram chat id (negative for a group). Only
  the setup wizard writes it, and only after the owner typed back the code of a successful test message
  ([Setup wizard](setup-wizard.md#telegram-chat)); a stored value that is not a chat id counts as no chat.
- The three `secrets` rows of the GitHub App are written together, in one transaction, by the setup wizard's GitHub App step
  ([Setup wizard](setup-wizard.md#github-app)): `github_app_id` holds the decimal App ID, `github_private_key` the
  private key as a PKCS#8 PEM and `github_webhook_secret` the webhook secret as GitHub generated it. The Worker
  secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` take precedence over the stored value
  of the same credential.
- The `secrets` row `telegram_bot_token` holds the Telegram bot token as the owner entered it. It is written on its own
  by the setup wizard's Telegram step, only after the token matched the bot token form and Telegram accepted it, and
  replaces an earlier value; _Remove token_ deletes it ([Setup wizard](setup-wizard.md#the-bot-token)). The Worker
  secret `TELEGRAM_BOT_TOKEN` takes precedence over it whenever it is set. A stored value that decrypts but is not of
  the bot token form is treated as damaged and never used.
- `token_cache` holds at most one row per installation id: the installation token of the GitHub API client and its
  expiry ([GitHub API](github-api.md#installation-tokens)). A new token for an installation replaces its row (an
  upsert on `installation_id`, without the key check guard of the credential writes: a token can always be requested
  again). A row that does not decrypt, or whose token is not of the allowed form, is treated as no cached token and
  replaced by the next token. The row of a token GitHub refused is deleted only while it still has the IV of that
  token, so a row another call replaced in between stays. Expired rows and rows of an earlier app's installations
  are not removed by these reads and writes; the cleanup of the cron deletes every row whose `expires_at` has passed
  ([Scheduled jobs](scheduled-jobs.md#cleanup)).
- `outbox.text` needs no migration for the JSON form: the column is `TEXT NOT NULL` since the first migration, and
  the first character tells the two forms apart (`{` or `<b>`). A row whose `text` starts with `{` but does not decode,
  or is not text, is read as damaged and ends `failed` after five attempts; it never stops the other rows.
- `delivery_channel` is the id of the active delivery channel (`telegram`, lowercase letters, digits and hyphens, at
  most 32 characters). It is written alone by the _Activate_ form of the start page, never by the settings form; an
  absent or unknown value reads as `telegram` ([Notifications](notifications.md#delivery-channels)). The credentials of
  a channel are `secrets` rows (`ChannelSecretName`, today `telegram_bot_token`).
- An `outbox` row is written `pending` and changed only while it is still `pending`: to `sent` when the active channel accepted
  it, to `failed` by its fifth failed attempt or, for a row that already holds 5 or more attempts, by the retry of the
  cron ([Scheduled jobs](scheduled-jobs.md#retry)). A `pending` row is never deleted; `sent` and `failed` rows are
  deleted 30 days after they were written, `deliveries` rows 7 days after they were received
  ([Scheduled jobs](scheduled-jobs.md#cleanup)).
- `meta` holds the last notified release (`notified_release`, below), the time of the last delivery, the key check value
  (`key_check`, below), the GitHub App's slug and owner and the setup login's failed-attempt count (`login_attempts`, format
  and rules in [Setup wizard](setup-wizard.md#failed-attempts-and-the-lock)).
- The `meta` row `last_delivery` is the time of the last received webhook delivery, as decimal milliseconds since
  1970-01-01 UTC matching `^(0|[1-9]\d{0,15})$` and at most `8640000000000000` (the latest time a JavaScript `Date`
  holds); a value that does not fit counts as no delivery. The webhook processing writes it, in the same transaction as the `deliveries` and `outbox` rows
  of a new delivery ([Notifications](notifications.md#processing-a-delivery)); the setup wizard only reads it.
- The `meta` row `github_app_slug` is `<appId>:<slug>`: `<appId>` the decimal App ID, `<slug>` matching
  `^[a-z0-9-]{1,100}$`. It is plain text (a slug is public) and is written by the GitHub App step after the three
  credentials were stored; it counts only for the App ID in its value, any other value reads as absent.
- The `meta` row `github_app_owner` is `<appId>:<ownerId>:<type>:<login>`: `<appId>` the decimal App ID, `<ownerId>`
  the owner account's numeric id (a decimal safe integer from 1, no leading zero), `<type>` exactly `User` or
  `Organization` and `<login>` a GitHub account name (1 to 39 characters, letters, digits and inner hyphens). It is
  plain text (an owner is public) and counts only for the App ID in its value; a value with any other form, App ID or
  part reads as absent. The GitHub App step writes it after the credentials were stored (a failed write is dropped and
  the app is created anyway), and the status page replaces it when GitHub's answer for the same App ID names another
  owner. The rules compare the owner by its numeric id, never by the login ([Notifications](notifications.md#the-sender)).
  The reset keeps it, like the slug.
- The `meta` row `notified_release` is the newest Seluna release the release check reported, as `A.B.C` (each part a
  whole number from 0 to 999,999,999 without leading zeros). Only the release check writes it, in one transaction
  with the notice's `outbox` row and only while it still holds the value read before, and never lowers it; a value of
  another form counts as none ([Scheduled jobs](scheduled-jobs.md#release-check)). The reset keeps it.
- Wrangler keeps its own record of the applied migrations in the table `d1_migrations`; no Seluna code reads or
  writes it.
- The setup login reads the table names from `sqlite_master` after a failed D1 access to tell a database without its
  tables from another failure ([Setup wizard](setup-wizard.md#login)); the list of the schema's tables sits beside
  the store modules (`src/store/schema.ts`) and a test pins it to the migrations.

### Encryption

- Nothing secret is kept in D1 in plain text: the GitHub App credentials and the Telegram bot token (`secrets`) and
  the installation tokens (`token_cache`) are stored only encrypted.
- Everything else is plain text on purpose, so a reader of the database sees it: `settings` (including the
  Telegram chat id), `deliveries`, `meta` apart from the key check value, and the `outbox` rows, whose `text` (the JSON notification or Telegram HTML) and
  `button_url` name repositories, pull request titles and branches, also of private repositories. None of these
  grants access to anything.
- A value is encrypted with AES-256-GCM under a random 12-byte IV drawn for every single write, with the default
  16-byte tag. The plaintext is the UTF-8 encoding of the value. IV and ciphertext are stored as standard base64
  with padding.
- The key is derived with HKDF-SHA256 from the UTF-8 bytes of the Worker secret `SELUNA_SECRET`; salt and info
  are both the UTF-8 bytes of `seluna/secrets/v1`. The key never leaves the Worker's memory and is never stored.
- The key is used only for the values in D1. Any other key taken from `SELUNA_SECRET` is derived with an HKDF
  info of its own, never this one: the setup login's session and CSRF keys use `seluna/setup-session/v1` and
  `seluna/setup-csrf/v1` as salt and info ([Setup wizard](setup-wizard.md#session)); the Telegram chat proof's key uses
  `seluna/setup-telegram/v1` ([Setup wizard](setup-wizard.md#chat-proof)); the GitHub manifest flow's state key uses
  `seluna/setup-github/v1` ([Setup wizard](setup-wizard.md#github-app)).
- Each value is bound to its place as additional authenticated data, the UTF-8 bytes of:
  - `secrets/<key>` for a row of `secrets`;
  - `token_cache/<installation_id>/<expires_at>/<permissions>` for a row of `token_cache`, the two numbers in decimal
    without leading zeros, as JavaScript's `String()` writes an integer, and `<permissions>` the permission list the
    token was requested with as `name=level` pairs sorted by name and joined by commas
    (`metadata=read,pull_requests=read`). Because `expires_at` and the list are part of it, a row whose expiry was
    changed afterwards, and every row written for another list, does not decrypt and is treated like a missing
    token ([GitHub API](github-api.md#installation-tokens));
  - `meta/key_check` for the key check value.

  A ciphertext copied into another row does not decrypt there.

- `SELUNA_SECRET` counts as configured only when it is a string of at least 32 characters (Unicode code points,
  so a character outside the Basic Multilingual Plane counts once); the value is used as it is, without trimming.
  The only way the code obtains the key is from the Worker environment, through the same check, so no caller can
  derive a key from a shorter secret.
- Without a configured `SELUNA_SECRET` there is no key: nothing is encrypted or decrypted and nothing is written.
  The setup wizard refuses to start ([Setup wizard](setup-wizard.md#paths)), and a component that needs a credential from D1 cannot read it
  and answers as if the credential were missing — the webhook answers 503 without a body, as it does today
  without a webhook secret ([HTTP routes](http-routes.md)).

### Key check

- `meta` row `key_check` holds `<iv>.<ciphertext>`, both base64: the text `seluna/key-check/v1` encrypted as
  above with the additional data `meta/key_check`.
- The first credential written stores the key check value in the same transaction as the credential. Later
  writes leave it unchanged. The bot token is a credential like the GitHub App's: it is written, read and reset
  under the same key check value, and whichever credential is written first stores it.
- Deleting one credential (`deleteSecret`, today only the Telegram step's _Remove token_) deletes the row and, in the
  same batch, the `key_check` row when no `secrets` row is left, whatever its value. So the key check value exists
  exactly while a credential does: removing the last credential leaves no key check behind that a later
  `SELUNA_SECRET` change would report as **secret changed**. A write that checked the deleted value finds it gone,
  is not applied and is tried once more from the check, which then writes a new key check value with the credential.
- Before a credential is read or written, the key check value is decrypted with the current key:

| Key check value                          | Read of a stored credential | Write of a credential        |
| ---------------------------------------- | --------------------------- | ---------------------------- |
| decrypts to `seluna/key-check/v1`        | the value                   | stored                       |
| well-formed, but does not decrypt        | **secret changed**          | **secret changed**, no write |
| absent, and `secrets` is empty           | **missing** (none stored)   | stored, key check written    |
| absent, but `secrets` holds a credential | **corrupt**                 | **corrupt**, no write        |
| malformed, or decrypts to another text   | **corrupt**                 | **corrupt**, no write        |

- The key check value is well-formed when it is a text with exactly one `.`, the part before it is 16 base64
  characters (a 12-byte IV) and the part after it is standard base64 with padding of at least 24 characters (at
  least the 16-byte tag); anything else is malformed. A well-formed value that does not decrypt was sealed under
  another `SELUNA_SECRET` or was altered afterwards; AES-GCM cannot tell the two apart, so both report
  **secret changed**.

- Reading a credential that was never stored reports **missing**, without looking at the key check value.
- A stored credential whose own ciphertext does not decrypt (altered, copied from another row, malformed
  base64 or IV, a plaintext that is not valid UTF-8) reports **corrupt**.
- A credential is only written while the key check value in the database is still the one checked before the
  write (or, for the first credential, the one written in the same transaction). If another write or a reset
  changed it in between, the write is not applied and is tried once more from the check; the second attempt
  reports what it finds (stored, **secret changed** or **corrupt**). So no credential is ever stored without a
  key check value that covers it: two first writes under the same `SELUNA_SECRET` both succeed, and a first
  write under another `SELUNA_SECRET` at the same moment reports **secret changed** and writes nothing.
- The three credentials of the GitHub App are written in **one batch** in which every statement is guarded by the
  checked key check value, so either all three are stored or none. The write counts as stored only when each of the
  three upserts changed one row (the key check insert of a first write is not counted); any other result is tried
  once more from the check and then reported as **corrupt**, with nothing of the three left half written by the
  attempt.
- `checkKey` reports the same states: **corrupt** for an absent key check value beside a stored credential (it used
  to report _unset_, after which every write failed), **unset** only while `secrets` is empty.
- **Secret changed** is the dedicated result the setup wizard shows; its remedy is a reset that clears the
  stored credentials, the installation tokens and the key check value and runs the setup again. **Corrupt** leads
  to the same reset.
- The reset (`resetCredentials`) is needed when the key check value is **secret changed** or **corrupt**, when it is
  absent beside a stored credential, or when a stored credential does not decrypt under a matching key check value
  (`needsReset`). It reads the key check value (as SQLite's `quote()` text), every `secrets` row and the secrets
  fingerprint (`quote(key) || ':' || quote(iv)` of every row in key order, computed by SQLite) in one batch, decides
  from what it read and then runs one batch of three deletes in this order: (1) `token_cache` and (2) `secrets`,
  each only while the key check value and the fingerprint are still the ones read; (3) the `key_check` row, only
  while its value is the one read and no `secrets` row is left. Each statement sees the changes of the earlier ones,
  which is why the shared guard stands only on the first two. Every credential write draws a new IV, so a write
  between the read and the delete, also one that keeps the key check value, changes the fingerprint: the first two
  deletes remove nothing, the rows stay, and the third finds `secrets` not empty and removes nothing. The reset
  answers _reset_ whether or not the guarded batch deleted rows. Because it deletes every `secrets` row, a saved
  Telegram bot token goes with the GitHub App credentials; a bot token row that alone does not decrypt makes the
  reset needed too, although the Telegram step can also replace or remove it. It keeps the settings, the other `meta` rows (the
  Telegram chat is a setting) and `login_attempts`.
  The reset always creates new GitHub App credentials and never stores old ones again: D1's Time Travel keeps
  earlier states of the database, including the deleted rows, for a while after the reset (Cloudflare documents
  up to 30 days). The same holds for a removed or replaced bot token; a token that may have leaked is revoked at
  @BotFather.

## Limits and errors

- None of the results above carries the value, the key, the IV or the ciphertext, and nothing in this area is
  logged.
- A value is limited only by D1's own row size limit; the credentials are a few kilobytes at most.

## Related decisions

- [`decisions/0007-github-app-credentials-encrypted-in-d1.md`](../decisions/0007-github-app-credentials-encrypted-in-d1.md)
  — credentials and installation tokens encrypted in D1, the key derivation, the binding to the row and the key
  check.
- [`decisions/0017-github-app-manifest-flow.md`](../decisions/0017-github-app-manifest-flow.md) — the three
  credentials written in one batch by the manifest flow, and the Worker secrets that take precedence.
- [`decisions/0026-github-app-authentication-and-installation-tokens.md`](../decisions/0026-github-app-authentication-and-installation-tokens.md)
  — one cached token per installation, written without the key check guard, deleted by IV after a 401.
- [`decisions/0036-telegram-bot-token-in-the-setup-wizard.md`](../decisions/0036-telegram-bot-token-in-the-setup-wizard.md)
  — the Telegram bot token as an encrypted credential in `secrets`, under the same key check and reset.
- [`decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md`](../decisions/0038-channel-neutral-outbox-and-active-delivery-channel.md)
  — the notification as JSON in `outbox.text` without a migration, the setting `delivery_channel`.
- [`decisions/0014-d1-schema-and-data-access.md`](../decisions/0014-d1-schema-and-data-access.md) — one schema
  migration for all tables, data access only through `src/store/`, times in milliseconds, text columns for
  encrypted values, migrations frozen once on `main`.

## Not here

- How and when migrations are applied to an instance's database: [Deployment](deployment.md#d1-database).
- What each setting means and how the setup wizard writes it: [Setup wizard](setup-wizard.md).
- The jobs that resend, mark `failed` and remove rows and the release check that writes `notified_release`:
  [Scheduled jobs](scheduled-jobs.md).
