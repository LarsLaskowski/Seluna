# GitHub API

## Scope

How Seluna calls the GitHub API as the owner's GitHub App: the app token (JWT), where App ID and private key come
from, the installation tokens per installation and their cache, the rules every request follows, the pull request
read and the installations list, and the one failure result its callers get. The webhook processing (the draft
lookup of the CI failure rule in a pull request, [Notifications](notifications.md#draft-lookup)) and the setup
wizard's status page rely on it.

## Behavior

### App ID and private key

- Each credential is resolved on its own: the Worker secret `GITHUB_APP_ID` or `GITHUB_APP_PRIVATE_KEY` when it is a
  non-empty string, else the value of the same name the setup wizard stored in D1 ([Storage](storage.md)). A mix of
  a Worker secret and a stored value is used as it is; GitHub refuses a pair of two different apps.
- The App ID is a positive whole number written in decimal without leading zeros (`^[1-9]\d{0,15}$`, at most the
  largest safe integer); any other value counts as no App ID.
- The private key is a PEM RSA key, PKCS#1 (`RSA PRIVATE KEY`) or PKCS#8 (`PRIVATE KEY`), at most 16,384
  characters, with a modulus of at most 4096 bits, that imports as an RSASSA-PKCS1-v1_5 SHA-256 signing key. A key that does not import, or a stored key
  that does not decrypt, is _key unusable_.
- No App ID or no key (neither source, a stored App ID that cannot be read with the current `SELUNA_SECRET`, no usable
  `SELUNA_SECRET` for a stored value) means no usable app.

### App token

- The app token is a JWT with the header `{"alg":"RS256","typ":"JWT"}` and the claims `iat` (now − 60 s), `exp`
  (now + 540 s) and `iss` (the App ID as a number), times in whole seconds since 1970-01-01 UTC, each part base64url
  without padding, signed with the private key.
- A new app token is made for each request to `/app/...` and is never stored.

### Installation tokens

- A call names its installation by the `installation.id` of the delivery that caused it: a positive safe integer.
  Anything else (absent, a string, `0`, negative, fractional, beyond the safe range) is a failure without a request;
  a call never uses another installation's token.
- An installation token is requested with `POST /app/installations/<installation id>/access_tokens` and the app
  token. A 2xx answer is accepted only with a `token` of 1 to 255 characters from `[A-Za-z0-9_]` and an `expires_at`
  in the form `YYYY-MM-DDTHH:MM:SS`, optional fractional seconds, then `Z` or `±HH:MM`, more than 5 minutes after
  now. Any other answer is a failure and nothing is cached.
- The token is cached encrypted in `token_cache`, one row per installation id, with the `expires_at` GitHub gave (in
  milliseconds); a new token replaces the row ([Storage](storage.md#encryption)). Without a usable `SELUNA_SECRET`
  nothing can be cached and every call fails without a request.
- A cached token is reused while its expiry is more than 5 minutes after now; at exactly 5 minutes or less a new one
  is requested. A row that does not decrypt, or whose token does not pass the allow-list, counts as no cached token.
- Two calls for one installation at the same time may both request a token; both succeed and one row is left.
- A repository request answered 401 deletes the row of that installation only while it still holds the token the
  request used (same IV), whether that token came from the cache or was stored in the same call; the call fails and
  the next one requests a new token. A 404 leaves the row.
- A token of an earlier app's installation is never used for a new app's installation, because installation ids
  belong to one app; such rows stay until they are cleaned up.

### Requests

- Every request goes to `https://api.github.com` and carries `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: seluna/<version>` (the version of the build) and
  `Authorization: Bearer <token>`: the app token for `/app/...`, the installation token for `/repos/...`.
- Redirects are not followed (a 3xx answer is a failure); each request has a 10-second timeout; no request is retried.
- Every answer is read through the bounded reader (at most 1 MiB, counted in bytes before decoding) and must be UTF-8
  JSON; the body of a non-2xx answer is not read.
- One call of the API client sends at most one token request and one repository request.
- Repository owner, repository name and number are checked before they enter a URL: owner
  `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`, name `^[A-Za-z0-9._-]{1,100}$` and neither `.` nor `..`, number a
  positive safe integer; anything else is a failure without a request.

### Pull request read

- `GET /repos/<owner>/<repo>/pulls/<number>` with the installation token answers the pull request's `draft` value; an
  answer without a boolean `draft` is a failure, and so is a 404 (a pull request that does not exist or is outside the
  installation's repositories).
- The webhook processing calls it with the delivery's `installation.id` and gives the whole call (token and pull
  request read) at most 8 seconds; a call still running then counts as a failure for the caller and is not cancelled
  ([Notifications](notifications.md#draft-lookup)).

### Installations list

- `GET /app/installations?per_page=100` with the app token: one page, never a second one. The answer must be a JSON
  array; each entry must be an object with a positive safe integer `id`, an `account` that is an object or `null`, and
  a `repository_selection` of `all` or `selected`, else the whole list is a failure (never a partial list). At most the
  first 100 entries are used, in GitHub's order.
- An entry's account is: its `login` (a string) with its `type` (`User`, `Organization`, any other or missing); else
  its `slug` (a string), an enterprise; else unknown (also for `null`). An entry is suspended when `suspended_at` is
  present and not `null`.
- There are more installations exactly when the answer's `Link` header has a link with the parameter `rel="next"`.
- How the status page shows the list is in [Setup wizard](setup-wizard.md#status-and-settings).

## Limits and errors

- The API client never throws. Every failure — no usable app, an unusable key, an invalid installation id, owner,
  name or number, a refused (401, 403, 404, 422 or any other non-2xx), failed, timed-out, redirected, oversized or
  unreadable answer, and a D1 error on the token cache — is the same failure result. It carries no token, key, JWT or
  text from GitHub's answer. After a D1 error on writing the cache, the token GitHub issued is not used.
- The private key, the app token and the installation tokens never appear in a log, a page, a result or in D1 in plain
  text; nothing in this area is logged.
- The 10-second timeout covers the whole request: waiting for the answer and reading its body (the body is read
  from the same request that carries the timeout), so a call waits at most about 10 seconds per request.
- The forms of the token, `expires_at`, the `Link` header and the account shapes follow GitHub's documentation and
  OpenAPI description, not a captured answer; each deviation fails closed (decision 0026).

## Related decisions

- [`decisions/0026-github-app-authentication-and-installation-tokens.md`](../decisions/0026-github-app-authentication-and-installation-tokens.md)
  — the JWT made with WebCrypto per request, the App ID as issuer, the encrypted per-installation token cache, the
  401 delete by IV, the live installations list.
- [`decisions/0017-github-app-manifest-flow.md`](../decisions/0017-github-app-manifest-flow.md) — the stored PKCS#8 key
  and the per-credential precedence of the Worker secrets.
- [`decisions/0007-github-app-credentials-encrypted-in-d1.md`](../decisions/0007-github-app-credentials-encrypted-in-d1.md)
  — installation tokens encrypted like the credentials, bound to their row and expiry.

## Not here

- The `token_cache` table, its columns and its encryption: [Storage](storage.md).
- The _Installations:_ line of the status page and its texts: [Setup wizard](setup-wizard.md).
- The manifest conversion of the setup wizard (the one unauthenticated GitHub request):
  [Setup wizard](setup-wizard.md#github-app).
- Removing expired and orphaned `token_cache` rows: the cleanup cron
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md#cron-triggers)).
