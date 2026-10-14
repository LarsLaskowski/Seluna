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
- **Setup login:** `/setup` and everything behind it (App creation, Telegram bot token, status) is reachable only
  with the setup credential; session cookies are `HttpOnly`, `Secure`, `SameSite=Strict`, and the endpoint is
  rate-limited and closed once setup is complete unless the owner logs in.
- **Encrypted credentials:** the GitHub App private key, webhook secret and Telegram bot token live in the D1 table
  `secrets` as AES-256-GCM ciphertext (random 96-bit nonce per value); the key is a Worker secret. Nothing secret is
  logged, returned in a response or kept in plain text in D1 (decision 0007).
- **Minimal GitHub App permissions:** the manifest requests read-only access to exactly what the rules read (pull
  requests, checks/statuses, security alerts, metadata); a new permission is a `security`-tier change.
- **Outbound-only Telegram:** the Worker only calls the Telegram Bot API (`sendMessage`); it exposes no Telegram
  webhook and accepts no input from Telegram. The bot token never appears in a URL that is logged.
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
- A release is created only by pushing a `v*` tag
  — [decision 0009](../docs/decisions/0009-releases-only-by-tag-push.md).

## Integration surface

What the Reviewer checks when the diff introduces or changes a thing of this kind: every place that must
change with it.

**A new or changed setting or secret** touches:
- the `settings` / `secrets` D1 tables and the migration under `migrations/` (and the encryption path for a secret)
- the `/setup` wizard that writes it, and the Worker binding in `wrangler.jsonc`, then `wrangler types` for `worker-configuration.d.ts`
- the setting table in `README.md`
- the test that pins the read/write round trip

**A new or changed rule (a notification kind)** touches:
- the pure rule function and its tests, with a real payload under `test/fixtures/<event>/<action>.json`
- the GitHub App manifest (events and permissions it needs) and the webhook event routing
- the message formatting and its escaping, the component list in `docs/ARCHITECTURE.md` and the rule list in `README.md`

**A new or changed D1 table or column** touches:
- a new migration (never an edited one), the access module and its tests, the cleanup cron if rows expire
- the D1 table list in `docs/ARCHITECTURE.md`

**A new or changed cron job** touches:
- the `triggers.crons` entry in `wrangler.jsonc`, the `scheduled` handler dispatch, `docs/ARCHITECTURE.md` (cron triggers)

**A new external API call or DTO** (GitHub API, Telegram Bot API) touches:
- the client module and its DTOs — the external shape must not leak past it
- the test double of that API (*Test doubles*)

## Test doubles

The hand-written fakes and stubs the tests reuse (no mocking library unless `docs/UNIT_TESTS.md` says
otherwise):

- **GitHub API double** — a `fetch` stub (`vi.fn` on `globalThis.fetch`, typed against the client's signature) that
  answers installation-token, pull request and check-run requests from fixtures under `test/fixtures/`.
- **Telegram Bot API double** — a `fetch` stub that records `sendMessage` calls and can answer with a rate limit
  (429 with `retry_after`) or a server error; no real bot is ever called.
- **Clock** — an injected `() => Date` (or `vi.useFakeTimers()`) so rules, retries and token expiry are tested
  without waiting; code under test never calls `Date.now()` directly.
- **Real GitHub payloads** — captured events stored as `test/fixtures/<event>/<action>.json`, with secrets and
  personal data removed; never hand-invented payloads for a rule test.
- **D1** — the real D1 binding the Workers test pool provides (migrations applied in a test setup), not a fake.
