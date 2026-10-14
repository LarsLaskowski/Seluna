# Plan: HTTP routes: health, webhook, not found, payload too large

Source: Issue #4 | [spec.md](spec.md)
Status: Draft
Tier: security — the change adds the public `POST /webhook` endpoint (security area *Webhook signature*), a
size guard on external input (*Parsing of external input*), a new log line of request data (*Logging of
external data*), and edits the build configuration `tsconfig.json`.

## Problem / root cause

Feature; summary of [spec.md](spec.md): the Worker gets its public routes — `GET /health` (200, JSON with the
build's version), `POST /webhook` (202), 404 with an empty body for everything else (`/setup` included), 413
for request bodies over 1 MiB checked against `Content-Length` and while reading, and one log entry per
request with method, path and status.

Claims of the issue, checked against the code:

- "Everything else → 404": the current handler already answers 404 for every request, but with the body
  `Not Found` (`src/index.ts:3`), not an empty body — **refuted for the body**, the change empties it.
- "the version is injected at build time, not read at runtime": **confirmed feasible** without a build script.
  In a scratch copy, `import { version } from "../package.json"` with `resolveJsonModule: true` passes
  `tsc --noEmit`, and `npm run build` emits `var version = "0.0.0";` in `dist/index.js` with no other field of
  `package.json` (no `devDependencies`, no `vitest`) — esbuild inlines and tree-shakes it. The same import
  resolves in the Workers test pool (the probe test read `0.0.0`). `package.json` is already the single source:
  the release workflow fails a tag that differs from its `version` (`.github/workflows/release.yml:49-58`).
  Without `resolveJsonModule` (absent from `tsconfig.json` today) the import does not type-check.
- "checked against `Content-Length` and while reading the stream, so a missing or wrong header does not bypass
  the limit": **confirmed testable** in the pool: a test can set `content-length` on a `Request` itself (probe
  read back `2000000`), and a `Request` with a `ReadableStream` or byte-array body has no `content-length`
  header (probe: `null` for both), so the header-less case is real in a unit test.
- `/setup` "reserved for the wizard (#8); until then 404": nothing exists under `/setup` — **confirmed**; no
  code branch is needed, the 404 rule covers it, tests pin it.
- The issue's acceptance criterion "Tests cover 200, 202, 404 and 413, including a body over 1 MB without
  `Content-Length`" is covered by AC1, AC3, AC4 and AC5 below.

Related defect found on the way: `docs/CONTRIBUTING.md:25` and the first `CHANGELOG.md` *Unreleased* entry say
the Worker answers every request with 404; both become untrue with this change (fixed under *Documentation
updates*).

Readings the issue leaves open, decided by the Lead in
[decision 0011](../../docs/decisions/0011-public-http-surface.md): 1 MB = 1 MiB (1,048,576 bytes, a body of
exactly that size is accepted); the limit applies to routes that read a body (only `POST /webhook` today), an
unknown path answers 404 whatever its body; a body that fails while being read answers 400; the logged path is
the URL path without query string; a route matches on exact method and path, so `HEAD /health` is 404.

## Acceptance criteria

Test names are exact; `it.each` tables give one test per row (no loops in tests). `MAX_BODY_BYTES` is
1,048,576.

- [ ] **AC1** — `GET /health` answers 200 with `Content-Type: application/json` and the body text
  `{"status":"ok","version":"<v>"}` (exactly this key order), `<v>` the injected version.
  - `src/router.test.ts`: `handleRequest answers GET /health with 200 and the status and version as JSON`
    (deps version `"1.2.3"`, asserts status, `content-type` header starting with `application/json`, and the
    body text `{"status":"ok","version":"1.2.3"}`).
  - `src/index.test.ts`: `GET /health answers with the version from package.json` (through
    `exports.default.fetch`, compares the parsed body with `{ status: "ok", version }` where `version` is
    imported from `../package.json` in the test).
- [ ] **AC2** — The version is fixed at build time: verified by the Dev before the review with *Build*
  (`npm run build`), then `grep -c 'var version = "' dist/index.js` prints `1` and
  `grep -c devDependencies dist/index.js` prints `0`; the Dev puts both outputs in its report. (Not a unit test:
  it is a property of the bundle. AC1's `index.test.ts` test pins the value.)
- [ ] **AC3** — `POST /webhook` with a body within the limit answers 202 with an empty body (`await
  response.text()` is `""`).
  - `src/router.test.ts`: `handleRequest answers POST /webhook with 202 and an empty body` (small body),
    `handleRequest answers POST /webhook without a body with 202`,
    `handleRequest answers POST /webhook with a body of exactly MAX_BODY_BYTES with 202`.
- [ ] **AC4** — Every other method and path answers 404 with an empty body.
  - `src/router.test.ts`: `it.each` `handleRequest answers $method $path with 404 and an empty body` over:
    `GET /`, `GET /anything`, `GET /setup`, `GET /setup/`, `GET /setup/app`, `POST /setup`, `HEAD /health`,
    `POST /health`, `GET /health/`, `GET /HEALTH`, `GET /webhook`, `PUT /webhook`, `POST /webhook/`.
  - `src/index.test.ts`: `an unknown path answers 404 with an empty body` (replaces the existing
    `answers every request with 404`, through `exports.default.fetch`).
- [ ] **AC5** — A body over the limit answers 413 with an empty body; the header is checked before reading,
  the body is always counted, and reading stops once the count exceeds the limit.
  - `src/body.test.ts`, `parseContentLength` — `it.each` `parseContentLength returns $expected for $value`:
    `null` → `undefined`; `"0"` → `0`; `"1048576"` → `1048576`; `"001048577"` → `1048577`;
    `"99999999999999999999"` → `1e20`; `""` → `undefined`; `"+5"` → `undefined`; `"-1"` → `undefined`;
    `"1e7"` → `undefined`; `"0x100001"` → `undefined`; `"5.0"` → `undefined`; `"5, 5"` → `undefined`.
  - `src/body.test.ts`, `readBodyWithLimit` (with a small `maxBytes` such as 8, so the tests stay cheap):
    `readBodyWithLimit returns the bytes of a body within maxBytes`,
    `readBodyWithLimit returns an empty body for a request without body`,
    `readBodyWithLimit accepts a body of exactly maxBytes`,
    `readBodyWithLimit rejects a body one byte over maxBytes without Content-Length` (a `ReadableStream` body),
    `readBodyWithLimit rejects a Content-Length over maxBytes before reading the body` (the body is a stream
    that errors when pulled; the result must be `too-large`, not `unreadable`),
    `readBodyWithLimit counts the body when Content-Length understates it` (header `"1"`, body over
    `maxBytes` → `too-large`),
    `readBodyWithLimit stops reading an endless stream once maxBytes is exceeded` (a stream whose `pull`
    enqueues a chunk on every call and never closes; asserts `too-large`, that the stream's `cancel` was
    called, and that `pull` ran at most `maxBytes / chunkSize + 3` times — the `+ 3` allows for the stream's
    read-ahead; a different fixed bound is fine if the Tester reports why).
  - `src/router.test.ts`, with the real `MAX_BODY_BYTES`:
    `handleRequest answers 413 for a webhook with Content-Length over MAX_BODY_BYTES`,
    `handleRequest answers 413 for a webhook body over MAX_BODY_BYTES without Content-Length` (a
    `ReadableStream` body of `MAX_BODY_BYTES + 1` bytes — the issue's named case),
    `handleRequest answers 413 for a webhook body over MAX_BODY_BYTES with an understated Content-Length`;
    each asserts status 413 and an empty body.
- [ ] **AC6** — A body stream that fails while being read answers 400 with an empty body.
  - `src/body.test.ts`: `readBodyWithLimit returns unreadable for a body stream that fails`.
  - `src/router.test.ts`: `handleRequest answers 400 for a webhook body stream that fails`.
- [ ] **AC7** — Each request is logged once, as exactly `{ method, path, status }`, path without query string;
  no other field.
  - `src/router.test.ts` (fake `log` collecting entries, compared with `toEqual` on the whole array):
    `handleRequest logs one entry with method, path without query string and status`
    (`GET /health?token=secret` → `[{ method: "GET", path: "/health", status: 200 }]`),
    `handleRequest logs a rejected webhook with status 413`,
    `handleRequest logs an unknown path with status 404`.
- [ ] **AC8** — Documentation matches the behavior: the area document and `docs/ARCHITECTURE.md` (Lead, done
  in this plan), `.squad/project.md`, `docs/CONTRIBUTING.md` and `CHANGELOG.md` (Dev, exact text under
  *Documentation updates*). Verified by the Reviewer in step 8 (no test).

No error text is fixed: every non-200 response has an empty body.

## Approach

1. `tsconfig.json`: add `"resolveJsonModule": true` to `compilerOptions`.
2. `src/body.ts` (new): `MAX_BODY_BYTES`, `parseContentLength`, `readBodyWithLimit`.
   - `parseContentLength(value)`: `null` → `undefined`; a value matching `/^\d+$/` → `Number(value)`
     (a very long digit string gives a huge number or `Infinity`, both above any limit); anything else →
     `undefined`. `Headers.get` already strips leading and trailing whitespace.
   - `readBodyWithLimit(request, maxBytes)`: if `parseContentLength(request.headers.get("content-length"))` is a
     number `> maxBytes` → `{ kind: "too-large" }` without touching `request.body`. If `request.body` is
     `null` → `{ kind: "ok", body: new Uint8Array(0) }`. Otherwise read with a reader, keep the chunks and a
     running byte count; as soon as the count exceeds `maxBytes`, cancel the reader (a rejection of `cancel`
     is ignored) and return `too-large`; a rejected `read` → `{ kind: "unreadable" }`; at the end copy the
     chunks into one `Uint8Array` of the counted length → `ok`. The header is never used as an allocation size
     or as a point to stop reading early. Memory held: at most `maxBytes` plus one chunk.
3. `src/router.ts` (new): `handleRequest(request, deps)` parses `request.url` with `URL`, switches on the
   exact `pathname` and `method`:
   - `GET /health` → `Response.json({ status: "ok", version: deps.version })` (status 200).
   - `POST /webhook` → `readBodyWithLimit(request, MAX_BODY_BYTES)`; `ok` → `new Response(null, { status:
     202 })`, `too-large` → 413, `unreadable` → 400 (an exhaustive `switch` over `kind` with a `never` check).
     The read body is not used yet (#5 verifies its signature).
   - anything else → `new Response(null, { status: 404 })`.
   Then `deps.log({ method: request.method, path: url.pathname, status: response.status })` once, and return
   the response.
4. `src/index.ts` (rewritten): the default export's `fetch` calls `handleRequest(request, { version, log })`
   with `version` imported from `../package.json` and `log` writing the entry object with `console.log` (an
   object, so Workers Logs keep it structured and a newline in the path cannot forge a line). If an ESLint rule
   flags `console`, the Dev disables it on that line with a reason (*Analyzer gate*), it is not worked around.
5. Tests as listed under *Acceptance criteria*; documentation as under *Documentation updates*.

### Guard: the forms `Content-Length` takes and how the guard treats each

The guard is the counted read; the header check is only an early answer. `Content-Length` per RFC 9110 §8.6
is `1*DIGIT`, and a recipient may see a comma-separated list when the header is repeated. What the Worker can
receive, and the outcome (limit 1,048,576):

| `Content-Length` as received | Parsed | Outcome |
| ---------------------------- | ------ | ------- |
| absent (chunked or streamed body) | `undefined` | body counted: 413 above the limit |
| `1048576` with a body of that size | 1048576 | read, 202 |
| `1048577` and above, any body | > limit | 413 before reading |
| leading zeros, `001048577` | 1048577 | 413 before reading |
| digits beyond `Number` precision, `99999999999999999999` | 1e20 (or `Infinity`) | 413 before reading |
| understated, `1` with a body of 2 MiB | 1 | body counted: 413 |
| overstated within the limit, `1000` with 10 bytes | 1000 | body counted: 202 |
| signed, exponent, hex, decimal point, empty (`+5`, `-1`, `1e7`, `0x100001`, `5.0`, `""`) | `undefined` | body counted |
| list of values, `5, 2000000` | `undefined` | body counted |
| `Content-Encoding: gzip` with a small compressed body | as above | the limit counts the bytes `request.body` yields, which is what the Worker holds in memory |

No form makes the Worker read more than `MAX_BODY_BYTES` plus one chunk.

## Options considered

From [decision 0011](../../docs/decisions/0011-public-http-surface.md), where each is recorded:

- Version: **source import of `package.json`** (chosen) vs. a `--define` in the `build` script (missed by
  Workers Builds, `wrangler dev` and the tests), a `vars` entry (runtime read, second copy), a generated
  `version.ts` (can go stale, uncoverable).
- Limit scope: **only routes that read a body** (chosen) vs. a `Content-Length` check on every request before
  routing (an unknown path would answer 413 or 404 depending on a header, and still needs the counted read).
- Limit value: **1 MiB** (chosen) vs. 1,000,000 bytes (equivalent in effect).
- Failing body stream: **400, logged** (chosen) vs. letting the exception reach the runtime (generic error, no
  log entry, exception as control flow).
- Logged path: **pathname without query** (chosen) vs. the full URL (would log the manifest flow's one-time
  code in #10).
- Code shape: a testable `handleRequest` with injected `version` and `log` (chosen) vs. everything in the
  default export tested only through `exports.default.fetch` (logging would need a spy on `console`, and the
  413 cases would pass through whatever the pool does to the request on the way in).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/body.ts` | new: bounded body reader |
| Worker | `src/router.ts` | new: routes and request log |
| Worker | `src/index.ts` | rewritten: wires `handleRequest`, version and `console.log` |
| Build | `tsconfig.json` | `resolveJsonModule: true` |
| Tests | `src/body.test.ts`, `src/router.test.ts` | new |
| Tests | `src/index.test.ts` | rewritten |
| Docs | `docs/areas/http-routes.md`, `docs/areas/README.md`, `docs/ARCHITECTURE.md`, `docs/decisions/0011-public-http-surface.md`, `docs/decisions/README.md` | done by the Lead in this plan |
| Docs | `.squad/project.md`, `docs/CONTRIBUTING.md`, `CHANGELOG.md` | Dev |

`wrangler.jsonc` and `worker-configuration.d.ts` do not change (no binding changes; `mainModule` still points
at `src/index`).

## Signatures (for the Dev's skeleton)

`src/body.ts`:

```ts
/** Largest request body, in bytes, a route reads: 1 MiB. */
export const MAX_BODY_BYTES = 1_048_576;

/** Outcome of reading a request body within a byte limit. */
export type ReadBodyResult =
  | { readonly kind: "ok"; readonly body: Uint8Array }
  | { readonly kind: "too-large" }
  | { readonly kind: "unreadable" };

/** A `Content-Length` value as a byte count when it is a plain decimal number, otherwise `undefined`. */
export function parseContentLength(value: string | null): number | undefined;

/**
 * Reads the request body, rejecting a `Content-Length` above `maxBytes` before reading and a body whose
 * counted bytes exceed `maxBytes` while reading.
 */
export function readBodyWithLimit(request: Request, maxBytes: number): Promise<ReadBodyResult>;
```

`src/router.ts`:

```ts
/** One log entry per request; nothing else about the request is logged. */
export interface RequestLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** What the routes need from outside. */
export interface RouteDeps {
  readonly version: string;
  readonly log: (entry: RequestLogEntry) => void;
}

/** Answers a request on the Worker's public routes and logs it once. */
export function handleRequest(request: Request, deps: RouteDeps): Promise<Response>;
```

`src/index.ts` (default export, rewritten by the skeleton to delegate to `handleRequest`):

```ts
export default {
  fetch(request: Request): Promise<Response>;
} satisfies ExportedHandler;
```

Skeleton: `tsconfig.json` gets `resolveJsonModule`, `src/body.ts` and `src/router.ts` with the signatures and
`throw new Error("Not implemented");` bodies (the constant gets its value), `src/index.ts` already delegates
to `handleRequest` (it then throws through the skeleton). *Build* passes.

## Test files

- `src/body.test.ts` — new, for `src/body.ts`.
- `src/router.test.ts` — new, for `src/router.ts`.
- `src/index.test.ts` — existing; the Tester replaces its one test (`answers every request with 404`) with the
  two tests named under AC1 and AC4.

Existing test code that calls a changed signature: none (the only existing test calls
`exports.default.fetch`, whose signature does not change; its assertion changes and is the Tester's).

Files of the change no unit test can cover: none — `src/index.ts` runs through `exports.default.fetch` in
`src/index.test.ts`; no coverage exclusion.

## Areas

- New area **HTTP routes**, `docs/areas/http-routes.md` (Lead decision; index row added in
  `docs/areas/README.md`): the public routes with status and body, the body size limit, the per-request log
  entry. Written by the Lead in this plan; the Dev reports any deviation from it instead of editing it.

## Documentation updates

| File | Edit | Owner |
| ---- | ---- | ----- |
| `docs/areas/http-routes.md`, `docs/areas/README.md` | new area and its index row | Lead (done) |
| `docs/ARCHITECTURE.md` | *Endpoints*: health row, the paragraph after the table with the 404/413/log rules and links; *Configuration*: "none are written yet" removed | Lead (done) |
| `docs/decisions/0011-public-http-surface.md`, `docs/decisions/README.md` | record and index row, `Proposed` | Lead (done) |
| `docs/decisions/0001-…`, `0002-…`, `0003-…` | `- **Area:** —` added (unreleased, edited in place): with the first area defined, `decision-check.py` requires the field on every record | Lead (done) |
| `.squad/project.md` | *Security areas*: add after *Parsing of external input* the bullet "- **Request body size:** every route that reads a request body reads it through the bounded reader in `src/body.ts` (1 MiB; a `Content-Length` above it is rejected before reading, and the body is always counted while read); a route that reads a body any other way is a `security`-tier finding." Replace the *Logging of external data* bullet with "- **Logging of external data:** logs carry event type, action and delivery id, and per request the method, the URL path without query string and the status (`src/router.ts`); never payload text, headers, query strings, tokens or keys." | Dev |
| `docs/CONTRIBUTING.md` | line 25 becomes "No configuration is needed to build; the local Worker answers `GET /health` and `POST /webhook`, and 404 for everything else." | Dev |
| `CHANGELOG.md` | *Unreleased / Added*: first entry becomes "Cloudflare Workers project skeleton in TypeScript." and a new entry "HTTP routes: `GET /health` with the version of the build, `POST /webhook` answering 202, 404 with an empty body for everything else, 413 for request bodies over 1 MiB, and one log entry per request with method, path and status." | Dev |

`README.md`: none (it documents no endpoint yet; #20 writes the setup guide).

## Architecture check

- *A webhook with an invalid signature has no effect*: preserved — until #5, `POST /webhook` reads the body
  within the limit and does nothing with it: nothing is stored, nothing is sent.
- *Webhook signature* security area ("verifies `X-Hub-Signature-256` … before any parsing"): the bounded read is
  not parsing; it is the step #5 needs before the HMAC, so the order becomes size limit → signature → parsing.
  #5 must keep this order (named in decision 0011's consequences).
- *Logging of external data*: extended by a request log of method, path without query and status; no payload,
  header or query string — `.squad/project.md` is updated to say so.
- No other guarantee (draft PRs, dedup, one instance per user, encrypted credentials, outbox, tag releases) is
  touched. `docs/ARCHITECTURE.md` is updated for the endpoint rules; no flow changes.

## Security considerations

- [x] The byte limit (1,048,576) applies to the bytes `request.body` yields, before any text or JSON decoding;
  the `Content-Length` check compares the header's number, which describes the same bytes.
- [x] Exceptions that can reach a user-visible failure: a rejected `read` becomes 400 with an empty body; a
  rejected `cancel` is ignored (the answer is 413). No response carries a body except `/health`, so no runtime
  message, configuration or secret can reach a client. `new URL(request.url)` cannot throw for a request the
  runtime delivered.
- [x] Log content is attacker-controlled (method, path): it is passed as fields of one object, never
  concatenated into a line; the URL length is bounded by the platform.
- [x] No new dependency, binding, secret or permission.

## Decision records

- [`docs/decisions/0011-public-http-surface.md`](../../docs/decisions/0011-public-http-surface.md) (Proposed,
  indexed) — version from `package.json` at build time, limit scope and value, 400 on an unreadable body, the
  log entry's fields.

## Out of scope / follow-ups

- Signature verification, 401/503 (#5); processing (later issues); the wizard under `/setup` (#8 and
  following); `HEAD /health`.
- No follow-up issue needed.
