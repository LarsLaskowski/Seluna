# Plan: GitHub App authentication

Source: Issue #15 | [spec.md](spec.md)
Status: Revised (1)
Tier: security — the change creates security controls: authentication as the app (a JWT signed with the private key), the storage and handling of installation tokens, and allow-lists on what enters a GitHub URL or header.
Security areas touched: Encrypted credentials (`token_cache` written and read in the new `src/store/token-cache.ts`; App ID and private key read in the new `src/github/app-credentials.ts`); Setup login (the signed-in status page `GET /setup` now calls GitHub, `src/setup/status.ts`, `src/setup/handler.ts`); GitHub App manifest flow (`toPkcs8Pem` in `src/github/private-key.ts`, parsing shared with `importSigningKey`, behavior unchanged and pinned by the unchanged `toPkcs8Pem` tests in `src/github/private-key.test.ts`); Parsing of external input (the token answer, the installations list and the pull request answer narrowed in `src/github/installation-token.ts`, `src/github/installations.ts`, `src/github/api-client.ts`); new area **GitHub App authentication** (`src/github/app-jwt.ts`, `src/github/http.ts`, `src/github/private-key.ts` and the files above), added to `.squad/project.md` by this change

## Problem / root cause

See [spec.md](spec.md), *Problem*: Seluna has App ID and key but nothing turns them into an API credential.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | `token_cache (installation_id INTEGER PK, iv TEXT CHECK length 16, ciphertext, expires_at INTEGER)` exists; only the reset touches it | `migrations/0001_initial_schema.sql` (table `token_cache`); `grep token_cache src` finds only `src/store/secrets.ts:233` (reset) and `schema.ts:2` | confirmed |
| 2 | The stored key is a PKCS#8 PEM that imports as RS256; the PKCS#1 wrap exists but only `toPkcs8Pem` is exported | `src/github/private-key.ts:33-81`; `docs/areas/storage.md` (*Tables*, `github_private_key`) | confirmed |
| 3 | Per-credential precedence of the Worker secrets is the documented rule, as `webhookSecretSource` does it | `docs/ARCHITECTURE.md` *Configuration*; 0017 *Consequences* ("#15 reads … with the same per-credential precedence"); `src/webhook-secret.ts:16-31` | confirmed |
| 4 | `appStatus` reports `partial-worker-secrets` before reading D1 and `worker-secrets` only with all three secrets | `src/setup/status.ts:39-46`, `src/github/worker-secrets.ts:9-19` | confirmed |
| 5 | The existing GitHub request uses `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: seluna/<version>`, `redirect: "manual"`, `AbortSignal.timeout(10_000)`, bounded read 1 MiB | `src/github/conversion.ts:8-11,107-122`; `src/body.ts:72-84` | confirmed |
| 6 | `SetupDeps` already carries `githubFetch`, `now` and `version`; `startPage` turns any thrown error into 503 | `src/setup/handler.ts:62-74,547-557` | confirmed |
| 7 | Webhook payloads carry `installation.id` | `test/fixtures/pull_request/opened.json`: `installation.id` 1000003 | confirmed |
| 8 | Token answer (201): schema `installation-token`, required `token` and `expires_at` (strings); other documented statuses 401, 403, 404, 422 | OpenAPI description (`github/rest-api-description`, `main`, downloaded 2026-10-19), `paths./app/installations/{installation_id}/access_tokens.post` | confirmed |
| 9 | Installations list (200): array of `installation`; `id` integer; `account` nullable `anyOf` `simple-user` (requires `login`, `type`) / `enterprise` (requires `slug`, has no `login`, `type`); `repository_selection` enum `all`/`selected`; `suspended_at` nullable date-time; `Link` header, example `<…?page=2>; rel="next", <…?page=5>; rel="last"`; parameter `per_page` | same description, `paths./app/installations.get`, `components.schemas.installation`, `components.headers.link` | confirmed |
| 10 | Documented token `ghs_16C7e42F292c6912E7710c838347Ae178B4a` (40 characters of `[A-Za-z0-9_]`), `expires_at` `2016-07-11T22:14:10Z` | `components.examples.installation-token.value` | confirmed |
| 11 | Real installation tokens and `expires_at` values have these forms, and the real installations list has the documented shape and `Link` header | to verify: Product Manager's live check on a deployed copy before the PR is marked ready (step 11): the status page lists the installation, a token request succeeds and a second call reuses the cached row | unverified |
| 12 | The real pull request answer has a boolean `draft` | `gh api repos/LarsLaskowski/Seluna/pulls/77` (HTTP 200, captured by the orchestrator, scratch `captures/pulls-77.json`): `"draft": false` | confirmed |
| 13 | GitHub's JWT rules: RS256, `iat` backdated 60 s against clock drift, `exp` at most 10 min ahead, `iss` App ID or client ID | github/docs `generating-a-json-web-token-jwt-for-a-github-app.md` (spec Q4) | confirmed |
| 14 | One RS256 signature with WebCrypto stays well within the free plan's CPU time per request | Security measured in workerd (compat date 2026-08-22): 2048-bit fixture key, 1001 signatures in 661 ms (about 0.65 ms each); the PM's dashboard reading stays the production check | confirmed |
| 15 | Workers' `fetch` with `redirect: "manual"` returns a 3xx answer instead of following it | Security measured in workerd: a local 302 came back as status 302, `ok` false, with `Location`; the target was never requested | confirmed |
| 19 | In workerd the request's `AbortSignal.timeout` also aborts reading the answer's body | Security measured in workerd: `AbortSignal.timeout(2000)`, body trickling 1 byte/s: `r.text()` failed with `TimeoutError` at 2004 ms. Holds while `sendGitHub` reads the body of the `Response` of the `Request` that carries the signal | confirmed |
| 16 | The Workers test pool can export an extractable RSA private key as JWK, so a test derives the public key and verifies the JWT | to verify: Tester, step 5, first run of `app-jwt.test.ts`; fallback: a public key PEM made with `openssl rsa -pubout` from the documented key, as a fixture with its README row | unverified |
| 17 | `githubDouble` rejects every URL but the conversion and fails the test | `test/github.ts:113-139` | confirmed |
| 18 | `statusView` and `StatusView` are built by tests | `src/setup/status.test.ts:43,134,140`; `src/setup/pages.test.ts:494` (`statusViewWith`) | confirmed |

Issue claims: two simultaneous installations of the private app — refuted (spec Q1; AC1 tests two ids); tokens cached in D1 — the table is unused (fact 1). Related defect: none.

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `isPullRequestDraft requests, stores and uses a token per installation id for two installations`; `isPullRequestDraft sends no token request when both installations have a cached token`; `a token request for one installation leaves the other installation's row unchanged` | `src/github/api-client.test.ts` |
| AC2 | `installationToken reuses a cached token that expires more than 5 minutes after now`; `installationToken renews a token that expires $case` (exactly 5 min, 1 ms less, already expired) and replaces the row | `src/github/installation-token.test.ts` |
| AC3 | `appJwt writes the RS256 header and the claims iat now − 60 s, exp now + 540 s, iss the App ID`; `appJwt's signature verifies with the documented key's public key`; `installationToken posts to /app/installations/<id>/access_tokens with the app JWT` | `src/github/app-jwt.test.ts`, `src/github/installation-token.test.ts` |
| AC4 | `writeCachedToken stores a row that decrypts with exactly token_cache/<id>/<expires_at>`; `no column of a written row contains the token`; `readCachedToken treats $case as no cached token` (changed `expires_at`, altered ciphertext, another `SELUNA_SECRET`, malformed IV); `installationToken replaces a row that does not decrypt` | `src/store/token-cache.test.ts`, `src/github/installation-token.test.ts` |
| AC5 | `gitHubRequest sets Accept, X-GitHub-Api-Version, User-Agent seluna/<version>, Bearer authorization, redirect manual and a timeout signal`; `isPullRequestDraft sends the app JWT to /app/... and the installation token to /repos/...`; `listInstallations sends the app JWT` | `src/github/http.test.ts`, `src/github/api-client.test.ts`, `src/github/installations.test.ts` |
| AC6 | `isPullRequestDraft fails without a request: $case` (the cases of *Guards*, below); `resolveAppCredentials reports no-app or key-unusable: $case` | `src/github/api-client.test.ts`, `src/github/app-credentials.test.ts` |
| AC7 | `isPullRequestDraft fails and caches nothing when the token request $case`; `isPullRequestDraft fails when the repository request $case`; `isPullRequestDraft fails without the repository request when writing the cache fails`; each asserts the result equals `{ kind: "failed" }` | `src/github/api-client.test.ts` |
| AC8 | `a 401 deletes the cached row the request used`; `a 401 deletes the row stored in the same call`; `a 401 leaves a row another call replaced in between`; `a 404 leaves the row` | `src/github/api-client.test.ts` |
| AC9 | `two concurrent calls for one installation without a cached token both succeed and leave one row` | `src/github/api-client.test.ts` |
| AC10 | `isPullRequestDraft answers false for the captured pull request and true for its draft variant` | `src/github/api-client.test.ts` |
| AC11 | `parseInstallations narrows $case` (each account form of E14, suspended, `null`); `parseInstallations rejects the whole list for $case` (E6); `the status section lists $case` with escaped login and slug; `statusView lists the installations for an app from Worker secrets and for a saved app` | `src/github/installations.test.ts`, `src/setup/pages.test.ts`, `src/setup/status.test.ts` |
| AC12 | `hasNextPage is $expected for $case` (documented header, `rel="last"` only, absent, `rel=next` unquoted); `listInstallations keeps at most 100 entries`; `the status section shows not installed for an empty list`; `the status section shows the more installations text exactly when more is set` | `src/github/installations.test.ts`, `src/setup/pages.test.ts` |
| AC13 | `statusView shows installations unavailable when $case`; `statusView shows key unusable for $case`; `statusView hides the installations and calls GitHub for nothing when the app is $case`; `GET /setup answers 200 with installations unavailable when GitHub fails` | `src/setup/status.test.ts`, `src/setup/handler.test.ts` |
| AC14 | `resolveAppCredentials takes $case` (each secret on its own, both, none, partial with a saved app); `importSigningKey imports the documented key as PKCS#1 and as PKCS#8`; `importSigningKey rejects an RSA key of more than 4096 bits` | `src/github/app-credentials.test.ts`, `src/github/private-key.test.ts` |
| AC15 | `the installations texts are the $language texts of the spec` | `src/setup/pages.test.ts` |

## Approach

1. **Key and JWT.** `importSigningKey` in `private-key.ts` shares the PEM parsing with `toPkcs8Pem` (unchanged
   behavior: `PEM_FORM`, the canonical base64 check, the 16,384-character bound and the PKCS#1 wrap stay as they are,
   and the existing `toPkcs8Pem` tests stay unchanged and must pass on the rewrite) and imports a non-extractable
   `sign` key; a key whose `algorithm.modulusLength` exceeds 4096 is refused (`undefined`, so _key unusable_), which
   bounds the signing cost per request. `toPkcs8Pem` gets no size bound (the wizard's behavior stays unchanged). `appJwt` builds header and claims (`Math.floor(now / 1000)`
   − 60 and + 540), signs with `crypto.subtle.sign`, encodes with `toBase64Url` from `src/base64url.ts`.
2. **Credentials.** `resolveAppCredentials`: App ID first — `GITHUB_APP_ID` when a non-empty string, else
   `readSecret("github_app_id")` (needs `keyFromEnv`); `parseAppId` (`^[1-9]\d{0,15}$`, safe integer) or `no-app`.
   Then the key — `GITHUB_APP_PRIVATE_KEY` or `readSecret("github_private_key")`; `missing` → `no-app`,
   `secret-changed`/`corrupt` or a failed import → `key-unusable`. D1 errors propagate. `status.ts` uses
   `parseAppId` instead of its own `APP_ID_FORM`.
3. **Requests.** `gitHubRequest` builds every request (headers of fact 5, `Authorization: Bearer`, `redirect:
   "manual"`, `AbortSignal.timeout(GITHUB_TIMEOUT_MS)`); `sendGitHub` reads a 2xx answer with `readJsonWithLimit`
   (`undefined` → `failed`), cancels the body of a non-2xx (`refused` with status), maps a rejection to `failed`.
   `conversion.ts` stays as it is.
4. **Token cache store.** Upsert `INSERT … ON CONFLICT (installation_id) DO UPDATE SET iv, ciphertext, expires_at`;
   read narrows the row (strings, integer `expires_at`), decrypts with `token_cache/${id}/${expiresAt}` and
   re-checks `isInstallationTokenText`; delete `WHERE installation_id = ?1 AND iv = ?2`. No key check guard
   (decision 0026, option 9).
5. **Installation token.** `installationToken`: cached row with `expiresAt - now > 300_000` → reuse; else app JWT,
   `POST /app/installations/${id}/access_tokens` (no body), `parseInstallationToken` (token
   `^[A-Za-z0-9_]{1,255}$`; `expires_at` `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`,
   `Date.parse` finite and more than 5 minutes after now), then `writeCachedToken` and return token and IV.
6. **API client.** `isPullRequestDraft` validates installation id, owner, name and number, resolves credentials,
   derives the storage key (`keyFromEnv`, else failure), gets the token, sends `GET
   /repos/${owner}/${repo}/pulls/${String(number)}`; 2xx → `parsePullRequestDraft`; 401 → `deleteCachedToken(id,
   iv)`; one `try`/`catch` around all of it maps any throw to `{ kind: "failed" }`. `installationIdOf` narrows
   `payload.installation.id` for #16.
7. **Installations.** `listInstallations` sends `GET /app/installations?per_page=100` with a fresh JWT,
   `parseInstallations` (all-or-nothing, at most 100 entries), `hasNextPage(response Link)`.
8. **Status page.** `statusView` computes `installations` after `app`: `hidden` unless `app.kind` is
   `worker-secrets` or `saved`; then `resolveAppCredentials` → `no-app` → `unavailable`, `key-unusable` →
   `key-unusable`, `ok` → `listInstallations` (`failed` → `unavailable`). `pages.ts` renders after the _GitHub App:_
   line: nothing (`hidden`); `<p>{label} {text}</p>` for _not installed_ (empty list), _installations unavailable_ and
   _key unusable_; otherwise `<p>{label}</p>\n<ul>\n<li>{entry}</li>…\n</ul>` and, when `more`,
   `\n<p>{more installations}</p>`. Entry: `escapeHtml(login or slug) + " (" + account type + "), " + selection`,
   or `unknown account + ", " + selection`, then `", " + suspended` when suspended. Account type: `User` →
   personal, `Organization` → organization, else other; slug → enterprise.

### Guards (allow-lists before a URL or header)

The WHATWG URL parser (Workers `Request`) treats `/`, `\`, `?`, `#` as delimiters, normalizes the dot segments `.`,
`..` and their percent-encoded forms `%2e`, `.%2e`, and percent-decodes nothing else. Accepted forms per guard:

| Input | Accepted | Rejected (cases of AC6) |
| ----- | -------- | ----------------------- |
| installation id, pull number | `number`, `Number.isSafeInteger`, > 0, written with `String()` (digits only) | `0`, `-1`, `1.5`, `2 ** 53`, `NaN`, `Infinity`, a string `"42"` |
| owner | `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$` — `isAccountName` of `src/github/manifest.ts`, which `isRepositoryOwner` calls (no second copy of the regex) | `""`, `-a`, `a-`, 40 characters, `a/b`, `a\b`, `a%2fb`, `a?b`, `a#b`, `.`, non-ASCII `ö` |
| repository name | `^[A-Za-z0-9._-]{1,100}$`, not `.` or `..` | `.`, `..`, `%2e`, `a/b`, `a\b`, `a?b`, `a#b`, `""`, 101 characters, a space |
| token (cache and answer) | `^[A-Za-z0-9_]{1,255}$` | `""`, 256 characters, `a-b`, `a b`, `a\r\nX: y`, non-ASCII |

`...` passes the name guard and is no dot segment for the URL parser. The JWT is base64url and never comes from
input.

### Test double and fixtures

`test/github.ts` gains `githubApiDouble(routes)`: answers by method and URL — the conversion, `POST
/app/installations/<id>/access_tokens`, `GET /app/installations?per_page=100`, `GET /repos/<o>/<r>/pulls/<n>` — each
route a `GitHubAnswer`, a sequence (one per request, the last repeated) or a function of the request; it records every
request with its `Authorization` header and fails the test on any other URL. `githubDouble(answer)` keeps its
signature as a wrapper. `GitHubAnswer` `raw`/`json` gain optional `headers` (for `Link`).

Fixtures under `test/fixtures/github/` (Tester): `pull-request.json` — the captured answer of pull request 77,
anonymized as `.squad/project.md` *Fixtures from real deliveries* prescribes, structure and `draft` untouched, leak
grep done (the draft variant is built in the test from it); `installation-token.json` —
`components.examples.installation-token.value` verbatim; `installations.json` —
`components.examples.base-installation-items.value` verbatim (one `User` account, `selected`); other account forms
and 100-entry lists are built in tests from it. The README's table gains the three rows, marked real or
reference-built.

## Options considered

Seven real alternatives, each with why it lost, are in decision 0026 (*Options considered*): a JWT library instead of
own WebCrypto code; a token per call or an isolate-memory cache instead of D1; the key check guard on token writes;
deleting by installation id, or not at all, after a 401; the client ID as `iss`; an uncached token without
`SELUNA_SECRET`; a cached installations list.

## Affected projects and types

New: `src/github/app-jwt.ts`, `http.ts`, `app-credentials.ts`, `installation-token.ts`, `installations.ts`,
`api-client.ts`, `src/store/token-cache.ts`. Changed: `src/github/private-key.ts`, `src/setup/status.ts`,
`src/setup/handler.ts` (`startPage` passes `{ fetcher: githubFetch, now }`), `src/setup/pages.ts`, `src/setup/texts.ts`
(13 texts per language); tests: `test/github.ts`, `test/fixtures/github/`.

## Signatures (for the Dev's skeleton)

```ts
// src/github/private-key.ts
export const MAX_SIGNING_KEY_BITS = 4096;
export async function importSigningKey(pem: string): Promise<CryptoKey | undefined>; // never throws; undefined above MAX_SIGNING_KEY_BITS

// src/github/app-jwt.ts
export const JWT_BACKDATE_SECONDS = 60;
export const JWT_LIFETIME_SECONDS = 600;
export async function appJwt(signingKey: CryptoKey, appId: number, now: Date): Promise<string>;

// src/github/http.ts
export type GitHubReply =
  | { readonly kind: "ok"; readonly body: unknown; readonly link: string | null }
  | { readonly kind: "refused"; readonly status: number }
  | { readonly kind: "failed" };
export function gitHubRequest(method: "GET" | "POST", path: string, version: string, bearer: string): Request;
export async function sendGitHub(fetcher: GitHubFetch, request: Request): Promise<GitHubReply>; // never throws

// src/github/app-credentials.ts
export interface AppCredentials { readonly appId: number; readonly signingKey: CryptoKey }
export type AppCredentialsResult =
  | { readonly kind: "ok"; readonly credentials: AppCredentials }
  | { readonly kind: "no-app" }
  | { readonly kind: "key-unusable" };
export function parseAppId(text: string): number | undefined;
export async function resolveAppCredentials(env: object, db: D1Database): Promise<AppCredentialsResult>; // D1 errors reject

// src/store/token-cache.ts
export interface CachedToken { readonly token: string; readonly expiresAt: number; readonly iv: string }
export async function readCachedToken(db: D1Database, key: CryptoKey, installationId: number): Promise<CachedToken | undefined>;
export async function writeCachedToken(db: D1Database, key: CryptoKey, installationId: number, token: string, expiresAt: number): Promise<string>; // the IV
export async function deleteCachedToken(db: D1Database, installationId: number, iv: string): Promise<void>;

// src/github/installation-token.ts
export const TOKEN_RENEWAL_MARGIN_MS = 300_000;
export interface InstallationToken { readonly token: string; readonly expiresAt: number }
export interface IssuedToken { readonly token: string; readonly iv: string }
export interface TokenDeps {
  readonly db: D1Database; readonly storageKey: CryptoKey; readonly fetcher: GitHubFetch;
  readonly now: () => Date; readonly version: string;
}
export function isInstallationTokenText(text: string): boolean;
export function parseInstallationToken(body: unknown, now: Date): InstallationToken | undefined;
export async function installationToken(deps: TokenDeps, credentials: AppCredentials, installationId: number): Promise<IssuedToken | undefined>; // D1 errors reject

// src/github/installations.ts
export const MAX_INSTALLATIONS = 100;
export type InstallationAccount =
  | { readonly kind: "login"; readonly login: string; readonly type: string | undefined }
  | { readonly kind: "enterprise"; readonly slug: string }
  | { readonly kind: "unknown" };
export interface Installation {
  readonly id: number; readonly account: InstallationAccount;
  readonly repositorySelection: "all" | "selected"; readonly suspended: boolean;
}
export type InstallationsResult =
  | { readonly kind: "listed"; readonly installations: readonly Installation[]; readonly more: boolean }
  | { readonly kind: "failed" };
export function parseInstallations(body: unknown): readonly Installation[] | undefined;
export function hasNextPage(link: string | null): boolean;
export async function listInstallations(fetcher: GitHubFetch, version: string, now: Date, credentials: AppCredentials): Promise<InstallationsResult>; // never throws

// src/github/api-client.ts
export interface GitHubApiDeps {
  readonly env: object; readonly db: D1Database; readonly fetcher: GitHubFetch;
  readonly now: () => Date; readonly version: string;
}
export interface PullRequestRef { readonly owner: string; readonly repo: string; readonly number: number }
export type DraftResult = { readonly kind: "ok"; readonly draft: boolean } | { readonly kind: "failed" };
export function installationIdOf(payload: unknown): number | undefined;
export function isRepositoryOwner(text: string): boolean; // returns isAccountName(text)
export function isRepositoryName(text: string): boolean;
export function parsePullRequestDraft(body: unknown): boolean | undefined;
export async function isPullRequestDraft(deps: GitHubApiDeps, installationId: number, pullRequest: PullRequestRef): Promise<DraftResult>; // never throws

// src/setup/status.ts
export type InstallationsView =
  | { readonly kind: "hidden" }
  | { readonly kind: "listed"; readonly installations: readonly Installation[]; readonly more: boolean }
  | { readonly kind: "unavailable" }
  | { readonly kind: "key-unusable" };
export interface StatusView { /* existing fields */ readonly installations: InstallationsView }
export interface StatusGitHub { readonly fetcher: GitHubFetch; readonly now: () => Date }
export async function statusView(env: object, db: D1Database, storageKey: CryptoKey, version: string, github: StatusGitHub): Promise<StatusView>;

// src/setup/texts.ts — new SetupTexts members (readonly string):
// installationsLabel, accountPersonal, accountOrganization, accountOther, accountEnterprise, unknownAccount,
// repositoriesAll, repositoriesSelected, installationSuspended, notInstalled, moreInstallations,
// installationsUnavailable, keyUnusable
```

`installationSuspended` is the word alone ("suspended" / "gesperrt"); the code adds ", ". Files the skeleton rewrites:
`src/github/private-key.ts`, `src/setup/status.ts`, `src/setup/texts.ts` (members added), `src/setup/handler.ts`
(`startPage` call). `src/setup/pages.ts` is changed in step 6 only.

## Test files

`src/github/private-key.test.ts`, `src/github/app-jwt.test.ts`, `src/github/http.test.ts`,
`src/github/app-credentials.test.ts`, `src/github/installation-token.test.ts`, `src/github/installations.test.ts`,
`src/github/api-client.test.ts`, `src/store/token-cache.test.ts`, `src/setup/status.test.ts`,
`src/setup/pages.test.ts`, `src/setup/handler.test.ts`; helpers in `test/github.ts`.

Existing test code that calls a changed signature: the **Dev** in step 4 makes it compile and nothing more —
`src/setup/status.test.ts` (`EMPTY` at line 43 gains `installations: { kind: "hidden" }`; the `statusView` calls at
lines 134 and 140 gain a GitHub argument whose fetcher rejects) and `src/setup/pages.test.ts` (`statusViewWith` at
line 494 gains `installations: { kind: "hidden" }`). The expected values are not mechanical (challenge minor 1):
`WORKER_SECRETS` in `status.test.ts` has a key that does not import (`key-unusable`), the saved-app cases seed no
key (`unavailable`, no request), the altered-key case is `key-unusable`, and `handler.test.ts` has the same bogus
Worker-secret key (line 1713) and `seedAppId` without a key (line 1767). The **Tester** in step 5 sets the expected
`installations` value of every existing `statusView` case and of every affected `handler.test.ts` page assertion
(and, where a case is meant to list installations, a real key and a double), and lists each one in its report. The
`toPkcs8Pem` tests in `src/github/private-key.test.ts` stay unchanged.

Files no unit test can cover: none.

## Areas

New area **GitHub API** (`docs/areas/github-api.md`, index row added; scope as in the index), a Lead decision.
Changed: Storage, Setup wizard, HTTP routes — each edit and its owner in *Documentation updates*.

## Documentation updates

| Document | Edit | Owner |
| -------- | ---- | ----- |
| `docs/areas/github-api.md`, `docs/areas/README.md` | new area and index row (written with this plan) | Lead |
| `docs/areas/storage.md` | `token_cache` rules, contract note, decision link (written with this plan) | Lead |
| `docs/ARCHITECTURE.md` | component row *GitHub API client*, setup wizard row, *Security model* (written with this plan) | Lead |
| `docs/areas/setup-wizard.md` | *Status and settings*: the _Installations:_ line and its states; *Texts*: the English texts of spec *Non-functional requirements*; *Limits and errors*: every signed-in start page answer (`GET /setup` 200, the 400 _settings invalid_ of `POST /setup/settings` and the 409 _reset not needed_ of `POST /setup/reset`) makes one installations request whose 10-second timeout covers the answer and the reading of its body, so the page takes at most about 10 s longer; signed-out pages call neither GitHub nor D1; *Related decisions*: 0026 | Dev |
| `docs/areas/http-routes.md` | *Request body size*: "… and the GitHub API answers of the app's calls ([GitHub API](github-api.md#requests)) are limited the same way" | Dev |
| `.squad/project.md` | new security area **GitHub App authentication** (text below); *Test doubles*: the GitHub API double answers the token, installations and pull request routes from `test/fixtures/github/` (two reference-built, one captured) | Dev |
| `CHANGELOG.md` | `## [Unreleased]` → `### Added`: "The status page lists where the GitHub App is installed (account, all or selected repositories, suspended), and Seluna can now call the GitHub API as the app, caching each installation's token encrypted." | Dev |
| `test/fixtures/github/README.md` | rows of the three new fixtures; the intro names the captured one | Tester |

Security area text for `.squad/project.md`: "**GitHub App authentication:** every GitHub call except the manifest
conversion is made as the app through `src/github/` (`app-jwt.ts`, `http.ts`, `app-credentials.ts`,
`installation-token.ts`, `installations.ts`, `api-client.ts`): an RS256 JWT (`iat` now − 60 s, `exp` now + 540 s,
`iss` the App ID) signed per request with the private key resolved per credential, never stored; installation tokens
per `installation.id`, allow-listed (`[A-Za-z0-9_]`, 1–255 characters), cached only encrypted in `token_cache`
(`src/store/token-cache.ts`) until 5 minutes before expiry, the row of a token GitHub answered 401 for deleted by
installation id and IV; installation id, owner, repository name and number allow-listed before they enter a URL;
only `https://api.github.com`, no redirects followed, 10-second timeout, answers read bounded (1 MiB) and narrowed; no
token, key or JWT in a log, page, result or plain D1 (decision 0026)."

## Architecture check

No guarantee is weakened: tokens follow 0007's encryption contract and key and JWT are never stored; calls go only to
`api.github.com` with the user's own app (0005); only the signed-in `startPage` reaches `statusView`; the manifest and
its permissions are untouched; the draft guarantee gains its API read for #16. `docs/ARCHITECTURE.md` updated as listed.

## Security considerations

- [x] Limits: answers 1 MiB counted in bytes before decoding (`readBodyWithLimit`); token 255 characters and PEM
  16,384 characters after decoding, both on ASCII-only allow-lists, so characters equal bytes; at most 100 entries
  used; login, slug and `type` have no length limit of their own beyond the 1 MiB answer, are escaped and never enter
  a URL.
- [x] Exceptions reaching the user: none. The API client maps every throw to `{ kind: "failed" }`; the status page
  shows only the fixed texts _installations unavailable_ and _key unusable_; a D1 error while resolving the
  credentials keeps today's 503 notice-only page with _unavailable_.
- CI-only runtime details, each failing closed: the real token and `expires_at` forms, the real installations shape
  and `Link` header (fact 11), `redirect: "manual"` in Workers (fact 15), the CPU time (fact 14). The Product
  Manager's live check before ready (step 11): deploy the branch to a copy, open `/setup` signed in (the installation
  is listed; Workers dashboard CPU time of that request); then, because the token path has no production caller yet,
  run a scratch entry module the orchestrator writes outside the repository (importing `src/github/api-client.ts`)
  with `wrangler dev --remote` against the copy's D1, calling `isPullRequestDraft` twice for the installation and a
  real pull request: both answer `ok`, and `wrangler d1 execute --remote` shows one `token_cache` row whose IV did not
  change between the calls. No route or code for this enters the product.

## Decision records

- `docs/decisions/0026-github-app-authentication-and-installation-tokens.md` (Proposed, indexed) — amends 0018.

## Challenge

Plan challenge by the Devil's Advocate at commit e79c609 (0 major, 3 minor).

- **Minor 1 — existing `status.test.ts` / `handler.test.ts` expectations are not mechanical.** Accepted. *Test files*
  now has the Dev only make them compile in step 4, and the Tester set every existing case's expected `installations`
  value (and real keys where a list is meant) in step 5, listed in its report; tasks 4, 5 and 11 say the same.
- **Minor 2 — the owner allow-list already exists as `isAccountName`.** Accepted. `isRepositoryOwner` returns
  `isAccountName(text)` (*Guards*, *Signatures*); no second copy of the regex.
- **Minor 3 — the setup wizard's limits text.** Accepted, with Security N1's measurement replacing the premise that
  the timeout does not bound the body: the `setup-wizard.md` row of *Documentation updates* now names every signed-in
  start page answer (200, the 400 of the settings form, the 409 of the reset form) and the bound of its one request.

## Security review

Security's plan review at commit e79c609: CHANGES_REQUIRED.

- **B1 — GitHub App manifest flow missing from *Security areas touched*.** Resolved: the area is listed with
  `toPkcs8Pem`; *Approach* 1 states that `PEM_FORM`, the canonical base64 check, the 16,384-character bound and the
  PKCS#1 wrap stay unchanged, and *Test files* that the existing `toPkcs8Pem` tests stay unchanged and pin it.
- **N1 — the timeout also bounds the body read.** Resolved: fact 19; `docs/areas/github-api.md` *Limits and errors*
  corrected (Lead), and the `setup-wizard.md` row states the bound.
- **N2 — facts 14 and 15 measured.** Resolved: both confirmed with Security's measurements; the Dev's step-6
  measurement and reading are dropped from task 6.
- **N3 — no upper bound on the key size.** Decided: in this change, because it is one check and bounds the CPU cost
  of every status page view and API call. `importSigningKey` refuses a key above 4096 bits (`MAX_SIGNING_KEY_BITS`,
  _key unusable_); spec E2 and AC14's test list, the area document and decision 0026 say so. `toPkcs8Pem` (the
  wizard) is left unbounded so the manifest flow's behavior does not change; the wizard's keys come from GitHub
  (2048 bits).

## Out of scope / follow-ups

As spec *Out of scope*. No follow-up issue: #16 (first caller) and #18 (cleanup of `token_cache`) exist.

## PR approval (Lead)

Decided at PR approval against code SHA 944fdc6:

- **Cyclic import `src/store/token-cache.ts` ↔ `src/github/installation-token.ts`:** not accepted. It works today only
  because both uses sit in function bodies, and it leaves module initialization order fragile. Fix (Dev): move
  `isInstallationTokenText` and its pattern into a new leaf module `src/github/token-text.ts` that imports nothing.
  Both modules import it from there, and `installation-token.ts` re-exports it so that no test import changes. No
  behavior change; Reviewer delta round.
- **`hasNextPage` written by hand instead of a regex:** accepted. An unquoted `rel=next` answers no next page, which
  matches spec E13 / AC12 and `docs/areas/github-api.md` (`rel="next"` exactly). It fails safe: only the _more
  installations_ text is left out.
- **The sentence in `setup-wizard.md` that the notice-only pages (503, 403) make no installations request:** accepted.
  It is true, and the Reviewer verified it.
- **The Tester's resolved doubts** (an unreadable saved App ID gives no app; an unreadable key gives key unusable; a
  missing `account` rejects the list; a login that is not a string shows _unknown account_): consistent with spec E1,
  E2, E6 and E14. No record needed.
