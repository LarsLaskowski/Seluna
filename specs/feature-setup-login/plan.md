# Plan: Setup wizard login and protection

Source: Issue #8 | [spec.md](spec.md)
Status: Draft
Tier: security — the change builds the *Setup login* security area of `.squad/project.md` (`/setup`, session
cookies, rate limit), adds a key derivation and a secret comparison to `src/crypto.ts`, and changes the test build
configuration (`vitest.config.ts`).

## Problem / root cause

Feature, summarized from [spec.md](spec.md): `/setup` and every path below it get a login with `SELUNA_SECRET`, a
12-hour signed session cookie, a lock after five failed attempts counted in D1, CSRF tokens in every form,
server-rendered bilingual HTML under a strict CSP, and a refusal page without a usable `SELUNA_SECRET`. The wizard
steps follow in #9–#11; this change gives them the signed-in branch to plug into.

The behavior is written down normatively, with every value, in the new area document
[`docs/areas/setup-wizard.md`](../../docs/areas/setup-wizard.md) (written in this step). Dev and Tester build and
test against it; where this plan and the area document differ, that is a plan defect to report, not a choice.

Claims of the issue and of the existing documents, checked against the code:

- "`/setup` answers 404 today" (`docs/areas/http-routes.md`): **confirmed** — `src/router.ts:73-81` routes only
  `GET /health` and `POST /webhook`, everything else falls through to 404.
- "`SELUNA_SECRET` missing or shorter than 32 characters" uses the same rule as the storage key: **confirmed** —
  `selunaSecretFromEnv` in `src/crypto.ts:48-54` (string, at least 32 code points, untrimmed); the new check reuses
  that private function, so both rules cannot drift.
- "Counter in D1": **confirmed as possible without a migration** — decision 0014 (*Consequences*) puts the
  failed-attempt counter in `meta`, which takes new keys without a migration (`migrations/0001_initial_schema.sql`,
  table `meta (key TEXT PRIMARY KEY, value TEXT)`).
- "Session key derived from `SELUNA_SECRET` with its own HKDF info next to `keyFromEnv`": required by decision 0007
  (*Consequences*) and `docs/areas/storage.md` (*Encryption*); **confirmed** that no such function exists yet.
- The body of a form submission must go through the bounded reader: **confirmed** as a rule (`.squad/project.md`,
  *Request body size*; `src/body.ts`, `readBodyWithLimit`).
- Related defect found on the way: `src/crypto.test.ts:204` pins the exported functions of `src/crypto.ts` to
  exactly `decrypt`, `encrypt`, `keyFromEnv` (decision 0007, option 17). This change must add exports there, so
  the pin is updated — by the Tester, see *Test files* — to the new list, which still has no function that derives
  a key from a plain string.
- `.dev.vars.example` and the `cloudflare.bindings` description in `package.json` already call `SELUNA_SECRET` "the
  password of the `/setup` page": **confirmed**, no change needed.

## Acceptance criteria

Test files are under *Test files* below. `H` = `src/setup/handler.test.ts`. Unless a criterion says otherwise, the
handler tests run with `env = { SELUNA_SECRET: <a 32+ character throwaway secret> }`, the real `env.DB` with the
migrations applied and the `meta` row `login_attempts` deleted before each test, and an injected clock.

- [ ] **AC1 — the login wall (issue AC1).** Without a valid session every request under `/setup` except
  `POST /setup/login` answers 200 with the login page (a form `method="post" action="/setup/login"` with an input
  `type="password" name="secret"` and a hidden input `name="csrf"`); `/setupx`, `/SETUP` and `/setup%2F` are not
  under `/setup` and answer 404 with an empty body.
  - H: `handleSetup answers %s %s without a session with 200 and the login page` — cases `GET /setup`,
    `GET /setup/`, `GET /setup/anything`, `GET /setup/login`, `POST /setup/logout`, `POST /setup/anything`,
    `PUT /setup`.
  - H: `handleSetup shows the login page for a session cookie that is %s` — cases: expired (clock at its expiry),
    MAC altered, signed under another `SELUNA_SECRET`, quoted (`"v1…"`), expiry more than 12 hours ahead.
  - `src/setup/handler.test.ts`: `isSetupPath returns %s for %s` — `/setup`, `/setup/`, `/setup/x` true;
    `/setupx`, `/SETUP`, `/setup%2F`, `/`, `/set` false.
  - `src/router.test.ts`: `handleRequest passes %s to the setup handler` (`/setup`, `/setup/x`: 200 login page)
    and `handleRequest answers %s with 404 and an empty body` (`/setupx`, `/SETUP`, `/setup%2F`).
  - `src/index.test.ts`: `GET /setup answers the login page through the Worker`.
- [ ] **AC2 — the lock (issue AC2).** The sixth attempt after five wrong secrets, each within 15 minutes of the
  previous one, answers 429 with the *locked* notice and no session cookie even with the correct secret; at
  15 minutes after the fifth failure the correct secret logs in; a successful login resets the count; parallel
  attempts get at most five checks.
  - H: `handleSetup rejects the sixth login within 15 minutes with 429 even with the correct secret`.
  - H: `handleSetup accepts the correct secret 15 minutes after the fifth failed attempt`.
  - H: `handleSetup resets the count after a successful login` (four wrong, one right, then five wrong are
    answered 403, not 429).
  - `src/store/login-attempts.test.ts`:
    - `reserveLoginAttempt allows five attempts in a row and locks the sixth`;
    - `reserveLoginAttempt keeps the lock until 15 minutes after the fifth attempt` (at +899,999 ms locked, at
      +900,000 ms allowed and the stored `failures` is 1);
    - `reserveLoginAttempt does not extend the lock with rejected attempts` (rejected attempts at +1 and +899,000 ms,
      allowed at +900,000 ms after the fifth);
    - `reserveLoginAttempt starts a new count when the last attempt is 15 minutes old` (four attempts, then one at
      +900,000 ms stores `failures` 1);
    - `reserveLoginAttempt starts a new count for a stored value that is %s` — not JSON, a JSON array, `failures`
      negative, `failures` 1.5, `last` a string, `last` missing;
    - `reserveLoginAttempt stores failures and last as a JSON object with integers in meta row login_attempts`
      (reads the row: `JSON.parse` gives `{ failures: 1, last: <now ms> }`, and `Number.isInteger` of both);
    - `reserveLoginAttempt allows exactly five of ten attempts sent at once` (`Promise.all`);
    - `clearLoginAttempts deletes the count so the next attempt is the first`.
- [ ] **AC3 — CSRF (issue AC3).** A login or logout submitted without a valid CSRF token answers 403 with the
  *form expired* notice and has no effect: no session cookie is set or cleared and no attempt is counted (the
  `meta` row `login_attempts` stays absent), also when the submitted secret is correct.
  - H: `handleSetup rejects a login with %s with 403 and does not count it` — cases: no `csrf` field, an empty
    one, a wrong token, the token of another cookie value, no `seluna_csrf` cookie, two `csrf` fields, a token
    made under another `SELUNA_SECRET`.
  - H: `handleSetup rejects a logout with %s with 403 and keeps the session` — cases: no `csrf` field, a wrong
    token.
  - H: `handleSetup sets a new seluna_csrf cookie on the login page when the request has none`.
  - H: `handleSetup renders the token of the request's seluna_csrf cookie and sets no new one`.
  - `src/setup/csrf.test.ts`: `newCsrfCookieValue returns 43 base64url characters`, `newCsrfCookieValue returns
    another value on every call`, `csrfTokenFor returns 43 base64url characters`, `isValidCsrfToken accepts the
    token of the cookie value`, `isValidCsrfToken accepts the token of the fourth cookie value`, `isValidCsrfToken
    rejects %s` — `null`, empty, the token of another cookie value, a token under another key, a malformed cookie
    value, the token of the fifth cookie value.
- [ ] **AC4 — the login itself.** The correct secret answers 303 with `Location: /setup` and the cookie
  `seluna_session=<token>; Max-Age=43200; Path=/setup; HttpOnly; Secure; SameSite=Strict`, whose token is valid;
  `GET /setup` with it shows the start page; a wrong, missing or repeated `secret` answers 403 with the *wrong
  secret* notice; the comparison is exact.
  - H: `handleSetup answers the correct secret with 303 to /setup and the session cookie`.
  - H: `handleSetup shows the start page for GET /setup with the session from the login`.
  - H: `handleSetup answers a %s secret with 403 and the wrong-secret notice` — wrong, missing field, two fields.
  - `src/crypto.test.ts`: `verifySelunaSecret returns true for exactly SELUNA_SECRET`, `verifySelunaSecret returns
    false for %s` — with a trailing space, without the last character, with one letter's case changed, with one
    character more, empty; `verifySelunaSecret returns false when SELUNA_SECRET is not configured`.
  - Constant time is not testable by a unit test: Security verifies by reading that `verifySelunaSecret` compares
    only through `crypto.subtle.verify` on HMAC values and has no early return that depends on the candidate.
- [ ] **AC5 — the session token.** `createSessionToken` returns `v1.<now + 43,200,000>.<43 base64url characters>`;
  `isValidSessionToken` accepts it until 1 ms before the expiry and rejects every other form.
  - `src/setup/session.test.ts`: `createSessionToken returns v1, the expiry 12 hours after now and a 43-character
    MAC`; `isValidSessionToken accepts a token 1 ms before its expiry`; `isValidSessionToken rejects a token at its
    expiry`; `isValidSessionToken rejects %s` — the expiry changed, one MAC character changed, a key from another
    secret, a leading zero in the expiry, 16 expiry digits, a padded MAC, `+` or `/` in the MAC, `v2`, a fourth
    segment, empty text, an expiry more than 12 hours after now.
  - `src/crypto.test.ts`: `isSelunaSecretConfigured returns %s for %s` (absent, a number, 31 characters, 31
    characters that are 32 UTF-16 units → false; 32 characters → true); `signingKeyFromEnv returns undefined when
    SELUNA_SECRET is not configured`; `signingKeyFromEnv derives different keys for setup-session and setup-csrf`
    (same message, different MACs); `signingKeyFromEnv derives the setup-session key with HKDF-SHA256, salt and info
    seluna/setup-session/v1` (a known HMAC computed outside the Worker, as for the storage key's vector).
  - `src/crypto.test.ts`: the existing pin, renamed `crypto exports decrypt, encrypt, isSelunaSecretConfigured,
    keyFromEnv, signingKeyFromEnv and verifySelunaSecret as its only functions`.
  - `src/base64url.test.ts`: `toBase64Url writes base64url without padding`; `fromBase64Url returns the bytes of
    base64url text`; `fromBase64Url returns undefined for %s` — padding `=`, `+`, `/`, a space, a length of 4n+1,
    a non-ASCII character.
- [ ] **AC6 — sign-out and the signed-in branch.** With a session and a valid CSRF token `POST /setup/logout`
  answers 303 to `/setup` with `seluna_session=; Max-Age=0; Path=/setup; HttpOnly; Secure; SameSite=Strict`; with a
  session every other path or method except `GET /setup` and `POST /setup/login` answers 404 with an empty body.
  - H: `handleSetup signs out with a valid CSRF token: 303 to /setup and an expired session cookie`.
  - H: `handleSetup answers %s %s with a session with 404 and an empty body` — `GET /setup/other`,
    `GET /setup/login`, `POST /setup`.
- [ ] **AC7 — refusal without a usable secret.** With `SELUNA_SECRET` absent, a number, or 31 characters, every
  request under `/setup` answers 503 with the *not configured* page (contains `SELUNA_SECRET`, `32`,
  `openssl rand -hex 32` and `wrangler secret put SELUNA_SECRET`, no `<form`), sets no session or CSRF cookie and
  counts nothing; 32 characters outside the Basic Multilingual Plane are usable.
  - H: `handleSetup answers %s %s with 503 and the not-configured page when SELUNA_SECRET is %s` — `GET /setup` and
    `POST /setup/login` (with an otherwise valid body), each for absent, a number, 31 characters.
  - H: `handleSetup shows the login page for a SELUNA_SECRET of 32 characters outside the Basic Multilingual Plane`.
- [ ] **AC8 — pages and headers.** Every response under `/setup` carries exactly the headers of the area document
  (*Pages and response headers*), the CSP hash being the SHA-256 of the page's style; no page has a script, an
  external resource or more than one `<style>`; text is escaped.
  - `src/setup/pages.test.ts`: `htmlResponse sets the security headers, Content-Type and Content-Language`
    (the test computes the hash of `STYLE` with `crypto.subtle.digest` itself and compares the whole CSP string);
    `the %s page in %s has no script, no external resource and exactly one style element` (login, start,
    not-configured × en, de: no `<script`, `<link`, `<img`, `<iframe`, no `http:`, `https:` or `//` in an `src`,
    `href` or `action`, one `<style>`); `escapeHtml escapes & < > " and '`; `renderLoginPage shows the %s notice`
    (each notice, compared with `TEXTS`); `the %s page sets html lang to %s`.
  - H: `handleSetup sets the security headers on %s` — the login page, the 303 of a login, a 404 with a session, a
    413.
  - `src/setup/texts.test.ts`: `texts define a non-empty text for every key in English and German`.
- [ ] **AC9 — language.** `?lang=en|de` wins and sets `seluna_lang` for a year; else the first valid
  `seluna_lang` cookie; else `Accept-Language` as the area document defines; else English.
  - `src/setup/language.test.ts`: `languageFromAcceptLanguage returns %s for %s` — the cases of *Real samples*
    below plus `null` → en, empty → en, `de;q=0.5,en;q=0.5` → de, `en;q=0.5,de;q=0.5` → en, `de;q=1.5` → en,
    `de;q=0.0001` → en, `de ; q=0.8` → de, `DE-at` → de, `deu` → en, `*` → en; `resolveLanguage takes %s` —
    query over cookie, cookie over header, header without query or cookie; `resolveLanguage ignores lang=%s` —
    `DE`, `english`, empty, `de-DE`.
  - H: `handleSetup renders German and sets seluna_lang for ?lang=de`; `handleSetup renders German for a
    seluna_lang=de cookie`; `handleSetup renders German for Accept-Language de-DE,de;q=0.9`.
- [ ] **AC10 — body limits.** A login body over 1 MiB answers 413 and an unreadable one 400, both with an empty
  body and no counted attempt.
  - H: `handleSetup answers a login body over 1 MiB with 413 and does not count it`; `handleSetup answers an
    unreadable login body with 400`.
- [ ] **AC11 — D1 failure.** A D1 error while counting answers 503 with the login page and the *unavailable*
  notice, without a session cookie and without the error text.
  - H: `handleSetup answers a login with 503 and the unavailable notice when D1 fails`. The failing database is the
    Tester's choice within the rules (no cast without a runtime check, *Test doubles* in `.squad/project.md`), for
    example a database binding of the test pool to which the migrations were not applied.
- [ ] **AC12 — logging.** A request under `/setup` is logged with method, path and status only.
  - `src/router.test.ts`: `handleRequest logs a setup login as method, path and status only` (the entry equals
    `{ method: "POST", path: "/setup/login", status: 403 }` for a wrong secret).
- [ ] **AC13 — cookies.** `setupCookie` writes `<name>=<value>` then `; Max-Age=<n>` when given, then
  `; Path=/setup; HttpOnly; Secure; SameSite=Strict`; `cookieValues` reads every value of a name in order.
  - `src/setup/cookies.test.ts`: `setupCookie writes Path=/setup, HttpOnly, Secure and SameSite=Strict`;
    `setupCookie writes Max-Age before the attributes when given`; `cookieValues returns every value of the name in
    header order`; `cookieValues returns %s for %s` — `null` header, no such name, another case of the name, spaces
    around pair and value, a value containing `=`, a quoted value (kept with its quotes), an empty value.

Content the issue supplies verbatim: none (no fixture, image or configuration).

### Real samples

`Accept-Language` is parsed by our own code. It is not a proprietary format: its grammar is normative in RFC 9110
§12.5.4 (with the weight of §12.4.2), so the parser is built from the RFC, not from the issue's description, and no
escalation for a sample is needed. The test table uses the default headers real browsers send (the area
document lists some of them as examples): Chrome with German UI `de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7`, Firefox with German UI
`de,en-US;q=0.7,en;q=0.3` → de, Chrome with English UI `en-US,en;q=0.9` → en, Safari `de-DE,de;q=0.9` → de, a
French browser with German second `fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7` → de. The `Cookie` header (RFC 6265 §5.4) and
the form body (`application/x-www-form-urlencoded`, parsed by the platform's `URLSearchParams`, WHATWG URL) are
standard formats too; the form body is not parsed by our code.

## Behavior coverage

| spec.md bullet | Criterion |
| -------------- | --------- |
| B1 paths | AC1 (`isSetupPath`, router cases) |
| B2 refusal | AC7 |
| B3 login page without session | AC1 |
| B4 comparison, 303 / 403 | AC4 |
| B5 session token and cookie | AC5, AC4 (cookie attributes), AC1 (invalid tokens) |
| B6 start page, 404 when signed in | AC4 (start page), AC6 (404) |
| B7 sign-out | AC6 |
| B8 lock | AC2 |
| B9 CSRF | AC3 |
| B10 pages, CSP, headers | AC8 |
| B11 language | AC9 |
| B12 body limits, D1 failure | AC10, AC11 |
| B13 logging, nothing echoed | AC12; nothing echoed: AC8 (`escapeHtml`, pages render only `TEXTS` and the CSRF token — Reviewer checks by reading that no page takes request data) |

## Approach

New directory `src/setup/` for the wizard, one module per concern; one new store module; additions to
`src/crypto.ts`; the router dispatches `/setup` to the wizard.

1. `src/base64url.ts` — base64url without padding, both ways; decoding checks `^[A-Za-z0-9_-]*$` and a length
   that is not 4n+1 **before** `atob`, because `atob` (forgiving base64) also accepts ASCII whitespace, `+`, `/`
   and padding.
2. `src/crypto.ts` — `isSelunaSecretConfigured`, `signingKeyFromEnv` (HKDF-SHA256 to an HMAC-SHA256 key, length
   256, usages `sign`/`verify`, non-extractable, salt = info = the purpose's label) and `verifySelunaSecret` (fresh
   random HMAC key from `crypto.subtle.generateKey`, `sign` over `SELUNA_SECRET`'s UTF-8 bytes, `verify` of that
   MAC against the candidate's UTF-8 bytes). All three go through the existing private `selunaSecretFromEnv`; no
   exported function returns the secret's text or derives a key from a plain string.
3. `src/store/login-attempts.ts` — one upsert with `RETURNING`, the semantics of the area document
   (*Failed attempts and the lock*). Guidance for the statement (the Dev may restructure it; the semantics and the
   integer storage are fixed):

   ```sql
   INSERT INTO meta (key, value) VALUES (?1, json_object('failures', 1, 'last', CAST(?2 AS INTEGER)))
   ON CONFLICT (key) DO UPDATE SET value = CASE
     WHEN json_valid(meta.value) = 0 THEN excluded.value
     WHEN json_type(meta.value, '$.failures') IS NOT 'integer'
       OR json_type(meta.value, '$.last') IS NOT 'integer' THEN excluded.value
     WHEN json_extract(meta.value, '$.failures') < 0 THEN excluded.value
     WHEN CAST(?2 AS INTEGER) - json_extract(meta.value, '$.last') >= ?3 THEN excluded.value
     WHEN json_extract(meta.value, '$.failures') < ?4
       THEN json_object('failures', json_extract(meta.value, '$.failures') + 1, 'last', CAST(?2 AS INTEGER))
     ELSE json_object('failures', json_extract(meta.value, '$.failures') + 1, 'last', json_extract(meta.value, '$.last'))
   END
   RETURNING json_extract(value, '$.failures') AS failures
   ```

   `CAST(?2 AS INTEGER)` is there because whether D1 binds a JavaScript number as INTEGER or REAL is not pinned
   (a REAL `last` would read as "not an integer" and reset the count on every attempt); the AC2 test that reads
   the stored row checks it. `CASE` stops at the first true `WHEN`, so `json_type` never sees malformed text. The
   returned `failures` is narrowed from `unknown`: an integer ≤ 5 is `allowed`, anything else (above 5, or a row
   of an unexpected shape) is `locked` — fail closed. D1 errors are not caught here.
4. `src/setup/cookies.ts`, `session.ts`, `csrf.ts`, `language.ts`, `texts.ts`, `pages.ts` — as in *Signatures*.
   `texts.ts` holds `TEXTS` typed `Readonly<Record<Language, SetupTexts>>`, so a missing text fails the type check.
   The English notices are the texts of the area document (*Texts*); the German ones are their translation (Dev,
   informal "du"). `pages.ts` renders by string templates; every interpolation goes through `escapeHtml`; the CSP
   hash is computed with `crypto.subtle.digest("SHA-256", …)` from the same `STYLE` constant the page embeds.
5. `src/setup/handler.ts` — `handleSetup` in the order of the area document (*Paths*, *Login*, *Sign-out*). The
   language is resolved first, so every page — the refusal too — is in the right language. The session key and
   the CSRF key are derived once per request after the configuration check. D1 errors of `reserveLoginAttempt`
   and `clearLoginAttempts` are caught (the error is dropped, as in `src/router.ts:verifyWebhook`) and answered
   with 503 and the *unavailable* notice.
6. `src/router.ts` — `RouteDeps` gains `setup: SetupDeps`; `route` sends every path for which `isSetupPath` holds,
   with any method, to `handleSetup` before the 404 fallback. Logging stays in `handleRequest`, unchanged.
7. `src/index.ts` — passes `setup: { env, db: env.DB, now: () => new Date() }`.
8. `vitest.config.ts` (Tester, with the tests of step 5) — a throwaway `SELUNA_SECRET` (at least 32 characters,
   commented as a test-only value) in the miniflare bindings, for the `src/index.test.ts` criterion.

## Options considered

The options and why each lost are in [decision 0015](../../docs/decisions/0015-setup-login.md): stateless signed
session vs. sessions in D1; signed double-submit CSRF vs. tokens in D1 vs. `SameSite`/`Origin` only; counting before
vs. after the check; the lock's timing (series with a full 15-minute lock vs. a fixed window vs. an extending lock);
a global count vs. per address; HMAC-and-verify vs. `timingSafeEqual`; where the secret's text stays; a hashed
inline style vs. a stylesheet route vs. `'unsafe-inline'`; a language link and cookie vs. a D1 setting.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/base64url.ts` | new |
| Worker | `src/crypto.ts` | three exports added (*Signatures*) |
| Worker | `src/store/login-attempts.ts` | new |
| Worker | `src/setup/cookies.ts`, `session.ts`, `csrf.ts`, `language.ts`, `texts.ts`, `pages.ts`, `handler.ts` | new |
| Worker | `src/router.ts` | `RouteDeps.setup`, dispatch of `/setup` |
| Worker | `src/index.ts` | builds `SetupDeps` |
| Test config | `vitest.config.ts` | throwaway `SELUNA_SECRET` binding |

Files the skeleton rewrites: `src/crypto.ts`, `src/router.ts`, `src/index.ts` (read; final apart from the listed
additions). No migration, no `wrangler.jsonc` change, no new dependency.

## Signatures (for the Dev's skeleton)

`src/base64url.ts`

```ts
/** Base64url (RFC 4648 §5) of `bytes`, without padding. */
export function toBase64Url(bytes: Uint8Array): string;
/** The bytes of base64url text without padding, or `undefined` for any other text (padding, `+`, `/`, whitespace, a length of 4n+1). */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined;
```

`src/crypto.ts` (added)

```ts
/** What a signing key derived from `SELUNA_SECRET` is for. */
export type SigningPurpose = "setup-session" | "setup-csrf";
/** HKDF salt and info of each signing key. */
export const SIGNING_KEY_LABELS: Readonly<Record<SigningPurpose, string>>; // "seluna/setup-session/v1", "seluna/setup-csrf/v1"
/** Whether `SELUNA_SECRET` in the Worker environment is a string of at least 32 code points (the rule of `keyFromEnv`). */
export function isSelunaSecretConfigured(env: object): boolean;
/** A non-extractable HMAC-SHA256 key (sign, verify) derived with HKDF-SHA256 from `SELUNA_SECRET`, salt and info the purpose's label; `undefined` when `SELUNA_SECRET` is not configured. */
export async function signingKeyFromEnv(env: object, purpose: SigningPurpose): Promise<CryptoKey | undefined>;
/** Whether the UTF-8 bytes of `candidate` equal those of `SELUNA_SECRET`, compared in constant time (HMAC under a fresh random key, `crypto.subtle.verify`); `false` when `SELUNA_SECRET` is not configured. */
export async function verifySelunaSecret(env: object, candidate: string): Promise<boolean>;
```

`src/store/login-attempts.ts`

```ts
/** `meta` key of the setup login's failed-attempt count. */
export const LOGIN_ATTEMPTS_META_KEY = "login_attempts";
/** Failed attempts after which the login is locked. */
export const MAX_FAILED_LOGINS = 5;
/** How long the lock lasts after the fifth failure, and how long a count is kept: 15 minutes. */
export const LOGIN_LOCK_MS = 900_000;
/** Whether a counted attempt may have its secret checked. */
export type LoginAttempt = "allowed" | "locked";
/** Counts one login attempt at `now` in one atomic statement and says whether its secret may be checked. D1 errors are not caught. */
export async function reserveLoginAttempt(db: D1Database, now: Date): Promise<LoginAttempt>;
/** Deletes the count after a successful login. D1 errors are not caught. */
export async function clearLoginAttempts(db: D1Database): Promise<void>;
```

`src/setup/cookies.ts`

```ts
/** The path every wizard cookie is scoped to. */
export const SETUP_COOKIE_PATH = "/setup";
/** At most this many values per cookie name are looked at. */
export const MAX_COOKIE_VALUES = 4;
/** Every value of the cookie `name` in a `Cookie` header, in header order: pairs split at `;`, name and value trimmed of spaces, the value neither unquoted nor decoded. */
export function cookieValues(header: string | null, name: string): readonly string[];
/** A `Set-Cookie` value: `<name>=<value>`, then `; Max-Age=<n>` when given, then `; Path=/setup; HttpOnly; Secure; SameSite=Strict`. */
export function setupCookie(name: string, value: string, maxAgeSeconds?: number): string;
```

`src/setup/session.ts`

```ts
export const SESSION_COOKIE = "seluna_session";
/** 12 hours. */
export const SESSION_LIFETIME_MS = 43_200_000;
/** `v1.<expires>.<mac>` for a session that expires 12 hours after `now`; `key` from `signingKeyFromEnv(env, "setup-session")`. */
export async function createSessionToken(key: CryptoKey, now: Date): Promise<string>;
/** Whether `token` has exactly the session form, its MAC verifies under `key`, and `now < expires <= now + 12 hours`. */
export async function isValidSessionToken(key: CryptoKey, token: string, now: Date): Promise<boolean>;
```

`src/setup/csrf.ts`

```ts
export const CSRF_COOKIE = "seluna_csrf";
export const CSRF_FIELD = "csrf";
/** 32 random bytes as base64url without padding (43 characters). */
export function newCsrfCookieValue(): string;
/** Whether `value` has the form of a CSRF cookie value (43 base64url characters). */
export function isWellFormedCsrfCookieValue(value: string): boolean;
/** The form token of a CSRF cookie value: HMAC-SHA256 of its UTF-8 bytes under `key` (from `signingKeyFromEnv(env, "setup-csrf")`), base64url without padding. */
export async function csrfTokenFor(key: CryptoKey, cookieValue: string): Promise<string>;
/** Whether `token` verifies, in constant time, against one of the first four well-formed values in `cookieValues`. */
export async function isValidCsrfToken(key: CryptoKey, token: string | null, cookieValues: readonly string[]): Promise<boolean>;
```

`src/setup/language.ts`

```ts
export type Language = "en" | "de";
export const LANGUAGE_COOKIE = "seluna_lang";
export const LANGUAGE_PARAMETER = "lang";
/** One year, in seconds. */
export const LANGUAGE_COOKIE_MAX_AGE = 31_536_000;
/** `value` when it is exactly `en` or `de`, otherwise `undefined`. */
export function parseLanguage(value: string | null | undefined): Language | undefined;
/** The language `Accept-Language` prefers (RFC 9110 §12.5.4, rules in the area document), English when it names neither. */
export function languageFromAcceptLanguage(header: string | null): Language;
/** The language of the response, and whether it came from the `lang` query parameter (then the cookie is set). */
export function resolveLanguage(request: Request): { readonly language: Language; readonly fromQuery: boolean };
```

`src/setup/texts.ts`

```ts
export type Notice = "wrong-secret" | "locked" | "form-expired" | "unavailable";
export interface SetupTexts {
  readonly pageTitle: string;
  readonly languageLabel: string;
  readonly loginHeading: string;
  readonly loginIntro: string;
  readonly secretLabel: string;
  readonly loginButton: string;
  readonly startHeading: string;
  readonly startBody: string;
  readonly logoutButton: string;
  readonly notConfiguredHeading: string;
  readonly notConfiguredParagraphs: readonly string[];
  readonly notices: Readonly<Record<Notice, string>>;
}
export const TEXTS: Readonly<Record<Language, SetupTexts>>;
```

`src/setup/pages.ts`

```ts
/** The content of every page's single `<style>` element. */
export const STYLE: string;
/** `text` with `&`, `<`, `>`, `"` and `'` replaced by character references. */
export function escapeHtml(text: string): string;
/** `default-src 'none'; style-src 'sha256-<base64 SHA-256 of STYLE>'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`. */
export async function contentSecurityPolicy(): Promise<string>;
export function renderLoginPage(language: Language, csrfToken: string, notice?: Notice): string;
export function renderStartPage(language: Language, csrfToken: string, notice?: Notice): string;
export function renderNotConfiguredPage(language: Language): string;
/** A page response with the security headers, `Content-Type: text/html; charset=utf-8`, `Content-Language` and one `Set-Cookie` per entry of `cookies`. */
export async function htmlResponse(page: string, status: number, language: Language, cookies: readonly string[]): Promise<Response>;
/** A response without a body with the security headers, `Location` when given and one `Set-Cookie` per entry of `cookies`. */
export async function emptyResponse(status: number, cookies: readonly string[], location?: string): Promise<Response>;
```

`src/setup/handler.ts`

```ts
/** What the wizard needs from outside. */
export interface SetupDeps {
  /** The Worker environment; `SELUNA_SECRET` is read from it only through `src/crypto.ts`. */
  readonly env: object;
  readonly db: D1Database;
  readonly now: () => Date;
}
export const SETUP_PATH = "/setup";
export const LOGIN_PATH = "/setup/login";
export const LOGOUT_PATH = "/setup/logout";
/** Whether `pathname` is `/setup` or starts with `/setup/`. */
export function isSetupPath(pathname: string): boolean;
/** Answers a request under `/setup` as the area document `setup-wizard.md` describes. */
export async function handleSetup(request: Request, pathname: string, deps: SetupDeps): Promise<Response>;
```

`src/router.ts` (changed)

```ts
export interface RouteDeps {
  readonly version: string;
  readonly log: (entry: RequestLogEntry) => void;
  readonly webhookSecret: WebhookSecretSource;
  readonly setup: SetupDeps;
}
```

## Test files

Named by *Layout* in `.squad/stack.md` (colocated `<module>.test.ts`):

- new: `src/base64url.test.ts`, `src/store/login-attempts.test.ts`, `src/setup/cookies.test.ts`,
  `src/setup/session.test.ts`, `src/setup/csrf.test.ts`, `src/setup/language.test.ts`, `src/setup/texts.test.ts`,
  `src/setup/pages.test.ts`, `src/setup/handler.test.ts`;
- extended: `src/crypto.test.ts`, `src/router.test.ts`, `src/index.test.ts`.

The tests use the real D1 binding with `applyMigrations` from `test/d1.ts`, the injected clock, and no real
network. The `src/store/login-attempts.test.ts` and handler tests delete the `meta` row `login_attempts` before each
test.

Existing test code a changed signature affects:

- `src/router.test.ts`, `makeDeps` (line 18): `RouteDeps` gains the required `setup` field. The **Dev** adds it in
  step 4, mechanically (for example `setup: { env: {}, db: env.DB, now: () => new Date(0) }`), so *Build* passes;
  no assertion changes.
- `src/crypto.test.ts:204`, the pin of the exported function names: its assertion changes with the new exports.
  The **Tester** updates it in step 5 (AC5); it fails on the skeleton and passes once the exports exist.

Files of the change no unit test can cover: none. Every new module runs in the Workers test pool; `src/index.ts`
stays covered by `src/index.test.ts`.

## Areas

- New area **Setup wizard**, [`docs/areas/setup-wizard.md`](../../docs/areas/setup-wizard.md), with its index row
  in `docs/areas/README.md` — a Lead decision: the wizard is one component in `ARCHITECTURE.md` and #9–#11 extend
  it. Scope: the pages under `/setup`, the refusal, login and lock, session, CSRF, page and header rules,
  languages. Written in this step.
- [`http-routes.md`](../../docs/areas/http-routes.md): `/setup` now belongs to the wizard; which setup routes read
  a body; the "no body" rule holds outside `/setup`. Edited in this step.
- [`storage.md`](../../docs/areas/storage.md): `meta` holds `login_attempts`; the setup keys' HKDF labels. Edited in
  this step.
- [`deployment.md`](../../docs/areas/deployment.md): without a usable `SELUNA_SECRET` `/setup` answers 503. Edited
  in this step.

## Documentation updates

Each with one owner:

| File | Change | Owner |
| ---- | ------ | ----- |
| `docs/areas/setup-wizard.md`, `docs/areas/README.md`, `http-routes.md`, `storage.md`, `deployment.md` | as under *Areas* | Lead (done in step 2; a deviation the build needs is reported by the Dev, and the Lead edits) |
| `docs/ARCHITECTURE.md` | *Endpoints*: `/setup` behind the login; *D1 tables* `meta`; *Configuration*: `SELUNA_SECRET` is the login password; *Security model*: link decision 0015 | Lead (done in step 2) |
| `docs/decisions/0015-setup-login.md`, index row; `0011-public-http-surface.md` *Decision* names `/setup` (unreleased, edited in place) | | Lead (done in step 2) |
| `CHANGELOG.md` | under `## [Unreleased]` / `### Added`: "Setup login: `/setup` asks for `SELUNA_SECRET` (compared in constant time) and keeps the owner signed in for 12 hours with a signed `HttpOnly`, `Secure`, `SameSite=Strict` cookie; after 5 failed attempts the login is locked for 15 minutes; every form carries a CSRF token; the pages use no scripts or external resources, a strict Content-Security-Policy, and English or German. Without a `SELUNA_SECRET` of at least 32 characters the page explains how to set it." | Dev |
| `docs/setup.md` | *Next steps*: replace "The `/setup` wizard follows in a later version." with "Open `https://<worker>.<your-subdomain>.workers.dev/setup` and sign in with your `SELUNA_SECRET`. The setup steps follow in a later version." (the 503 sentence stays) | Dev |
| `.squad/project.md` | *Security areas*, the *Setup login* bullet, replaced by: "**Setup login:** `/setup` and every path below it (`src/setup/`) answer only the login page — or, without a `SELUNA_SECRET` of at least 32 characters, a page that explains how to set it — until the owner signs in with `SELUNA_SECRET`, compared in constant time (`verifySelunaSecret` in `src/crypto.ts`). The session is an HMAC-SHA256-signed token with a 12-hour expiry (`src/setup/session.ts`, key from `signingKeyFromEnv`) in a cookie with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/setup`; every form carries a signed double-submit CSRF token (`src/setup/csrf.ts`); attempts are counted in the `meta` row `login_attempts` before the secret is checked and lock the login for 15 minutes after 5 failures (`src/store/login-attempts.ts`); pages have no script or external resource and a strict Content-Security-Policy (`src/setup/pages.ts`) (decision 0015)." | Dev |

No change to `README.md`, `.dev.vars.example` or the `cloudflare.bindings` description (both already call
`SELUNA_SECRET` the password of `/setup`).

## Architecture check

- Guarantees in `.squad/project.md` / `docs/ARCHITECTURE.md`: none weakened. An invalid webhook signature, delivery
  deduplication, the outbox and the encrypted credentials are untouched; the wizard reads no credential yet.
- The setup login was already a documented security area and the *Security model* already names it; this change
  implements it and links decision 0015.
- Only `src/store/` touches D1 (the new `login-attempts.ts`); no migration (decision 0014 puts the counter in
  `meta`).
- Decision 0007: no exported function derives a key from a plain string, the storage key is not reused, the setup
  keys have their own HKDF labels — kept (AC5 pin).
- Decision 0011: `/setup` is a new public surface; its POST routes use the bounded reader, and each request is still
  logged as method, path and status. Its *Decision* text is edited in place (unreleased) to name the wizard.

## Security considerations

- [x] Limits on parsed input: the login and logout body is limited to 1 MiB **in bytes before decoding**
  (`readBodyWithLimit`); decoding (UTF-8 with replacement, then `URLSearchParams`) never yields more UTF-16 units
  than bytes, so the parsed text is bounded by the same number. At most four values per cookie name are looked at
  (each costs an HMAC). `Accept-Language` and `Cookie` have no limit of ours beyond the platform's header size;
  their parsing is linear. The candidate secret is not length-capped beyond the body limit (an HMAC over 1 MiB is
  cheap; a cap would make a longer `SELUNA_SECRET` unusable).
- [x] Exceptions that reach the user: D1 errors in the login flow → 503 with the fixed *unavailable* notice (error
  dropped). Body read failures → 400/413 without a body (values, not exceptions). Web Crypto failures (HKDF,
  HMAC, `getRandomValues`) are not expected and not caught: the runtime answers with its generic error, which
  carries no text of ours or of the request; this is the existing behavior for unexpected errors (decision 0011,
  option 9). No page shows a runtime message.

Guards against bypasses — the forms each parser really accepts, and the guard's answer:

| Input | Parser and the forms it accepts | Guard |
| ----- | ------------------------------- | ----- |
| Path | WHATWG URL: resolves `.`/`..` and `%2e`/`%2E` dot segments, turns `\` into `/` for `https:`, keeps other percent escapes (`%2F`) and case | `isSetupPath` on the parsed `pathname`, exact `/setup` or prefix `/setup/`. A path outside it is 404 or another route; a path inside it gets the full check. It cannot fail open: being outside means no wizard code runs. |
| Session cookie | Our `cookieValues`: any text between `=` and `;`, trimmed; quotes and escapes kept | Exact regex `^v1\.(?:0\|[1-9]\d{0,14})\.[A-Za-z0-9_-]{43}$` before any HMAC; MAC over the exact text; expiry window. Quoted, padded, standard-base64, leading-zero, overlong forms fail (AC5 cases). |
| CSRF cookie | as above | 43 base64url characters, else ignored. |
| CSRF field | `URLSearchParams`: `+` → space, `%XX` decoded (names too: `%63srf` is `csrf`), broken escapes literal, empty pairs skipped, `;` not a separator, names may repeat | `getAll("csrf")` must have exactly one entry, which must verify (AC3: missing, empty, repeated, wrong). |
| `secret` field | as above | `getAll("secret")` must have exactly one entry; compared byte-exact (AC4). |
| Body `Content-Type` | ignored: the body is always parsed as urlencoded | A `multipart/form-data` or `text/plain` body yields no valid `csrf` field unless it carries a valid token, which a cross-site page cannot know. |
| `lang` parameter, `seluna_lang` cookie | `URLSearchParams.get`, `cookieValues` | Exactly `en` or `de` (AC9). |
| Base64url text | `atob` (forgiving: also whitespace, `+`, `/`, padding) | `fromBase64Url` checks `^[A-Za-z0-9_-]*$` and the length first (AC5). |

Claims that rest on platform behavior, marked *unverified* until measured:

- **U1** D1 runs `INSERT … ON CONFLICT … DO UPDATE … RETURNING` with SQLite's JSON functions, and one statement is
  atomic, so concurrent attempts are never lost. Measured by the AC2 store tests in the Workers test pool (ten
  attempts at once → exactly five allowed; the stored row holds integers), run by the Dev before the review;
  production D1 is the same SQLite engine, and Cloudflare documents its JSON functions. Security re-checks the
  test in its review. Decision 0015 states it only with this test as its basis.
- **U2** HKDF in workerd derives an HMAC key (`deriveKey` to `{ name: "HMAC", hash: "SHA-256", length: 256 }`):
  measured by the AC5 crypto tests including the known vector.
- **U3** `crypto.subtle.verify` for HMAC compares in constant time: the runtime's documented behavior, already
  relied on by decision 0012; not measurable by a unit test.

## Decision records

- `docs/decisions/0015-setup-login.md` (Proposed), indexed.
- `docs/decisions/0011-public-http-surface.md` — *Decision* text edited in place to name `/setup` (unreleased;
  status stays `Accepted`).

## Out of scope / follow-ups

- Wizard steps (#9, #10, #11): they plug into the signed-in branch of `handleSetup`; #10 widens `form-action` for
  its manifest page.
- Server-side revocation of sessions; an owner-only unlock of the global lock (decision 0015, *Consequences*).
- A `SELUNA_SECRET` containing a line break cannot be typed into a password field; the area document says so, and
  #20's documentation can warn about it. No follow-up issue.
