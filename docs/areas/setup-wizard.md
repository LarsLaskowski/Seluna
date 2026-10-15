# Setup wizard

## Scope

The pages under `/setup` through which the owner sets up an instance: who gets in (the setup login and its
session), how forms are protected, what every page and response looks like, and in which language. The owner
relies on it to keep everyone else out; the wizard steps (Telegram chat, GitHub App, settings and status) build on
it and add their pages behind the login.

## Behavior

### Paths

- The wizard owns `/setup` and every path that starts with `/setup/`. Other paths are not part of it, also
  `/setupx`, `/SETUP` or `/setup%2F` ([HTTP routes](http-routes.md)). The path is matched after the URL is parsed,
  so dot segments are already resolved: `/setup/../health` is `/health`.
- Every request under `/setup` is decided in this order:
  1. **No usable `SELUNA_SECRET`** (absent, not a string, or shorter than 32 characters as counted in
     [Storage](storage.md#encryption)): **503** with the _not configured_ page, for every method and path. No body
     is read and no cookie other than the language cookie is set.
  2. **`POST /setup/login`**: the login (below), with or without a session.
  3. **No valid session**: **200** with the login page, for every other method and path.
  4. **With a valid session**: `GET /setup` answers **200** with the start page, `POST /setup/logout` signs out
     (below), everything else answers **404** with an empty body.
- The start page says that the owner is signed in and that the setup steps follow in a later version, and carries
  the sign-out form. The wizard steps add their pages in this branch.

### Login

- The login page has one form: `POST /setup/login` with the password field `secret` and the hidden field `csrf`.
- `POST /setup/login` is processed in this order, and each step that rejects ends the request:
  1. The body is read with the 1 MiB limit of [HTTP routes](http-routes.md#request-body-size): **413** above it,
     **400** when it cannot be read, both with an empty body.
  2. The body is parsed as `application/x-www-form-urlencoded`, whatever the `Content-Type` says (`+` is a space,
     `%XX` is decoded as UTF-8, a broken escape stays as it is, names are decoded like values).
  3. The CSRF token (below) must be valid, else **403** with the login page and the _form expired_ notice.
  4. The attempt is counted (below). When the login is locked: **429** with the login page and the _locked_
     notice; the secret is not checked.
  5. The field `secret` is compared with `SELUNA_SECRET`: equal only when its UTF-8 bytes are exactly those of
     `SELUNA_SECRET` (no trimming, no case or Unicode normalization). The comparison takes the same time whatever
     the position of the first difference: both values are run through HMAC-SHA256 under a fresh random key and the
     results are compared by the runtime's constant-time `verify`. A missing or repeated `secret` field counts as
     a wrong secret.
  6. Correct: the count is reset, and the answer is **303** with `Location: /setup` and the session cookie. Wrong:
     **403** with the login page and the _wrong secret_ notice.
- A D1 failure while counting or resetting answers **503** with the login page and the _unavailable_ notice; no
  session is set.
- A browser's password field cannot hold a line break, so a `SELUNA_SECRET` that contains one cannot be entered.

### Failed attempts and the lock

- The count is one value for the whole instance, in the `meta` row `login_attempts` ([Storage](storage.md)): a
  JSON object `{"failures":<n>,"last":<ms>}`, `last` being the time of the latest counted attempt in milliseconds
  since 1970-01-01 UTC.
- Every login attempt with a valid CSRF token is counted **before** the secret is checked, in one atomic
  statement, so attempts that arrive at the same time are counted one after the other: of any number of parallel
  attempts at most five have their secret checked.
- When an attempt is counted at time `now`:
  - if there is no row, or `now` is 15 minutes (900,000 ms) or more after `last`, or the row is not such an object
    with integer `failures` ≥ 0 and integer `last`, the count starts again: `failures` 1, `last` `now`;
  - otherwise, if `failures` is below 5, it becomes `failures + 1` with `last` `now`;
  - otherwise (5 or more) the login is **locked**: `failures` grows by one and `last` stays, so a rejected
    attempt does not extend the lock.
- An attempt whose count is 5 or less has its secret checked; one whose count is above 5 is rejected with 429.
- So after five wrong secrets, each within 15 minutes of the one before, the login is locked from the fifth until
  15 minutes after it; every attempt in that time is rejected, the correct secret too. At 15 minutes after the
  fifth failure the next attempt starts a new count.
- A correct secret deletes the row.
- The lock is global: anyone who can reach the instance can keep it locked by sending five wrong attempts every
  15 minutes. The owner then waits, or deletes the `meta` row `login_attempts` in the Cloudflare dashboard.

### Session

- The session cookie `seluna_session` holds `v1.<expires>.<mac>`: `<expires>` is the expiry in milliseconds since
  1970-01-01 UTC, written in decimal without leading zeros, 12 hours (43,200,000 ms) after the login; `<mac>` is
  the HMAC-SHA256 of the ASCII text `v1.<expires>`, written as base64url without padding (43 characters).
- Base64url text is read only in its canonical form: no padding, no `+`, `/` or whitespace, and the unused low bits
  of the last character zero, so each MAC and token has exactly one accepted text.
- The HMAC key is derived with HKDF-SHA256 from `SELUNA_SECRET`, salt and info `seluna/setup-session/v1`
  ([Storage](storage.md#encryption) keeps every key apart). Changing `SELUNA_SECRET` therefore ends every session.
- A session is valid at time `now` when the cookie value has exactly that form (`<expires>` at most 15 digits),
  its MAC verifies in constant time, and `now < <expires> ≤ now + 12 hours`. Anything else (expired, altered,
  signed under another `SELUNA_SECRET`, quoted, padded, another version) is no session.
- The cookie header may carry the name more than once; the request has a session when one of the first four
  values is valid.
- Login sets `seluna_session=<token>; Max-Age=43200` with the cookie attributes below.
- A navigation started on another site (a link, or a redirect back from GitHub) carries none of the wizard's
  cookies (`SameSite=Strict`), so it is answered as signed out, and the 303 after a login always goes to `/setup`
  without a query. A wizard step that another site returns to (the manifest flow of #10) must handle that return
  while signed out.

### Sign-out

- `POST /setup/logout` (with a valid session) reads its body like the login (413, 400), then needs a valid CSRF
  token, else **403** with the start page and the _form expired_ notice and the session stays. With a valid token
  it answers **303** with `Location: /setup` and clears the cookie (`seluna_session=; Max-Age=0`).
- Sign-out ends the session in this browser only: a copy of the token stays valid until it expires.

### CSRF protection

- Every form carries the hidden field `csrf`. Its value is the HMAC-SHA256 (base64url without padding) of the
  value of the cookie `seluna_csrf`, under a key derived like the session key with salt and info
  `seluna/setup-csrf/v1`.
- `seluna_csrf` holds 32 random bytes as base64url without padding (43 characters). A page with a form takes the
  first well-formed value from the request; when there is none it draws a new one and sets the cookie (no
  `Max-Age`, so it ends with the browser session).
- A submitted form is valid when its body has exactly one `csrf` field and that field verifies, in constant time,
  against one of the first four well-formed `seluna_csrf` values of the request. A missing, empty, repeated or
  wrong field, a missing cookie, or a token from another cookie value or another `SELUNA_SECRET` is rejected.

### Cookies

- Every cookie the wizard sets has `Path=/setup; HttpOnly; Secure; SameSite=Strict`, so the browser sends it to
  `/setup` and the paths below it only and never with a request started by another site.
- Cookie values are read as they appear in the `Cookie` header (pairs split at `;`, name and value trimmed of
  spaces, the value neither unquoted nor decoded); a value that does not have the expected form is ignored.

### Pages and response headers

- Pages are complete HTML documents rendered on the server, UTF-8, without a framework, without any script,
  without any external resource (no script, font, style or image is loaded from anywhere), and with one inline
  `<style>` element.
- Every text placed in a page is HTML-escaped (`&`, `<`, `>`, `"`, `'`). No page echoes anything from the request:
  not the secret, not a token other than the page's own CSRF token, not a header, not the path.
- Every response under `/setup` (pages, redirects, 404, 413, 400) carries:

  | Header                    | Value                                                                                                        |
  | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `Content-Security-Policy` | `default-src 'none'; style-src 'sha256-<hash>'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` |
  | `X-Content-Type-Options`  | `nosniff`                                                                                                    |
  | `X-Frame-Options`         | `DENY`                                                                                                       |
  | `Referrer-Policy`         | `no-referrer`                                                                                                |
  | `Cache-Control`           | `no-store`                                                                                                   |

  `<hash>` is the base64 (with padding) SHA-256 of the UTF-8 bytes of the content of the page's `<style>` element.
  A page also carries `Content-Type: text/html; charset=utf-8` and `Content-Language` with its language.

### Language

- The interface is in English (`en`) and German (`de`); every text exists in both.
- The language of a response is, in this order: the query parameter `lang` when it is exactly `en` or `de`; else
  the first `seluna_lang` cookie value that is exactly `en` or `de`; else the `Accept-Language` header; else
  English.
- A valid `lang` parameter also sets the cookie `seluna_lang` to it, with `Max-Age=31536000` (one year).
- Every page links to exactly `/setup?lang=en` and `/setup?lang=de`, whatever path it is answered on (a page
  answered on `/setup/logout` or `/setup/login` links to `/setup` too), and its `<html lang>` is its language.
- `Accept-Language` is read as RFC 9110 defines it: a comma-separated list of language ranges, each with an
  optional weight `;q=<0 to 1, at most three decimals>`. A range counts for German when its first subtag is `de`
  and for English when it is `en`, in any case (`de`, `de-DE`, `DE-at`). The language with the highest weight
  wins; on equal weights the one listed first. A weight of 0 excludes the range; `*`, other languages and entries
  that do not fit the grammar are skipped. Examples: `de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7` → German,
  `en-US,en;q=0.9` → English, `fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7` → German, `de;q=0,en;q=0.1` → English,
  `fr` → English.

### Texts

The notices and the _not configured_ page, in English (the German texts are their translation, in
`src/setup/texts.ts`):

- _wrong secret_: "That is not the SELUNA_SECRET of this instance."
- _locked_: "Too many failed attempts. Signing in is locked for 15 minutes after the fifth failed attempt; try
  again later."
- _form expired_: "The form has expired. Please submit it again."
- _unavailable_: "The setup is unavailable right now. Please try again in a moment."
- _not configured_: the heading "SELUNA_SECRET is not set", then: the setup cannot start because the Worker secret
  `SELUNA_SECRET` is missing or shorter than 32 characters; create a random string of at least 32 characters (a
  password manager, or `openssl rand -hex 32`); in the Cloudflare dashboard open this Worker, then _Settings_ →
  _Variables and Secrets_, and add a secret named `SELUNA_SECRET` with that string, or run
  `npx wrangler secret put SELUNA_SECRET`; then reload the page. The page does not say whether the secret is
  missing or too short.

## Limits and errors

- 404, 413 and 400 under `/setup` carry no body; 503 and the 403 and 429 answers carry a page with a fixed
  notice and never a reason from the runtime or D1.
- A login or logout body is limited to 1 MiB counted in bytes before decoding; the parsed text is never longer than
  that number of bytes.
- At most four values per cookie name are looked at; the `Accept-Language` and `Cookie` headers are otherwise
  limited only by the platform's header size, and reading them takes time proportional to their length, also for
  adversarial input such as long runs of spaces, `;` or `,`.
- Nothing in this area is logged beyond the per-request entry of [HTTP routes](http-routes.md#logging) (method,
  path, status).

## Related decisions

- [`decisions/0015-setup-login.md`](../decisions/0015-setup-login.md) — stateless signed session, signed
  double-submit CSRF token, one global attempt count taken before the check, the lock's timing, the hashed inline
  style, the language cookie.
- [`decisions/0007-github-app-credentials-encrypted-in-d1.md`](../decisions/0007-github-app-credentials-encrypted-in-d1.md)
  — the 32-character minimum of `SELUNA_SECRET` and separate keys per purpose.

## Not here

- The routes outside `/setup`, the body size limit and the request log: [HTTP routes](http-routes.md).
- The `meta` table and the encryption key: [Storage](storage.md).
- How `SELUNA_SECRET` is set at deploy time: [Deployment](deployment.md#worker-secrets).
