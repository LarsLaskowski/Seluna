# 0026: GitHub App authentication and cached installation tokens

- **Status:** Proposed
- **Date:** 2026-10-19
- **Area:** GitHub API
- **Source:** Issue #15
- **Supersedes:** — (amends [0018](0018-settings-and-status-page.md): the signed-in status page now makes one GitHub
  request, for the app's installations)

## Context

Seluna holds the GitHub App's ID and private key (stored by the setup wizard, [0017](0017-github-app-manifest-flow.md),
or set as Worker secrets) but cannot call the GitHub API as the app. The CI failure rule (#16) has to read whether a
pull request is a draft, which the `workflow_run` payload does not say, to keep the guarantee that a draft pull request
triggers nothing; the status page (#11, [0018](0018-settings-and-status-page.md)) cannot show where the app is
installed. GitHub authenticates an app with a JWT signed by its private key (at most 10 minutes valid) and its
installations with installation tokens valid for one hour, one per installation. The table `token_cache` and its
encryption contract exist since [0007](0007-github-app-credentials-encrypted-in-d1.md) and
[0014](0014-d1-schema-and-data-access.md). The Worker runs on the free plan (limited CPU time per request) and the
session that built this feature could not authenticate as an app to capture GitHub's answers.

## Options considered

How the JWT is made:

1. **Own code on WebCrypto (`RSASSA-PKCS1-v1_5`, SHA-256), a new JWT for every GitHub request, never stored** — about
   thirty lines on the existing PKCS#1-to-PKCS#8 conversion, no dependency, nothing secret kept. Chosen.
2. **A library (`universal-github-app-jwt`, Octokit's auth packages)** — a new runtime dependency is a `security`-tier
   change of its own and brings code the Worker does not need, for the same thirty lines.
3. **Cache the JWT** — saves one signature per call, but another secret-equivalent value to store or keep.

The JWT's issuer:

4. **The App ID** — the one identifier both sources have (the conversion keeps no client ID, a hand-made app is
   configured with `GITHUB_APP_ID`). Chosen.
5. **The client ID, as GitHub recommends** — the wizard would have to store a fourth value, and `GITHUB_APP_ID` would
   need a sibling secret.

Where installation tokens are kept:

6. **Encrypted in `token_cache`, one row per installation id, reused until 5 minutes before GitHub's `expires_at`** —
   one token request per installation and hour, shared by every Worker isolate; the row's ciphertext is bound to its
   installation and expiry (0007). Chosen.
7. **A new token per call** — a second request and its latency on every delivery that needs the API.
8. **Only in the isolate's memory** — isolates are short-lived and not shared, so most calls would still request a
   token.

Guarding the token writes:

9. **A plain upsert, without the key check guard of the credential writes** — a token is short-lived and can always be
   requested again: a row that does not decrypt (changed `SELUNA_SECRET`, altered row) is treated as missing and
   replaced, and concurrent calls leave one row with one valid token. Chosen.
10. **Guarded by the key check value like `secrets`** — would let a changed `SELUNA_SECRET` block the API for an app
    from Worker secrets, for no gain.

A token GitHub refuses (401 on a repository request):

11. **Delete the row only while it still holds that token, matched by installation id and IV** — the next call gets a
    new token, and a row another call replaced meanwhile stays (every write draws a new IV). Chosen.
12. **Delete by installation id** — could remove a fresh token another call just stored.
13. **Keep the row until it expires** — every call within the hour would fail.

The installations on the status page:

14. **Read live on every signed-in `GET /setup`, one page of 100, 10 seconds at most, the page never failing on it** —
    always current, one request per page view. Chosen.
15. **Cached in D1** — stale after an install or uninstall, and a cache needs its own invalidation; out of scope.

What the readers are built from:

16. **GitHub's OpenAPI description for the token answer and the installations list, marked as such, and a real
    pull request answer captured with `gh api`, plus the Product Manager's live check on a deployed copy before the
    pull request is marked ready** — the Product Manager's decision. Chosen.
17. **Captured answers of all three** — what GitHub really sends, but the session cannot authenticate as an app.

## Decision

Seluna signs an RS256 app JWT with the private key for each request to `/app/...`, exchanges it per
`installation.id` for an installation token, caches that token encrypted in `token_cache` until 5 minutes before its
expiry, and deletes exactly the row of a token a repository request was refused for; the status page lists the app's
installations from one live request. App ID and key are resolved per credential with the Worker secrets first (0017).
The rules are in the area document [`areas/github-api.md`](../areas/github-api.md).

## Consequences

- #16 reads the draft state through the API client and gets one failure result for every problem; it decides what a
  failure means for its notification.
- Every signed-in status page view costs one JWT signature and one GitHub request and can take up to about 10 seconds
  longer when GitHub is slow; the login page and every signed-out answer still call neither GitHub nor D1.
- An installation token in D1 grants read access to the owner's repositories for up to an hour to whoever also has
  `SELUNA_SECRET`; a database reader alone gets nothing (0007).
- Rows of an old app's installations, and expired rows, stay in `token_cache` until the cleanup cron (#18) removes them.
- Without a usable `SELUNA_SECRET` the API client cannot cache, so it fails without a request.
- The token allow-list (`[A-Za-z0-9_]`, at most 255 characters) follows GitHub's documented token form; a token of
  another form fails closed and would need a new issue.
- Residual risk: the token answer, the installations list and the account shapes rest on GitHub's OpenAPI description
  (`components.examples.installation-token`, `components.examples.base-installation-items`), not on captured
  answers, so the unit tests share its assumptions and cannot reveal where GitHub deviates — the form of the token
  and of `expires_at`, the `Link` header, an enterprise or `null` account. Each deviation fails closed (a failure
  result, _installations unavailable_, nothing cached). The pull request answer is a real capture. The Product
  Manager's live check on a deployed copy (the status page lists the installation, a token request succeeds and a
  second call reuses the cached token, the Worker's CPU time per request stays within the free plan) is the one check
  against the real API; a deviation it or a later run finds is fixed in a new issue, with the captured answer
  replacing the fixture.
