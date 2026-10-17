# Project

What the squad needs to know about this project that is not stack-specific. Read by the Lead, the Devil's
Advocate, Security, the Tester and the Reviewer. Not template-managed: `adopt-template` creates it once
and never overwrites it. A product PR updates it when the change makes an entry untrue
(`.squad/routing.md`, *Scope of a product PR*).

## Security areas

A change that touches one of these is tier `security` (`.squad/routing.md`). Name the concrete types,
files or endpoints.

- **Webhook signature:** `POST /webhook` verifies `X-Hub-Signature-256` (HMAC-SHA256 over the raw body, constant-time
  comparison) before any parsing; an invalid or missing signature is rejected without a body that explains why.
- **Setup login:** `/setup` and every path below it (`src/setup/`) answer only the login page — or, without a
  `SELUNA_SECRET` of at least 32 characters, a page that explains how to set it — until the owner signs in with
  `SELUNA_SECRET`, compared in constant time (`verifySelunaSecret` in `src/crypto.ts`). The session is an
  HMAC-SHA256-signed token with a 12-hour expiry (`src/setup/session.ts`, key from `signingKeyFromEnv`) in a cookie
  with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/setup`; every form carries a signed double-submit CSRF token, which on the
  signed-in forms is also bound to the session (`src/setup/csrf.ts`); attempts are counted in the `meta` row `login_attempts` before the secret is checked and
  lock the login for 15 minutes after 5 failures (`src/store/login-attempts.ts`); pages have no script or external
  resource and a strict Content-Security-Policy (`src/setup/pages.ts`) (decision 0015).
- **Encrypted credentials:** the GitHub App ID, private key and webhook secret live in the D1 table `secrets` as
  AES-256-GCM ciphertext (random 96-bit nonce per value; code in `src/crypto.ts` and `src/store/secrets.ts`); the key comes from the Worker secret `SELUNA_SECRET`. The D1 table `token_cache` holds installation tokens encrypted the same way, each ciphertext is bound to its row (additional data), and a key check value in `meta` reports a changed `SELUNA_SECRET`. The
  Telegram bot token is the Worker secret `TELEGRAM_BOT_TOKEN`. Worker secrets are set through the deploy form or
  Wrangler and never committed (`.gitignore` ignores `.dev.vars*` and `.env*`, the files Wrangler loads local secrets
  from, except `.dev.vars.example` and `.env.example`, which hold names and descriptions only). Nothing secret is
  logged, returned in a response or kept in plain text in D1 (decision 0007).
- **Minimal GitHub App permissions:** the manifest requests read-only access to exactly what the rules read (pull
  requests, checks/statuses, security alerts, metadata); a new permission is a `security`-tier change.
- **Outbound-only Telegram:** the Worker calls only the Telegram Bot API methods `getUpdates` (in the setup wizard's
  Telegram step, `src/setup/telegram-step.ts`) and `sendMessage` (`src/telegram.ts`); it never sets or deletes a
  webhook and exposes no Telegram route; the input it takes from Telegram is the `getUpdates` answer of the signed-in
  step and the status of each `sendMessage` answer, both read bounded (1 MiB) and narrowed in `src/telegram.ts`; a
  chat is stored only after the owner typed back the code of its test message (`src/setup/chat-proof.ts`); the bot
  token appears only in the request URL, which Seluna never logs.
- **Parsing of external input:** webhook bodies are JSON from GitHub and are narrowed from `unknown`; fields are
  length-limited and escaped (Telegram MarkdownV2/HTML) before they enter a message, because titles and branch names
  are attacker-controlled text.
- **Request body size:** every route that reads a request body reads it through the bounded reader in `src/body.ts` (1 MiB; a `Content-Length` above it is rejected before reading, and the body is always counted while read); a route that reads a body any other way is a `security`-tier finding.
- **Logging of external data:** logs carry event type, action and delivery id, and per request the method, the URL path without query string and the status (`src/router.ts`); never payload text, headers, query strings, tokens or keys.

## Guarantees

Deliberate behavior that must not change without the Product Manager. Each one is described in
`docs/ARCHITECTURE.md` and, where it was a real choice, has a decision record.

- A draft pull request triggers no notification.
- A webhook with an invalid signature has no effect: nothing is stored, nothing is sent.
- A delivery (`X-GitHub-Delivery`) is processed once: a redelivery produces no second message.
- Each user's data stays in that user's own Cloudflare account — no central service
  — [decision 0005](../docs/decisions/0005-one-instance-per-user.md).
- GitHub App credentials are only ever stored encrypted
  — [decision 0007](../docs/decisions/0007-github-app-credentials-encrypted-in-d1.md).
- A matched event is written to the outbox before delivery is attempted, and unsent rows are retried
  — [decision 0008](../docs/decisions/0008-delivery-through-a-d1-outbox.md).
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
- the pure rule function and its tests, with a real payload under `test/fixtures/<event>/<action>.json`
- the GitHub App manifest (events and permissions it needs) and the webhook event routing
- the message formatting and its escaping, the component list in `docs/ARCHITECTURE.md` and the rule list in `README.md`

**A new or changed D1 table or column** touches:
- a new migration (never an edited one), the access module under `src/store/` and its tests, the cleanup cron if rows expire
- the D1 table list in `docs/ARCHITECTURE.md`

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

- **GitHub API double** — a `fetch` stub (`vi.fn` on `globalThis.fetch`, typed against the client's signature) that
  answers installation-token, pull request and check-run requests from fixtures under `test/fixtures/`.
- **Telegram Bot API double** — `test/telegram.ts`: a `vi.fn<TelegramFetch>()` passed as the injected `TelegramFetch`
  (not a stub on `globalThis.fetch`) that records every request and answers `getUpdates` and `sendMessage` from
  fixtures, a status and body, or a rejection (a rate limit, a server error); it fails the test on any other method.
  Its `getUpdates` answers come from `test/fixtures/telegram/`, which are written from the Bot API reference, not
  captured (see the `README.md` there); no real bot is ever called.
- **Clock** — an injected `() => Date` (or `vi.useFakeTimers()`) so rules, retries and token expiry are tested
  without waiting; code under test never calls `Date.now()` directly.
- **Real GitHub payloads** — captured events stored as `test/fixtures/<event>/<action>.json`, with secrets and
  personal data removed; never hand-invented payloads for a rule test. A signed
  delivery used to test the signature stays unaltered, because any edit breaks its signature, and is signed with a
  throwaway secret (decision 0012).
- **D1** — the real D1 binding the Workers test pool provides (migrations applied in a test setup), not a fake.
