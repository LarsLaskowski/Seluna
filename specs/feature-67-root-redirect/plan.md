# Plan: Redirect the Worker root URL to /setup

Source: Issue #67 | [spec.md](spec.md)
Status: Draft
Tier: security — the change adds a route reachable without login and the headers it answers with, which `.squad/routing.md` (*Tiers*, `security`) counts as network exposure, even though the route only answers a fixed redirect.
Security areas touched: the public HTTP surface (network exposure: a new route `GET /` / `HEAD /` reachable without login, `src/router.ts` `route()`); Setup login (the security headers and `Content-Security-Policy` of `src/setup/pages.ts`, reused unchanged through `emptyResponse()`); Request body size (a new route that must read no body); Logging of external data (the per-request entry of `src/router.ts` for the new route, code path unchanged)

## Problem / root cause

See [spec.md](spec.md), *Problem*: `route()` in `src/router.ts` (lines 93–105) has no branch for `/`, so the root falls through to the final 404.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | `GET /` answers 404 with an empty body today. | `src/router.ts` `route()`: `/` matches neither `/health`, `/webhook` nor `isSetupPath`, last line `new Response(null, { status: 404 })`; `src/router.test.ts` line 197, case `{ method: "GET", path: "/" }` of the 404 table. | confirmed |
| 2 | Decision 0011 is released, so it is amended by a new record and not edited. | `git cat-file -e v0.1.0:docs/decisions/0011-public-http-surface.md` succeeds; `git ls-remote --tags origin` lists `v0.1.0` to `v0.5.0`. | confirmed |
| 3 | Every response under `/setup`, redirects included, carries `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`; the issue lists only four of them. | `src/setup/pages.ts` lines 63–68 (`SECURITY_HEADERS`), `securityHeaders()` lines 370–374 adds the CSP; `docs/areas/setup-wizard.md` header table (line 482 on). The issue's list of four is thereby partly refuted: the CSP is sent too. | confirmed |
| 4 | `emptyResponse(status, cookies, location?)` builds a bodiless response with exactly those headers, `Location` when given and one `Set-Cookie` per cookie; with `[]` it sets no cookie. | `src/setup/pages.ts` lines 398–405. | confirmed |
| 5 | `SETUP_PATH` (`"/setup"`) is exported and is the `Location` the wizard's own redirects use. | `src/setup/handler.ts` line 75, used at lines 241, 253, 588. | confirmed |
| 6 | The session and language cookies are scoped to `Path=/setup`, so a browser sends none to `/` and sends them with the follow-up `GET /setup`. | `src/setup/cookies.ts` lines 24–27 (`setupCookie`). | confirmed |
| 7 | `contentSecurityPolicy()` is exported, so a test can compare the root's CSP with the wizard's value. | `src/setup/pages.ts` line 87; used the same way in `src/setup/handler.test.ts` line 1989. | confirmed |
| 8 | The log entry for every request other than `POST /webhook` has exactly `method`, `path` (without query) and `status`. | `src/router.ts` `handleRequest()`: `entry` from `new URL(request.url).pathname`, `deps.log(entry)` in the `else` branch. | confirmed |
| 9 | A `GET` or `HEAD` `Request` can not carry a body. | Fetch standard, `Request` constructor: a non-null body with method `GET` or `HEAD` throws a `TypeError`; the Devil's Advocate saw Node throw `Request with GET/HEAD method cannot have body.` Confirmed from the standard, not run in workerd; no test rests on it any more (spec, *Challenge* 1). | confirmed |
| 10 | `POST` with a streamed body in the test runtime works without `duplex`. | `src/router.test.ts` `webhook()` builds `POST /webhook` requests from `streamOf()` / `failingStream()` streams that way and passes today. | confirmed |

## Acceptance criteria

The criteria are AC1–AC6 of [spec.md](spec.md).

## Tests per criterion

All in `src/router.test.ts`, inside `describe("handleRequest", …)`.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `handleRequest answers GET / with 302 to /setup, an empty body and no cookie`; `it.each` over `/?lang=de` and `/?next=%2F%2Fevil.example` (with a `Host: evil.example` header): `handleRequest answers GET $path with Location /setup whatever the query and Host` | `src/router.test.ts` |
| AC2 | `handleRequest answers HEAD / with 302 to /setup and no body` | `src/router.test.ts` |
| AC3 | `it.each` over `GET` and `HEAD`: `handleRequest answers $method / with the security headers of the setup wizard` — `Content-Security-Policy` equal to `await contentSecurityPolicy()`, and the four fixed values | `src/router.test.ts` |
| AC4 | The existing 404 table: remove `{ method: "GET", path: "/" }`, add `POST /`, `PUT /`, `DELETE /`, `OPTIONS /`, `GET /index.html` and `GET //` | `src/router.test.ts` |
| AC5 | `handleRequest logs GET /?lang=de once as method, path / and status 302` — `toEqual([{ method: "GET", path: "/", status: 302 }])` | `src/router.test.ts` |
| AC6 | `handleRequest answers POST / with a body over 1 MiB with 404 without reading it` (stream of `MAX_BODY_BYTES + 1` bytes, no `Content-Length`); `handleRequest answers POST / with a failing body stream with 404` (`failingStream()`); `it.each` over `GET` and `HEAD`: `handleRequest answers $method / without calling the webhook or setup dependencies` — `vi.fn` spies for `webhookSecret.webhookSecret`, `webhook`, `setup.now`, `setup.fetch`, `setup.githubFetch`, each `not.toHaveBeenCalled()` | `src/router.test.ts` |

## Approach

In `route()` of `src/router.ts`, after the `isSetupPath` branch and before the final 404, add one branch:

```ts
if (pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
  return { response: await emptyResponse(302, [], SETUP_PATH) };
}
```

with `emptyResponse` imported from `./setup/pages` and `SETUP_PATH` from `./setup/handler` (the existing import
of `handleSetup, isSetupPath` gets it). The branch reads no body, no cookie, no secret and no D1. `Location` is
the constant, never built from the request. `handleRequest()` is unchanged: its `else` branch already logs
`{ method, path, status }`.

No new user-visible text: the answer has no body, so there is no layout to decide.

## Options considered

1. **`302` with the fixed `Location: /setup` and the wizard's headers through `emptyResponse()`, `GET` and `HEAD`
   only.** Chosen: one definition of the headers, no state, nothing built from the request.
2. **301 or 308** — lost: a permanent redirect is kept by clients and bookmarks, and a later version could not
   take it back.
3. **Serve the wizard at `/`** — lost: it moves the cookie path and every wizard route. Out of scope in the issue.
4. **A landing page at `/` with a link** — lost: it needs a page with texts in two languages and its own policy,
   for one extra click.
5. **Carry the query string into `Location`** — lost: the language is chosen on `/setup` anyway, and a
   `Location` built from input starts an open redirect.
6. **A separate header set in the router** (the four headers the issue lists, without the CSP) — lost: a second
   copy that can drift from the wizard's, and it leaves the root weaker than every `/setup` redirect.
7. **Redirect every unknown path to `/setup`** — lost: it would turn every probe of the internet into a redirect,
   and `/health/`, `/HEALTH` and friends are documented as 404.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/router.ts`, `route()` (module-private) | New branch for `GET /` and `HEAD /`; two imports added |
| Worker tests | `src/router.test.ts` | New cases (AC1–AC3, AC5, AC6); the 404 table changed (AC4); `contentSecurityPolicy` and `vi` spies used |

## Signatures (for the Dev's skeleton)

None. `route()` stays `async function route(request: Request, pathname: string, deps: RouteDeps): Promise<Routed>`,
`handleRequest()` and `RouteDeps` are unchanged, and no exported member is added or changed. No skeleton (step 4).

## Test files

- `src/router.test.ts` (existing, one test file per module).

Existing test code that calls a changed signature: none.

Files of the change no unit test can cover: none.

## Areas

- `docs/areas/http-routes.md` — the routes table, the matching rules, the request body section, *Limits and
  errors* and *Related decisions* gain the root redirect (*Documentation updates*).
- `docs/areas/setup-wizard.md` — *Paths*: one sentence that `/` is not part of the wizard but redirects to it.

## Documentation updates

Sweep done: `grep` for `GET /health`, `/health` and "404 for everything else" / "Every other method and path"
over `README.md`, `CHANGELOG.md`, `docs/**/*.md`, `docs/ARCHITECTURE.md` and the area documents. Hits and their
owners:

| File | Edit | Owner |
| ---- | ---- | ----- |
| `docs/areas/http-routes.md` | Routes table: a row `GET /`, `HEAD /` — status 302 — "empty, `Location: /setup`, the security headers of the [Setup wizard](setup-wizard.md)", above "anything else". Matching bullet: `/` answers `GET` and `HEAD` only, `POST /` and every other method on `/` are "anything else", the query string is neither carried into `Location` nor logged. Body section line 64: "A route that reads no body (`GET /health`, `GET /` and `HEAD /`, every 404)". *Limits and errors*: the root's 302 carries no body either. *Related decisions*: add 0035. | Lead |
| `docs/areas/setup-wizard.md` | *Paths*, first bullet: `/` is not part of the wizard; it redirects to `/setup` ([HTTP routes](http-routes.md)). | Lead |
| `docs/ARCHITECTURE.md` | Line 18, `fetch` handler row: add "`GET /` (redirects to `/setup`)". *Endpoints* table: a row `GET /`, `HEAD /` — "Redirects to `/setup`"; the sentence after the table links [decision 0035](decisions/0035-root-url-redirects-to-setup.md) next to 0011. | Lead |
| `docs/CONTRIBUTING.md` line 25 | Existing error (it omits `/setup`, which already answers): "the local Worker answers `GET /health`, `POST /webhook`, the setup wizard under `/setup` and `GET /` with a redirect to it, and 404 for everything else." | Dev |
| `docs/setup.md` | *Next steps*, first sentence: "Open `https://<worker>.<your-subdomain>.workers.dev/` (it leads to `/setup`) and sign in with your `SELUNA_SECRET`." Step 4 (`/health`) stays. | Dev |
| `README.md` line 64 | "Open `https://<your-worker>.workers.dev/` (it leads to the setup page `/setup`), sign in and …" | Dev |
| `CHANGELOG.md` | `## [Unreleased]`, new `### Added` section: "- Opening the Worker URL (`/`) leads to the setup page `/setup`; other unknown paths still answer 404." | Dev |

Not changed: `docs/update.md` and `docs/areas/deployment.md` mention `/health` only; `CHANGELOG.md` line 65 is a
released entry; `AGENTS.md` / `.github/copilot-instructions.md` line 93–94 list the handler's routes as a summary
but are instruction files a product PR does not change (*Out of scope / follow-ups*).

## Architecture check

No guarantee of `.squad/project.md` or `docs/ARCHITECTURE.md` is weakened: the new route stores nothing, sends
nothing, reads no secret, no cookie and no D1, logs only method, path and status, and reads no body. The
public surface grows by one fixed redirect, which decision 0035 amends 0011 for; the cookies stay scoped to
`Path=/setup`, and the setup login still decides every request under `/setup`. `docs/ARCHITECTURE.md` is updated
as listed and links the record.

## Security considerations

- [x] Every byte or length limit on parsed input: no limits — the route parses no input; `pathname` comes from
  `new URL()` and is only compared with `"/"`.
- [x] Every exception that can reach a user-visible failure reason or message: none — `emptyResponse()` only
  hashes the constant style and builds headers; the answer has no body.
- Open redirect: `Location` is the constant `SETUP_PATH`, a path on the same origin; no part of the request
  (query, `Host`, path) enters it (AC1 cases with a hostile query and `Host`).
- Clickjacking and sniffing: the root's answer carries the same five headers as every `/setup` redirect (AC3).

## Decision records

- `docs/decisions/0035-root-url-redirects-to-setup.md` (Proposed, indexed) — amends 0011 (released, not edited):
  `GET /` and `HEAD /` redirect to `/setup`.

## Out of scope / follow-ups

- Out of scope as in [spec.md](spec.md).
- Follow-up issue for the orchestrator (label `squad` or `docs`, as an instruction-file change): title
  "[Docs] Name the root redirect in the AGENTS.md architecture summary", body: "`AGENTS.md` (and the generated
  `.github/copilot-instructions.md`) list the `fetch` handler's routes as `POST /webhook`, `GET /health`, `/setup`.
  Since #67, `GET /` and `HEAD /` redirect to `/setup`; add it to the summary. A product PR does not change
  instruction files, so it was left out of #67."

## Challenge notes

Devil's Advocate, plan challenge (0 major, 2 minor), verbatim:

1. (minor) The line numbers in plan.md, *Problem / root cause*, are wrong. It says `route()` is at `src/router.ts`
   lines 93–105, but at 2c68909 `route()` is at lines 89–100: the `isSetupPath` branch is at 96–98 and the final 404
   at line 99. Instruction for the Dev: put the new branch between line 98 and line 99, after the `isSetupPath`
   branch and before `return { response: new Response(null, { status: 404 }) }`. Treat the plan's line numbers as
   stale. Why minor: the *Approach* already names the place by its branches, so nothing in the plan changes.

2. (minor) The AC6 test does not cover the D1 and secret parts of E6. E6 and the *Cost* requirement say the root
   reads no secret and nothing from D1. The AC6 spies only cover `webhookSecret.webhookSecret`, `webhook`,
   `setup.now`, `setup.fetch` and `setup.githubFetch`. `makeDeps()` in `src/router.test.ts` lines 40–47 passes the
   real `env.DB` and `env: {}`, so a build that read `SELUNA_SECRET` or D1 on `/` would still pass. Instruction for
   the Tester: in the `GET`/`HEAD` "no dependencies called" case, pass `setup.env` as a `Proxy` over `{}` whose
   `get` trap throws. `SetupDeps.env` is typed `object` (`src/setup/handler.ts` line 64), so this needs no cast.
   Then assert the 302. The Reviewer checks by reading that the branch never touches `deps.setup.db`. Why minor: it
   is a stronger test of a branch that is plainly stateless, not a change to the plan.

## Security notes

Security, plan review (APPROVED), non-blocking notes, verbatim:

1. **`Host` header in the AC1 test:** the test passes `Host: evil.example`, but the router never reads that
   header, so it barely exercises anything. A stronger hostile-input case is one where the request URL itself
   carries a foreign host, e.g. `new Request("https://evil.example/?next=//evil.example")`, asserting
   `Location === "/setup"`. That would pin that the redirect is never absolute or built from the request. Keeping
   the `Host` case is harmless. If the Workers runtime drops or rejects `Host` in `new Request`, the Tester should
   switch to the URL form rather than assert on a header that never arrived.
2. **Exact `Location` match:** the AC3/AC1 assertions should compare `Location` with exactly `"/setup"`, so that a
   later change to an absolute URL derived from `request.url` (which would reflect the `Host` header) fails the
   test.
