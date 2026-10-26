# HTTP routes

## Scope

The public HTTP surface of the Worker: which method and path combinations answer, with which status and body,
how large a request body may be, and what is logged per request. GitHub (the webhook), monitoring (the health
check) and the owner's browser (the setup wizard) rely on it; every route below builds on these rules, and so
does the setup wizard under `/setup`.

## Behavior

### Routes

| Method and path      | Status                              | Body                                                                                                              |
| -------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /health`        | 200                                 | JSON `{"status":"ok","version":"<version>"}`, `Content-Type: application/json`                                    |
| `POST /webhook`      | 202                                 | empty (valid signature, delivery recorded, [Notifications](notifications.md))                                     |
| `POST /webhook`      | 200                                 | empty (valid signature, delivery id already recorded)                                                             |
| `POST /webhook`      | 400                                 | empty (valid signature, delivery that cannot be processed)                                                        |
| `POST /webhook`      | 401                                 | empty (missing or wrong signature)                                                                                |
| `POST /webhook`      | 503                                 | empty (no webhook secret usable, or reading it failed; database failure while processing)                         |
| `/setup`, `/setup/…` | see [Setup wizard](setup-wizard.md) | see [Setup wizard](setup-wizard.md)                                                                               |
| `GET /`, `HEAD /`    | 302                                 | empty, `Location: /setup`, the security headers of the [Setup wizard](setup-wizard.md#pages-and-response-headers) |
| anything else        | 404                                 | empty                                                                                                             |

- A route matches on the exact method and the exact path; the query string is ignored. `HEAD /health`,
  `POST /health`, `GET /webhook`, `/health/` and `/HEALTH` are "anything else".
- `<version>` is the `version` of `package.json` at the time the Worker was built. It is fixed into the bundle
  at build time and never read from a file or a setting at runtime.
- `/setup` and every path that starts with `/setup/`, with any method, belong to the setup wizard, which answers
  them as [Setup wizard](setup-wizard.md) describes; `/setupx`, `/SETUP` and `/setup%2F` are "anything else".
- `/` answers `GET` and `HEAD` only, with a redirect to the setup wizard; `POST /` and every other method on `/` are
  "anything else". The `Location` is always exactly `/setup`: the query string is neither carried into it nor
  logged, and no part of the request (path, query, `Host`) enters it. The redirect reads no body, no cookie, no
  secret and no D1, and sets no cookie.

### Webhook signature

- `POST /webhook` is processed in this order: the body size limit (below), then the webhook secret, then the signature, then the webhook processing ([Notifications](notifications.md)). 413 and the 400 of an unreadable body therefore answer before 503 and 401; the 200, 202, 400 and 503 of the processing answer only after a valid signature.
- The accepted signature is exactly `X-Hub-Signature-256: sha256=` followed by 64 lowercase hex digits of the
  HMAC-SHA256 of the raw body bytes as received, under the webhook secret. It is compared in constant time
  (`crypto.subtle.verify`). Any other form (uppercase digits or prefix, another length, another algorithm, two
  joined values, an empty value) answers 401.
- `X-Hub-Signature` (SHA-1) is ignored: a delivery that carries only that header is unsigned and answers 401.
- The secret is the `GITHUB_WEBHOOK_SECRET` Worker secret when it is a non-empty string, used verbatim (surrounding
  whitespace is part of it); else the webhook secret the setup wizard stored in D1 ([Storage](storage.md)), when
  `SELUNA_SECRET` is usable and the stored value reads. Neither: absent, empty or non-string Worker secret and nothing
  stored, a stored secret that cannot be read with the current `SELUNA_SECRET`, or `SELUNA_SECRET` not configured,
  counts as not configured and answers 503, also for a validly signed request; a secret source that fails (a D1
  error) answers 503 as well.
- Without `GITHUB_WEBHOOK_SECRET`, every `POST /webhook`, signed or not, reads D1 (the key check value and the stored
  secret) and decrypts the secret before the signature is checked. These reads count against the account's D1 read
  allowance. With the Worker secret set no D1 access happens. The secret is not cached; a cache would need its own
  decision.
- A 202 means the delivery was recorded; what happens next is described in [Notifications](notifications.md).

### Request body size

- A route that reads a request body accepts at most **1 MiB (1,048,576 bytes)**. A body of exactly 1,048,576
  bytes is accepted; one byte more answers **413** with an empty body.
- The limit counts the bytes of the body as the Worker receives them, before any text or JSON decoding.
- A `Content-Length` header that is a plain decimal number above the limit is rejected with 413 before any byte
  of the body is read. Every other `Content-Length` value (absent, not a plain decimal number, a list of values)
  leaves the decision to the counted body.
- The body is always counted while it is read, whatever `Content-Length` says: a missing, malformed or too small
  header does not bypass the limit. Reading stops as soon as the count exceeds the limit; the rest of the body is
  never read. An accepted body is briefly held twice while its chunks are combined, so reading one takes up to
  about 2 MiB of memory.
- A route that reads no body (`GET /health`, `GET /` and `HEAD /`, every 404) never reads it, so its size does not matter there. Under
  `/setup` only the form submissions `POST /setup/login`, `POST /setup/logout`, `POST /setup/settings`,
  `POST /setup/reset`, `POST /setup/channel/activate`, `POST /setup/channel/remove`, `POST /setup/telegram`, `POST /setup/telegram/verify`, `POST /setup/telegram/token`,
  `POST /setup/telegram/token/remove`, `POST /setup/github` and
  `POST /setup/github/callback` read a body, with this limit. The Telegram Bot API answers (`getMe`, `getUpdates`, `sendMessage`, also the 429 answer of `sendMessage`, read for its `retry_after`), through the shared HTTP code of the delivery channels ([Notifications](notifications.md#delivery-channels)), and the GitHub conversion answer read by the setup wizard are limited the same
  way, through the same reader ([Setup wizard](setup-wizard.md#telegram-chat), [GitHub
  App](setup-wizard.md#github-app)), and so are the GitHub API answers of the app's calls ([GitHub API](github-api.md#requests)) and the answer of the
  release check ([Scheduled jobs](scheduled-jobs.md#release-check)).

### Logging

- Every request produces exactly one log entry, written once the status is known, with three fields: the
  method, the path and the status. The entry of `POST /webhook` additionally holds `delivery` (the
  `X-GitHub-Delivery` value when it matches `^[0-9A-Za-z-]{1,64}$`) and `event` (the `X-GitHub-Event` value when
  it matches `^[a-z_]{1,64}$`), each `null` otherwise, and `action`, `repository` and `decision` (their patterns
  and values are in [Notifications](notifications.md#log-entries)), each `null` when the webhook processing did not
  run (401, 413, 400 of an unreadable body, 503 of the secret). Each row sent additionally writes one entry with
  its `outbox` id and `result` ([Notifications](notifications.md#log-entries)).
- The path is the URL path without the query string and without the fragment. Request bodies, signatures, query
  strings and headers other than the two values above are never logged; so the `code` and `state` of GitHub's return
  to `GET /setup/github/callback` never reach a log.

## Limits and errors

- A body that cannot be read to the end (the client aborts, the stream fails) answers **400** with an empty body.
- Outside `/setup`, 404, 413, 400, 401 and 503 never carry a body, nor does the 302 of `GET /` and `HEAD /`, so no response reveals a reason, the
  configuration or a secret. Under `/setup` 404, 413 and the 400 of an unreadable body carry no body either; the pages the wizard answers with (also the Telegram and GitHub steps' 400, 403, 409, 502 and 503) carry fixed texts only ([Setup wizard](setup-wizard.md#limits-and-errors)).

## Related decisions

- [`decisions/0011-public-http-surface.md`](../decisions/0011-public-http-surface.md) — the version fixed at
  build time from `package.json`, the body limit only on routes that read a body, and what a request log entry
  holds.
- [`decisions/0012-webhook-signature-verification.md`](../decisions/0012-webhook-signature-verification.md) — the
  accepted signature form, the check order and the secret source.
- [`decisions/0017-github-app-manifest-flow.md`](../decisions/0017-github-app-manifest-flow.md) — the secret comes
  from the Worker secret when it is set, else from D1; what that costs per delivery.
- [`decisions/0035-root-url-redirects-to-setup.md`](../decisions/0035-root-url-redirects-to-setup.md) — `GET /`
  and `HEAD /` redirect to `/setup` with a fixed, temporary redirect instead of answering 404.

## Not here

- Webhook event processing, the message format and the sending: [Notifications](notifications.md).
- The setup wizard and its login under `/setup`: [Setup wizard](setup-wizard.md).
