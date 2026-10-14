# HTTP routes

## Scope

The public HTTP surface of the Worker: which method and path combinations answer, with which status and body,
how large a request body may be, and what is logged per request. GitHub (the webhook), monitoring (the health
check) and the owner's browser (the setup wizard) rely on it; every route below builds on these rules.

## Behavior

### Routes

| Method and path | Status | Body                                                                           |
| --------------- | ------ | ------------------------------------------------------------------------------ |
| `GET /health`   | 200    | JSON `{"status":"ok","version":"<version>"}`, `Content-Type: application/json` |
| `POST /webhook` | 202    | empty                                                                          |
| anything else   | 404    | empty                                                                          |

- A route matches on the exact method and the exact path; the query string is ignored. `HEAD /health`,
  `POST /health`, `GET /webhook`, `/health/` and `/HEALTH` are "anything else".
- `<version>` is the `version` of `package.json` at the time the Worker was built. It is fixed into the bundle
  at build time and never read from a file or a setting at runtime.
- `POST /webhook` reads the request body (subject to the size limit below) and does nothing else with it yet;
  signature verification and processing follow in later changes.
- `/setup` and every path below it are reserved for the setup wizard and answer 404 until the wizard exists.

### Request body size

- A route that reads a request body accepts at most **1 MiB (1,048,576 bytes)**. A body of exactly 1,048,576
  bytes is accepted; one byte more answers **413** with an empty body.
- The limit counts the bytes of the body as the Worker receives them, before any text or JSON decoding.
- A `Content-Length` header that is a plain decimal number above the limit is rejected with 413 before any byte
  of the body is read. Every other `Content-Length` value (absent, not a plain decimal number, a list of values)
  leaves the decision to the counted body.
- The body is always counted while it is read, whatever `Content-Length` says: a missing, malformed or too small
  header does not bypass the limit. Reading stops as soon as the count exceeds the limit; the rest of the body is
  never read.
- A route that reads no body (`GET /health`, every 404) never reads it, so its size does not matter there.

### Logging

- Every request produces exactly one log entry, written once the status is known, with exactly three fields:
  the method, the path and the status.
- The path is the URL path without the query string and without the fragment. Request bodies, headers and query
  strings are never logged.

## Limits and errors

- A body that cannot be read to the end (the client aborts, the stream fails) answers **400** with an empty body.
- 404, 413 and 400 never carry a body, so no response reveals a reason, the configuration or a secret.

## Related decisions

- [`decisions/0011-public-http-surface.md`](../decisions/0011-public-http-surface.md) — the version fixed at
  build time from `package.json`, the body limit only on routes that read a body, and what a request log entry
  holds.

## Not here

- Webhook signature verification and event processing: later changes to `POST /webhook`
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md#webhook-to-telegram)).
- The setup wizard and its login under `/setup` ([`ARCHITECTURE.md`](../ARCHITECTURE.md#components)).
