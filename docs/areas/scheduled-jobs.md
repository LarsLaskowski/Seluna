# Scheduled jobs

## Scope

What the Worker does when a cron trigger calls it: resending `pending` `outbox` rows and marking them `failed` after
the fifth attempt, deleting old rows, and the daily check for a new Seluna release with its notice. The owner relies
on it to get a message once Telegram is reachable again, to keep the database small and to hear about new releases;
the operator relies on its log entries.

## Behavior

### Schedules

| Expression     | Jobs, in this order |
| -------------- | ------------------- |
| `*/10 * * * *` | cleanup, then retry |
| `17 5 * * *`   | release check       |

- The expression of the trigger is compared character for character with these two; any other expression (the owner
  changed `triggers.crons`) runs no job and writes one log entry, `{ job: "schedule", result: "unknown" }`.
- A run reads the clock once when it starts; every time bound below is computed from that reading. Quiet hours are
  still decided by a clock reading per row, at its send ([Notifications](notifications.md#quiet-hours)).
- The jobs of one run fail independently: a failure in the cleanup does not keep the retry from running, and the
  other way round. Every job catches its own failures; the run itself never fails.

### Retry

1. At most 10 rows that are `pending` with 5 or more attempts, oldest first (by `created_at`, then `id`), are set
   `failed` in one statement, without a send. Each writes the log entry `{ outbox: <id>, status: "failed" }`.
2. The rows to send are at most 10 rows that are `pending`, have fewer than 5 attempts and were written more than one
   minute (60,000 ms) before the run started, oldest first (by `created_at`, then `id`). A younger row is left to its
   first send, which may still be running.
3. Without such a row the job ends; otherwise the notification settings are read and the rows are sent one after the
   other through the sending rules of a first send ([Notifications](notifications.md#sending-a-row)): the same bot
   token and chat, quiet hours at each send, the button label in the language at sending, one wait after a 429, one
   log entry per row.
4. An attempt that fails and is the row's fifth sets the row `failed` in the same update that counts it, and writes
   the log entry `{ outbox: <id>, status: "failed" }` after the row's own entry. The row is never sent again.
5. Without a usable bot token or chat no attempt is counted and no row is marked `failed`; the rows wait for the
   setup. A failed read of the saved bot token or the chat logs `store-failed` per row, as for a first send.

- A failed statement in steps 1 to 3 (marking, reading the rows, reading the settings) ends the job and writes
  `{ job: "retry", result: "store-failed" }`.
- Rows are not claimed: two runs at the same time may send one row twice (at least once, never lost).
- A message whose first send fails is tried by the first send and then by up to four runs, so an outage of more than
  about 40 minutes leaves its rows `failed`.

### Cleanup

One batch of three deletes, all applied or none:

| Table         | A row is deleted when                                                                          | Order of deletion                    |
| ------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| `deliveries`  | `received_at` is more than 7 days (604,800,000 ms) before the run started                      | `received_at`, then `id`             |
| `outbox`      | `status` is `sent` or `failed` and `created_at` is more than 30 days (2,592,000,000 ms) before | `created_at`, then `id`              |
| `token_cache` | `expires_at` is before the run started                                                         | `expires_at`, then `installation_id` |

- Each delete removes at most 1,000 rows per run, the oldest first; a larger backlog goes over the next runs.
- A row exactly on its bound stays. A `pending` row is never deleted, whatever its age. No other table or `meta` row
  is touched.
- A failed batch deletes nothing and writes `{ job: "cleanup", result: "store-failed" }`; a successful one writes no
  entry.

### Release check

The daily run, step by step; the first step that decides ends it with exactly one log entry
`{ job: "release-check", result: <result> }`:

1. The notification settings are read. A failure: `store-failed`. With the update notice off nothing else happens —
   no request, nothing read or written: `off`.
2. The running version is the `version` of `package.json`, fixed when the Worker was built. It must have the form
   `A.B.C`, each part a whole number from 0 to 999,999,999 written without leading zeros (`0` itself allowed);
   otherwise: `invalid-version`.
3. The remembered version (`meta` `notified_release`) is read. A failure: `store-failed`.
4. One request: `GET https://api.github.com/repos/LarsLaskowski/Seluna/releases/latest`, the repository fixed in the
   code, with `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` and
   `User-Agent: seluna/<running version>`, and no `Authorization` header or other credential. Redirects are not
   followed, the request including its body is aborted after 10 seconds, and the answer is read up to 1 MiB, counted
   before decoding.
5. The answer decides:

   | Answer                                                                                         | Result        |
   | ---------------------------------------------------------------------------------------------- | ------------- |
   | 404                                                                                            | `no-release`  |
   | any other status outside 2xx, a redirect included (its body is not read)                       | `refused`     |
   | a network error, the timeout, a body over 1 MiB or not valid JSON                              | `unavailable` |
   | 2xx, but not a JSON object, without a string `tag_name`, or a `tag_name` not of the form below | `malformed`   |

   `tag_name` must be exactly `v` and a version of the form of step 2 (`v0.5.0`; not `v0.5`, `v0.5.0-rc.1`,
   `0.5.0`, `v01.5.0`, `V0.5.0`, nor with a space or another character before, inside or after it). No other field
   of the answer is read.

6. Versions compare part by part as numbers (`0.10.0` is newer than `0.9.0`). A latest release not newer than the
   running version: `current`. A remembered value of the form of step 2 that is not older than the latest release:
   `known`; a remembered value of another form counts as none.
7. The notice is written in one transaction: an `outbox` row (the message below, `silent` 0, written at the run's
   time) and `notified_release` set to the latest version — both only while `notified_release` still holds the value
   read in step 3 (or is still absent). When another run changed it in between, neither is written: `known`. A
   failure: `store-failed`, nothing written; the next daily run tries again.
8. The row is sent at once through the sending rules of a first send; a failed send leaves it to the retry. Result:
   `reported`.

- The remembered version is never lowered: a latest release older than it (a deleted release) changes nothing.
- Without a bot token or chat the notice is written and the version remembered; the row waits for the setup.
- A release published by hand without the pre-release flag is the latest before the release workflow verified it
  ([`CONTRIBUTING.md`](../CONTRIBUTING.md#versioning-and-releases)) and is reported like any other.

### Release message

| Language | Line 1 (title in bold, then `·` and the repository) | Line 2                                                               | Button              |
| -------- | --------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| English  | **New Seluna release** · LarsLaskowski/Seluna       | `Version <latest> is available; this instance runs <running>.`       | _Open on GitHub_    |
| German   | **Neue Seluna-Version** · LarsLaskowski/Seluna      | `Version <latest> ist verfügbar; diese Instanz läuft mit <running>.` | _Auf GitHub öffnen_ |

- `<latest>` and `<running>` are written as `A.B.C` from the parsed numbers. The button opens
  `https://github.com/LarsLaskowski/Seluna/releases/tag/v<latest>`, built from the same numbers.
- The text is in the notification language when the row is written; the button label follows the language at
  sending, as for every row ([Notifications](notifications.md#languages)).

### Log entries

- Per run at most one entry per job: `{ job: "retry" | "cleanup", result: "store-failed" }` on a failure only,
  `{ job: "release-check", result }` on every daily run, `{ job: "schedule", result: "unknown" }` for an unknown
  expression.
- Per row marked `failed`: `{ outbox: <id>, status: "failed" }`. Per row sent: the entry of
  [Notifications](notifications.md#log-entries).
- No entry holds a message text, a chat id, a token, a release text, a GitHub or Telegram answer, an error text or
  the expression of an unknown schedule.

## Limits and errors

- Per run of the 10-minute schedule at most 17 D1 statements and 20 Telegram requests; per daily run at most 6 D1
  statements, one GitHub request and 2 Telegram requests — inside the free plan's 50 subrequests per invocation. A
  run of the retry ends within about 4 minutes (10 rows of at most two 10-second requests and a 5-second wait), well
  inside the 15 minutes a cron invocation may take.
- Residual risks, accepted:
  - GitHub limits requests without credentials per outgoing address, which Workers share; a refused check is tried
    again only the next day, so a notice can come a day or more late.
  - A Telegram outage of more than about 40 minutes leaves its rows `failed`; they are not resent.
  - Two runs at the same time (a trigger delivered twice) may send one row twice.
  - Without a bot token or chat, `pending` rows are never deleted and each run logs `no-token` or `no-chat` for its
    10 oldest rows (about 1,440 entries a day); the backlog arrives oldest first once the setup is fixed.
  - A release published by hand without the pre-release flag can be reported before its checks ran.
  - The release reader rests on one captured answer; a different answer fails closed (no notice, one log entry).
  - A `deliveries` row is deleted after 7 days, so the guarantee that a delivery is processed once holds within that
    time ([Notifications](notifications.md#processing-a-delivery)). GitHub redelivers only within 3 days, but a
    captured, validly signed delivery replayed later (the signature carries no time) is processed again and can send
    one duplicate message. Nothing else is written and no data leaves the instance.

## Related decisions

- [`decisions/0029-outbox-retry-and-cleanup-by-the-cron.md`](../decisions/0029-outbox-retry-and-cleanup-by-the-cron.md)
  — the retry through the first send's path, `failed` in the counting update, 10 rows and 1,000 deletes per run, the
  retention, no claim.
- [`decisions/0030-release-notice-without-credentials.md`](../decisions/0030-release-notice-without-credentials.md)
  — the unauthenticated release check, only `tag_name` in a strict form, the notice and the remembered version in one
  guarded batch, nothing read while the switch is off.
- [`decisions/0008-delivery-through-a-d1-outbox.md`](../decisions/0008-delivery-through-a-d1-outbox.md) — the outbox
  and the at-least-once delivery.

## Not here

- The cron triggers in `wrangler.jsonc`: [Deployment](deployment.md#cron-triggers).
- Sending a row, the message format and the per-row log entry: [Notifications](notifications.md).
- The tables, the `meta` row `notified_release` and the switch `update_notice`: [Storage](storage.md).
- GitHub calls made as the app: [GitHub API](github-api.md).
- Applying a release to the user's copy: [Deployment](deployment.md#update).
