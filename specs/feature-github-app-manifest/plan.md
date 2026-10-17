# Plan: Setup wizard step: create the GitHub App through the manifest flow

Source: Issue #10 | [spec.md](spec.md)
Status: Draft
Tier: security — the change touches four security areas of `.squad/project.md` (setup login and its CSRF rule,
encrypted credentials, minimal GitHub App permissions, webhook signature secret source) and adds an outbound GitHub
API call whose answer carries secrets.

## Problem / root cause

Summary of `spec.md`: a signed-in step `/setup/github` sends a manifest to GitHub (personal account or organization),
handles GitHub's signed-out return with a same-site finish form, exchanges the code, converts the private key to
PKCS#8, stores App ID, key and webhook secret encrypted in one transaction, and the webhook reads the stored secret
unless the Worker secret is set.

Claims of the issue, checked against the code and GitHub's documentation:

- "The webhook secret source from #5 now reads the D1 value" — **confirmed** that the seam exists:
  `src/webhook-secret.ts:6` `WebhookSecretSource`, built only from the environment by `secretFromEnv`
  (`src/webhook-secret.ts:11`) and wired in `src/index.ts:15`. Decision 0012 (released) left "which source wins" to
  this issue and requires a D1 error to keep answering 503 (`src/router.ts:52-57` already maps a throwing source to
  503).
- "Store App ID, private key and webhook secret encrypted (#7)" — **confirmed**: `SecretName` in
  `src/store/secrets.ts:4` has exactly `github_app_id`, `github_private_key`, `github_webhook_secret`. But
  `writeSecret` (`src/store/secrets.ts:141`) writes one credential per call, so three calls can leave a partial set
  (App ID of the new app beside the old app's webhook secret) — this plan adds an all-or-nothing `writeSecrets`.
- "Convert the private key from PKCS#1 to PKCS#8 in the Worker" — **confirmed**: GitHub's documented example answer
  of `POST /app-manifests/{code}/conversions` carries `pem` as `-----BEGIN RSA PRIVATE KEY-----` (PKCS#1); the Lead
  checked that this example key is a valid 2048-bit RSA key (`openssl rsa -check`: "RSA key ok"), so the fixture can
  be the documented example verbatim. Web Crypto's `importKey` reads `pkcs8` but not PKCS#1.
- Permission names — **confirmed** against GitHub's OpenAPI description (`components.schemas.app-permissions`):
  `actions`, `pull_requests`, `vulnerability_alerts` (Dependabot alerts), `security_events` (code scanning alerts),
  `secret_scanning_alerts`, `metadata`.
- Manifest flow details — **confirmed** from GitHub's documentation page "Registering a GitHub App from a manifest":
  `POST` form to `https://github.com/settings/apps/new` (personal) or
  `https://github.com/organizations/ORGANIZATION/settings/apps/new`, field `manifest` (JSON), `state` in the action's
  query; the user can edit the name on GitHub's page; GitHub redirects to `redirect_url?code=<code>&state=<state>`
  (example code: 40 lowercase hex digits); all three steps within one hour; the conversion needs no authentication
  and answers 201 (schema: `id`, `slug`, `pem`, `webhook_secret` nullable, `client_id`, `client_secret`, …), 404 or
  422. App names: at most 34 characters ("Registering a GitHub App"), slug = lowercase name with spaces and special
  characters replaced.
- "Manual alternative … take precedence over D1 and the step shows them as configured" — **partly new**: only
  `GITHUB_WEBHOOK_SECRET` exists today (`src/webhook-secret.ts:2`); `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are
  new names, read here only to decide what the step shows (their use for API calls is #15).
- "Private, installable only on the owning account" — **confirmed** as the meaning of manifest `public: false`.
- Signed-out return — **confirmed** as a constraint: the wizard cookies are `SameSite=Strict`
  (`src/setup/cookies.ts:27`), so the redirect from github.com arrives without the session (decision 0015,
  *Consequences*, already says #10 must handle that).

Related defects found on the way:

- `.squad/project.md`, *Security areas*, "Minimal GitHub App permissions" names "pull requests, checks/statuses,
  security alerts, metadata"; the issue (and the rule set: `workflow_run` for CI) needs Actions, not checks/statuses.
  Corrected by the Dev in this change (it describes the product; *Scope of a product PR*).
- `docs/setup.md` ends with "Until then the instance answers webhooks with 503" — untrue after this change.
- `src/telegram.ts:664-676` has a private bounded JSON reader the GitHub client needs too; it moves to `src/body.ts`
  instead of being duplicated (SonarQube duplication).

## Acceptance criteria

Each criterion names its tests (file, then test name). `NOW` is the tests' fixed clock.

- [ ] AC1 (manifest content, issue AC-a): `appManifest(origin, account)` returns exactly
  `{"name":"seluna-<account>","url":"https://github.com/LarsLaskowski/Seluna","hook_attributes":{"url":"<origin>/webhook","active":true},"redirect_url":"<origin>/setup/github/callback","public":false,"default_permissions":{"actions":"read","pull_requests":"read","vulnerability_alerts":"read","security_events":"read","secret_scanning_alerts":"read","metadata":"read"},"default_events":["pull_request","workflow_run","dependabot_alert","code_scanning_alert","secret_scanning_alert"]}`
  (key order as written); `appName` cuts `seluna-<account>` to its first 34 characters.
  - `src/github/manifest.test.ts`: "appManifest requests exactly the six read-only permissions and the five events";
    "appManifest is private and points the webhook and the redirect at the instance origin"; "appName prefixes
    seluna- and cuts the name to 34 characters".
- [ ] AC2 (personal and organization, issue AC-b): `manifestFormAction("personal", a, s)` is
  `https://github.com/settings/apps/new?state=<s>`; `manifestFormAction("organization", a, s)` is
  `https://github.com/organizations/<a>/settings/apps/new?state=<s>`. `parseAccountType` accepts exactly `personal` and
  `organization`. `isAccountName` accepts exactly `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$` (see *Guard
  forms*).
  - `src/github/manifest.test.ts`: "manifestFormAction posts a personal account's manifest to
    github.com/settings/apps/new with the state"; "manifestFormAction posts an organization's manifest to its
    organization settings with the state"; "parseAccountType accepts exactly personal and organization";
    "isAccountName accepts 1 to 39 letters, digits and inner hyphens"; "isAccountName rejects every form in the guard
    table" (one `it.each` over the table in *Guard forms*).
- [ ] AC3 (state): `createGitHubState(key, session, now)` returns `v1.<expires>.<nonce>.<mac>` with `<expires>` =
  `now + 3,600,000` ms, `<nonce>` 16 random bytes base64url (22 characters), `<mac>` the HMAC-SHA256 (base64url, 43
  characters) of the ASCII text `github-state.v1.<expires>.<nonce>.<session>` under the `setup-github` key.
  `isValidGitHubState(key, state, session, now)` is true only for exactly that form with canonical base64url, a MAC
  that verifies in constant time for this session, and `now < expires ≤ now + 3,600,000`.
  - `src/setup/github-state.test.ts`: "createGitHubState yields v1, the expiry one hour ahead, a 22-character nonce and
    the MAC of the documented text"; "createGitHubState draws a new nonce each time"; "isValidGitHubState accepts a
    fresh state of the same session"; "isValidGitHubState rejects another session, another key, an expired state, an
    expiry more than one hour ahead, an altered part and non-canonical base64url" (`it.each`).
  - `src/crypto.test.ts`: "signingKeyFromEnv derives the setup-github key from seluna/setup-github/v1, apart from the
    other keys".
- [ ] AC4 (step page): `gitHubStepView` returns `worker-secrets` when all three Worker secrets are non-empty strings and
  `partial-worker-secrets` when one or two are (neither reads D1); otherwise reads `github_app_id`: `ok` → `form` with
  the App ID, `missing` → `form` without, `secret-changed`/`corrupt` → `reset-needed`; D1 errors propagate.
  `GET /setup/github` (signed in) answers 200 with the matching page, 503 with _unavailable_ when D1 fails.
  - `src/github/worker-secrets.test.ts`: "workerCredentials reports none, partial and all for every combination of the
    three secrets" (`it.each` over the 8 combinations, plus an empty string and a non-string counting as unset).
  - `src/setup/github-step.test.ts`: "gitHubStepView shows the Worker-secrets view when all three are set, without
    reading D1"; "gitHubStepView shows the partial view when one or two are set"; "gitHubStepView shows the saved App
    ID"; "gitHubStepView shows the form without a saved app when none is stored"; "gitHubStepView reports reset needed
    when the key check fails".
  - `src/setup/handler.test.ts`: "GET /setup/github answers 200 with the account form and a session-bound CSRF field";
    "GET /setup/github answers 503 with the unavailable notice when D1 fails"; "GET /setup/github signed out answers
    the login page"; "the start page links to /setup/telegram and /setup/github".
- [ ] AC5 (start): `POST /setup/github` in this order: body (413/400); CSRF (signed-in form) else 403 _form expired_;
  any Worker secret set → 409 with that view; exactly one `account_type` that parses and exactly one `account` that is
  an account name, else 400 with the form page and _invalid account_; key check `changed`/`corrupt` → 409
  _reset needed_; D1 error → 503 _unavailable_; else 200 with the review page: app name, permissions, events, and one
  form `method="post"` whose `action` is `manifestFormAction(type, account, state)` and whose only field is the hidden
  `manifest` (the JSON of AC1, HTML-escaped; no `csrf` field). Only this page's `Content-Security-Policy` has
  `form-action https://github.com` instead of `form-action 'self'`.
  - `src/setup/handler.test.ts`: "POST /setup/github answers 200 with a review page that posts the manifest to GitHub
    for a personal account"; "POST /setup/github posts an organization's manifest to its organization settings";
    "POST /setup/github sends GitHub no CSRF token and widens form-action to https://github.com on that page only";
    "POST /setup/github rejects a wrong CSRF token with 403"; "POST /setup/github answers 400 with the invalid account
    notice for a missing, repeated or invalid field" (`it.each`); "POST /setup/github answers 409 while a GitHub
    Worker secret is set"; "POST /setup/github answers 409 reset needed when the key check fails"; "the state of the
    review page is valid for the session for one hour".
  - `src/setup/github-step.test.ts`: "startGitHubApp checks Worker secrets, then the account, then the key check".
- [ ] AC6 (return): `GET /setup/github/callback` (any session state, after the `SELUNA_SECRET` check) answers 200 with
  the finish page when the query has exactly one `code` matching `^[A-Za-z0-9_-]{1,100}$` and exactly one `state`
  matching the state form; the page's one form posts hidden `code` and `state` (escaped) to `/setup/github/callback`
  and carries no `csrf` field. Otherwise 400 with the GitHub notice-only page and _invalid return_. Neither answer
  calls GitHub or D1 or sets a cookie (a `lang` query parameter still sets the language cookie).
  - `src/setup/handler.test.ts`: "GET /setup/github/callback answers 200 signed out with a finish form carrying code
    and state"; "GET /setup/github/callback sets no cookie and calls neither GitHub nor D1"; "GET
    /setup/github/callback answers 400 with the invalid return notice for a missing, repeated or malformed code or
    state" (`it.each`, including the forms of *Guard forms*).
- [ ] AC7 (conversion client): `convertManifestCode(code, version, fetcher)` sends one `POST
  https://api.github.com/app-manifests/<code>/conversions` with `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: seluna/<version>`, no `Authorization`, no body, a 10 second abort;
  2xx with a body that narrows → `converted` (`appId` positive safe integer `id`, `pem` string of at most 16,384
  characters, `webhookSecret` non-empty string of at most 1,024 characters, `slug` when it matches `^[a-z0-9-]{1,100}$`,
  else `undefined`); 404 and 422 → `rejected`; any other status, a rejected or aborted fetch → `unavailable`; a 2xx
  body above 1 MiB, not UTF-8 JSON, or of another shape (also `webhook_secret: null`) → `malformed`. A code outside the
  allow-list returns `rejected` without a call.
  - `src/github/conversion.test.ts`: "convertManifestCode posts to the conversions endpoint without credentials and
    with the API headers"; "convertManifestCode narrows the documented answer to app id, slug, pem and webhook secret"
    (fixture `manifest-conversion.json`); "convertManifestCode reports 404 and 422 as rejected" (fixtures);
    "convertManifestCode reports a rejected fetch and other statuses as unavailable" (`it.each`);
    "convertManifestCode reports an oversized, non-JSON or differently shaped 2xx answer as malformed" (`it.each`);
    "convertManifestCode makes no call for a code outside the allow-list"; "parseConversion leaves out a slug outside
    the allow-list".
- [ ] AC8 (private key): `toPkcs8Pem(pem)` returns the PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----\n`, base64 in lines of
  64 characters, `\n-----END PRIVATE KEY-----\n`) of a PKCS#1 (`RSA PRIVATE KEY`) or PKCS#8 (`PRIVATE KEY`) input, only
  when the DER imports with `importKey("pkcs8", …, {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}, false, ["sign"])`;
  otherwise `undefined`.
  - `src/github/private-key.test.ts`: "toPkcs8Pem converts the documented PKCS#1 key to the PKCS#8 PEM openssl writes"
    (expected text in `test/fixtures/github/manifest-conversion-pkcs8.json`, made by the Tester with `openssl pkcs8
    -topk8 -nocrypt` from the documented key); "toPkcs8Pem returns a PKCS#8 PEM that imports as an RS256 signing key";
    "toPkcs8Pem passes a PKCS#8 key through in canonical form"; "toPkcs8Pem accepts CRLF line endings and a missing
    final newline"; "toPkcs8Pem rejects every form in the PEM table" (`it.each`, *Guard forms*).
- [ ] AC9 (finish): `POST /setup/github/callback` signed out answers the login page and calls nothing. Signed in, in
  this order: body (413/400); exactly one `state` that is valid for the session, else 403 with the GitHub notice-only
  page and _state invalid_ (GitHub not called); any Worker secret set → 409 with that view; exactly one `code` in the
  allow-list, else 400 _invalid return_; key check `changed`/`corrupt` → 409 _reset needed_ and D1 error → 503
  _unavailable_, both before any GitHub call; conversion `rejected` → 400 _code rejected_; `unavailable` → 502 with the
  finish page (same `code` and `state`) and _GitHub unavailable_; `malformed` or a key `toPkcs8Pem` refuses → 502
  _answer invalid_; then `writeSecrets` with `github_app_id` = decimal App ID, `github_private_key` = PKCS#8 PEM,
  `github_webhook_secret` = the webhook secret; any result but `ok`, or a D1 error, → 503 _store failed_; `ok` → 200
  with the created page: _app saved_, the install link `https://github.com/apps/<slug>/installations/new` and the
  _install intro_, or without a slug the _install manually_ text. The `csrf` field is not read on this form.
  - `src/setup/handler.test.ts`: "POST /setup/github/callback stores app id, PKCS#8 key and webhook secret encrypted
    and links to the installation page"; "POST /setup/github/callback signed out answers the login page and calls
    nothing"; "POST /setup/github/callback rejects a state of another session, an expired or a missing state with 403
    without calling GitHub" (`it.each`); "POST /setup/github/callback answers 409 while a GitHub Worker secret is set,
    without calling GitHub"; "POST /setup/github/callback answers 409 reset needed before calling GitHub";
    "POST /setup/github/callback answers 400 code rejected for GitHub's 404 and 422"; "POST /setup/github/callback
    offers the finish form again with 502 when GitHub is unavailable"; "POST /setup/github/callback answers 502 answer
    invalid and stores nothing for a malformed answer or a key that does not import"; "POST /setup/github/callback
    answers 503 store failed when saving fails after the conversion"; "the created page tells how to install the app
    when the answer has no usable slug".
  - `src/setup/github-step.test.ts`: "finishGitHubApp stores exactly the three values and never the client secret";
    "finishGitHubApp converts only after the state, the Worker secrets, the code and the key check passed".
- [ ] AC10 (atomic storage): `writeSecrets(db, key, values)` stores all three credentials (and the key check value on
  the first write) in one D1 batch whose statements are all guarded by the checked key check value; it reports `ok`
  only when all three were written, retries once from the check like `writeSecret`, and writes none when the key check
  changed (`secret-changed`) or is corrupt.
  - `src/store/secrets.test.ts`: "writeSecrets stores the three credentials and the key check value on the first
    write"; "writeSecrets replaces earlier values of all three"; "writeSecrets writes none of the three under a changed
    SELUNA_SECRET"; "writeSecrets writes none of the three when the key check value is corrupt".
- [ ] AC11 (webhook source, issue AC-c at unit level): `webhookSecretSource(env, db)` resolves to
  `GITHUB_WEBHOOK_SECRET` when it is a non-empty string, without touching D1; else, with a usable `SELUNA_SECRET`, to the
  stored `github_webhook_secret` when `readSecret` returns `ok`; else `undefined` (none stored, secret changed,
  corrupt, `SELUNA_SECRET` not configured). A D1 error rejects, so the route answers 503.
  - `src/webhook-secret.test.ts`: "webhookSecretSource prefers GITHUB_WEBHOOK_SECRET and does not read D1";
    "webhookSecretSource returns the webhook secret stored in D1 when the Worker secret is absent or empty";
    "webhookSecretSource returns undefined when nothing is stored, the key check fails or SELUNA_SECRET is not
    configured"; "webhookSecretSource lets a D1 error reach the caller".
  - `src/router.test.ts`: "POST /webhook answers 202 for the real ping delivery signed with the webhook secret stored
    in D1" (stores `my-secret` of `test/fixtures/ping/form-delivery.json` with `writeSecrets`); "POST /webhook answers
    503 when reading the stored webhook secret fails".
  - `src/index.test.ts`: "POST /webhook uses the webhook secret stored in D1 through the Worker".
- [ ] AC12 (pages): `contentSecurityPolicy("github")` equals the default policy with `form-action https://github.com`
  in place of `form-action 'self'`; every GitHub page escapes every value it renders; every new text exists in English
  and German, and the English texts are those of *Texts* below.
  - `src/setup/pages.test.ts`: "contentSecurityPolicy for github allows forms to post to https://github.com only";
    "renderGitHubReviewPage escapes the app name, the form action and the manifest"; "renderGitHubFinishPage escapes
    code and state and has no csrf field"; the existing `PAGES`/`NOTICES` tables extended to the new pages and notices.
  - `src/setup/texts.test.ts`: "texts word the English GitHub step as the area document does".
- [ ] AC13 (shared bounded JSON reader): `readJsonWithLimit(response, maxBytes)` returns the parsed JSON of a body of
  at most `maxBytes` bytes that is UTF-8 JSON, else `undefined`; `src/telegram.ts` uses it unchanged in behavior.
  - `src/body.test.ts`: "readJsonWithLimit parses a UTF-8 JSON body within the limit"; "readJsonWithLimit returns
    undefined above the limit, for invalid UTF-8 and for text that is not JSON" (`it.each`).
- [ ] AC14 (logging): the code and state of the return never reach a log.
  - `src/router.test.ts`: "handleRequest logs GET /setup/github/callback as method, path and status without the
    query".
- [ ] AC15 (through the Worker): the finish step reaches GitHub through the Worker's global `fetch`.
  - `src/index.test.ts`: "the GitHub step of /setup calls the GitHub API through the global fetch of the Worker".

The issue's AC-a to AC-c are additionally verified live by the Product Manager (*Verification without tests* is not
needed; see *Runtime details only a live run can verify*).

## Behavior coverage

| `spec.md` bullet | Criteria |
| ---------------- | -------- |
| B1 start page link | AC4 |
| B2 step page views | AC4 |
| B3 start form, review page, state, form-action | AC2, AC3, AC5, AC12 |
| B4 manifest content | AC1, AC2 |
| B5 signed-out return, finish page | AC6, AC14 |
| B6 finish order and checks | AC3, AC9 |
| B7 key conversion, atomic storage, discarded fields | AC7, AC8, AC9, AC10 |
| B8 created page, install link | AC9 |
| B9 fixed notices | AC5, AC6, AC9, AC12 |
| B10 webhook secret source | AC11 |
| B11 Worker-secret precedence, shown without values | AC4, AC5, AC9, AC11 |

## Approach

### Flow

1. `GET /setup/github` (signed in) — the step page (AC4).
2. `POST /setup/github` (signed in, CSRF) — validates, creates the state, answers the review page whose form posts the
   manifest to GitHub (AC5). Two clicks are needed because pages have no script; the review page also shows the owner
   what will be requested.
3. GitHub shows its own page (name editable), creates the app and redirects to
   `<origin>/setup/github/callback?code=…&state=…`.
4. `GET /setup/github/callback` — no session arrives (`SameSite=Strict`); the finish page re-posts `code` and `state`
   from the instance's own page, which is a same-site request, so the session cookie is sent (AC6).
5. `POST /setup/github/callback` (signed in) — the state takes the role of the session-bound CSRF token: it is an HMAC
   under a key from `SELUNA_SECRET` over this session's token, so neither a cross-site page (no cookies) nor a host
   under the same registrable domain (no state for this session) can submit it (AC9). The `csrf` field is not used on
   this one form because the finish page is rendered without the session and must not set `seluna_csrf` (it would
   replace the owner's cookie and expire every other open form).
6. Conversion, PKCS#8 conversion and import check, one-batch write, created page with the install link.

`<origin>` is `new URL(request.url).origin` of the signed-in `POST /setup/github`. That request carries the `Secure`
session cookie, so it was made over HTTPS (or `localhost` in development); no extra scheme check is needed.

### Request order under `/setup` (changes to `handleSetup`)

1. No usable `SELUNA_SECRET` → 503 (unchanged; the storage key from `keyFromEnv` is derived here too, and a missing
   key counts as not configured).
2. `POST /setup/login` → login (unchanged).
3. **New:** `GET /setup/github/callback` → finish page or 400, with or without a session.
4. No valid session → login page (unchanged; this covers a signed-out `POST /setup/github/callback`).
5. Signed in: existing routes plus `GET`/`POST /setup/github` and `POST /setup/github/callback`; everything else 404.

### Statuses

| Request | Outcome | Status | Page |
| ------- | ------- | ------ | ---- |
| `GET /setup/github` | view | 200 | step page (view) |
| | D1 error | 503 | GitHub notice-only, _unavailable_ |
| `POST /setup/github` | too large / unreadable | 413 / 400 | empty |
| | CSRF invalid | 403 | GitHub notice-only, _form expired_ |
| | any Worker secret set | 409 | step page, `worker-secrets` or `partial-worker-secrets` view |
| | invalid account | 400 | step page (`form` view, read again), _invalid account_ |
| | key check changed/corrupt | 409 | step page, `reset-needed` view |
| | D1 error | 503 | GitHub notice-only, _unavailable_ |
| | ok | 200 | review page (CSP `form-action https://github.com`) |
| `GET /setup/github/callback` | valid fields | 200 | finish page |
| | missing/repeated/malformed | 400 | GitHub notice-only, _invalid return_ |
| `POST /setup/github/callback` | signed out | 200 | login page |
| | too large / unreadable | 413 / 400 | empty |
| | state invalid | 403 | GitHub notice-only, _state invalid_ |
| | any Worker secret set | 409 | step page, Worker-secret view |
| | code missing/repeated/malformed | 400 | GitHub notice-only, _invalid return_ |
| | key check changed/corrupt | 409 | step page, `reset-needed` view |
| | D1 error before the conversion | 503 | GitHub notice-only, _unavailable_ |
| | conversion rejected | 400 | GitHub notice-only, _code rejected_ |
| | conversion unavailable | 502 | finish page again, _GitHub unavailable_ |
| | answer malformed / key refused | 502 | GitHub notice-only, _answer invalid_ |
| | store not ok / D1 error after conversion | 503 | GitHub notice-only, _store failed_ |
| | stored | 200 | created page |

The GitHub notice-only page: heading, the notice, and a link to `/setup/github` (_back to the step_).

### Texts (English; the Dev translates them into German in `src/setup/texts.ts`; the area document's *Texts* lists the English ones)

- Start page link: "GitHub App".
- `githubHeading`: "GitHub App"
- `githubIntro`: "Seluna receives the events of your repositories through a private GitHub App of its own. Create it here for
  your personal account or for an organization: Seluna sends GitHub a manifest with the app's name, the webhook
  address of this instance and read-only permissions, and saves the app's credentials encrypted once you have
  confirmed on GitHub."
- `githubWorkerSecrets`: "The GitHub App is set by the Worker secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and
  GITHUB_WEBHOOK_SECRET, which take precedence over an app created here. To create the app here, delete those
  secrets."
- `githubPartialWorkerSecrets`: "Some, but not all, of the Worker secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and
  GITHUB_WEBHOOK_SECRET are set. Set all three to configure the app by hand, or delete them to create the app here."
- `githubResetNeeded`: "The saved GitHub credentials cannot be read with the current SELUNA_SECRET: it was changed, or
  the saved values are damaged. Set the earlier SELUNA_SECRET again, or delete the saved credentials in the Cloudflare
  dashboard (the rows of the D1 table secrets and the row key_check of the table meta), then create the app again."
- `githubSavedApp` (followed by the id): "Saved GitHub App, App ID:"; `githubNoSavedApp`: "No GitHub App is saved
  yet."; `githubReplaceHint`: "Creating a new app replaces the saved one. Delete the old app on GitHub afterwards: in the
  settings of your account or organization, under Developer settings, then GitHub Apps."
- `githubPersonal`: "My personal account"; `githubOrganization`: "An organization"; `githubAccountLabel`: "Name of the
  account or organization, as in github.com/name"; `githubNextButton`: "Next".
- `githubReviewIntro`: "Seluna asks GitHub to create this app. On GitHub, check the details and select Create GitHub
  App; GitHub then sends you back here."; `githubAppNameLabel`: "App name:"; `githubPermissionsLabel`: "Permissions,
  all read-only:"; `githubPermissionsList`: "Actions, Pull requests, Dependabot alerts, Code scanning alerts, Secret
  scanning alerts, Metadata"; `githubEventsLabel`: "Events:"; `githubEventsList`: "Pull request, Workflow run,
  Dependabot alert, Code scanning alert, Secret scanning alert"; `githubToGitHubButton`: "Continue to GitHub".
- `githubFinishIntro`: "GitHub has created the app. Select Finish so that Seluna fetches and saves its credentials.";
  `githubFinishButton`: "Finish".
- `githubCreated`: "The GitHub App is saved."; `githubInstallIntro`: "Now install it on your account or organization.
  Choosing All repositories is recommended, so that new repositories are covered too."; `githubInstallLink`: "Install
  the app on GitHub"; `githubInstallManual`: "Install it on GitHub: in the settings of your account or organization,
  open Developer settings, then GitHub Apps, choose the app and select Install App. Choosing All repositories is
  recommended, so that new repositories are covered too."
- `githubBackLink`: "Back to the GitHub App step".
- Notices: _invalid account_ `github-invalid-account`: "Choose your personal account or an organization and enter its
  name: 1 to 39 letters, digits and hyphens, not starting or ending with a hyphen."; _invalid return_
  `github-return-invalid`: "This page needs the code and state GitHub sends back after creating the app. Start again
  from the GitHub App step."; _state invalid_ `github-state-invalid`: "This return from GitHub does not belong to your
  current sign-in or is older than one hour, so nothing was saved. If GitHub created an app, delete it on GitHub and
  start again."; _code rejected_ `github-code-rejected`: "GitHub no longer accepts this return: the code was already
  used or is older than one hour. If you have just created the app, it is already saved; otherwise delete it on GitHub
  and start again."; _GitHub unavailable_ `github-unavailable`: "GitHub could not be reached. Select Finish again in a
  moment; the return stays valid for one hour."; _answer invalid_ `github-answer-invalid`: "GitHub created the app, but
  its answer could not be read, so nothing was saved. Delete the app on GitHub and start again."; _store failed_
  `github-store-failed`: "GitHub created the app, but saving its credentials failed, so nothing was saved. Delete the
  app on GitHub and start again."

## Guard forms

Every value that enters a URL is allow-listed, never encoded or trimmed; each guard's behavior per form is pinned by
the named `it.each` tables.

**Account name** → path segment of `https://github.com/organizations/<name>/settings/apps/new` and part of the app
name. The WHATWG URL parser (which `Request`/`fetch` and the browser use for the form action) treats in a path: `/`
and `\` as separators, `.`/`..` and `%2e`/`%2E` variants as dot segments, `?` and `#` as the start of query and
fragment, `%XX` as an escape, tab/LF/CR as removed, leading/trailing C0 controls and spaces as stripped, other
non-ASCII as percent-encoded. `isAccountName` rejects: empty; 40 characters; leading `-`; trailing `-`; `a/b`; `a`,
a backslash (U+005C), `b`; `.`; `..`; `%2e%2e`; `a%2Fb`; `a?b`; `a#b`; `a b`; ` a` (leading space); `a` followed by a
tab (U+0009); `a`, a line feed (U+000A), `b`; `a.b`; `a_b`; `a@b`; `a:b`; `ä`; the fullwidth `ａ` (U+FF41); and accepts
`a`, `A1`, `a-b`, `a--b`, 39 characters. The test table writes the control characters and the backslash as escapes
in TypeScript string literals; the 40-character case fails only through the length bound, so a lost escape still
leaves each other case rejected by the character class. (`a--b` is accepted:
GitHub no longer allows consecutive hyphens in new names but older accounts may have them, and it is path-safe.)

**Manifest code** → path segment of `https://api.github.com/app-manifests/<code>/conversions`. Allow-list
`^[A-Za-z0-9_-]{1,100}$` (documented example: 40 lowercase hex digits). The table of AC6 and AC7 rejects: empty; 101
characters; `..`; `.`; `a/b`; `a`, a backslash, `b`; `%2e%2e`; `a%2Fb`; `a?b`; `a#b`; `a b`; `a+b`; `a=b`; `ä`; and accepts the
documented `a180b1a3d263c81bc6441d7b990bae27d4c10679`, `A-_9`.

**State** → query of the form action (`?state=`), checked on return. Form `^v1\.([1-9]\d{0,14})\.([\w-]{22})\.([\w-]{43})$`
(base64url and digits are unreserved characters, so neither the browser nor GitHub needs to encode them). Rejected on
`GET /setup/github/callback`: empty; `v2.…`; a 21- or 23-character nonce; padding `=`; `+` or `/`; a leading zero in
the expiry; two `state` parameters. On the POST additionally: another session, another `SELUNA_SECRET`, `expires ≤
now`, `expires > now + 1 h`, a non-canonical nonce or MAC (unused low bits set, `withUnusedBitFlipped` of
`test/keys.ts`).

**App slug** → path segment of `https://github.com/apps/<slug>/installations/new`. Allow-list `^[a-z0-9-]{1,100}$`;
anything else (absent, empty, uppercase, `.`, `/`, `%`, 101 characters) gives no link and the _install manually_ text.
The slug is the only value from GitHub's answer that is rendered.

**PEM** (`toPkcs8Pem`) — accepted: exactly `-----BEGIN RSA PRIVATE KEY-----` or `-----BEGIN PRIVATE KEY-----`, a line
break (`\n` or `\r\n`), lines of standard base64 (with padding only at the end), the matching `-----END … -----`
line, and at most one final line break; the decoded base64 must re-encode to the same text (canonical). Rejected
(table of AC8): another armour (`ENCRYPTED PRIVATE KEY`, `EC PRIVATE KEY`, `PUBLIC KEY`), mismatched BEGIN/END, text
before the BEGIN line or after the END line, two keys, a non-base64 character, base64url characters `-`/`_`, inner
padding, non-canonical base64, more than 16,384 characters, an empty body, DER that `importKey` refuses (a PKCS#1 body
with one byte changed in its outer SEQUENCE length, a truncated body).

## Runtime details only a live run can verify

Named up front; each fails closed. The Product Manager's live check on a deployed copy (personal account and
organization, install, a delivery passes the signature check) covers them before the pull request is marked ready.

1. GitHub returns `code` within `^[A-Za-z0-9_-]{1,100}$` and the `state` unchanged — otherwise _invalid return_,
   nothing created on our side (the app exists on GitHub and is deleted by hand).
2. The browser sends the `SameSite=Strict` session cookie with the finish form's POST (a same-site request from a
   page that a cross-site redirect loaded) — otherwise the login page answers and nothing is stored. If the live
   check shows this, the design needs a new decision, not a silent fallback.
3. `form-action https://github.com` does not block GitHub's own redirects after the manifest POST (to its sign-in
   page, or an organization's SAML single sign-on, which may leave github.com) — otherwise the browser blocks the
   submission and nothing is created.
4. The conversion answers 201 with the documented shape and a PKCS#1 `pem` — another shape is _answer invalid_ and
   stores nothing.
5. GitHub accepts the manifest's permission and event names and `public: false` as documented — a refusal shows on
   GitHub's page, before anything is created.

The unit tests share the documentation's assumptions (decision 0017, *Consequences*).

## Options considered

1. **Return handling:** (a) finish page posting `code` and `state` back same-site, the state bound to the session —
   chosen; (b) exchange the code on the signed-out GET, authorized by the state alone — a GET with an effect, and a
   state that cannot be bound to a session the request does not carry, so a leaked return URL could be replayed within
   the hour by anyone; (c) a `SameSite=Lax` session cookie — weakens decision 0015 for every page; (d) a D1 row for
   the pending state — storage and cleanup for what an HMAC token does.
2. **CSRF on the finish form:** (a) the session-bound state replaces the `csrf` field on this one form — chosen;
   (b) a `csrf` field bound to a freshly drawn cookie — the signed-out finish page would overwrite the owner's
   `seluna_csrf` and expire every other open form, and the token would still have to be bound to the session.
3. **State key:** a fourth signing key `seluna/setup-github/v1` (chosen, like 0016's chat-proof key) versus reusing
   the CSRF key with a prefix — separation by construction costs one HKDF per request.
4. **Untrusted names in URLs:** allow-lists (chosen, as 0016 did for the bot token) versus `encodeURIComponent` — a
   malformed value would reach GitHub, and "invalid" could not be told apart from "rejected".
5. **Private key:** convert to PKCS#8 and check with `importKey` before storing (chosen; the issue asks for the
   conversion in the Worker) versus storing GitHub's PKCS#1 text and converting at use in #15 — a key that cannot be
   used would only surface when the first event needs the API.
6. **Storage:** one batch for all three credentials (chosen) versus three `writeSecret` calls — a failure between them
   leaves credentials of two different apps.
7. **Worker-secret precedence:** per credential for reading, and the manifest flow refused while any of the three is
   set (chosen) versus all-or-nothing precedence (an instance of 0.1.0 that set only `GITHUB_WEBHOOK_SECRET`, as the
   deployment area told it to, would stop verifying deliveries) versus no refusal (a created app's credentials would be
   mixed with a hand-set secret of another app).
8. **Install link:** shown on the created page from the answer's slug, nothing stored for it (chosen) versus a
   `settings` row `github_app_slug` — a second write outside the credentials' transaction for a value #11/#15 can read
   from GitHub (`GET /app`) with the stored credentials.
9. **GitHub client injection:** an injected `GitHubFetch` in the setup dependencies (chosen, as 0016 option 15) versus
   the stub on `globalThis.fetch` that `.squad/project.md` describes for the not yet built GitHub API double.
10. **Client source:** GitHub's documentation and OpenAPI description, fixtures reference-built — the Product Manager's
    decision (no captured sample; the session cannot run the flow).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/github/manifest.ts` | new: account type and name, app name, manifest, form action |
| Worker | `src/github/conversion.ts` | new: `GitHubFetch`, the conversion client and its narrowing |
| Worker | `src/github/private-key.ts` | new: PKCS#1/PKCS#8 PEM to PKCS#8 PEM with import check |
| Worker | `src/github/worker-secrets.ts` | new: names of the three Worker secrets, `workerCredentials` |
| Worker | `src/setup/github-state.ts` | new: signed state |
| Worker | `src/setup/github-step.ts` | new: step view, start, finish |
| Worker | `src/setup/handler.ts` | routes, `SetupDeps` (`githubFetch`, `version`), context keys, `SetupForm` |
| Worker | `src/setup/pages.ts` | per-page form target in the CSP, GitHub pages, start page link |
| Worker | `src/setup/texts.ts` | new texts and notices (en, de) |
| Worker | `src/crypto.ts` | `SigningPurpose` and label `setup-github` |
| Worker | `src/store/secrets.ts` | `writeSecrets` |
| Worker | `src/webhook-secret.ts` | `webhookSecretSource` |
| Worker | `src/body.ts`, `src/telegram.ts` | `readJsonWithLimit` moved from `telegram.ts` |
| Worker | `src/index.ts` | wires `webhookSecretSource`, `githubFetch`, `version` |
| Tests | `test/github.ts` | new GitHub API double |
| Tests | `test/fixtures/github/*` | new reference-built fixtures and `README.md` |

`src/router.ts` keeps its code; `RouteDeps.setup` gains the new fields through `SetupDeps`.

## Signatures (for the Dev's skeleton)

```ts
// src/crypto.ts (changed)
export type SigningPurpose = "setup-session" | "setup-csrf" | "setup-telegram" | "setup-github";
// SIGNING_KEY_LABELS gains "setup-github": "seluna/setup-github/v1"

// src/body.ts (new export; moved from src/telegram.ts)
/** The parsed JSON of a body of at most `maxBytes` bytes (counted before decoding) that is UTF-8 JSON, else `undefined`. Never throws. */
export async function readJsonWithLimit(message: Request | Response, maxBytes: number): Promise<unknown>;

// src/github/manifest.ts (new)
export type AccountType = "personal" | "organization";
export const SELUNA_HOMEPAGE = "https://github.com/LarsLaskowski/Seluna";
export const MAX_APP_NAME_CHARACTERS = 34;
export const APP_PERMISSIONS: Readonly<Record<string, "read">>;
export const APP_EVENTS: readonly string[];
export interface AppManifest {
  readonly name: string;
  readonly url: string;
  readonly hook_attributes: { readonly url: string; readonly active: true };
  readonly redirect_url: string;
  readonly public: false;
  readonly default_permissions: Readonly<Record<string, "read">>;
  readonly default_events: readonly string[];
}
export function parseAccountType(text: string): AccountType | undefined;
export function isAccountName(text: string): boolean;
export function appName(account: string): string;
/** `origin` without a trailing slash, e.g. `https://seluna.example.workers.dev`. */
export function appManifest(origin: string, account: string): AppManifest;
export function manifestFormAction(type: AccountType, account: string, state: string): string;

// src/github/conversion.ts (new)
/** Sends one request to the GitHub API; injected so tests never reach the network. */
export type GitHubFetch = (request: Request) => Promise<Response>;
export const GITHUB_API_ORIGIN = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const MAX_GITHUB_RESPONSE_BYTES = 1_048_576;
export const GITHUB_TIMEOUT_MS = 10_000;
export const MAX_PEM_CHARACTERS = 16_384;
export const MAX_WEBHOOK_SECRET_CHARACTERS = 1_024;
export interface ConvertedApp {
  readonly appId: number;
  readonly slug: string | undefined;
  readonly pem: string;
  readonly webhookSecret: string;
}
export type ConversionResult =
  | { readonly kind: "converted"; readonly app: ConvertedApp }
  | { readonly kind: "rejected" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "malformed" };
export function isManifestCode(text: string): boolean;
export function parseConversion(body: unknown): ConvertedApp | undefined;
/** Never throws. */
export async function convertManifestCode(code: string, version: string, fetcher: GitHubFetch): Promise<ConversionResult>;

// src/github/private-key.ts (new)
/** The PKCS#8 PEM of an RSA key given as PKCS#1 or PKCS#8 PEM, or `undefined` unless it imports as an RS256 signing key. Never throws. */
export async function toPkcs8Pem(pem: string): Promise<string | undefined>;

// src/github/worker-secrets.ts (new)
export const APP_ID_SECRET_NAME = "GITHUB_APP_ID";
export const PRIVATE_KEY_SECRET_NAME = "GITHUB_APP_PRIVATE_KEY";
export type WorkerCredentials = "none" | "partial" | "all";
/** How many of GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are non-empty strings. */
export function workerCredentials(env: object): WorkerCredentials;

// src/store/secrets.ts (new export; writeSecret stays)
export async function writeSecrets(
  db: D1Database,
  key: CryptoKey,
  values: Readonly<Record<SecretName, string>>,
): Promise<SecretWriteResult>;

// src/webhook-secret.ts (new export; secretFromEnv stays)
/** GITHUB_WEBHOOK_SECRET when set, else the webhook secret stored in D1; D1 errors reject. */
export function webhookSecretSource(env: object, db: D1Database): WebhookSecretSource;

// src/setup/github-state.ts (new)
export const GITHUB_STATE_LIFETIME_MS = 3_600_000;
export async function createGitHubState(key: CryptoKey, session: string, now: Date): Promise<string>;
export function isWellFormedGitHubState(state: string): boolean;
export async function isValidGitHubState(key: CryptoKey, state: string, session: string, now: Date): Promise<boolean>;

// src/setup/github-step.ts (new)
export const GITHUB_STEP_PATH = "/setup/github";
export const GITHUB_CALLBACK_PATH = "/setup/github/callback";
export const ACCOUNT_TYPE_FIELD = "account_type";
export const ACCOUNT_FIELD = "account";
export const GITHUB_CODE_FIELD = "code";
export const GITHUB_STATE_FIELD = "state";
export type GitHubStepView =
  | { readonly kind: "worker-secrets" }
  | { readonly kind: "partial-worker-secrets" }
  | { readonly kind: "reset-needed" }
  | { readonly kind: "form"; readonly savedAppId: number | undefined };
/** D1 errors are not caught. */
export async function gitHubStepView(env: object, db: D1Database, storageKey: CryptoKey): Promise<GitHubStepView>;
export type StartGitHubResult =
  | { readonly kind: "review"; readonly appName: string; readonly formAction: string; readonly manifest: string }
  | { readonly kind: "worker-secrets" }
  | { readonly kind: "partial-worker-secrets" }
  | { readonly kind: "invalid-account" }
  | { readonly kind: "reset-needed" };
/** D1 errors are not caught. */
export async function startGitHubApp(
  env: object,
  db: D1Database,
  storageKey: CryptoKey,
  stateKey: CryptoKey,
  session: string,
  origin: string,
  typeFields: readonly string[],
  accountFields: readonly string[],
  now: Date,
): Promise<StartGitHubResult>;
/** The one code and one state of the return when both pass their allow-lists, else `undefined`. */
export function returnFields(
  codeFields: readonly string[],
  stateFields: readonly string[],
): { readonly code: string; readonly state: string } | undefined;
export type FinishGitHubResult =
  | { readonly kind: "created"; readonly slug: string | undefined }
  | { readonly kind: "state-invalid" }
  | { readonly kind: "worker-secrets" }
  | { readonly kind: "partial-worker-secrets" }
  | { readonly kind: "return-invalid" }
  | { readonly kind: "reset-needed" }
  | { readonly kind: "code-rejected" }
  | { readonly kind: "github-unavailable"; readonly code: string; readonly state: string }
  | { readonly kind: "answer-invalid" }
  | { readonly kind: "store-failed" };
/** D1 errors before the conversion are not caught; after it every failure is `store-failed`. */
export async function finishGitHubApp(
  env: object,
  db: D1Database,
  storageKey: CryptoKey,
  stateKey: CryptoKey,
  session: string,
  fetcher: GitHubFetch,
  version: string,
  codeFields: readonly string[],
  stateFields: readonly string[],
  now: Date,
): Promise<FinishGitHubResult>;

// src/setup/pages.ts (changed / new)
export type FormTarget = "self" | "github";
export async function contentSecurityPolicy(formTarget?: FormTarget): Promise<string>; // default "self"
export async function htmlResponse(
  page: string,
  status: number,
  language: Language,
  cookies: readonly string[],
  formTarget?: FormTarget, // default "self"
): Promise<Response>;
export type GitHubPageView =
  | GitHubStepView
  | { readonly kind: "notice-only" }
  | { readonly kind: "created"; readonly slug: string | undefined };
export function renderGitHubPage(language: Language, csrfToken: string, view: GitHubPageView, notice?: Notice): string;
export function renderGitHubReviewPage(language: Language, appName: string, formAction: string, manifest: string): string;
export function renderGitHubFinishPage(language: Language, code: string, state: string, notice?: Notice): string;

// src/setup/handler.ts (changed)
export interface SetupDeps {
  readonly env: object;
  readonly db: D1Database;
  readonly now: () => Date;
  readonly fetch: TelegramFetch;
  /** Reaches the GitHub API. */
  readonly githubFetch: GitHubFetch;
  /** The build's version, sent in the GitHub API's User-Agent. */
  readonly version: string;
}
// Context gains storageKey and githubKey; SetupForm gains
// { readonly kind: "github"; readonly session: string; readonly view: GitHubPageView }.
```

`src/setup/texts.ts`: `Notice` gains the seven notices of *Texts*; `SetupTexts` gains the fields named there.

Files the skeleton rewrites (read and found to need it): `src/crypto.ts`, `src/body.ts`, `src/telegram.ts`,
`src/store/secrets.ts`, `src/webhook-secret.ts`, `src/setup/handler.ts`, `src/setup/pages.ts`, `src/setup/texts.ts`,
`src/index.ts`. Final as they are: `src/router.ts`, `src/signature.ts`, `src/setup/csrf.ts`, `src/setup/session.ts`,
`src/setup/cookies.ts`, `src/base64url.ts`, `migrations/` (no schema change).

## Test files

New: `src/github/manifest.test.ts`, `src/github/conversion.test.ts`, `src/github/private-key.test.ts`,
`src/github/worker-secrets.test.ts`, `src/setup/github-state.test.ts`, `src/setup/github-step.test.ts`. Extended:
`src/setup/handler.test.ts`, `src/setup/pages.test.ts`, `src/setup/texts.test.ts`, `src/store/secrets.test.ts`,
`src/webhook-secret.test.ts`, `src/router.test.ts`, `src/index.test.ts`, `src/body.test.ts`, `src/crypto.test.ts`.

Test data (Tester):

- `test/fixtures/github/manifest-conversion.json` — **GitHub's documented example answer verbatim**
  (`components.examples.integration-from-manifest.value` of GitHub's OpenAPI description, the same as the docs page
  "Create a GitHub App from a manifest"): `id` 1, `slug` `octoapp`, owner, permissions, events, `client_id`,
  `client_secret`, `webhook_secret` (40 hex), and the documented PKCS#1 `pem` with `\n` line breaks and a final `\n`.
  The key is public documentation, valid RSA (checked with `openssl rsa -check`), and grants nothing.
- `test/fixtures/github/manifest-conversion-not-found.json` (404, `basic-error`: `message` "Not Found",
  `documentation_url`, `status` "404") and `manifest-conversion-validation-failed.json` (422,
  `validation-error-simple`: `message` "Validation Failed", `documentation_url`) — written from the schemas.
- `test/fixtures/github/manifest-conversion-pkcs8.json` — `{"pkcs8":"<PEM>"}`, the documented key converted with
  `openssl pkcs8 -topk8 -nocrypt`, the expected output of AC8.
- `test/fixtures/github/README.md` — like `test/fixtures/telegram/README.md`: not captured, written from GitHub's
  documentation and OpenAPI description (decision 0017), which file follows which section, replaced by captured answers
  once the live check yields some (secrets removed).
- `test/github.ts` — the GitHub API double: a `vi.fn<GitHubFetch>()` that records each request (method, URL, headers)
  and answers `POST /app-manifests/<code>/conversions` from the fixtures, a status and body, raw bytes, or a
  rejection; it fails the test on any other URL.

Existing test code that calls a changed signature: `SetupDeps` gains two required fields — `depsAt` in
`src/setup/handler.test.ts:33` and the setup deps in `src/router.test.ts:29` and `:39` (plus every object literal of
type `SetupDeps` there). The **Dev** adapts them in step 4 (`githubFetch: () => Promise.reject(new Error("unexpected
GitHub call"))`, `version: "0.0.0-test"`), mechanically, no assertion touched. `contentSecurityPolicy()` and
`htmlResponse(...)` keep their existing calls valid through the default parameter. `src/telegram.test.ts` keeps
passing through the moved reader (no call-site change).

Files of the change no unit test can cover: none.

## Areas

- `docs/areas/setup-wizard.md` (Dev): *Paths* (request order with the return, the new signed-in routes, the start page
  list), a new section *GitHub App* (views, start, review page, manifest, return, finish order, state format and key,
  allow-lists, statuses, created page), *CSRF protection* (the finish form is protected by its state instead of the
  `csrf` field, and why), *Pages and response headers* (the review page's `form-action https://github.com`; no page
  echoes the request except the allow-listed, escaped `code` and `state` on the finish page), *Texts*, *Limits and
  errors* (GitHub texts never shown; an app created on GitHub but not saved must be deleted by hand; a session that
  expires during the detour loses the return), *Related decisions* (0017).
- `docs/areas/http-routes.md` (Dev): *Webhook signature* — the secret source (Worker secret, else D1; 503 when none is
  usable or D1 fails); *Request body size* — the new form routes and the bounded GitHub answer; *Related decisions*
  (0017).
- `docs/areas/storage.md` (Dev): the three credentials are written together in one transaction by the setup wizard;
  `github_app_id` is decimal text, `github_private_key` a PKCS#8 PEM, `github_webhook_secret` as GitHub generated it;
  the signing-key list gains `seluna/setup-github/v1`.
- `docs/areas/deployment.md` (Dev): *Worker secrets* — rows for `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` (optional,
  by hand, take precedence), the `GITHUB_WEBHOOK_SECRET` row (takes precedence over the stored secret); *Limits and
  errors* — 503 when neither the Worker secret nor a stored webhook secret is usable.

## Documentation updates

- `docs/ARCHITECTURE.md` (Dev): *Webhook to Telegram* step 1 (the secret comes from `GITHUB_WEBHOOK_SECRET` or the
  stored one), *Configuration* (the three optional GitHub Worker secrets take precedence over the credentials the
  wizard stores), *Security model* (the manifest flow's state and the GitHub API call), each linking decision 0017.
- `.squad/project.md` (Dev): *Minimal GitHub App permissions* → "the manifest requests read-only Actions, Pull
  requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts and Metadata (`src/github/manifest.ts`)";
  *Setup login* → every form carries the CSRF token except the GitHub finish form, which is protected by the
  session-bound state (`src/setup/github-state.ts`); a new entry *GitHub App manifest flow* (state, allow-lists on
  account name, code and slug, conversion answer read bounded and narrowed in `src/github/conversion.ts`, key import
  check, one-transaction write, the review page's `form-action https://github.com`); *Encrypted credentials* names
  `writeSecrets`; *Test doubles* → the GitHub API double is `test/github.ts`, an injected `vi.fn<GitHubFetch>()`
  answering from the reference-built `test/fixtures/github/` (decision 0017), replacing the `globalThis.fetch` wording.
- `docs/setup.md` (Dev): *Next steps* — the GitHub App step (personal or organization, confirm on GitHub, Finish,
  install with "All repositories"), the manual alternative with the three Worker secrets, and the removal of "Until
  then the instance answers webhooks with 503".
- `CHANGELOG.md` (Dev): an entry under `## [Unreleased]` / `### Added` for the GitHub App step and the webhook reading
  the stored secret.
- `docs/decisions/0017-github-app-manifest-flow.md` and its index row (Lead, done in this step).
- `README.md`: none (no setting table; the setup guide carries the steps).

## Architecture check

- *A webhook with an invalid signature has no effect* — kept: the source only changes where the secret comes from;
  the order (size, secret, signature) and 503 on a failing source stay (`src/router.ts`).
- *GitHub App credentials are only ever stored encrypted* — kept: the three values go through `encrypt` with their row
  as additional data; the client secret is discarded; nothing from the answer is logged or rendered except the
  allow-listed slug.
- *Each user's data stays in the user's account* — kept: the only new outbound call goes to `api.github.com` from the
  owner's Worker.
- Decision 0015's rule "every form carries a CSRF token" gets one exception (the finish form, protected by an
  equivalent session-bound token); decision 0017 amends 0015 and 0012 and `docs/ARCHITECTURE.md` links it. No guarantee
  of `.squad/project.md` is weakened, so no Product Manager decision is needed beyond the one taken.

## Security considerations

- [ ] Limits: form bodies 1 MiB counted in bytes before decoding (existing reader); the GitHub answer 1 MiB counted in
  bytes before UTF-8 decoding; `pem` ≤ 16,384 and webhook secret ≤ 1,024 UTF-16 code units after JSON decoding;
  account name ≤ 39, code ≤ 100, slug ≤ 100 characters after URL/form decoding (all ASCII allow-lists, so characters
  equal bytes).
- [ ] Exceptions that can reach a user-visible message: none. D1 errors become _unavailable_ (before the conversion)
  or _store failed_ (after it); `fetch` rejections and aborts become _GitHub unavailable_; `JSON.parse`, `TextDecoder`
  and `importKey` failures become _answer invalid_; GitHub's `message`, the runtime's text and every secret never reach
  a page or the log.
- [ ] The finish page echoes `code` and `state` only after their allow-lists, HTML-escaped, in hidden fields; it sets
  no cookie; `Referrer-Policy: no-referrer` keeps the return URL out of any `Referer`.
- [ ] The review page's form carries no `csrf` field (it posts to GitHub) and its CSP is the only one with
  `form-action https://github.com`.
- [ ] Measured behavior: `importKey` refusing a damaged key is exercised by AC8's table in the Workers test pool, the
  runtime that runs in production; no claim rests on an unmeasured library behavior.

## Decision records

- `docs/decisions/0017-github-app-manifest-flow.md` (Proposed) — amends 0012 (secret source and precedence) and 0015
  (the finish form's state in place of the CSRF field, `form-action` widened on the review page).

## Out of scope / follow-ups

- #15 reads `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` (Worker secret first, per credential) and the stored values for
  the JWT; #11 shows the app's name and link (from `GET /app`) and owns the reset. No new follow-up issue.
