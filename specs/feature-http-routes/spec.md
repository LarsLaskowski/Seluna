# Spec: HTTP routes: health, webhook, not found, payload too large

Status: Approved by Lead

Source: Issue #4

## Problem / motivation

The Worker is a public URL. Today it answers every request with 404 and the text `Not Found`
(`src/index.ts`). Monitoring needs a health check that reports the running version, GitHub needs a webhook
endpoint to deliver to (#5 adds the signature check, later issues the processing), and everything else
should expose as little as possible. Large bodies must not be able to exhaust the Worker's memory, whether or
not the client sends an honest `Content-Length`.

## Behavior

- `GET /health` answers 200 with the JSON `{"status":"ok","version":"<version>"}`, where `<version>` is the
  `version` of `package.json` fixed into the bundle at build time.
- `POST /webhook` answers 202 with an empty body once the body has been read within the limit.
- Every other method and path, including `/setup` and everything below it, answers 404 with an empty body.
- A route that reads a body rejects one over 1 MiB (1,048,576 bytes) with 413 and an empty body: early on a
  `Content-Length` above the limit, and in every case by counting the bytes while reading.
- A body that cannot be read to the end answers 400 with an empty body.
- Each request writes one log entry with the method, the path without query string, and the status; never a
  body, a header or a query string.

The normative statement is the area document [`docs/areas/http-routes.md`](../../docs/areas/http-routes.md).

## Acceptance criteria

- [ ] AC1: `GET /health` answers 200, `Content-Type: application/json`, body `{"status":"ok","version":"<v>"}`
  with `<v>` the `package.json` version.
- [ ] AC2: The version is fixed at build time: the bundle holds it as a string literal and no other
  `package.json` field.
- [ ] AC3: `POST /webhook` with a body of at most 1,048,576 bytes (none, small, exactly the limit) answers 202
  with an empty body.
- [ ] AC4: Every other method and path (including `/setup`, `/setup/...`, `HEAD /health`, `POST /health`,
  `GET /webhook`, `/health/`) answers 404 with an empty body.
- [ ] AC5: A body over 1,048,576 bytes answers 413 with an empty body — with a `Content-Length` above the limit
  (before reading), without any `Content-Length`, and with a `Content-Length` that understates the body;
  reading stops once the limit is exceeded.
- [ ] AC6: A body stream that fails while being read answers 400 with an empty body.
- [ ] AC7: Each request is logged once as exactly `{ method, path, status }`, the path without query string.
- [ ] AC8: The area document, `docs/ARCHITECTURE.md`, `.squad/project.md`, `docs/CONTRIBUTING.md` and
  `CHANGELOG.md` describe the new behavior.

## Out of scope

- Webhook signature verification and the 401/503 answers (#5), event processing (later issues).
- The setup wizard and its login (#8 and following).
- `HEAD` support for `/health`.

## Open questions

None. The Lead decided the readings the issue left open (1 MB as 1 MiB, the limit only on routes that read a
body, 400 for an unreadable body, the path without query in logs) in
[decision 0011](../../docs/decisions/0011-public-http-surface.md).
