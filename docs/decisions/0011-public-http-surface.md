# 0011: Public HTTP surface of the Worker

- **Status:** Proposed
- **Date:** 2026-10-14
- **Area:** HTTP routes
- **Source:** Issue #4
- **Supersedes:** —

## Context

The Worker is reachable by anyone on the internet, so its surface should be as small as possible: a health
check, the webhook, and nothing else. Issue #4 asks for the version in `/health` to be injected at build time,
for request bodies over 1 MB to be rejected even when `Content-Length` is missing or wrong, and for logs that
carry method, path and status but never bodies. The release workflow already fails a tag whose `package.json`
version differs from it ([decision 0009](0009-releases-only-by-tag-push.md)), so `package.json` is the one place
the version is maintained. Deployments through Workers Builds (issue #6) run `wrangler deploy`, not
`npm run build`. Later changes put a one-time code from GitHub's manifest flow into a query string under
`/setup` (issue #10).

## Options considered

How the version reaches the Worker:

1. **Import `version` from `package.json` in the source** — the bundler (esbuild through Wrangler) inlines the
   string and drops every other field of the file; tests and every deploy path see the same value. Chosen.
2. **A `--define` flag in the `build` script** — missing whenever Wrangler is run directly (Workers Builds,
   the local dev server) and in the tests, which would need a second definition.
3. **A `vars` entry in `wrangler.jsonc`** — read at runtime, and a second copy of the version that the release
   check does not compare.
4. **A `version.ts` generated before the build** — a generated file that can go stale and that no test covers.

Where the body limit applies:

5. **Only on routes that read a body, checked against `Content-Length` and counted while reading** — an unknown
   path always answers 404 and never touches the body. Chosen.
6. **A `Content-Length` check on every request before routing** — an unknown path would answer 413 or 404
   depending on a header, and a body without the header would still need the counted read on the routes that
   read one.

The limit value:

7. **1 MiB (1,048,576 bytes)**, the usual reading of "1 MB" for request limits. Chosen. **1,000,000 bytes** would
   serve equally; both are far above the webhook payloads Seluna subscribes to.

A body that fails while being read:

8. **400 with an empty body** — an expected failure stays a value, and the request is still logged. Chosen.
9. **Let the error propagate** — the runtime answers with its generic error and no log entry is written.

What a log entry holds:

10. **Method, the URL path without query string, status** — chosen, because a query string can carry a one-time
    code (issue #10). Logging the full URL would put that code into the logs.

## Decision

`GET /health` and `POST /webhook` are the only routes; everything else answers 404 with an empty body. The
version comes from `package.json` through a source import that the bundler fixes at build time. Every route that
reads a body reads it through one bounded reader that rejects with 413 on a too-large `Content-Length` and on a
counted body over 1 MiB; each request is logged as method, path without query, and status. The resulting rules
are in the area document [`areas/http-routes.md`](../areas/http-routes.md).

## Consequences

Later routes that read a body (`POST /webhook` with its signature check in issue #5, the forms under `/setup`)
reuse the bounded reader, so the size check precedes the signature check and any parsing. The 413 on the
`Content-Length` header is an early answer only; the counted read is the guarantee. Until issue #5 `POST /webhook`
answers 202 to any request of acceptable size and has no effect, which keeps the guarantee that an unsigned
webhook stores and sends nothing. A health check by `HEAD` answers 404; supporting it would be a new route.
