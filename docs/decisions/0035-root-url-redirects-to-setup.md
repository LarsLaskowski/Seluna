# 0035: The root URL redirects to the setup wizard

- **Status:** Accepted
- **Date:** 2026-10-24
- **Area:** HTTP routes
- **Source:** Issue #67
- **Supersedes:** — (amends [0011](0011-public-http-surface.md): `GET /` and `HEAD /` are a route of their own, a
  redirect to `/setup`, instead of "anything else" with 404)

## Context

The owner learns the Worker's address (`https://<worker>.<subdomain>.workers.dev/`) from the Cloudflare dashboard
and opens it in a browser. Decision 0011 kept the public surface to `/health`, `/webhook` and the setup wizard
under `/setup`, so the root answers 404 with an empty body and the owner has to know to append `/setup`. The
wizard's cookies are scoped to `Path=/setup` and every response under `/setup` carries a fixed set of security
headers ([decision 0015](0015-setup-login.md)). The root is reachable without login, so whatever it answers must
reveal nothing and must not be usable as an open redirect.

## Options considered

1. **`302 Found` with the fixed `Location: /setup`, no body and the wizard's security headers, for `GET` and `HEAD`
   only** — the browser lands on the login or start page; the answer reads nothing (no cookie, secret or D1) and
   builds nothing from the request. Chosen.
2. **A permanent redirect (301 or 308)** — browsers and bookmarks would treat `/setup` as the root's new home for
   good, which a later version that answers `/` differently could not withdraw.
3. **Serve the wizard at `/`** — moves the cookie path and every route of the wizard, a far larger change to a
   security area for the same convenience.
4. **A landing page at `/` with a link** — a page with texts in both languages, a style and its own policy, for
   one extra click.
5. **Carry the query string into `Location`** (for example `?lang=de`) — the language is chosen on `/setup` from
   the cookie or `Accept-Language` anyway, and a `Location` built from request input is the start of an open
   redirect.
6. **Its own header set in the router** — a second copy of the wizard's security headers that can drift; reusing
   the wizard's empty response keeps one definition.

## Decision

`GET /` and `HEAD /` answer `302 Found` with `Location: /setup`, no body and the security headers of the setup
wizard's redirects; every other method on `/` stays "anything else" with 404. The rules are in the area document
[`areas/http-routes.md`](../areas/http-routes.md).

## Consequences

The public surface grows by one route that answers a fixed text and touches no state. A monitor that probed `/`
and expected 404 now sees 302; the documented health check stays `GET /health`. The guides can send the owner to
the Worker URL itself. `HEAD /health` still answers 404 (decision 0011).
