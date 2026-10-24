# Spec: Redirect the Worker root URL to /setup

Source: Issue #67
Status: Draft

## Problem

The owner of an instance knows the Worker's address, `https://<worker>.<subdomain>.workers.dev/`, from the
Cloudflare dashboard or the deploy log, and opens it in a browser. Today that address answers 404 with an empty
body (`src/router.ts`, `route()`: `/` matches none of `/health`, `/webhook` or `isSetupPath`, so it falls through to
`new Response(null, { status: 404 })`; pinned by the `GET /` case of the 404 table in `src/router.test.ts`). The
browser shows a blank error page, and nothing tells the owner that the setup wizard lives under `/setup`; the
guide (`docs/setup.md`) and the README have to name the path. Decision 0011 and `docs/areas/http-routes.md` define
every path outside `/health`, `/webhook` and `/setup` as 404, so the root is "anything else" by design today.

## Scenarios

- S1: Given a deployed instance, when the owner opens `https://<worker>.<subdomain>.workers.dev/` in a browser
  (`GET /`), then the Worker answers `302 Found` with `Location: /setup` and an empty body, and the browser shows
  the page `/setup` answers: the setup login, or the wizard's start page when the owner is already signed in
  (the session cookie has `Path=/setup` and is sent on the follow-up request to `/setup`).
- S2: Given an instance without a usable `SELUNA_SECRET`, when the owner opens the root URL, then the Worker
  answers the same redirect, and `/setup` shows the page that explains how to set `SELUNA_SECRET`, as today.
- S3: Given any client, when it sends `HEAD /`, then the Worker answers `302 Found` with `Location: /setup`, the
  same headers as S1 and no body.
- S4: Given any request to `/`, when the Worker answers it, then the request log holds exactly one entry with the
  method, the path `/` and the status 302, and nothing else.

## Errors and edge cases

- E1: `GET /?lang=de` or `GET /?anything=<text>` answers the same redirect: `Location` is exactly `/setup`, the
  query string is neither carried into `Location` nor logged, and no `Set-Cookie` header is sent (the language
  cookie is set only by `/setup` itself).
- E2: Any other method on `/` (`POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`) answers 404 with an empty body, as
  today; a body sent with it is never read.
- E3: Every other path that today answers 404 still does, with an empty body: for example `/anything`,
  `/index.html`, `//`, `/setupx`, `/SETUP`, `/setup%2F`, `HEAD /health`, `GET /webhook`.
- E4: Hostile input (a forged `Host` header, an absolute URL or `//evil.example` in the query, a crafted path)
  never changes the answer of `/`: `Location` is a fixed text, never built from the request, so the root can not
  be used as an open redirect.
- E5: A request body sent with `GET /` or `HEAD /` is not read; its size does not matter (no 413).
- E6: Repeated requests to `/` answer the same each time: the root reads no cookie, no secret and nothing from
  D1, writes nothing, and its answer carries `Cache-Control: no-store`, so a browser does not keep the redirect
  once a later version answers `/` differently.

## Non-functional requirements

- Security: the redirect carries the security headers every response under `/setup` carries
  (`docs/areas/setup-wizard.md`, the header table: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`), with the same values as the
  wizard's own redirects. The root sets no cookie and reads none; the cookies stay scoped to `Path=/setup`.
- Cost: the root does not access D1, does not read `SELUNA_SECRET` or any other secret, and calls no external
  service, so it adds nothing to the account's D1 read allowance.
- Logging: one entry per request with method, path and status only, like every route outside `POST /webhook`.
- Compatibility: `/health`, `/webhook` and everything under `/setup` keep their behavior. A monitor that probed
  `GET /` and expected 404 now sees 302; the documented health check is `GET /health`.
- Configuration: none new.

## Acceptance criteria

- [ ] AC1: `GET /` answers status 302 with `Location: /setup`, an empty body and no `Set-Cookie` header, also with
  a query string (S1, S2, E1, E4, E6).
- [ ] AC2: `HEAD /` answers status 302 with `Location: /setup` and no body (S3).
- [ ] AC3: The 302 of `GET /` and `HEAD /` carries `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, with the values a
  redirect under `/setup` carries (S1, S3, E6).
- [ ] AC4: `POST /`, `PUT /`, `DELETE /` and `OPTIONS /` answer 404 with an empty body, and the 404 cases of the
  existing route table other than `GET /` still answer 404 with an empty body (E2, E3).
- [ ] AC5: A request to `/` writes exactly one log entry `{ method, path: "/", status }` with no further field, the
  query string not part of `path` (S4, E1).
- [ ] AC6: Answering `GET /` with a body over 1 MiB reads no body and still answers 302; answering `/` calls none
  of the webhook secret source, the webhook processor or the setup dependencies (E5, E6).

## Out of scope

- Serving the setup pages directly under `/` (would mean moving the cookie path and every route of the wizard).
- Any change to `/health`, `/webhook` or `/setup` and its pages.
- Redirecting paths other than exactly `/` (for example `/index.html`, `/setup/` variants or mistyped paths).
- A landing page at `/` with content of its own.

## Open questions

- Which status code? Answered: `302 Found`, as the issue states. A permanent redirect (301, 308) tells clients and
  bookmarks to replace the root URL for good, which a later version that answers `/` differently could not
  withdraw; the wizard's own redirects use 303 after a form post, which does not apply to a `GET`.
- Is the query string carried into `Location` (for example `?lang=de`)? Answered: no. The issue fixes
  `Location: /setup`; a fixed `Location` can never become an open redirect, and the language is still chosen on
  `/setup` from the `seluna_lang` cookie or `Accept-Language` (`src/setup/language.ts`, `resolveLanguage`).
- Which security headers? Answered: all five of the setup wizard's header table, including
  `Content-Security-Policy`. The issue asks for "the security headers the setup pages send" and lists four; every
  response under `/setup`, redirects included, also carries the `Content-Security-Policy`
  (`src/setup/pages.ts`, `securityHeaders()`, used by `emptyResponse()`; `docs/areas/setup-wizard.md`). On a
  response without a body it is harmless and keeps the root's headers identical to the wizard's redirects.
- Does `HEAD /` also redirect while `HEAD /health` stays 404? Answered: yes. The issue names `HEAD /` explicitly;
  `HEAD /health` is a separate route decision in decision 0011 and stays out of scope.
- Is decision 0011 released, so that it must be superseded rather than edited? Answered: yes; the record exists
  in tag `v0.1.0` (`git ls-remote --tags origin` lists `v0.1.0` to `v0.5.0`). The plan adds a new record that
  supersedes 0011 in the point "everything else answers 404".
- Does a signed-in owner land on the start page? Answered: yes. The session cookie is scoped to `Path=/setup`
  (`src/setup/cookies.ts`, `setupCookie`), so the browser does not send it to `/` but does send it with the
  follow-up `GET /setup`, which decides between login and start page as today.

## Area documents

- `docs/areas/http-routes.md`: the routes table gains `GET /` and `HEAD /` with status 302, `Location: /setup`,
  an empty body and the security headers of the setup wizard; the matching rules list `POST /` and the other
  methods on `/` as "anything else"; the request body section names `/` among the routes that read no body; the
  "Limits and errors" sentence on bodiless answers outside `/setup` includes the 302; the related decisions list
  the new record that supersedes 0011 in this point.
- `docs/areas/setup-wizard.md`: unchanged in behavior; its scope may note that the root URL redirects to
  `/setup` with a link to HTTP routes, if the plan finds an entry point described there.
- Outside the area documents, the plan's documentation sweep covers at least `docs/ARCHITECTURE.md` (the
  endpoints table and "Every other method and path answers 404"), `docs/CONTRIBUTING.md` (line "the local Worker
  answers `GET /health` and `POST /webhook`, and 404 for everything else"), `docs/setup.md` (opening the setup via
  the Worker URL) and the README's setup step that names `/setup`.

## Challenge notes

Devil's Advocate, spec challenge (0 major, 1 minor), verbatim:

1. (minor) AC6 asks for a test where `GET /` carries a body over 1 MiB. That test cannot be written. In this Node,
   `new Request("https://x/", { method: "GET", body: "a" })` throws `Request with GET/HEAD method cannot have body.`
   The Fetch spec, which workerd (the Cloudflare Workers runtime) follows, forbids it as well. That is a strong
   expectation, but I did not run it inside workerd itself. As written, the Tester would have to bend the test or
   drop it.

   Instruction for the Lead: rewrite AC6 so it checks that the root answer reads no body in a way that can be
   tested. Either:
   - send `POST /` with a body over 1 MiB (or a failing stream, like `failingStream()` in `src/router.test.ts:97`)
     and expect a 404 with no 413 or 400; or
   - keep only the second half: answering `/` calls none of the webhook secret source, the webhook processor or
     the setup dependencies.

   Change E5 to match.
