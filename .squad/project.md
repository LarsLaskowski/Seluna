# Project

What the squad needs to know about this project that is not stack-specific. Read by the Lead, the Devil's
Advocate, Security, the Tester and the Reviewer. Not template-managed: `adopt-template` creates it once
and never overwrites it. A product PR updates it when the change makes an entry untrue
(`.squad/routing.md`, *Scope of a product PR*).

## Security areas

A change that touches one of these lists it under *Security areas touched* in its plan, so Security reviews the
plan (`.squad/routing.md`, *Tiers*, which also says when a change is tier `security`). Name the concrete types,
files or endpoints.

- **Webhook signature:** `POST /webhook` verifies `X-Hub-Signature-256` (HMAC-SHA256 over the raw body, constant-time
  comparison) before any parsing; an invalid or missing signature is rejected without a body that explains why.
- **Setup login:** `/setup` and every path below it (`src/setup/`) answer only the login page — or, without a
  `SELUNA_SECRET` of at least 32 characters, a page that explains how to set it; and on `GET /setup/github/callback`, GitHub's signed-out return, the finish
  page or a fixed notice, calling neither GitHub nor D1 (decision 0017) — until the owner signs in with
  `SELUNA_SECRET`, compared in constant time (`verifySelunaSecret` in `src/crypto.ts`). The session is an
  HMAC-SHA256-signed token with a 12-hour expiry (`src/setup/session.ts`, key from `signingKeyFromEnv`) in a cookie
  with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/setup`; every form carries a signed double-submit CSRF token, which on the
  signed-in forms is also bound to the session (`src/setup/csrf.ts`), except the GitHub finish form, which is protected
  by the session-bound state of the manifest flow instead (`src/setup/github-state.ts`, decision 0017); attempts are counted in the `meta` row `login_attempts` before the secret is checked and
  lock the login for 15 minutes after 5 failures (`src/store/login-attempts.ts`); a D1 failure there answers a fixed notice
  (_migrations missing_ when `sqlite_master` lacks a schema table, `src/store/schema.ts`, decision 0021, else
  _unavailable_) and never the error; pages have no script or external
  resource and a strict Content-Security-Policy (`src/setup/pages.ts`) (decision 0015).
- **Encrypted credentials:** the GitHub App ID, private key and webhook secret and the Telegram bot token entered in
  the setup wizard (`telegram_bot_token`, written alone through `writeSecret` and deleted through `deleteSecret`) live
  in the D1 table `secrets` as AES-256-GCM ciphertext (random 96-bit nonce per value; code in `src/crypto.ts` and `src/store/secrets.ts`, the three
  credentials of the manifest flow together through `writeSecrets`); the key comes from the Worker secret `SELUNA_SECRET`. The D1 table `token_cache` holds installation tokens encrypted the same way, each ciphertext is bound to its row (additional data), expired rows are deleted by the cleanup cron (`src/cleanup.ts`), and a key check value in `meta` reports a changed `SELUNA_SECRET`. The
  Telegram bot token is the optional Worker secret `TELEGRAM_BOT_TOKEN`, which takes precedence over the saved token
  (`resolveBotToken` in `src/bot-token.ts`; a malformed Worker secret does not fall back). Worker secrets are set
  through the deploy form (which asks only for `SELUNA_SECRET`) or Wrangler and never committed (`.gitignore` ignores `.dev.vars*` and `.env*`, the files Wrangler loads local secrets
  from, except `.dev.vars.example` and `.env.example`, which hold names and descriptions only). Nothing secret is
  logged, returned in a response or kept in plain text in D1 (decision 0007).
  The reset (`resetCredentials` in `src/store/secrets.ts`) deletes `secrets`, `token_cache` and the key check value
  only while the credentials cannot be read, behind the session and its CSRF token, in one batch that deletes
  `token_cache` and then `secrets` only while the key check value and the `secrets` rows are the ones checked, and
  then the key check value only while it is the one checked and no `secrets` row is left (a credential written in
  between leaves everything).
- **Minimal GitHub App permissions:** the manifest requests read-only access to exactly what the rules read (Actions,
  Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts and Metadata, `src/github/manifest.ts`);
  a new permission is a `security`-tier change.
- **GitHub App manifest flow:** the setup wizard hands GitHub a manifest and finishes the flow on GitHub's signed-out
  return (`src/setup/github-step.ts`, `src/setup/github-state.ts`, decision 0017). The `state` is an HMAC (key
  `seluna/setup-github/v1`) over the owner's session, the chosen account type and account, a nonce and an expiry
  one hour ahead; the finish form is accepted only with a state of the request's session. The app returned by
  `POST /app-manifests/{code}/conversions` must belong to the chosen account (`isAppOwner` in
  `src/github/conversion.ts`) before anything is stored or an install link is shown. Account name, code and slug are
  allow-listed before they enter a URL, the conversion answer is read bounded (1 MiB) and narrowed, the private key
  is converted to PKCS#8 and must import as an RS256 key (`src/github/private-key.ts`), the three credentials are
  written in one transaction, and the client secret is discarded. Only the review page has `form-action
  https://github.com`.
- **Update workflow:** `.github/workflows/update.yml` (decision 0031) runs with `contents: write` as the only permission,
  no action and no code of the release; it is started only by `workflow_dispatch`, reads only the public original
  repository (the `curl` header from a mode-600 file, the release answer bounded to 1 MiB and narrowed to `tag_name`,
  tag and version only as a whole string under anchored rules), prints only fixed texts with allow-listed paths (never
  output of Git, `curl` or `jq`), pushes one new commit without force and never a change under `.github/workflows/`
  (checked before the push), and copies the owner's names with literal comparison (only name lines of `package.json`, `package-lock.json`
  and `wrangler.jsonc`, values of `[A-Za-z0-9._-]` up to 214 characters). Known: every name line with the base's value is rewritten, wherever it sits in the file, and a release that renames the package, Worker or database away from the base's name replaces the owner's name, which the owner sets again by hand (`docs/update.md`, _After the update_).
- **GitHub App authentication:** every GitHub call except the manifest conversion and the release check (`src/github/release.ts`: fixed URL, no credential, same request rules, answer narrowed to `tag_name`) is made as the app through
  `src/github/` (`app-jwt.ts`, `http.ts`, `app-credentials.ts`, `installation-token.ts`, `token-text.ts`,
  `installations.ts`, `api-client.ts`): an RS256 JWT (`iat` now − 60 s, `exp` now + 540 s, `iss` the App ID) signed per request with the
  private key resolved per credential, never stored; installation tokens per `installation.id`, allow-listed
  (`[A-Za-z0-9_]`, 1–255 characters), cached only encrypted in `token_cache` (`src/store/token-cache.ts`) until 5
  minutes before expiry, the row of a token GitHub answered 401 for deleted by installation id and IV; installation id,
  owner, repository name and number allow-listed before they enter a URL; only `https://api.github.com`, no redirects
  followed, 10-second timeout, answers read bounded (1 MiB) and narrowed; no token, key or JWT in a log, page, result
  or plain D1 (decision 0026).
- **Outbound-only Telegram:** the Worker calls only the Telegram Bot API methods `getMe` (at most once per submitted token form whose token matches the bot token form, in
  the setup wizard's Telegram step, `src/setup/telegram-step.ts`), `getUpdates` (in the same step) and `sendMessage`
  (`src/telegram.ts`); delivery reads the token from the Worker secret or from D1 (`src/delivery.ts`); it never sets
  or deletes a webhook and exposes no Telegram route; the input it takes from Telegram is the status and `ok` of the
  `getMe` answer and the `getUpdates` answer of the signed-in step and the status of each `sendMessage` answer and, for a 429, its `parameters.retry_after`, all read bounded
  (1 MiB) and narrowed in `src/telegram.ts` (a notification is sent from `src/delivery.ts`); a
  chat is stored only after the owner typed back the code of its test message (`src/setup/chat-proof.ts`); the bot
  token appears only in the request URL, which Seluna never logs.
- **Parsing of external input:** webhook bodies are JSON from GitHub and are narrowed from `unknown`; the body (JSON or the form field `payload`) is narrowed in `src/webhook.ts`; fields are
  cleaned, length-limited and escaped (Telegram HTML) in `src/message.ts` before they enter a message, because titles and branch names
  are attacker-controlled text.
- **Request body size:** every route that reads a request body reads it through the bounded reader in `src/body.ts` (1 MiB; a `Content-Length` above it is rejected before reading, and the body is always counted while read); a route that reads a body any other way is a `security`-tier finding.
- **Logging of external data:** logs carry event type, delivery id, the action and repository (pattern-checked) and the decision of the processing, each sent outbox row logs its id and result (a row marked failed after its fifth attempt logs its id and status `failed`), each scheduled job logs only a fixed result (`src/scheduled.ts`: `store-failed`, `unknown`, the release check's result), and per request the method, the URL path without query string and the status (`src/router.ts`); never payload text, headers, query strings, tokens or keys.

## Guarantees

Deliberate behavior that must not change without the Product Manager. Each one is described in
`docs/ARCHITECTURE.md` and, where it was a real choice, has a decision record.

- A draft pull request triggers no notification; the exceptions are a CI failure in a pull request whose draft state could not be read (failure or no answer within 8 seconds), reported marked _draft status unknown_ — [decision 0027](../docs/decisions/0027-ci-failure-rules-and-the-draft-lookup.md), and a secret scanning alert, which is reported whatever its source — [decision 0028](../docs/decisions/0028-security-alert-rules.md).
- A webhook with an invalid signature has no effect: nothing is stored, nothing is sent.
- A delivery (`X-GitHub-Delivery`) is processed once within the 7-day retention of its `deliveries` row: a redelivery produces no second message. After the cleanup removed the row, a captured, validly signed delivery replayed later (the signature has no timestamp) would produce one duplicate message; GitHub itself redelivers only within 3 days.
- Each user's data stays in that user's own Cloudflare account — no central service
  — [decision 0005](../docs/decisions/0005-one-instance-per-user.md).
- GitHub App credentials are only ever stored encrypted
  — [decision 0007](../docs/decisions/0007-github-app-credentials-encrypted-in-d1.md).
- A matched event is written to the outbox before delivery is attempted, and unsent rows are retried up to the fifth attempt, then marked failed
  — [decision 0008](../docs/decisions/0008-delivery-through-a-d1-outbox.md), amended by [decision 0029](../docs/decisions/0029-outbox-retry-and-cleanup-by-the-cron.md).
- The release workflow turns a release into the latest full release only after it has verified its `v*` tag on
  `main`; a release published as a full release by hand is only warned about
  — [decision 0009](../docs/decisions/0009-releases-only-by-tag-push.md).

## Integration surface

What the Reviewer checks when the diff introduces or changes a thing of this kind: every place that must
change with it.

**A new or changed setting or secret** touches:
- the `settings` / `secrets` D1 tables and the migration under `migrations/` (and the encryption path for a secret)
- the `/setup` wizard that writes it, and the Worker binding in `wrangler.jsonc`, then `wrangler types` for `worker-configuration.d.ts`
- for a Worker secret the deploy form asks for, `.dev.vars.example` and its description under `cloudflare.bindings` in `package.json`
- the setting table in `README.md`
- the test that pins the read/write round trip

**A new or changed rule (a notification kind)** touches:
- the pure rule function and its tests, with a real payload under `test/fixtures/<event>/<action>.json`, its entry in `src/rules/registry.ts` and its texts in `src/i18n/en.ts` and `src/i18n/de.ts`
- the GitHub App manifest (events and permissions it needs) and the webhook event routing
- the message formatting and its escaping, the component list in `docs/ARCHITECTURE.md` and the rule list in `README.md`

**A new or changed D1 table or column** touches:
- a new migration (never an edited one), the access module under `src/store/` and its tests, the cleanup cron if rows expire
- the D1 table list in `docs/ARCHITECTURE.md`, `SCHEMA_TABLES` in `src/store/schema.ts`

**A new or changed cron job** touches:
- the `triggers.crons` entry in `wrangler.jsonc`, the `scheduled` handler dispatch, `docs/ARCHITECTURE.md` (cron triggers)

**A new external API call or DTO** (GitHub API, Telegram Bot API) touches:
- the client module and its DTOs — the external shape must not leak past it
- the test double of that API (*Test doubles*)

## Plan checklist

What the Lead's plan lists under *Documentation updates* besides the area documents, so the Dev writes it before
review and not after the PR is opened:

- **`CHANGELOG.md`:** an entry under `## [Unreleased]` for every user-visible change (the pull request template
  checklist requires it; a release fails without entries under its version). A change without user-visible effect
  names that in the plan instead.

## Test doubles

The hand-written fakes and stubs the tests reuse (no mocking library unless `docs/UNIT_TESTS.md` says
otherwise):

- **GitHub API double** — `test/github.ts`: a `vi.fn<GitHubFetch>()` passed as the injected `GitHubFetch` (not a
  stub on `globalThis.fetch`) that records every request and answers `POST /app-manifests/<code>/conversions` from
  the reference-built fixtures under `test/fixtures/github/` (written from GitHub's documentation, not captured,
  decision 0017), a status and body, or a rejection; it fails the test on any other URL. `githubApiDouble(routes)`
  also answers `POST /app/installations/<id>/access_tokens`, `GET /app/installations?per_page=100`, `GET
  /repos/<owner>/<repo>/pulls/<number>` and `GET /repos/LarsLaskowski/Seluna/releases/latest` from
  `test/fixtures/github/` (the token and installations answers are reference-built from GitHub's OpenAPI examples,
  the pull request and latest release answers are captured), each route an answer, a
  sequence or a function of the request, and records every request with its `Authorization` header. The check-run
  answers of the later API clients get their fixtures beside these.
- **Telegram Bot API double** — `test/telegram.ts`: a `vi.fn<TelegramFetch>()` passed as the injected `TelegramFetch`
  (not a stub on `globalThis.fetch`) that records every request and answers `getMe`, `getUpdates` and `sendMessage` from
  fixtures, a status and body (for `sendMessage` also a sequence, one answer per request, the last repeated), or a rejection (a rate limit, a server error; the 429 answer is the reference-built `send-message-too-many-requests.json`); it fails the test on any other method.
  Its `getMe` and `getUpdates` answers come from `test/fixtures/telegram/`, which are written from the Bot API reference, not
  captured (see the `README.md` there); no real bot is ever called. Squad sessions have no egress to
  `api.telegram.org` (the session proxy refuses it), so a real answer cannot be fetched during a run: the
  fixtures stay reference-built until they are replaced by captured answers, and a plan that reads a new Bot API
  answer either asks the Product Manager for a captured sample up front or plans a live check on a deployed copy
  before the pull request is marked ready (decision 0016).
- **Clock** — an injected `() => Date` (or `vi.useFakeTimers()`) so rules, retries and token expiry are tested
  without waiting; code under test never calls `Date.now()` directly.
- **Real GitHub payloads** — captured events stored as `test/fixtures/<event>/<action>.json`, with secrets and
  personal data removed; never hand-invented payloads for a rule test. A signed
  delivery used to test the signature stays unaltered, because any edit breaks its signature, and is signed with a
  throwaway secret (decision 0012). The `dependabot_alert`,
  `code_scanning_alert` and `secret_scanning_alert` fixtures are reference-built from GitHub's OpenAPI webhook schemas,
  not captured (Product Manager's decision, [decision 0028](../docs/decisions/0028-security-alert-rules.md)).
- **D1** — the real D1 binding the Workers test pool provides (migrations applied in a test setup), not a fake.

## Fixtures from real deliveries

A rule test needs a real webhook payload (*Test doubles*, *Real GitHub payloads*). When the Lead finds none in
`test/fixtures/` or on the issue, that is a normal `ESCALATE`: the Product Manager supplies raw deliveries; the Lead
never picks a hand-built payload instead. The orchestrator turns them into fixtures before the Lead's second plan
launch:

1. **Replace** every identifying value and nothing else: logins (the owner's and third parties'), numeric ids,
   `node_id`s, avatar and profile URLs, repository and organization names, the homepage, the installation id, commit
   SHAs, and the text of titles, bodies and commit messages. Replacements are consistent (one original value, one
   replacement, so references between fields still match). Structure, field set, types and the values that decide a
   rule (`action`, `draft`, `state`, `conclusion`, labels, review states) stay untouched. A delivery used to test the
   signature is not edited (decision 0012).
2. **Grep for leaks**: every original login, repository name, id and SHA, taken from the raw delivery, must find
   nothing in the new files.
3. **Format** the new files with `npx prettier --write test/fixtures` and confirm that the parsed JSON is unchanged
   (`npm run format:check` covers `test/fixtures/**/*.json`).
