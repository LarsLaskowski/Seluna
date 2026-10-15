# Plan: Bind the setup CSRF token to the session on signed-in forms

Source: Issue #35
Status: Draft
Tier: security — the change rewrites the CSRF protection of the setup login (`src/setup/csrf.ts`,
`src/setup/handler.ts`), which `.squad/project.md` lists under *Security areas* (*Setup login*).

## Problem / root cause

Every form token is the HMAC of the `seluna_csrf` cookie value alone, `src/setup/csrf.ts:25-27`
(`csrfTokenFor`), and a submission is valid when it verifies against any of the first four well-formed
`seluna_csrf` values of the request, `src/setup/csrf.ts:30-42` (`isValidCsrfToken`). Sign-out, the only form
behind the login, uses exactly that check (`src/setup/handler.ts:98-102` `hasValidCsrf`, called from
`signOut` at `src/setup/handler.ts:136`), and the start page renders the same unbound token
(`src/setup/handler.ts:59-69` `formPage`). Nothing in the token depends on the session, so any pair
(cookie value, token) that anyone obtained from the instance is accepted on a signed-in form as long as the
browser sends that cookie value.

Claims of the issue, checked:

- *"The form value is the HMAC of the `seluna_csrf` cookie under a key derived from `SELUNA_SECRET`."* —
  confirmed: `csrf.ts:25-27`; key `signingKeyFromEnv(env, "setup-csrf")`, HKDF label `seluna/setup-csrf/v1`
  (`src/crypto.ts:10-14`, `:126-140`).
- *"A host under the same registrable domain can toss a `seluna_csrf` cookie with `Path=/setup`; it can use a
  value whose matching form token it got from the instance's own login page."* — confirmed: the login page is
  answered to anyone and renders `csrfTokenFor(c)` for the requester's own cookie value `c` (`handler.ts:59-69`,
  `:166`); a cookie with `Domain=<registrable domain>` is sent to the instance (RFC 6265 §5.3, §5.4). The tossed
  value does not even need to be sent first: every one of the first four well-formed values is a candidate
  (`csrf.ts:38-41`).
- *"Then submit a form same-site, so the `SameSite=Strict` session cookie is sent."* — confirmed: the session
  cookie is `SameSite=Strict` (`src/setup/cookies.ts:24-27`), and a request between two hosts of one registrable
  domain is same-site, so the cookie is sent.
- *"Today the only signed-in form is sign-out, so the impact is a forced sign-out."* — confirmed:
  `renderStartPage` (`src/setup/pages.ts:74-82`) carries only the sign-out form; `signedIn`
  (`handler.ts:143-152`) accepts only `GET /setup` and `POST /setup/logout`.
- *"On `*.workers.dev`, which is on the public suffix list, no sibling host can set the cookie."* — partly
  refuted: `workers.dev` is an entry of the public suffix list (checked against the list in
  `publicsuffix/list`, line 12731), so the registrable domain of `<worker>.<subdomain>.workers.dev` is
  `<subdomain>.workers.dev` — every other Worker of the same Cloudflare account is a sibling and can toss the
  cookie. Those Workers belong to the owner, so the risk there is low, but it is not nil; the fix below does not
  depend on the domain at all.

Related limitation found on the way (not a defect of this issue, recorded, not fixed): a sibling host can still
**disrupt** the wizard by cookie tossing. The request reads at most four values per cookie name
(`cookies.ts:16-18`), and the browser sends cookies with a longer path first (RFC 6265 §5.4), so four tossed
`seluna_session` values with `Path=/setup/` hide the owner's session on every path below `/setup/` (answered
as signed out), and four tossed `seluna_csrf` values make a form submission fail with *form expired*. Neither
makes a forged form succeed. After this change the forced sign-out through a valid token is gone; the
denial through tossing stays and is written into decision 0015 (*Consequences*) and the area document.

## Acceptance criteria

The session-bound token is the HMAC-SHA256 under the CSRF key of the ASCII text
`session.<session token>.<cookie value>`, base64url without padding (the *Approach* below).

- [ ] AC1: `sessionCsrfTokenFor(key, session, cookieValue)` returns 43 base64url characters equal to the
  HMAC-SHA256 of `session.<session>.<cookieValue>` under `key` (computed independently with `hmacBase64Url`
  from `test/keys.ts`), and differs from `csrfTokenFor(key, cookieValue)`.
  Test: `csrf.test.ts` — `sessionCsrfTokenFor returns the HMAC of session, session token and cookie value`.
- [ ] AC2: `isValidSessionCsrfToken(key, token, session, cookieValues)` accepts the token of `session` and the
  cookie value, also for the fourth value of `cookieValues`.
  Tests: `isValidSessionCsrfToken accepts the token of the session and the cookie value`,
  `isValidSessionCsrfToken accepts the token of the fourth cookie value`.
- [ ] AC3: `isValidSessionCsrfToken` rejects: `null`; an empty token; the token of **another session**
  (`sessionCsrfTokenFor` of a second session token); the **unbound** token of the same cookie value
  (`csrfTokenFor(key, value)`, a token issued for no session); the token of another cookie value; a token under
  another key; a malformed cookie value; the token of the fifth cookie value; the valid token with its last
  character changed only in its two unused bits.
  Test: one `it.each` — `isValidSessionCsrfToken rejects $name`.
- [ ] AC4: `isValidCsrfToken` (the login form's check) rejects a session-bound token of the same cookie value,
  so neither scheme accepts the other's token.
  Test: one more row in the existing `isValidCsrfToken rejects $name` table — `a session-bound token of the
  cookie value`.
- [ ] AC5: `POST /setup/logout` with a valid session, a `seluna_csrf` cookie and the token bound to that session
  and cookie value answers 303 to `/setup` and clears the session cookie.
  Test: `handler.test.ts` — the existing `handleSetup signs out with a valid CSRF token: 303 to /setup and an
  expired session cookie`, rewritten by the Tester to submit the session-bound token (it submits the unbound
  token today and becomes wrong with this change).
- [ ] AC6: `POST /setup/logout` with a valid session is rejected with 403, the start page with the *form
  expired* notice, and no `Set-Cookie` for `seluna_session` (the session stays), when the token is:
  - the unbound login-form token of the request's cookie value (issued for no session);
  - bound to another valid session (a session token created one hour before the request's one, same secret);
  - the unbound token of a second, tossed `seluna_csrf` value that the request also carries
    (cookies `[session, seluna_csrf=<owner value>, seluna_csrf=<tossed value>]`, token
    `csrfTokenFor(<tossed value>)`) — the attack of the issue.
  Test: one `it.each` — `handleSetup rejects a logout whose token is $name with 403 and keeps the session`.
- [ ] AC7: the start page renders the session-bound token: `GET /setup` with a valid session and a
  `seluna_csrf` cookie contains `value="<sessionCsrfTokenFor(session, value)>"` and sets no new `seluna_csrf`;
  without a `seluna_csrf` cookie it sets a new one and renders the session-bound token of the new value.
  Tests: `handleSetup renders the session-bound token of the request's seluna_csrf cookie on the start page`,
  `handleSetup sets a new seluna_csrf cookie on the start page and renders its session-bound token`.
- [ ] AC8: the 403 start page of a rejected logout renders the session-bound token, and submitting it signs out
  (303). Test: `handleSetup accepts the token of the form-expired start page for a second logout`.
- [ ] AC9: the login form keeps the unbound scheme and stays valid without a session: `POST /setup/login` with
  the unbound token and the correct secret answers 303 without any session cookie in the request (pinned by the
  existing `handleSetup answers the correct secret with 303 to /setup and the session cookie`) **and** with a
  valid session cookie in the request; a login with a session-bound token is rejected with 403 *form expired*.
  Tests: `handleSetup accepts the unbound login token while a session cookie is present`,
  `handleSetup rejects a login with a session-bound token with 403`.

The existing login-page tests (`handleSetup sets a new seluna_csrf cookie on the login page when the request
has none`, `handleSetup renders the token of the request's seluna_csrf cookie and sets no new one`) keep
pinning that the login page renders the unbound token; they stay unchanged.

## Approach

1. `src/setup/csrf.ts` gains the signed-in scheme next to the unchanged login scheme:
   `sessionCsrfTokenFor` signs the ASCII text `session.<session token>.<cookie value>` under the same CSRF key;
   `isValidSessionCsrfToken` takes the candidates exactly like `isValidCsrfToken` (well-formed values, at most
   four) and verifies every candidate with `crypto.subtle.verify` (all of them, so the time does not tell which
   matched). The two message sets are disjoint: a login-form message is a well-formed cookie value, 43
   base64url characters without a `.`, a signed-in message starts with `session.` — so no token of one scheme
   verifies in the other (AC4, AC3 row "unbound"). The session token passed in is one the handler has already
   found valid; its form (`v1.<at most 15 digits>.<43 characters>`) bounds the message length.
2. `src/setup/handler.ts`:
   - `hasSession` becomes `sessionOf`, which returns the first valid session token value of the request (the
     same four values in the same order as today), or `undefined`.
   - A form is either the login form or a signed-in form that names its session (`SetupForm` below);
     `formPage` and `hasValidCsrf` take it and switch over its `kind` exhaustively (`never` check): the login
     form uses `csrfTokenFor` / `isValidCsrfToken`, a signed-in form `sessionCsrfTokenFor` /
     `isValidSessionCsrfToken` with its session. Which scheme applies follows the form, not the presence of a
     session cookie: `POST /setup/login` always checks the login scheme, also when a session is present.
   - `handleSetup` keeps its order (not configured → `POST /setup/login` → session or login page); the session
     found by `sessionOf` is passed to `signedIn`, and from there to `formPage` and `signOut`.
   The wizard steps of #9–#11 add their forms as further signed-in forms of this kind.
3. No new key, no change to `SIGNING_KEY_LABELS`, no new cookie, no change to the session token or the cookie
   attributes.

## Options considered

1. **Signed-in token = HMAC of `session.<session token>.<cookie value>` under the CSRF key; login form
   unchanged** — the attacker cannot compute it without the key and cannot obtain it without the owner's
   session token (`HttpOnly`, never rendered, and a valid one needs `SELUNA_SECRET`); keeps one shape for every
   form (cookie plus field), the token still ends with the browser session together with the cookie, and the
   login page still works without a session. Chosen; it is the issue's first suggestion.
2. **Signed-in token = HMAC of the session token alone** — equally unforgeable by a tossing host; loses only on
   shape: the signed-in forms would no longer use the cookie at all, so the wizard would carry two different
   mechanisms, and a rendered token would stay valid for the whole 12-hour session independent of the browser
   session.
3. **A `__Host-seluna_csrf` cookie** — the browser refuses a `__Host-` cookie from a sibling host or an
   insecure origin, so tossing is blocked at the source and the login form is covered too. Loses: the prefix
   requires `Path=/`, which breaks the rule that every wizard cookie is scoped to `/setup` (the cookie would
   travel with `/webhook` and `/health` requests from the browser), and the protection would rest on the
   browser enforcing the prefix rather than on the key. The issue names it only "where the path allows it";
   it does not.
4. **A separate HKDF key (`seluna/setup-csrf-session/v1`) instead of the `session.` prefix** — separation by
   construction; loses: one more key derivation per request on the free plan, a new label in
   `SIGNING_KEY_LABELS` and in Storage, for a separation the disjoint message sets already give.
5. **Reject state-changing requests whose `Sec-Fetch-Site` is not `same-origin` (or whose `Origin` is not the
   instance's)** — would stop the sibling's submission too, but rests on request headers the browser may omit,
   was already rejected as the CSRF defense in decision 0015 (option 5), and the issue asks for the token to be
   bound. Not added as a second layer either: it would be a behavior of its own with its own error cases.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/setup/csrf.ts` | add `sessionCsrfTokenFor`, `isValidSessionCsrfToken`; TSDoc of `csrfTokenFor` / `isValidCsrfToken` says "of the login form" |
| Worker | `src/setup/handler.ts` | `sessionOf` replaces `hasSession`; `SetupForm`; `formPage`, `hasValidCsrf`, `signIn`, `signOut`, `signedIn`, `handleSetup` pass the form kind and session |
| Tests | `src/setup/csrf.test.ts`, `src/setup/handler.test.ts` | AC1–AC9 |
| Docs | `docs/areas/setup-wizard.md`, `.squad/project.md`, `CHANGELOG.md` | see *Documentation updates* |
| Docs | `docs/decisions/0015-setup-login.md` | edited in place by the Lead (done with this plan) |

## Signatures (for the Dev's skeleton)

`src/setup/csrf.ts` (new exports):

```ts
/** The form token of a signed-in form: HMAC-SHA256 under `key` (from `signingKeyFromEnv(env, "setup-csrf")`) of the ASCII text `session.<sessionToken>.<cookieValue>`, base64url without padding; `sessionToken` is the request's valid session token. */
export async function sessionCsrfTokenFor(key: CryptoKey, sessionToken: string, cookieValue: string): Promise<string>;

/** Whether `token` verifies, in constant time, as the signed-in form token of `sessionToken` and one of the first four well-formed values in `cookieValues`. */
export async function isValidSessionCsrfToken(
  key: CryptoKey,
  token: string | null,
  sessionToken: string,
  cookieValues: readonly string[],
): Promise<boolean>;
```

`csrfTokenFor` and `isValidCsrfToken` keep their signatures; only their TSDoc names them as the login form's.

`src/setup/handler.ts` (module-internal; exports unchanged):

```ts
/** Which form a page carries or a submission belongs to; a signed-in form names the session its token is bound to. */
type SetupForm = { readonly kind: "login" } | { readonly kind: "start"; readonly session: string };

/** The first of the request's (at most four) `seluna_session` values that is a valid session, or `undefined`. */
async function sessionOf(context: Context): Promise<string | undefined>;

async function formPage(context: Context, form: SetupForm, status: number, notice?: Notice): Promise<Response>;
async function hasValidCsrf(context: Context, fields: URLSearchParams, form: SetupForm): Promise<boolean>;
async function signOut(context: Context, session: string): Promise<Response>;
async function signedIn(context: Context, session: string, pathname: string): Promise<Response>;
```

`hasSession` and the type `FormPage` are removed. `signIn(context: Context)` keeps its signature and uses
`{ kind: "login" }`. Skeleton files to rewrite: `src/setup/csrf.ts` (two new stubs), `src/setup/handler.ts`
(the internal signatures above; its bodies may stay as they are with the new parameters threaded through,
because the skeleton only has to compile — the new behavior comes in step 6).

## Test files

- `src/setup/csrf.test.ts` — AC1–AC4.
- `src/setup/handler.test.ts` — AC5–AC9. A helper next to `csrfToken` there, e.g.
  `sessionCsrfToken(session: string, cookieValue = CSRF_VALUE, secret = SECRET)`, is the Tester's choice.

Existing test code affected: no exported signature changes, so no call site stops compiling. One existing test
becomes wrong by behavior: `handleSetup signs out with a valid CSRF token: 303 to /setup and an expired session
cookie` (`handler.test.ts:410-424`) submits the unbound token; the **Tester** rewrites it in step 5 as AC5. The
`a wrong token` row of `handleSetup rejects a logout with $name with 403 and keeps the session`
(`handler.test.ts:316-334`) stays valid as it is; the Tester may base it on the session-bound token. The
form-expired language test (`handler.test.ts:512`) and `router.test.ts:384-399` (a login) are unaffected.

Files of the change no unit test can cover: none.

## Areas

- `docs/areas/setup-wizard.md` (*Setup wizard*), section *CSRF protection*, rewritten (owner: **Dev**):
  - Two kinds of form: the **login form** and the **signed-in forms** (every form on a page answered with a valid
    session; today the sign-out form).
  - Login form: unchanged — the HMAC of the cookie value.
  - Signed-in form: the HMAC-SHA256 (base64url without padding), under the same key, of the ASCII text
    `session.<session token>.<cookie value>`, where `<session token>` is the first valid `seluna_session` value
    of the request (the order of *Session*); the page renders it for its own cookie value as today.
  - Validity: as today, plus — a signed-in form is valid only with a token of the session the request carries; a
    token of another session, an unbound login-form token, or a token of another cookie value is rejected;
    `POST /setup/login` accepts only the login form's token, also when a session is present.
  - A sentence on what this protects: a cookie planted by a host under the same registrable domain (on a custom
    domain, or another Worker of the same account under `<subdomain>.workers.dev`) is useless on a signed-in
    form, because its token needs the owner's session; on the login form it still yields a valid token, which is
    harmless there because a login also needs `SELUNA_SECRET`.
  - In *Limits and errors*: such a host can still make a page look signed out or a form fail (at most four values
    per cookie name are read, and the browser sends a cookie with a longer path first), but cannot make a form
    succeed.
  - *Related decisions*: the summary of decision 0015 names "a signed double-submit CSRF token, bound to the
    session on signed-in forms".
- *Session* and *Sign-out* need no change beyond what the *CSRF protection* section says ("needs a valid CSRF
  token" then refers to the signed-in rule).

## Documentation updates

- `docs/areas/setup-wizard.md` — as under *Areas* (owner: **Dev**).
- `.squad/project.md`, *Security areas* → *Setup login*: "every form carries a signed double-submit CSRF token
  (`src/setup/csrf.ts`)" becomes "every form carries a signed double-submit CSRF token, which on the signed-in
  forms is also bound to the session (`src/setup/csrf.ts`)" (owner: **Dev**; the change makes the entry
  incomplete otherwise, *Scope of a product PR*).
- `CHANGELOG.md`: the setup login is still unreleased, so the existing `### Added` entry is amended instead of a
  new entry: "every form carries a CSRF token" becomes "every form carries a CSRF token, bound to the session on
  the forms behind the login" (owner: **Dev**).
- `docs/decisions/0015-setup-login.md` — edited in place by the **Lead** with this plan (see *Decision records*).
- `docs/ARCHITECTURE.md`, `docs/areas/storage.md` (no new key label), `README.md`, `docs/setup.md`: none.

## Architecture check

No guarantee of `.squad/project.md` or `docs/ARCHITECTURE.md` is touched. The setup login stays as described
(`ARCHITECTURE.md` lines 55-57 and 97-98 name it without CSRF detail); no new route, cookie, key, table or
dependency. The change narrows what a submission is accepted for; the owner's own flow is unchanged (the page
renders the token the submission is checked against).

## Security considerations

- [x] Limits: no new parsed input. The session token in the signed message has passed `isValidSessionToken`
  (at most 2 + 1 + 15 + 1 + 43 ASCII characters), the cookie value is checked well-formed (43 characters)
  before it is signed or verified, and at most four cookie values are verified per request (four HMAC
  verifications, as today).
- [x] Exceptions reaching the user: none new. A rejected token answers the existing 403 start page with the
  fixed *form expired* notice; `crypto.subtle` errors are not expected for well-formed inputs and are not caught
  differently than today.
- Constant time: `isValidSessionCsrfToken` verifies every candidate with `crypto.subtle.verify`, so the time
  does not tell which value matched — the same property `isValidCsrfToken` has; no measured claim is made.
- Bypass forms considered (the guard is "token verifies under the session and one cookie value"):
  a tossed cookie with the login token (AC6 third row) — rejected; the unbound token of the owner's own cookie
  (AC6 first row) — rejected; a token of another session (AC6 second row) — rejected; a tossed `seluna_session`
  — useless, it must verify under the session key; a session-bound token submitted at the login (AC9) —
  rejected; repeated or missing `csrf` fields — rejected as today (`hasValidCsrf` keeps the exactly-one-field
  rule); a non-canonical base64url text of a valid token — rejected (AC3 last row).

## Decision records

- `docs/decisions/0015-setup-login.md` — **edited in place** (not superseded): the commit that added it,
  `9ad6bdf`, is not contained in the only release tag `v0.1.0` (`37cff63`, `git merge-base --is-ancestor`
  fails), so 0015 is unreleased. Option 3 is narrowed to the login form, options 22–25 (binding of the signed-in
  token) are added, the *Decision* names the binding and *Consequences* records the remaining denial by cookie
  tossing and that #9–#11 use the signed-in scheme. Status stays `Accepted` (rule for unreleased records in
  `docs/decisions/README.md`); index row unchanged.

## Out of scope / follow-ups

- The disruption by cookie tossing (hiding the session or the CSRF cookie behind four tossed values) stays; it is
  denial only, limited to sibling hosts, and recorded in 0015. No follow-up issue.
- No `Origin` / `Sec-Fetch-Site` check (option 5).
