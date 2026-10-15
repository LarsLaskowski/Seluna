# HTTP routes

## Scope

The public HTTP surface of the Worker: which method and path combinations answer, with which status and body,
how large a request body may be, and what is logged per request. GitHub (the webhook), monitoring (the health
check) and the owner's browser (the setup wizard) rely on it; every route below builds on these rules, and so
does the setup wizard under `/setup`.

## Behavior

### Routes

| Method and path      | Status                              | Body                                                                           |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `GET /health`        | 200                                 | JSON `{"status":"ok","version":"<version>"}`, `Content-Type: application/json` |
| `POST /webhook`      | 202                                 | empty (valid signature)                                                        |
| `POST /webhook`      | 401                                 | empty (missing or wrong signature)                                             |
| `POST /webhook`      | 503                                 | empty (no webhook secret configured)                                           |
| `/setup`, `/setup/…` | see [Setup wizard](setup-wizard.md) | see [Setup wizard](setup-wizard.md)                                            |
| anything else        | 404                                 | empty                                                                          |

- A route matches on the exact method and the exact path; the query string is ignored. `HEAD /health`,
  `POST /health`, `GET /webhook`, `/health/` and `/HEALTH` are "anything else".
- `<version>` is the `version` of `package.json` at the time the Worker was built. It is fixed into the bundle
  at build time and never read from a file or a setting at runtime.
- `/setup` and every path that starts with `/setup/`, with any method, belong to the setup wizard, which answers
  them as [Setup wizard](setup-wizard.md) describes; `/setupx`, `/SETUP` and `/setup%2F` are "anything else".

### Webhook signature

- `POST /webhook` is processed in this order: the body size limit (below), then the webhook secret, then the
  signature. 413 and 400 therefore answer before 503 and 401.
- The accepted signature is exactly `X-Hub-Signature-256: sha256=` followed by 64 lowercase hex digits of the
  HMAC-SHA256 of the raw body bytes as received, under the webhook secret. It is compared in constant time
  (`crypto.subtle.verify`). Any other form (uppercase digits or prefix, another length, another algorithm, two
  joined values, an empty value) answers 401.
- `X-Hub-Signature` (SHA-1) is ignored: a delivery that carries only that header is unsigned and answers 401.
- The secret is the `GITHUB_WEBHOOK_SECRET` Worker secret, used verbatim (surrounding whitespace is part of it).
  An absent, empty or non-string value counts as not configured and answers 503, also for a validly signed
  request; a secret source that fails answers 503 as well.
- A 202 has no further effect yet; processing of the event follows in a later change.

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
- A route that reads no body (`GET /health`, every 404) never reads it, so its size does not matter there. Under
  `/setup` only the form submissions `POST /setup/login` and `POST /setup/logout` read a body, with this limit.

### Logging

- Every request produces exactly one log entry, written once the status is known, with three fields: the
  method, the path and the status. The entry of `POST /webhook` additionally holds `delivery` (the
  `X-GitHub-Delivery` value when it matches `^[0-9A-Za-z-]{1,64}$`) and `event` (the `X-GitHub-Event` value when
  it matches `^[a-z_]{1,64}$`), each `null` otherwise.
- The path is the URL path without the query string and without the fragment. Request bodies, signatures, query
  strings and headers other than the two values above are never logged.

## Limits and errors

- A body that cannot be read to the end (the client aborts, the stream fails) answers **400** with an empty body.
- Outside `/setup`, 404, 413, 400, 401 and 503 never carry a body, so no response reveals a reason, the
  configuration or a secret. Under `/setup` 404, 413 and 400 carry no body either; the pages the wizard answers
  with carry fixed texts only ([Setup wizard](setup-wizard.md#limits-and-errors)).

## Related decisions

- [`decisions/0011-public-http-surface.md`](../decisions/0011-public-http-surface.md) — the version fixed at
  build time from `package.json`, the body limit only on routes that read a body, and what a request log entry
  holds.
- [`decisions/0012-webhook-signature-verification.md`](../decisions/0012-webhook-signature-verification.md) — the
  accepted signature form, the check order and the secret source.

## Not here

- Webhook event processing: a later change to `POST /webhook`
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md#webhook-to-telegram)).
- The setup wizard and its login under `/setup`: [Setup wizard](setup-wizard.md).
