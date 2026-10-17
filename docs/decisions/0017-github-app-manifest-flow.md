# 0017: GitHub App creation through the manifest flow in the setup wizard

- **Status:** Proposed
- **Date:** 2026-10-17
- **Area:** Setup wizard
- **Source:** Issue #10
- **Supersedes:** — (amends [0012](0012-webhook-signature-verification.md): the webhook secret comes from the Worker
  secret when it is set, else from D1; and amends [0015](0015-setup-login.md): the form that finishes the manifest
  flow is protected by its session-bound state instead of the `csrf` field, and the page that hands the manifest to
  GitHub allows forms to post to `https://github.com`)

## Context

Decision [0006](0006-github-app-per-user-manifest-flow.md) chose a private GitHub App per instance, created through
GitHub's manifest flow. Issue #10 asks for that step in the setup wizard: personal account or organization, a
manifest with the instance's webhook and redirect URLs, read-only Actions, Pull requests, Dependabot alerts, Code
scanning alerts, Secret scanning alerts and Metadata and the five matching events, a random `state` checked on
return, the code exchanged with `POST /app-manifests/{code}/conversions`, the private key converted from PKCS#1 to
PKCS#8 in the Worker, App ID, key and webhook secret stored encrypted
([0007](0007-github-app-credentials-encrypted-in-d1.md)), the webhook secret source of #5 reading the stored value,
and the Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` taking precedence.

The wizard's cookies are `SameSite=Strict` (0015), so GitHub's redirect back arrives without the session, as 0015
foresaw. GitHub's flow has to be finished within one hour. Instances of 0.1.0 verify deliveries with a hand-set
`GITHUB_WEBHOOK_SECRET` alone (0012). Pages have no script, so a form cannot be filled and submitted on the owner's
behalf. The session cannot reach GitHub's flow and no captured answer of the conversion endpoint exists; the Product
Manager chose to build from GitHub's documentation and OpenAPI description and to check the flow live on a deployed
copy before the pull request is marked ready.

## Options considered

How the signed-out return is handled:

1. **The return answers a page whose one form posts `code` and `state` back to the same path; the POST, sent from the
   instance's own page, carries the session** — no effect on a GET, and the state can be checked against the session.
   Chosen.
2. **Exchange the code on the signed-out GET, authorized by the state alone** — one click less, but a GET with an
   effect, and a state that cannot be bound to a session the request does not carry: a leaked return URL could be
   replayed by anyone within the hour.
3. **A `SameSite=Lax` session cookie** — the return would arrive signed in, but every page would lose 0015's
   protection against cross-site top-level navigations.
4. **A pending state row in D1** — storage and cleanup for what a signed token does.

What protects the finish form:

5. **The state replaces the `csrf` field on this form: an HMAC under its own key from `SELUNA_SECRET`
   (`seluna/setup-github/v1`) over the session token, a random nonce and an expiry one hour ahead** — as unforgeable as
   the session-bound CSRF token, and it already travels in the form. Chosen.
6. **A `csrf` field as on every other form** — the finish page is rendered without the session, so it would draw a new
   `seluna_csrf` cookie, overwrite the owner's and expire every other open form, and the token would still need the
   session to be bound to it.

Untrusted names placed in URLs (the organization name, the code, the app's slug):

7. **Allow-lists checked before any URL is built** — no value can change a path, and a malformed value is reported as
   such. Chosen, as 0016 did for the bot token.
8. **Percent-encoding** — safe for the path, but garbage would reach GitHub, and "invalid" could not be told apart
   from "rejected".

The private key:

9. **Converted to PKCS#8 and imported as an RS256 signing key before anything is stored** — a key that cannot be used
   is refused while the owner is still in the flow. Chosen.
10. **Stored as GitHub sends it, converted at use (#15)** — a broken key would surface only when the first event needs
    the API.

How the three credentials are written:

11. **In one D1 batch, every statement guarded by the key check value** — all or nothing. Chosen.
12. **Three single writes** — a failure between them leaves the credentials of two different apps.

Worker secrets against stored credentials:

13. **Each Worker secret that is set wins over the stored value of the same credential; the wizard refuses to create
    an app while any of the three is set** — a 0.1.0 instance with only `GITHUB_WEBHOOK_SECRET` keeps verifying
    deliveries, and a created app's credentials are never mixed with a hand-set value of another app. Chosen.
14. **All three or none** — an instance with only `GITHUB_WEBHOOK_SECRET` would fall back to D1 and stop verifying.
15. **Precedence per credential without the refusal** — a new app's ID and key beside an old app's webhook secret.

The link to the installation page:

16. **Shown once on the page after the app is saved, from the answer's slug; nothing stored for it** — the status page
    (#11) can read the app's name and link from GitHub with the stored credentials (#15). Chosen.
17. **A `settings` row for the slug** — a second write outside the credentials' transaction.

What the client is built from:

18. **GitHub's documentation and OpenAPI description, with fixtures written from them and marked as such; the test
    key is the documented example key** — the Product Manager's decision. Chosen.
19. **A captured answer of a real conversion** — what GitHub really sends, but none was available.

## Decision

The setup wizard's step `/setup/github` hands GitHub a manifest with exactly the issue's read-only permissions and
events for a personal account or an organization, answers GitHub's signed-out return with a page that posts `code` and
`state` back same-site, and exchanges the code only for a signed-in request whose state was issued to its session
within the hour; the private key is converted to PKCS#8 and must import before App ID, key and webhook secret are
stored encrypted in one transaction. The webhook secret comes from `GITHUB_WEBHOOK_SECRET` when it is set, else from
D1, and the wizard creates no app while any of the three GitHub Worker secrets is set. The rules are in the area
document [`areas/setup-wizard.md`](../areas/setup-wizard.md).

## Consequences

- 0015's rule that every form carries the `csrf` field has one exception, the finish form; `.squad/project.md` and
  the setup wizard area say so. The wizard gains a fourth signing key (`seluna/setup-github/v1`), so changing
  `SELUNA_SECRET` also voids every pending return.
- The page that hands the manifest to GitHub is the only one whose `form-action` is `https://github.com`; its form
  carries no CSRF token.
- An app GitHub created but Seluna could not save (a session that expired during the detour, an unreadable answer,
  a failed write) stays on GitHub and is deleted by hand; the notices say so. GitHub's own one-hour limit bounds the
  return.
- A webhook delivery now derives the storage key and reads D1 when `GITHUB_WEBHOOK_SECRET` is not set; a D1 error or an
  unreadable stored secret still answers 503, never 202 (0012).
- #15 reads `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` with the same per-credential precedence and finds the stored
  key already in PKCS#8.
- Residual risk: the client, the allow-lists of `code` and slug and the fixtures under `test/fixtures/github/` rest on
  GitHub's documentation, not on a captured run, so the unit tests share its assumptions and cannot reveal where GitHub
  deviates — the form of the code and of the returned state, the answer's status and shape, the key's armour, whether
  the browser sends the session with the finish form, and whether `form-action https://github.com` lets GitHub's
  sign-in or single sign-on redirects through. Each deviation fails closed (a fixed notice, nothing stored); the worst
  outcome is an app on GitHub that has to be deleted by hand. The Product Manager's live check on a deployed copy
  (personal account and organization, install, a delivery that passes the signature check) before the pull request is
  marked ready is the one check against the real flow; a deviation it or a later run finds is fixed in a new issue,
  with the captured answer replacing the fixture.
