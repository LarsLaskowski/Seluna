# Spec: Setup wizard login and protection

Status: Draft

Source: Issue #8 "[Setup] Wizard login and protection" (dependency #7 merged in #34).

## Problem / motivation

The setup wizard under `/setup` will create the GitHub App, store its credentials and pick the Telegram chat
(issues #9, #10, #11). Every instance is public on the internet, so only the owner may get in. Today `/setup`
answers 404 ([`docs/areas/http-routes.md`](../../docs/areas/http-routes.md)); this feature makes `/setup` the
wizard's entry point and puts a login in front of everything under it. The wizard steps themselves follow in
#9–#11; this feature provides the login, the session, the CSRF protection, the HTML frame and the languages they
build on.

## Behavior

What the owner (and an attacker) sees. The normative rules with every value are in
[`docs/areas/setup-wizard.md`](../../docs/areas/setup-wizard.md).

- **B1** `/setup` and every path below it (`/setup/…`) belong to the wizard; any other path keeps its current
  answer (`/setupx`, `/SETUP` answer 404).
- **B2** Without a `SELUNA_SECRET` of at least 32 characters, every request under `/setup` answers 503 with a page
  that says the wizard cannot start and explains how to set the secret (dashboard and Wrangler); it shows no form.
- **B3** Without a valid session, every request under `/setup` except the login submission answers 200 with the
  login page: one password field for `SELUNA_SECRET`, a hidden CSRF field, a submit button.
- **B4** The submitted secret is compared with `SELUNA_SECRET` exactly (no trimming, no case folding) and in
  constant time. The correct secret answers 303 to `/setup` and sets the session cookie; a wrong one answers 403
  with the login page and a "wrong secret" notice.
- **B5** The session cookie holds an HMAC-signed token that expires 12 hours after the login; the cookie is
  `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/setup`. An expired, altered, malformed token, or one signed under
  another `SELUNA_SECRET`, counts as no session.
- **B6** With a valid session, `GET /setup` shows the wizard's start page (for now: "signed in", the steps follow
  later) with a sign-out form; any other path or method under `/setup` answers 404.
- **B7** Signing out (`POST /setup/logout`) clears the session cookie and answers 303 to `/setup`.
- **B8** After 5 failed login attempts in a row (each within 15 minutes of the previous one) the login is locked
  for 15 minutes from the fifth failure: every attempt in that time answers 429 with a "locked" notice, without
  checking the secret, even when it is correct. Rejected attempts do not extend the lock. A successful login resets
  the count. The count lives in D1 (`meta`) and is taken before the secret is checked, so parallel attempts get at
  most five checks.
- **B9** Every form carries a CSRF token bound to a CSRF cookie. A form submitted without a valid token answers
  403 with a "form expired" notice and has no effect: no login, no logout, no counted attempt.
- **B10** Pages are server-rendered HTML without a framework, without scripts and without any external
  resource (script, font, style, image); every response under `/setup` carries a strict
  `Content-Security-Policy` and the other security headers of the area document, and is never cached.
- **B11** The interface is in English and German. The language comes from a `?lang=en` / `?lang=de` link on every
  page (remembered in a cookie), otherwise from that cookie, otherwise from `Accept-Language`, otherwise English.
- **B12** A login or logout body over 1 MiB answers 413, an unreadable one 400, both with an empty body and
  without a counted attempt. A D1 failure during login answers 503 with an "unavailable" notice and no session.
- **B13** Nothing of the request beyond method, path and status is logged; the secret, the tokens and the
  cookies are never logged or echoed into a page.

## Acceptance criteria

The issue's three criteria are AC1, AC2 and AC3; the plan adds the criteria for the rest of the scope.

- [ ] AC1: Without login every page under `/setup` shows the login.
- [ ] AC2: The sixth failed attempt within 15 minutes is rejected even with the correct secret.
- [ ] AC3: A form submitted without a valid CSRF token is rejected.
- [ ] AC4–AC13: see [plan.md](plan.md), *Acceptance criteria*.

## Out of scope

- The wizard steps and their pages: Telegram chat (#9), GitHub App manifest flow (#10), settings, status page and
  the reset after a changed `SELUNA_SECRET` (#11).
- Revoking a session on the server before it expires (logout clears the cookie only), "log out everywhere".
- A per-client lock; an unlock other than waiting (the owner can delete the `meta` row `login_attempts` in the
  Cloudflare dashboard).
- The language of Telegram notifications (a setting of #11/#12, not the wizard's interface language).

## Open questions

None. The lockout trade-off (an attacker can keep the single global lock closed) follows from the issue's "counter
in D1" and is recorded in decision 0015.
