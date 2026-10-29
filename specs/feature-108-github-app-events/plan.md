# Plan: Subscribe the GitHub App to issues, comments, forks and stars

Source: Issue #108 | [spec.md](spec.md)
Status: Draft
Tier: security — it adds two app permissions, narrows the installation tokens and changes the additional data of the encrypted `token_cache` rows: each is a security control.
Security areas touched: Minimal GitHub App permissions (`src/github/manifest.ts`), GitHub App manifest flow (`src/setup/github-step.ts`, owner stored after the credentials), GitHub App authentication (`src/github/http.ts`, `src/github/installation-token.ts`, new `src/github/app-info.ts`, `src/github/installations.ts`), Encrypted credentials (`src/store/token-cache.ts`, additional data of `token_cache`), Setup login (`src/setup/pages.ts`, `src/setup/status.ts`: new external links on the signed-in status page), Parsing of external input (`GET /app` and installation `permissions`/`events` narrowed from `unknown`)

## Problem / root cause

See [spec.md](spec.md), *Problem*.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | The manifest requests 6 read permissions and 5 events, none of the new ones | `src/github/manifest.ts` lines 12–26 | confirmed |
| 2 | The conversion narrows `owner` to `login` and `type` only; a malformed owner makes the whole answer _malformed_ | `src/github/conversion.ts` lines 19–23, 49–56, 69 | confirmed |
| 3 | The token request has no body and no `permissions` object | `src/github/installation-token.ts` lines 62–67; its test asserts `hasBody` false (`installation-token.test.ts` line 202) | confirmed |
| 4 | The only call made with an installation token is the pull request read | `src/github/api-client.ts` line 83; `docs/areas/github-api.md` *Pull request read* | confirmed |
| 5 | The `token_cache` additional data is `token_cache/<id>/<expires_at>`, and a row that does not decrypt counts as no cached token and is replaced | `src/store/token-cache.ts` lines 17–19, 42–43; `docs/areas/github-api.md` *Installation tokens* | confirmed |
| 6 | Only one migration exists; migrations run only with the deploy command `npm run deploy` | `migrations/`, `docs/setup.md` line 20 | confirmed |
| 7 | `listInstallations` signs its own JWT per call; the status page makes exactly one GitHub request | `src/github/installations.ts` lines 109–129, `src/setup/status.ts` lines 148–174 | confirmed |
| 8 | `statusView` does not catch D1 errors; the slug write after the manifest flow drops its failure | `src/setup/status.ts` line 177, `src/setup/github-step.ts` lines 232–242 | confirmed |
| 9 | A GitHub App object has `id`, `slug`, `owner` (`id`, `login`, `type`), `permissions` (name to level) and `events` (array of names) | real app object `specs/feature-108-github-app-events/sample-app.json`, read from a check run of this repository (`gh api repos/larslaskowski/seluna/commits/main/check-runs`); public data, no private values | confirmed |
| 10 | `GET /app` answers this app's object (schema of fact 9) | to verify: Product Manager's live check on a deployed copy before the PR is marked ready (basis: GitHub REST documentation; the session cannot authenticate as an app) | unverified |
| 11 | Installation entries carry `permissions` and `events` | to verify: Product Manager's live check on a deployed copy before the PR is marked ready: an older installation shows the missing Issues and Contents (basis: OpenAPI example in `installations.json`) | unverified |
| 12 | The token request accepts `{"permissions":{...}}`; a token with only `pull_requests: read` reads a pull request | to verify: Product Manager's live check on a deployed copy before the PR is marked ready: a CI failure in a pull request is reported without _draft status unknown_ (basis: GitHub REST documentation) | unverified |
| 14 | The four settings URLs of spec S5 and S6 | to verify: Product Manager's live check on a deployed copy before the PR is marked ready: each link opens its page (basis: `installations.json` `html_url`, GitHub's settings navigation) | unverified |
| 15 | `fork` needs Contents, `star` Metadata, `issue_comment` Issues (Pull requests for pull request comments) | to verify: Product Manager's live check on a deployed copy before the PR is marked ready: an app from the new manifest receives each event (basis: issue #108, GitHub webhook documentation) | unverified |
| 16 | Every fixture with a `sender` has `example-owner`, type `User` | script over `test/fixtures/*/*.json` (ids 1000 and 1000001) | confirmed |
| 17 | `docs/setup.md` and the created-page texts recommend _All repositories_ | `docs/setup.md` line 26; `src/setup/texts.ts` lines 241, 244, 460, 463 | confirmed |
| 18 | A delivery writes a `deliveries` row (indexed on `received_at`) and the `meta` `last_delivery` upsert, whether or not a rule matches | `docs/areas/notifications.md` *Processing a delivery* step 5; `migrations/0001_initial_schema.sql` line 18 | confirmed |
| 19 | The free plan allows 100,000 Worker requests and 100,000 D1 rows written a day | to verify: Security checks Cloudflare's published limits in step 3 | unverified |
| 20 | The GitHub double fails a test on any request without a route and records no body | `test/github.ts` lines 91, 178–220 | confirmed |

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `APP_PERMISSIONS is exactly the eight read permissions in manifest order`; `APP_EVENTS is exactly the nine events in manifest order`; `appManifest carries the new permissions and events` (against `expectedManifestJson`) | `src/github/manifest.test.ts` |
| AC1 | `the review page lists the eight permissions and nine events in $language` | `src/setup/pages.test.ts` |
| AC2 | `parseOwnerAccount narrows a User and an Organization owner`; `parseOwnerAccount rejects $case` (id 0, negative, fractional, string, beyond safe range; type `Bot`, `Enterprise`, missing; login failing the allow-list, 40 characters; not an object) | `src/github/owner.test.ts` |
| AC2 | `parseConversion keeps the owner account`; `parseConversion converts with an undefined account when the owner id is missing` | `src/github/conversion.test.ts` |
| AC2 | `finishGitHubApp stores the owner for the saved App ID`; `finishGitHubApp saves the app without an owner when the owner id is malformed`; `finishGitHubApp answers created when the owner write fails` | `src/setup/github-step.test.ts` |
| AC2, AC3 | `writeAppOwner and readAppOwner round-trip an owner`; `readAppOwner ignores an owner of another App ID`; `readAppOwner reads $case as absent` (wrong form, unknown type, unsafe id) | `src/store/meta.test.ts` |
| AC3 | `statusView stores the owner of GET /app when none is stored`; `statusView writes nothing when the stored owner is the same`; `statusView replaces a different owner of the same App ID`; `statusView ignores an owner stored for another App ID`; `statusView answers with GitHub's owner when the owner write fails`; `statusView signs one JWT and sends GET /app and the installations list` | `src/setup/status.test.ts` |
| AC4 | `statusView shows GitHub's owner, else the stored one, else unavailable` (table: answer ok/failed/malformed owner × stored/none); `statusView hides the owner where the installations line is hidden` | `src/setup/status.test.ts` |
| AC4 | `the status page shows the owner line for a personal account in $language`; `the status page adds the organization notice for an organization's app`; `the status page shows owner unavailable` | `src/setup/pages.test.ts` |
| AC5 | `isOwnAction is true for the owner's sender id`; `isOwnAction is true for a renamed login with the owner's id`; `isOwnAction is false for $case` (another user, a bot, an organization owner, an unknown owner, no `sender`, `sender` not an object, `id` missing, `id` a string); `isBotSender is true for sender.type Bot`; `isBotSender is false for $case` (a user, no `sender`, not an object, `type` missing, `type` not a string, `bot` lowercase) | `src/rules/actor.test.ts` |
| AC6 | `missingAccess names the permissions and events the granted access lacks, in manifest order`; `missingAccess counts write and admin as read`; `missingAccess ignores permissions and events beyond the wanted ones`; `missingAccess counts an unknown level as missing`; `accessToCheck leaves out what the app lacks` | `src/github/app-info.test.ts` |
| AC6 | `appPermissionsUrl builds the personal and organization page`; `installationSettingsUrl builds the user and organization page` | `src/github/app-links.test.ts` |
| AC6 | `statusView reports what the app lacks with the settings link`; `statusView reports what an installation lacks of what the app has`; `statusView names something the app lacks only on the app`; `statusView reports nothing missing for a complete app and installations`; `statusView checks a suspended installation` | `src/setup/status.test.ts` |
| AC6 | `the status page renders the missing line and links in $language`; `the status page renders nothing extra when nothing is missing`; `the $page page in $language has exactly its own external addresses` (adapted: the two new links) | `src/setup/pages.test.ts` |
| AC7 | `parseAppInfo narrows the real app object`; `parseAppInfo rejects $case` (no id, permissions not an object, a level not a string, events not an array, an event not a string); `parseAppInfo keeps the answer with an undefined owner when the owner is malformed`; `parseAppInfo drops a slug outside the allow-list`; `readAppInfo sends GET /app with the given JWT`; `readAppInfo fails on $case` (401, 500, redirect, rejection, oversized, not JSON) | `src/github/app-info.test.ts` |
| AC7 | `appPermissionsUrl gives no link for $case` (slug or login failing the allow-list); `installationSettingsUrl gives no link for $case` (enterprise, unknown, type other, login failing the allow-list) | `src/github/app-links.test.ts` |
| AC7 | `parseInstallations keeps an entry with unreadable permissions or events as unchecked`; `listInstallations sends the given JWT` (adapted signature) | `src/github/installations.test.ts` |
| AC7 | `statusView marks the app unchecked and installations without a suffix when GET /app fails`; `statusView marks an installation with unreadable access as not checked`; `statusView treats a GET /app answer of another App ID as failed`; `statusView takes the slug from the answer, else from the stored slug` | `src/setup/status.test.ts` |
| AC7 | `the status page says the app's permissions could not be read`; `the status page renders access not checked for an installation`; `the status page renders a missing line without a link when no link is built` | `src/setup/pages.test.ts` |
| AC8 | `installationToken requests the token with exactly {"permissions":{"pull_requests":"read"}} as JSON` (replaces the `hasBody` false assertion); `INSTALLATION_TOKEN_PERMISSIONS holds no contents, no issues and no write level` | `src/github/installation-token.test.ts` |
| AC8 | `gitHubRequest with a JSON body sets Content-Type application/json and the body`; `gitHubRequest without a body sends none` | `src/github/http.test.ts` |
| AC9 | `tokenContext binds the installation, the expiry and the permission list`; `readCachedToken treats a row written under the earlier additional data as no cached token`; `permissionsTag sorts the names` | `src/store/token-cache.test.ts` |
| AC9 | `installationToken requests a new token when the cached row was written by an earlier version` | `src/github/installation-token.test.ts` |
| AC10 | `processWebhook accepts and records $event and sends nothing` (fixtures `issues/opened.json`, `issue_comment/created.json`, `fork/fork.json`, `star/created.json`) | `src/webhook.test.ts` |
| AC12 | `the created page recommends Only select repositories in $language` (install intro and install manually) | `src/setup/pages.test.ts` |

## Verification without tests

Only AC11 and the documentation part of AC12; everything else has tests. AC11: decision record 0039 exists with
AC11's points (this step); the Reviewer checks `.squad/project.md` and the area documents against the code in step 8.
AC12: the Reviewer checks `docs/setup.md` and `docs/areas/setup-wizard.md` (*Texts*) against the new texts.

## Approach

**Manifest.** `APP_PERMISSIONS` becomes `actions`, `contents`, `issues`, `pull_requests`, `vulnerability_alerts`,
`security_events`, `secret_scanning_alerts`, `metadata` (all `read`, in this key order). `APP_EVENTS` is today's five
followed by `issues`, `issue_comment`, `fork`, `star`. The review texts `githubPermissionsList` and `githubEventsList`
follow the same order in GitHub's names (en and de):

- Permissions: Actions, Contents, Issues, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning
  alerts, Metadata.
- Events: Pull request, Workflow run, Dependabot alert, Code scanning alert, Secret scanning alert, Issues, Issue
  comment, Fork, Star.

**Owner.** `parseOwnerAccount` accepts a positive safe integer `id`, a `login` passing `isAccountName` and a `type`
of exactly `User` or `Organization`. The conversion keeps `owner` for decision 0017's check and adds `account`, parsed
separately, so a malformed id never makes the answer _malformed_ (spec E4). After the credentials are stored,
`keepOwner` writes the `meta` row `github_app_owner` = `<appId>:<ownerId>:<type>:<login>` and drops a failure, like
`keepSlug`; read only for its App ID, else absent; the reset keeps it like the slug row.

**Status page.** For an app the _GitHub App:_ line names (`worker-secrets` or `saved`), `resolveAppCredentials` runs
as today.
- **No credentials.** On `no-app`, `key-unusable`, or a signing failure, the installations line keeps today's view.
  The app check is `unchecked`. The owner is the stored one for the App ID when one is known (saved app), else
  `unavailable`.
- **With credentials.** One `appJwt` is signed, then `readAppInfo` and `listInstallations` run under
  `Promise.all`.
- **App answer.** An answer whose `id` differs from the credentials' App ID counts as failed.
- **Owner.** It is the answer's owner, else the stored one, else `unavailable`. When the answer has an owner that
  differs from the stored one, or nothing is stored, `writeAppOwner` runs inside `try`/`catch`, and a failure is
  dropped (spec E11).
- **Slug.** It is the answer's, else `readAppSlug` for the App ID.
- **Settings link.** `appPermissionsUrl(owner, slug)` builds it from the owner shown and the slug.
- **Installations.** Each listed installation gets a check:
  - `app-unchecked` when the app answer failed;
  - `unreadable` when its `access` is undefined;
  - otherwise `missingAccess(installation.access, accessToCheck(app.access))`, as `complete` or as `missing` with
    `installationSettingsUrl(account, id)`.

**Levels.** `read` < `write` < `admin`; a granted level satisfies every lower one, and an unknown level satisfies
nothing. Missing names keep the manifest order.

**Tokens.**
- `INSTALLATION_TOKEN_PERMISSIONS = { pull_requests: "read" }`. The token request sends
  `JSON.stringify({ permissions: INSTALLATION_TOKEN_PERMISSIONS })` with `Content-Type: application/json`.
- `tokenContext` becomes `token_cache/<id>/<expires_at>/<permissionsTag>`, where the tag is `name=level` pairs
  sorted by name and joined by `,` (today `pull_requests=read`).
- Rows of the earlier form fail to decrypt and are replaced (decision 0039, option 12).

**Actor helpers.** As spec S9 and E5; both narrow `unknown` with a private type guard and never throw.

**Status page layout** (inside the status card, after the _GitHub App:_ paragraph and before _Installations:_). New
texts are given in English; the Dev writes the German ones. Permission and event names are GitHub's names in both
languages, as on the review page.

1. `<p>GitHub App owner: <login> (personal account)</p>`, or `(organization)`, reusing `accountPersonal` and
   `accountOrganization`. Otherwise `<p>GitHub App owner: Owner unavailable.</p>` (text _owner unavailable_: "Cannot
   be read from GitHub right now.").
2. For an organization only, a plain `<p>` with _organization owner_: "The app belongs to an organization, so Seluna
   cannot tell your own actions from anyone else's: activity of every account is reported, yours too."
3. The app check. On `checked` with something missing:
   `<p>Missing on the app: <list> <a href="<settings url>">Add them in the app's settings on GitHub</a></p>`, with
   the link left out when there is no URL. On `unchecked` (after a request): `<p>Missing on the app: Seluna could not
   read the app's permissions from GitHub.</p>`. Nothing for `checked` with nothing missing, nor for `hidden`.
4. Installation entries keep today's text and append:
   - `, missing: <list> <a href="<url>">Review and accept on GitHub</a>` (link only with a URL);
   - `, access not checked`;
   - or nothing (`complete`, `app-unchecked`).
5. `<list>`:
   - permissions as `<Name> (read-only)`, joined by `, `;
   - then, when events are missing, `events: <Name>, <Name>`;
   - the two parts joined by `; `;
   - German: `nur lesend`, `Ereignisse:`.

**Created page.** _install intro_: "Now install it on your account or organization. Choosing Only select
repositories is recommended: Seluna then sees only the repositories you pick, and you add a new repository to the
installation by hand." _install manually_ ends with the same recommendation in place of the _All repositories_
sentence. German texts are their translation.

**Load.** About 3 rows written per delivery, so roughly 30,000 deliveries a day against the free plan's D1 write
allowance (facts 18, 19; decision 0039). No code limits it; _Only select repositories_ is the owner's control.

## Options considered

Each weighed in decision 0039 (options 1–18) with the reason it lost: fork polling from the cron (delay, state,
requests); owner by login (breaks on rename) or entered in the wizard (wrong for organizations); owner in `settings`
(the owner's choices); the owner learned on a delivery (a request on the webhook path, not needed yet); a token list of
every manifest permission but Contents (unaccepted Issues breaks the draft lookup, spec E8); a migration deleting
`token_cache` or waiting for expiry (only with migrations applied; up to 55 minutes of broad tokens); links from
`html_url` (an external URL without allow-list); two JWTs in sequence (two signatures and timeouts per view).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/github/` (`manifest`, `conversion`, `http`, `installation-token`, `installations`; new `owner`, `token-permissions`, `app-info`, `app-links`) | lists, owner account, token list, `GET /app`, access, links |
| Worker | `src/store/` (`meta`, `token-cache`), `src/setup/` (`github-step`, `status`, `pages`, `texts`), new `src/rules/actor.ts` | owner row, additional data, status page, texts, helpers |
| Tests | `test/github.ts`, `test/token-cache.ts`, new fixtures | double route `app` and body, additional data |

## Signatures (for the Dev's skeleton)

```ts
// src/github/owner.ts (new)
export type OwnerType = "User" | "Organization";
export interface OwnerAccount { readonly id: number; readonly login: string; readonly type: OwnerType }
export function parseOwnerAccount(value: unknown): OwnerAccount | undefined;

// src/github/conversion.ts (changed interface)
export interface ConvertedApp { /* existing fields */ readonly account: OwnerAccount | undefined }

// src/github/token-permissions.ts (new)
export const INSTALLATION_TOKEN_PERMISSIONS: Readonly<Record<string, "read">>;
export function permissionsTag(permissions: Readonly<Record<string, string>>): string;

// src/github/http.ts (changed)
export function gitHubRequest(method: "GET" | "POST", path: string, version: string, bearer: string, jsonBody?: string): Request;

// src/store/token-cache.ts (same signature, new output)
export function tokenContext(installationId: number, expiresAt: number): string;

// src/github/app-info.ts (new)
export interface GrantedAccess { readonly permissions: Readonly<Record<string, string>>; readonly events: readonly string[] }
export interface MissingAccess { readonly permissions: readonly string[]; readonly events: readonly string[] }
export interface AppInfo { readonly appId: number; readonly slug: string | undefined; readonly owner: OwnerAccount | undefined; readonly access: GrantedAccess }
export type AppInfoResult = { readonly kind: "read"; readonly app: AppInfo } | { readonly kind: "failed" };
export const MANIFEST_ACCESS: GrantedAccess;
export function parseGrantedAccess(permissions: unknown, events: unknown): GrantedAccess | undefined;
export function parseAppInfo(body: unknown): AppInfo | undefined;
export function readAppInfo(fetcher: GitHubFetch, version: string, jwt: string): Promise<AppInfoResult>;
export function missingAccess(granted: GrantedAccess, wanted: GrantedAccess): MissingAccess;
export function accessToCheck(app: GrantedAccess): GrantedAccess;
export function hasMissing(missing: MissingAccess): boolean;

// src/github/app-links.ts (new)
export function appPermissionsUrl(owner: OwnerAccount, slug: string): string | undefined;
export function installationSettingsUrl(account: InstallationAccount, installationId: number): string | undefined;

// src/github/installations.ts (changed)
export interface Installation { /* existing fields */ readonly access: GrantedAccess | undefined }
export function listInstallations(fetcher: GitHubFetch, version: string, jwt: string): Promise<InstallationsResult>;

// src/store/meta.ts (new members)
export const GITHUB_APP_OWNER_META_KEY = "github_app_owner";
export function readAppOwner(db: D1Database, appId: number): Promise<OwnerAccount | undefined>;
export function writeAppOwner(db: D1Database, appId: number, owner: OwnerAccount): Promise<void>;

// src/setup/status.ts (new and changed types)
export type OwnerView = { readonly kind: "hidden" } | { readonly kind: "known"; readonly owner: OwnerAccount } | { readonly kind: "unavailable" };
export type AppAccessView =
  | { readonly kind: "hidden" }
  | { readonly kind: "unchecked" }
  | { readonly kind: "checked"; readonly missing: MissingAccess; readonly settingsUrl: string | undefined };
export type InstallationCheck =
  | { readonly kind: "complete" }
  | { readonly kind: "missing"; readonly missing: MissingAccess; readonly acceptUrl: string | undefined }
  | { readonly kind: "unreadable" }
  | { readonly kind: "app-unchecked" };
export interface InstallationEntry { readonly installation: Installation; readonly check: InstallationCheck }
// InstallationsView "listed": installations becomes readonly InstallationEntry[]
// StatusView gains: readonly owner: OwnerView; readonly appAccess: AppAccessView

// src/rules/actor.ts (new)
export function isOwnAction(payload: unknown, owner: OwnerAccount | undefined): boolean;
export function isBotSender(payload: unknown): boolean;
```

Files the skeleton rewrites (all read for this plan): src/github/manifest.ts, conversion.ts, http.ts,
installations.ts and the token request module of src/github, src/store/token-cache.ts, src/store/meta.ts, src/setup/status.ts,
src/setup/github-step.ts, src/setup/pages.ts, src/setup/texts.ts.

## Test files

The files of *Tests per criterion*; new among them: `src/github/owner.test.ts`, `app-info.test.ts`,
`app-links.test.ts`, `src/rules/actor.test.ts`.

- Fixtures (Tester):
  - `test/fixtures/github/app.json`, copied from `specs/feature-108-github-app-events/sample-app.json` and formatted
    with Prettier; the `User` owner variant is built in the tests.
  - `test/fixtures/issues/opened.json`, `test/fixtures/issue_comment/created.json`, `test/fixtures/fork/fork.json`
    and `test/fixtures/star/created.json`, built from GitHub's webhook payload documentation. Each folder gets a
    `README.md` that marks them reference-built and not captured; #109 and #110 replace them with real deliveries for
    their rule tests.

Existing call sites a changed signature affects (all adapted by the Tester):

- `test/github.ts`:
  - a route `app` for `GET https://api.github.com/app`;
  - `RecordedGitHubRequest.body: string | null` (read from a clone of the request);
  - `expectedManifestJson` with the new lists.
- `test/token-cache.ts` line 13 and `src/store/token-cache.test.ts` line 37: the new additional data.
- `src/github/installation-token.test.ts` line 202: the `hasBody` false assertion is replaced by the AC8 test.
- `src/github/installations.test.ts`: `listInstallations` takes a JWT; the entry factory gains `access`.
- `src/setup/status.test.ts`, `src/setup/handler.test.ts`, `src/setup/pages.test.ts`:
  - every double that answers `installations` also answers `app`;
  - `Installation` and `StatusView` literals gain the new fields;
  - the external-address test lists the new links.
- `src/github/conversion.test.ts` and `src/setup/github-step.test.ts`: `ConvertedApp` equality includes `account`.

Files of the change no unit test can cover: none.

## Areas

`docs/areas/github-api.md`, `docs/areas/setup-wizard.md`, `docs/areas/storage.md` and `docs/areas/notifications.md`;
what changes in each is listed under *Documentation updates*. No new area.

## Documentation updates

Owner: the Dev, once the code is green, against that code, unless noted.

- `docs/areas/github-api.md`: *Installation tokens* (explicit list; old rows invalidated by the additional data), a new
  *App read* section (`GET /app`, narrowing, App ID match, failure), *Installations list* (`permissions`, `events`,
  an unreadable entry).
- `docs/areas/setup-wizard.md`: the manifest lists; *Status and settings* (owner line, organization text, app check,
  installation suffixes and links, two requests under one JWT); *Style limits* (the two new external links); *Texts*.
- `docs/areas/storage.md`: the `meta` row `github_app_owner` (form, App ID binding, writers, kept by the reset) and the
  `token_cache` additional data.
- `docs/areas/notifications.md`: the four new events reach the rules and none reports them yet; a pointer from the
  `sender` sentence to the owner and bot definitions for #109.
- `.squad/project.md`:
  - *Minimal GitHub App permissions*: the eight permissions, and why `contents` (decision 0039).
  - *GitHub App authentication*: `app-info.ts`, `app-links.ts`, `token-permissions.ts`, the explicit token list.
  - *Encrypted credentials*: `token_cache` additional data with the permission tag.
  - *Test doubles*, GitHub API double: the `app` route and the recorded body. This item belongs to the Tester.
- `docs/setup.md`:
  - the permission and event list of the GitHub App paragraph;
  - _Only select repositories_ instead of _All repositories_, with the trade-off;
  - the status page sentence (owner, missing permissions).
- `docs/update.md`: a section *New GitHub permissions* that tells the owner to open the status page after an update,
  add what _Missing on the app_ names in the app's settings, and accept it on each installation through _Review and
  accept on GitHub_.
- `README.md`: the event and permission list, wherever it names them (sweep: `grep -n -i "permission\|events" README.md`).
- Sweep for enumerations the change extends; each hit is updated:
  - `docs/ARCHITECTURE.md` (a list of permissions, events or status page requests);
  - `docs/areas/setup-wizard.md` *Style limits* ("the only external addresses …");
  - `docs/areas/github-api.md` *Requests* ("One call of the API client sends at most …"; the status page now makes two
    requests, not one);
  - `docs/areas/setup-wizard.md` *Status and settings* ("one request of up to 100").

## Architecture check

The guarantees of `.squad/project.md` hold: drafts still trigger nothing, no new route, credentials stay encrypted
(the owner row is public data), no central service. *Minimal GitHub App permissions* gains `contents: read` as the
issue asks (decision 0039), while tokens are narrowed below the app's permissions. The status page's second request
runs beside the first; signed-out pages still call neither GitHub nor D1. `docs/ARCHITECTURE.md` changes only where
the sweep finds a list.

## Security considerations

- [ ] Limits: `GET /app` goes through the existing bounded reader (1 MiB in bytes before decoding); the login is at
  most 39 characters and the slug 100 after narrowing; only manifest names are ever shown, so a large `permissions`
  or `events` cannot grow the page.
- [ ] No exception reaches a user: `readAppInfo` and `listInstallations` never throw, the signing failure and the
  owner write are caught, and only the fixed texts above are shown.
- Links come only from the two builders over allow-listed parts under `https://github.com/`, never from `html_url`.
  An answer of another App ID counts as failed, so no foreign owner is stored.

## Decision records

- `docs/decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md` (Proposed). It amends 0007, 0017 and
  0026, all released, without editing them.

## Out of scope / follow-ups

- Passing the owner into the rule input and the rules themselves: #109 and #110.
- A deviation the live check finds: a new issue with the captured answer.
