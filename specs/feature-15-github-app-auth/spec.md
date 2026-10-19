# Spec: GitHub App authentication

Source: Issue #15
Status: Approved by Product Manager

## Problem

Seluna receives webhooks from the owner's GitHub App, but it cannot call the GitHub API as that app: it has
the App ID and the private key (stored encrypted by the setup wizard, or set as the Worker secrets
`GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`), yet nothing turns them into an API credential. The table
`token_cache` exists since the first migration and the reset already empties it, but nothing writes or reads it.
Two things wait for this:

- The CI failure rule (issue #16) has to look up whether a pull request is a draft, because the `workflow_run`
  payload carries only the pull request's number. Without an API call it cannot keep the guarantee that a draft
  pull request triggers nothing.
- The status page (issue #11) shows which GitHub App is configured, but not where it is installed. The owner
  cannot tell from Seluna whether the app is installed at all, on which account, and whether it covers all
  repositories or only selected ones. Issue #11 left that list to this feature.

An instance can have more than one installation of its app (see *Open questions*, Q1), and each installation has
its own access token, so the payload of each delivery decides which installation (and token) a call uses. An
installation token is valid for one hour, so asking GitHub for a new one on every call would waste a request and
add latency to every delivery.

## Scenarios

The "API client" below is the part of Seluna that other components (the CI failure rule of issue #16 first) call
to read from GitHub; it is not a page. "Now" is the Worker's clock at the call.

- S1: Given a GitHub App saved by the setup wizard and installed on the personal account `octocat` for all
  repositories, when the signed-in owner opens the start page `/setup`, then the status section shows below
  _GitHub App:_ the line _Installations:_ with one entry "octocat (personal account), all repositories".
- S2: Given a GitHub App set by the Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and
  `GITHUB_WEBHOOK_SECRET` and installed on the personal account `octocat` (all repositories) and on the
  organization `octo-org` (selected repositories), when the owner opens `/setup`, then _Installations:_ lists
  both, in GitHub's order: "octocat (personal account), all repositories" and "octo-org (organization), selected
  repositories".
- S3: Given no cached token for installation 1000003, when the API client is asked whether pull request 42 of
  `octocat/hello-world` is a draft for a delivery whose payload has `installation.id` 1000003, then Seluna signs an
  app token (JWT) with the app's private key, requests an installation token with
  `POST /app/installations/1000003/access_tokens`, stores that token encrypted in `token_cache` with the expiry
  GitHub gave, reads `GET /repos/octocat/hello-world/pulls/42` with it and answers whether the pull request is a
  draft.
- S4: Given a cached token for installation 1000003 that expires more than 5 minutes after now, when the API
  client reads a pull request for that installation, then it sends no token request and reads the pull request with
  the cached token.
- S5: Given a cached token for installation 1000003 that expires 5 minutes after now or earlier, when the API client
  reads a pull request for that installation, then it requests a new installation token, replaces the cached one
  with it and reads the pull request with the new token.
- S6: Given two installations, 1000003 (personal account) and 2000004 (organization), when deliveries of both reach
  the API client one after the other or at the same time, then each call uses the token of its own installation,
  each installation has its own row in `token_cache`, and a token request for one never replaces or uses the
  other's token.
- S7: Given any call of Seluna to the GitHub API (the installations list, a token request, a pull request read),
  when the request is sent, then it carries `User-Agent: seluna/<version>` with the version of the build, the same
  `Accept` and `X-GitHub-Api-Version` headers as the existing manifest conversion request, and either the app token
  (`/app/...` requests) or the installation token (repository requests) as `Authorization: Bearer <token>`.

## Errors and edge cases

The API client never throws: every failure below is reported to its caller as one failure result, which carries
no token, key, JWT or text from GitHub's answer. "Cannot be loaded" below is the status page's text
_installations unavailable_ (exact texts under *Non-functional requirements*).

- E1: No usable app: after the per-credential precedence (AC14) there is no App ID or no private key — neither
  the Worker secret nor a saved value, or the saved value cannot be read with the current `SELUNA_SECRET` — or the
  App ID is not a positive whole number. The API client reports failure without any request to GitHub. Only some
  of the three Worker secrets being set is no failure by itself: App ID and key are resolved one by one, and a pair
  from two different apps is refused by GitHub (E3). The status page shows no _Installations:_ line and calls
  GitHub for nothing whenever its _GitHub App:_ line says _none saved yet_, _partial Worker secrets_ or _cannot be
  read_ — a display rule of the status page, which names no usable app in those states and asks the owner to set
  all three Worker secrets or none. With the _GitHub App:_ line at _Worker secrets_ and a `GITHUB_APP_ID` that is not
  a positive whole number, the status page shows _Installations:_ with _installations unavailable_ and calls GitHub
  for nothing.
- E2: The private key cannot sign: the Worker secret `GITHUB_APP_PRIVATE_KEY` is not a PEM RSA key that imports as
  an RS256 signing key (PKCS#1 and PKCS#8 are both accepted), or the saved key does not decrypt. The API client
  reports failure without a request; the status page shows _Installations:_ with the _key unusable_ text.
- E3: GitHub refuses the app token (401, for example after the owner generated a new private key on GitHub and
  deleted the old one, or with an App ID and a key of different apps): the status page shows _Installations:_ with
  _installations unavailable_; the API client reports failure and caches nothing.
- E4: The installation of the payload is unknown to the app, was removed or is suspended (the token request answers
  404, 403 or another non-2xx status): the API client reports failure and caches nothing.
- E5: GitHub is unreachable, does not answer within 10 seconds, answers with a 5xx status or a redirect: failure,
  nothing cached; on the status page _installations unavailable_, and the page still answers 200.
- E6: An answer above 1 MiB, or one Seluna cannot read: not JSON, a token that is missing, empty, not a string,
  longer than the limit or with characters outside the allow-list, an `expires_at` that is missing, not a time, or
  not more than 5 minutes after now; an installations list that is not a list, or an entry that is not an object,
  has no positive whole `id`, an `account` that is neither `null` nor an object, or a `repository_selection` other
  than `all` or `selected`; a pull request without a boolean `draft`.
  Failure, nothing cached; on the status page _installations unavailable_ (the whole list, never a partial one).
- E7: The payload has no `installation.id`, or it is not a positive whole number within the safe integer range (a
  string, `0`, a negative or fractional number): the API client reports failure without any request, and never
  falls back to another installation's token.
- E8: The cached token of an installation does not decrypt: `SELUNA_SECRET` was changed (while the app comes from
  Worker secrets), the row was altered, or its `expires_at` was changed after the write (the additional data
  `token_cache/<installation_id>/<expires_at>` no longer matches). It is treated as no cached token: a new token is
  requested and replaces the row.
- E9: A repository request answers 401 (GitHub revoked the token, for example because the app was uninstalled and
  installed again), whether its token came from the cache or was issued and stored in this call: the row that holds
  exactly that token is deleted (matched by installation id and the row's IV), the call reports failure, and the
  next call requests a new token. A row another call has meanwhile replaced with a fresh token (E10) has another IV
  and stays.
- E10: Two calls for the same installation without a usable cached token at the same time: both request a token,
  both reads succeed, and afterwards `token_cache` holds exactly one row for that installation, with one of the two
  tokens.
- E11: D1 fails while the token cache is read, written or deleted: the API client reports failure (no exception
  reaches the webhook processing); a token GitHub already issued is not used for this call. Without a usable
  `SELUNA_SECRET` no token can be stored encrypted, so the API client reports failure without any request.
- E12: The app has no installation yet: _Installations:_ shows _not installed_.
- E13: The app has more than 100 installations: the first 100 GitHub returns are listed, followed by the _more
  installations_ text; Seluna asks GitHub for one page only. The text appears exactly when the answer's `Link`
  header has a link with `rel="next"`; exactly 100 entries without such a link show no text.
- E14: The account of an installation, as GitHub's REST description allows it (a user or organization with `login`
  and `type`, an enterprise with `slug` and `name` but no `login` and no `type`, or `null`): an account with a
  string `login` shows that login and the _account type_ text of its `type` — "(personal account)" for `User`,
  "(organization)" for `Organization`, "(other account)" for any other or a missing `type`; an account without
  `login` but with a string `slug` (an enterprise) shows the slug and "(enterprise)"; an account that is `null`, or
  has neither, shows _unknown account_ in place of name and type. An installation with `suspended_at` set gets ",
  suspended" after the repository selection. Login and slug are shown as text, escaped, never as markup or a link.
- E15: Someone else installed the app (possible only once the owner made the app public on GitHub, or for a public
  app set by Worker secrets): the installation is listed like the owner's own, so the owner sees it, and the API
  client serves its deliveries like any other.
- E16: The repository owner or name, or the pull request number, handed to the API client does not have the form
  GitHub allows (owner `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`, repository name `^[A-Za-z0-9._-]{1,100}$`
  and not `.` or `..`, number a positive safe integer): failure without any request, so no payload text shapes a
  URL.
- E17: The pull request does not exist or the installation cannot see it (404, for example a repository outside the
  selected repositories): failure; the cached token stays.
- E18: A cached token that expires exactly 5 minutes after now counts as expiring (S5): it is renewed, not reused.
- E19: The owner replaces the app (the wizard's GitHub step again, or other Worker secrets): the cached tokens of the
  old app's installations are never used for the new app, because installation ids belong to one app; their rows
  stay until they are cleaned up.

## Non-functional requirements

- **App token (JWT):** header `{"alg":"RS256","typ":"JWT"}`; claims `iat` 60 seconds before now, `exp` 9 minutes
  after now (10 minutes after `iat`, so it is never more than 10 minutes in the future on GitHub's clock even when
  the Worker's clock runs up to a minute ahead), `iss` the App ID; times in whole seconds; signed with RSASSA-PKCS1-v1_5
  SHA-256 through WebCrypto; base64url without padding. A new app token per GitHub request is acceptable; none is
  stored.
- **Installation token:** used from the cache until 5 minutes before the `expires_at` GitHub returned with it (GitHub
  documents one hour); stored only encrypted, as the storage contract for `token_cache` already defines (AES-256-GCM,
  key from `SELUNA_SECRET`, additional data `token_cache/<installation_id>/<expires_at>`, `expires_at` in
  milliseconds). The token text is limited in length and allow-listed before it is stored or enters a header.
- **Credentials:** App ID and private key follow the precedence `docs/ARCHITECTURE.md` already states: each Worker
  secret that is a non-empty string takes precedence over the credential of the same name saved in D1. The App ID
  must be a positive whole number (the form the status page already checks).
- **Requests:** to `https://api.github.com` only; `User-Agent: seluna/<version>`, `Accept:
  application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`; redirects are not followed; 10-second timeout
  per request; every answer read through the bounded reader (1 MiB) and narrowed from `unknown`; at most one token
  request and one repository request per API client call, no retries.
- **Status page time:** `GET /setup` waits for at most one GitHub request (the installations list, one page of up
  to 100), so the page takes at most about 10 seconds longer when GitHub is slow; it never fails because of GitHub.
  Only the signed-in status page calls GitHub; the login page and every signed-out answer still call neither GitHub
  nor D1 (security area *Setup login*).
- **Worker CPU:** signing with WebCrypto must stay within the free plan's CPU time per request; the plan names the
  measurement.
- **Security and privacy:** the private key, app token and installation tokens never appear in a log, a page, an
  error result or D1 in plain text; the request log stays method, path and status. The app's permissions do not
  change (still read-only, the manifest is untouched), and neither does its visibility (private).
- **Texts (status page), English / German:**
  - _installations label_: "Installations:" / "Installationen:"
  - entry: "<login or slug> (<account type>), <repository selection>", or "<unknown account>, <repository
    selection>", and, when suspended, ", suspended" / ", gesperrt"
  - _account type_: "personal account" / "persönliches Konto" for `User`, "organization" / "Organisation" for
    `Organization`, "other account" / "anderes Konto" for another or a missing type, "enterprise" / "Enterprise"
    for an enterprise account (identified by its `slug`)
  - _unknown account_: "Unknown account" / "Unbekanntes Konto"
  - _repository selection_: "all repositories" / "alle Repositories" for `all`, "selected repositories" /
    "ausgewählte Repositories" for `selected`
  - _not installed_: "Not installed on any account yet." / "Noch auf keinem Konto installiert."
  - _more installations_: "Only the first 100 installations are shown." / "Nur die ersten 100 Installationen werden
    angezeigt."
  - _installations unavailable_: "Cannot be loaded from GitHub right now." / "Kann gerade nicht von GitHub geladen
    werden."
  - _key unusable_: "The app's private key cannot be used." / "Der private Schlüssel der App ist nicht verwendbar."
- **Compatibility:** no migration (the `token_cache` table and its storage contract exist); no new setting, Worker
  secret or binding; existing instances need no action.
- **Logs:** nothing new is logged.

## Acceptance criteria

- [ ] AC1: Calls for two installations (ids from `installation.id` of their payloads) each request a token for their
  own id, each store a row under their own id, and each send their repository request with their own token; with
  both rows cached, calls for both send no token request, and a token request for one leaves the other's row
  unchanged (S3, S6).
- [ ] AC2: A cached token is reused while it expires more than 5 minutes after now; at 5 minutes before expiry or
  later a new token is requested and replaces the row (S4, S5, E18).
- [ ] AC3: The token request is `POST https://api.github.com/app/installations/<id>/access_tokens` with
  `Authorization: Bearer <JWT>`, whose header is `{"alg":"RS256","typ":"JWT"}`, whose claims are `iat` = now − 60 s,
  `exp` = now + 540 s and `iss` = the App ID, and whose signature verifies with the app's public key (S3).
- [ ] AC4: A token from GitHub is stored only encrypted: its row decrypts with exactly the additional data
  `token_cache/<installation_id>/<expires_at>` (`expires_at` the answer's time in milliseconds), and the plaintext
  token occurs nowhere in D1; a row that does not decrypt is treated as missing and replaced (S3, E8).
- [ ] AC5: Every GitHub API request of this feature carries `User-Agent: seluna/<version>`, `Accept:
  application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`, does not follow redirects and has a 10-second
  timeout; `/app/...` requests carry the app token, repository requests the installation token (S7, E5).
- [ ] AC6: Without a usable App ID and private key after the per-credential precedence (neither Worker secret nor a
  readable saved value, an App ID that is not a positive whole number, a key that does not import), without a usable
  `SELUNA_SECRET`, with an invalid `installation.id`, or with an invalid repository owner, name or number, the API
  client reports failure and sends no request (E1, E2, E7, E11, E16).
- [ ] AC7: A refused, failed, timed-out, redirected, oversized or unreadable answer of the token request or of the
  repository request, and a D1 failure on the token cache, make the API client report failure without throwing; no
  token is cached from such a token answer, and the result carries no token, key or answer text (E3, E4, E5, E6, E11,
  E17).
- [ ] AC8: A 401 answer to a repository request deletes the row only while it still holds the token that request used
  (same installation id and IV), for a cached token and for one issued and stored in the same call; a row replaced
  by another call in between stays, and a 404 leaves the row (E9, E10, E17).
- [ ] AC9: Two calls for one installation without a cached token at the same time both succeed and leave exactly one
  row for it (E10).
- [ ] AC10: The pull request read answers the `draft` value of `GET /repos/<owner>/<repo>/pulls/<number>` (S3).
- [ ] AC11: With an app from the Worker secrets or saved by the wizard, the status page lists every installation of
  one `GET /app/installations?per_page=100` answer, in its order, as "<login or slug> (<account type>), <repository
  selection>" with ", suspended" for a suspended one, the account type texts for `User`, `Organization`, any other
  or a missing type and an enterprise account, _unknown account_ for a `null` account or one without `login` and
  `slug`, login and slug escaped (S1, S2, E14, E15).
- [ ] AC12: The status page shows _not installed_ for an empty list, and the _more installations_ text after the
  entries exactly when the answer's `Link` header has a link with `rel="next"`; 100 entries without that link show
  no such text (E12, E13).
- [ ] AC13: The status page answers 200 with _installations unavailable_ when the installations request fails, is
  refused, times out, redirects or is unreadable, and without a request when the App ID of the Worker secrets is not a
  positive whole number, with _key unusable_ when the private key cannot sign, and with no
  _Installations:_ line and no GitHub request when the _GitHub App:_ line shows _none saved yet_, _partial Worker
  secrets_ or _cannot be read_ (E1, E2, E3, E5, E6).
- [ ] AC14: The API client takes App ID and private key from `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` when they
  are non-empty strings, each on its own, else from D1 (also when only some of the three Worker secrets are set); a
  private key in PKCS#1 or PKCS#8 PEM signs (S2, S3, E1).
- [ ] AC15: The status page's installation texts are the English and German texts above, in the page's language
  (S1, S2, E12, E13, E14).

## Out of scope

- E19: removing the orphaned and expired rows of `token_cache` is the cleanup cron's job (issue #18).
- Calling the API client from webhook processing or a rule: the CI failure rule (issue #16) is the first caller.
- Making the app public, or any change to its manifest, permissions or events.
- Narrowing an installation token to fewer permissions or repositories in the token request.
- Listing the repositories of an installation with selected repositories, a link to an installation's settings on
  GitHub, and more than one page of installations.
- Handling the `installation` and `installation_repositories` webhook events.
- Caching the installations list or the app token.
- The client ID as the JWT's `iss` (the wizard does not keep the client ID).

## Open questions

- Q1: Can one Seluna app really have installations on a personal account and an organization at the same time, as
  the issue's first criterion says?
  Answered: not with the app the setup wizard creates. Its manifest sets `public: false` (`src/github/manifest.ts`,
  decision 0006), and GitHub documents that a private app "can only be installed on the account that owns the app"
  (github/docs, `making-a-github-app-public-or-private.md`). Several installations exist once the owner makes the app
  public on GitHub, or for a public app set by Worker secrets. The issue's own scope bullet — the installation id
  from each payload, so several installations work in parallel — holds in either case and is what AC1 tests, with two
  installation ids. The app stays private: a public app lets any GitHub user install it and send events to the
  owner's Worker (E15), which would weaken decision 0006 and is out of scope.
- Q2: Which calls do "the rules" need?
  Answered: the current pull request rules read only the payload (`src/rules/`); the security alert rules (issue #17)
  name no API call; the CI failure rule (issue #16) reads `GET /repos/{owner}/{repo}/pulls/{number}` for the draft
  state. So the API client offers that one repository read (AC10), plus the installations list for the status page.
- Q3: Which App ID and private key does authentication use when Worker secrets and saved credentials both exist?
  Answered: each Worker secret takes precedence over the credential of the same name (`docs/ARCHITECTURE.md`,
  *Configuration*). Decision 0017, released with v0.2.0, fixes this for #15 under *Consequences*: "#15 reads
  `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` with the same per-credential precedence", and `webhookSecretSource`
  (`src/webhook-secret.ts`) already resolves the webhook secret that way. So the API client resolves App ID and key
  one by one (AC14), also when only some Worker secrets are set (E1); no record changes. The status page is a
  separate, display-only rule: `appStatus` (`src/setup/status.ts`) reports _partial Worker secrets_ before it reads
  D1, and the status page lists installations only in the two states in which its _GitHub App:_ line names a usable
  app (Worker secrets, saved) (AC13).
- Q4: App ID or client ID as `iss`?
  Answered: the App ID. GitHub accepts both (github/docs, `generating-a-json-web-token-jwt-for-a-github-app.md`) and
  recommends the client ID, but the conversion keeps only App ID, key and webhook secret (`parseConversion` in
  `src/github/conversion.ts`), and a hand-made app is configured with `GITHUB_APP_ID`.
- Q5: Are dependencies #10 and #11 in place?
  Answered: yes, both issues are closed, and the code is on `main`: the manifest flow and the conversion
  (`src/github/manifest.ts`, `src/github/conversion.ts`, `src/setup/github-step.ts`), the PKCS#8 conversion of the key
  (`src/github/private-key.ts`), the status page (`src/setup/status.ts`, `src/setup/pages.ts`), the `token_cache`
  table (`migrations/0001_initial_schema.sql`), its storage contract (`docs/areas/storage.md`, *Encryption*) and the
  reset that empties it (`resetCredentials` in `src/store/secrets.ts`).
- Q6: What does the status page call "repository selection"?
  Answered: the installation's `repository_selection` of the `GET /app/installations` answer, `all` or `selected` —
  what the owner chose on GitHub's install page, where the wizard recommends "All repositories".
- Q7: Are there real answers of the token request, the installations list and the pull request read to build the
  readers from?
  Answered: none in `test/fixtures/` or on the issue, and the session cannot authenticate as an app to capture
  them. The Product Manager decided (escalation of the plan, option B): the token answer and the installations list
  are fixtures written from GitHub's OpenAPI description and documentation and marked as such, as decisions 0016 and
  0017 did; the pull request answer is a real one, captured with `gh api` (`GET /repos/LarsLaskowski/Seluna/pulls/77`,
  a closed pull request that is not a draft) and anonymized; before the pull request is marked ready the Product
  Manager checks the feature live on a deployed copy (the status page lists the installation, a token request
  succeeds and a second call reuses the cached token), and the residual risk is recorded in decision 0026.

## Area documents

- **New area "GitHub API"** (`docs/areas/github-api.md`; a new area is the Lead's decision in the plan): how Seluna
  authenticates as the app (the JWT's claims and lifetime, where App ID and key come from), installation tokens per
  `installation.id` and the 5-minute renewal, the 401 handling, the request headers, timeout, size limit and the
  allow-lists of what enters a URL, and the failure result the callers get.
- **Storage** (`docs/areas/storage.md`): `token_cache` is now written and read — one row per installation, replaced
  on renewal, a row that does not decrypt treated as missing, deleted after a 401; the *(issue #15)* note on the
  additional data becomes a plain statement; the index scope of the area stays.
- **Setup wizard** (`docs/areas/setup-wizard.md`): the _Installations:_ line of the status section with its states,
  its texts in *Texts*, the one GitHub request of `GET /setup` and its time bound under *Limits and errors*; the
  security area *Setup login* is unchanged (only signed-in pages call GitHub).
- **HTTP routes** (`docs/areas/http-routes.md`): the list of external answers read through the bounded reader
  (today Telegram and the conversion) gains the GitHub API answers of this feature.

## Challenge

Spec challenge by the Devil's Advocate at commit a61bd21.

- **Major 1 — E1 contradicts AC14 and decision 0017 for a partial set of Worker secrets.** Accepted. Rule chosen:
  the per-credential precedence of released decision 0017 (*Consequences*) and `docs/ARCHITECTURE.md`, as
  `webhookSecretSource` already does for the webhook secret; superseding a released record to forbid mixing would
  only trade GitHub's 401 (E3) for an earlier failure and gain nothing. E1 no longer lists "only some of the three
  Worker secrets are set" as an API client failure and names a mixed pair as E3's case; AC6 and AC14 say the
  same (AC14 now names E1); Q3 quotes 0017 and separates the status page's display rule (no _Installations:_ line
  in the _partial Worker secrets_ state, from `appStatus`) from the API client's resolution. No decision record
  changes.
- **Minor 1 — an enterprise or `null` account fails the whole list under E6.** Accepted. E14 now covers every
  account form of the REST description: a `login` with its `type` (unknown or missing type: "other account"), an
  enterprise by its `slug` with "(enterprise)", and `null` or neither field as _unknown account_. E6 makes the list
  unavailable only for an entry that is not an object, lacks a positive `id`, has an `account` that is neither `null`
  nor an object, or an unknown `repository_selection`. New texts _enterprise_ and _unknown account_ (English and
  German); AC11 updated.
- **Minor 2 — the delete after a 401 can hit a fresh row, and misses a token issued in the same call.** Accepted.
  E9 and AC8 now delete only the row that still holds the token the request used, matched by installation id and IV
  (every write draws a new IV), for a cached token and for one issued and stored in the same call; a row another
  call replaced in between stays (E10 named in AC8).
- **Minor 3 — when exactly the "more installations" text appears.** Accepted. E13 and AC12 now say: exactly when the
  answer's `Link` header has a link with `rel="next"`; 100 entries without that link show no text.
- **Spec defects found while planning (Lead, plan step).** E1 and AC13 did not say what the status page shows for
  Worker secrets with an App ID that is not a positive whole number: now _installations unavailable_ without a
  request. E11 and AC6 did not cover a missing `SELUNA_SECRET`, without which no token can be cached encrypted: now a
  failure without a request. Q7 records the Product Manager's answer.
