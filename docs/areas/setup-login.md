# Setup login

## Scope

Who gets into the setup wizard: the login with `SELUNA_SECRET`, the count of failed attempts and the lock, the signed
session, sign-out, and the CSRF protection of every form under `/setup`. The owner relies on it to keep everyone
else out of the wizard; every page behind the login relies on the session and the CSRF check stated here.

## Behavior

### Login

- The login page has one form: `POST /setup/login` with the password field `secret` and the hidden field `csrf`.
- `POST /setup/login` is processed in this order, and each step that rejects ends the request:
  1. The body is read and parsed ([Setup wizard](setup-wizard.md#forms)): **413** or **400**, both with an empty
     body.
  2. The CSRF token of the login form ([CSRF protection](#csrf-protection)) must be valid, else **403** with the
     login page and the _form expired_ notice.
  3. The attempt is counted ([Failed attempts and the lock](#failed-attempts-and-the-lock)). When the login is
     locked: **429** with the login page and the _locked_ notice; the secret is not checked.
  4. The field `secret` is compared with `SELUNA_SECRET`: equal only when its UTF-8 bytes are exactly those of
     `SELUNA_SECRET` (no trimming, no case or Unicode normalization). The comparison takes the same time whatever
     the position of the first difference: both values are run through HMAC-SHA256 under a fresh random key and the
     results are compared in constant time. A missing or repeated `secret` field counts as a wrong secret.
  5. Correct: the count is reset, and the answer is **303** with `Location: /setup` and the session cookie
     ([Session](#session)). Wrong: **403** with the login page and the _wrong secret_ notice.
- A D1 failure while counting or resetting answers **503** with the login page and no session. The notice is
  _migrations missing_ when the database lacks a table of the schema (the table names are read from `sqlite_master`
  after the failure; no error is read), otherwise _unavailable_, which is also the answer when that read fails. The
  secret is not checked when counting failed, so the answer is the same for a wrong secret.
- The _migrations missing_ notice tells the owner that the database migrations have not run and how to fix it: set
  the Worker's deploy command to `npm run deploy` in the Cloudflare dashboard (_Workers & Pages_, the Worker,
  _Settings_, _Build_) and retry the latest build, as the setup guide describes ([Deployment](deployment.md)).
- The _locked_ notice says that signing in is locked for 15 minutes after the fifth failed attempt.
- A browser's password field cannot hold a line break, so a `SELUNA_SECRET` that contains one cannot be entered.

### Failed attempts and the lock

- The count is one value for the whole instance, in the `meta` row `login_attempts` ([Storage](storage.md#tables)): a
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

### Session

- The session cookie `seluna_session` holds `v1.<expires>.<mac>`: `<expires>` is the expiry in milliseconds since
  1970-01-01 UTC, written in decimal without leading zeros, 12 hours (43,200,000 ms) after the login; `<mac>` is
  the HMAC-SHA256 of the ASCII text `v1.<expires>`, written as base64url without padding (43 characters).
- Base64url text is read only in its canonical form: no padding, no `+`, `/` or whitespace, and the unused low bits
  of the last character zero, so each MAC and token of the wizard has exactly one accepted text.
- The HMAC key is derived with HKDF-SHA256 from `SELUNA_SECRET`, salt and info `seluna/setup-session/v1`
  ([Storage](storage.md#encryption) keeps every key apart). Changing `SELUNA_SECRET` therefore ends every session.
  The other keys of the wizard (CSRF, chat proof, GitHub state) are derived the same way, each with its own salt and
  info.
- A session is valid at time `now` when the cookie value has exactly that form (`<expires>` at most 15 digits),
  its MAC verifies in constant time, and `now < <expires> ≤ now + 12 hours`. Anything else (expired, altered,
  signed under another `SELUNA_SECRET`, quoted, padded, another version) is no session.
- The cookie header may carry the name more than once; the request has a session when one of the first four
  values is valid.
- Login sets `seluna_session=<token>; Max-Age=43200` with the cookie attributes of
  [Setup wizard](setup-wizard.md#cookies).
- A navigation started on another site (a link, or a redirect back from GitHub) carries none of the wizard's
  cookies (`SameSite=Strict`), so it is answered as signed out, and the 303 after a login always goes to `/setup`
  without a query. The step that another site returns to, the manifest flow of the GitHub App step, handles that
  return while signed out ([GitHub App step](github-app-step.md#githubs-return-and-finishing)).

### Sign-out

- `POST /setup/logout` (with a valid session) reads its body ([Setup wizard](setup-wizard.md#forms)), then needs a
  valid CSRF token, else **403** with the start page and the _form expired_ notice and the session stays. With a
  valid token it answers **303** with `Location: /setup` and clears the cookie (`seluna_session=; Max-Age=0`).
- Sign-out ends the session in this browser only: a copy of the token stays valid until it expires.

### CSRF protection

- Every form carries the hidden field `csrf`. There are two kinds of form: the **login form** (the login page) and
  the **signed-in forms** (every form on a page answered with a valid session: the sign-out, settings, reset,
  activate and remove forms of the start page, the token, remove, confirm and verify forms of the Telegram step and
  the account form of the GitHub App step). The key is derived like the session key with salt and info
  `seluna/setup-csrf/v1`. Two forms carry no `csrf` field: the form of the GitHub review page, which posts to
  github.com, and the GitHub finish form, which is protected by its session-bound state instead
  ([GitHub App step](github-app-step.md#githubs-return-and-finishing)).
- Login form: the value is the HMAC-SHA256 (base64url without padding) of the value of the cookie `seluna_csrf`.
- Signed-in form: the value is the HMAC-SHA256 (base64url without padding), under the same key, of the ASCII text
  `session.<session token>.<cookie value>`, where `<session token>` is the first valid `seluna_session` value of the
  request (the order of [Session](#session)) and `<cookie value>` the value of `seluna_csrf` the page uses. The page
  renders it for its own cookie value.
- `seluna_csrf` holds 32 random bytes as base64url without padding (43 characters). A page with a form takes the
  first well-formed value among the first four `seluna_csrf` values of the request; when there is none it draws a
  new one and sets the cookie (no `Max-Age`, so it ends with the browser session).
- A submitted form is valid when its body has exactly one `csrf` field and that field verifies, in constant time,
  against one of the well-formed values among the first four `seluna_csrf` values of the request, with the scheme of
  the form: a signed-in form is valid only with a token of the session the request carries, and `POST /setup/login`
  accepts only the login form's token, also when a session is present. A missing, empty, repeated or wrong field, a
  missing cookie, a token from another cookie value, another session or another `SELUNA_SECRET`, an unbound
  login-form token on a signed-in form, or a session-bound token on the login form is rejected.
- A rejected token on a signed-in form answers **403** with the _form expired_ notice on the notice-only view of
  the page the form belongs to, and the form changes nothing; the area document of each form names that view.
- What this protects: a cookie planted by a host under the same registrable domain (on a custom domain, or another
  Worker of the same account under `<subdomain>.workers.dev`) is useless on a signed-in form, because its token needs
  the owner's session. On the login form it still yields a valid token, which is harmless there because a login also
  needs `SELUNA_SECRET`.

## Limits and errors

- The lock is global: anyone who can reach the instance can keep it locked by sending five wrong attempts every
  15 minutes. The owner then waits, or deletes the `meta` row `login_attempts` in the Cloudflare dashboard.
- The _migrations missing_ notice is shown to anyone who submits the login form with a valid CSRF token, before the
  secret is checked; it tells them only that the database lacks a table of the schema. A database with every table
  but an outdated column still shows _unavailable_, and the signed-in pages show _unavailable_ for every D1 failure.
  The table names are read after the failure and an error of that read answers _unavailable_; production D1 answers
  that read ([decision 0021](../decisions/0021-missing-tables-notice-on-the-setup-login.md)).
- The login page, the lock answer and the _not configured_ page call no GitHub API; the login page itself reads no
  D1.
- A host under the same registrable domain that plants cookies can make a page look signed out or a form fail, but
  it cannot make a signed-in form succeed (above, and [Setup wizard](setup-wizard.md#limits-and-errors)).

## Related decisions

- [`decisions/0015-setup-login.md`](../decisions/0015-setup-login.md) — stateless signed session, signed
  double-submit CSRF token bound to the session on signed-in forms, one global attempt count taken before the
  check, the lock's timing.
- [`decisions/0021-missing-tables-notice-on-the-setup-login.md`](../decisions/0021-missing-tables-notice-on-the-setup-login.md)
  — the _migrations missing_ notice on the login, the table names read after a failed D1 access.

## Not here

- The paths, form reading, cookies, page rules and languages of the wizard: [Setup wizard](setup-wizard.md).
- The start page and its forms: [Status page](status-page.md).
- The Telegram step and its chat proof: [Telegram step](telegram-step.md).
- The GitHub App step and its state: [GitHub App step](github-app-step.md).
- The `meta` table and the derivation of the keys: [Storage](storage.md).
