# Project

What the squad needs to know about this project that is not stack-specific. Read by the Lead, the Devil's
Advocate, Security, the Tester and the Reviewer. Not template-managed: `adopt-template` creates it once
and never overwrites it. A product PR updates it when the change makes an entry untrue
(`.squad/routing.md`, *Scope of a product PR*).

Every entry points: it names files, types or endpoints and links the document that says more. Behavior, values,
limits and sequences are written once, in the area documents (`docs/areas/README.md`), and the reasons in the
decision records; a copy here goes stale with the next change. `config-check.py` warns when this file grows past
`PROJECT_MAX_WORDS` words (`.squad/tools/squad_settings.py`).

## Security areas

A change that touches one of these lists it under *Security areas touched* in its plan, so Security reviews the
plan (`.squad/routing.md`, *Tiers*, which also says when a change is tier `security`). One line per area: what is
protected, the concrete types, files or endpoints, and a link to the area document that states its rules
(`- Session tokens: issued in src/Auth/, checked by every /api route — [Sessions](../docs/areas/sessions.md)`); no
limits, patterns or sequences.

- **Webhook signature:** that only GitHub's signed deliveries reach the processing; `POST /webhook` in `src/router.ts`, `src/signature.ts`, `src/webhook-secret.ts` — [HTTP routes](../docs/areas/http-routes.md#webhook-signature)
- **Setup login:** who gets into `/setup`; the session, the CSRF tokens of every form and the lock in `src/setup/` (`handler.ts`, `session.ts`, `csrf.ts`, `cookies.ts`), `src/crypto.ts`, `src/store/login-attempts.ts`, `src/store/schema.ts` — [Setup login](../docs/areas/setup-login.md), [Setup wizard](../docs/areas/setup-wizard.md#paths)
- **Setup pages:** that no page runs a script, loads a resource or echoes the request; `src/setup/pages.ts` and its response headers — [Setup wizard](../docs/areas/setup-wizard.md#pages-and-response-headers)
- **Encrypted credentials:** the GitHub App credentials, the Telegram bot token and the installation tokens; the D1 tables `secrets` and `token_cache` and the `meta` row `key_check` (`src/crypto.ts`, `src/store/secrets.ts`, `src/store/token-cache.ts`), the Worker secrets (`src/bot-token.ts`, `src/github/worker-secrets.ts`), the reset on the start page, `.gitignore` and `.dev.vars.example` — [Storage](../docs/areas/storage.md#encryption), [Reset](../docs/areas/status-page.md#reset), [Worker secrets](../docs/areas/deployment.md#worker-secrets)
- **Minimal GitHub App permissions:** what the app and its installation tokens may read; `src/github/manifest.ts`, `src/github/token-permissions.ts` (a new permission is a `security`-tier change) — [GitHub App step](../docs/areas/github-app-step.md#starting-the-flow), [GitHub API](../docs/areas/github-api.md#installation-tokens)
- **GitHub App manifest flow:** that only the owner's own app is stored; `/setup/github` and `/setup/github/callback` in `src/setup/github-step.ts`, `src/setup/github-state.ts`, `src/github/conversion.ts`, `src/github/private-key.ts`, `src/github/owner.ts` — [GitHub App step](../docs/areas/github-app-step.md)
- **Update workflow:** what a release may write into the owner's copy; `.github/workflows/update.yml` — [Deployment](../docs/areas/deployment.md#update)
- **GitHub App authentication:** the app JWT, the private key, installation tokens and the URLs built from external values; every call under `src/github/` (the status page's app read and settings links, the unauthenticated release check in `release.ts` included) — [GitHub API](../docs/areas/github-api.md)
- **Outbound delivery channels:** the bot token, the destination and what is read back from a messenger; `src/channels/`, `src/telegram.ts`, `src/delivery.ts`, the Telegram step (`src/setup/telegram-step.ts`, `src/setup/chat-proof.ts`), and the ESLint `no-restricted-imports` block that keeps `src/rules/` away from them — [Delivery](../docs/areas/delivery.md#delivery-channels), [Telegram step](../docs/areas/telegram-step.md)
- **Parsing of external input:** attacker-controlled text from GitHub and Telegram on its way into D1 and a message; `src/webhook.ts`, `src/notification.ts`, `src/message.ts`, `src/rules/`, `src/store/activity.ts`, `src/digest.ts` — [Payload](../docs/areas/notifications.md#payload), [Message format](../docs/areas/notifications.md#message-format), [Issue and comment rules](../docs/areas/notification-rules.md#issue-and-comment-rules), [Collecting](../docs/areas/stars-and-forks.md#collecting), [Telegram rendering](../docs/areas/delivery.md#telegram-rendering)
- **Request body size:** every route that reads a body reads it through `src/body.ts`; one that reads a body any other way is a `security`-tier finding — [HTTP routes](../docs/areas/http-routes.md#request-body-size)
- **Bound on deliveries of other senders:** how far strangers can flood the owner's messenger; `src/webhook.ts`, `src/rules/stranger.ts`, `src/store/meta.ts`, `src/limit-notice.ts` — [Processing a delivery](../docs/areas/notifications.md#processing-a-delivery), [Limit notice](../docs/areas/notifications.md#limit-notice)
- **Logging of external data:** that no payload text, header, query string, token or key is logged; `src/index.ts` (the sink), `src/router.ts`, `src/webhook.ts`, `src/delivery.ts`, `src/outbox-retry.ts`, `src/scheduled.ts` — [HTTP routes](../docs/areas/http-routes.md#logging), [Notifications](../docs/areas/notifications.md#log-entries), [Scheduled jobs](../docs/areas/scheduled-jobs.md#log-entries)

## Guarantees

Deliberate behavior that must not change without the Product Manager. One line each: the guarantee in a few words,
a link to its decision record where it was a real choice, and a link to the area document that states it.

- A draft pull request triggers no notification, except a CI failure whose draft state could not be read and a secret scanning alert — [decision 0027](../docs/decisions/0027-ci-failure-rules-and-the-draft-lookup.md), [decision 0028](../docs/decisions/0028-security-alert-rules.md), [Draft lookup](../docs/areas/notification-rules.md#draft-lookup)
- A webhook with an invalid signature has no effect — [decision 0012](../docs/decisions/0012-webhook-signature-verification.md), [HTTP routes](../docs/areas/http-routes.md#webhook-signature)
- A delivery that led to a message or an `activity` change is processed once while its `deliveries` row is kept — [decision 0043](../docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md), [Processing a delivery](../docs/areas/notifications.md#processing-a-delivery)
- Each user's data stays in that user's own Cloudflare account, with no central service — [decision 0005](../docs/decisions/0005-one-instance-per-user.md), [Deployment](../docs/areas/deployment.md)
- GitHub App credentials are only ever stored encrypted — [decision 0007](../docs/decisions/0007-github-app-credentials-encrypted-in-d1.md), [Storage](../docs/areas/storage.md#encryption)
- A matched event is in the outbox before delivery is attempted, and an unsent row is retried until it is marked failed — [decision 0008](../docs/decisions/0008-delivery-through-a-d1-outbox.md), [decision 0029](../docs/decisions/0029-outbox-retry-and-cleanup-by-the-cron.md), [Sending a row](../docs/areas/delivery.md#sending-a-row), [Retry](../docs/areas/scheduled-jobs.md#retry)
- A release becomes the latest full release only after the release workflow verified its `v*` tag on `main` — [decision 0009](../docs/decisions/0009-releases-only-by-tag-push.md), [`CONTRIBUTING.md`](../docs/CONTRIBUTING.md#versioning-and-releases)

## Integration surface

What the Reviewer checks when the diff introduces or changes a thing of this kind: every place that must
change with it.

**A new or changed setting or secret** touches:
- the `settings` / `secrets` D1 tables, a migration under `migrations/` and, for a secret, the encryption path
- the `/setup` page that writes it, the binding in `wrangler.jsonc` and `worker-configuration.d.ts` (`wrangler types`)
- for a Worker secret the deploy form asks for, `.dev.vars.example` and `cloudflare.bindings` in `package.json`
- the settings table in `README.md`, the area document that states it, and the round-trip test

**A new delivery channel** touches:
- its entry in `src/channels/registry.ts`, its adapter under `src/channels/` on the shared `src/channels/http.ts`
- its setup page `/setup/<id>`, its secret name and its texts in `src/setup/texts.ts` (English and German)
- its test double or tests, [Delivery](../docs/areas/delivery.md#delivery-channels), [Messengers](../docs/areas/status-page.md#messengers) and the component list in `docs/ARCHITECTURE.md`

**A new or changed rule (a notification kind)** touches:
- the rule under `src/rules/` with its tests and a real payload under `test/fixtures/<event>/<action>.json`, its entry in `src/rules/registry.ts`, its texts in `src/i18n/en.ts` and `src/i18n/de.ts`
- the GitHub App manifest (events and permissions) and the webhook event routing
- the stored notification and its rendering (`src/notification.ts`, `src/message.ts`), [Notification rules](../docs/areas/notification-rules.md), the component list in `docs/ARCHITECTURE.md` and the rule list in `README.md`

**A new or changed D1 table or column** touches:
- a new migration (never an edited one), the access module under `src/store/` and its tests, the cleanup cron if rows expire
- [Storage](../docs/areas/storage.md#tables), the D1 table list in `docs/ARCHITECTURE.md`, the schema table list in `src/store/schema.ts`

**A new or changed cron job** touches:
- `triggers.crons` in `wrangler.jsonc`, the dispatch in `src/scheduled.ts`, [Scheduled jobs](../docs/areas/scheduled-jobs.md) and `docs/ARCHITECTURE.md`

**A new external API call or DTO** (GitHub API, Telegram Bot API) touches:
- the client module and its DTOs — the external shape must not leak past it
- the test double of that API (*Test doubles*) and its fixtures

## Plan checklist

What the Lead's plan lists under *Documentation updates* besides the area documents, so the Dev writes it before
review and not after the PR is opened:

- **`CHANGELOG.md`:** an entry under `## [Unreleased]` for every user-visible change (the pull request template
  checklist requires it; a release fails without entries under its version). A change without user-visible effect
  names that in the plan instead.

## Test doubles

The hand-written fakes and stubs the tests reuse (no mocking library unless `docs/UNIT_TESTS.md` says
otherwise), one line each: the double, where it lives and what it stands in for; how it behaves is read in its code.

- **GitHub API double** — `test/github.ts` (with `test/token-cache.ts` for seeded token rows): the injected `GitHubFetch`, answering from `test/fixtures/github/`
- **Telegram Bot API double** — `test/telegram.ts`: the injected `TelegramFetch`, answering from `test/fixtures/telegram/`
- **Delivery channel double** — `test/channel.ts`: a `Channel` that stands in for any messenger besides Telegram
- **Clock** — an injected `() => Date` or `vi.useFakeTimers()`: the time of rules, retries and token expiry
- **Webhook payloads** — `test/fixtures/<event>/<action>.json`: GitHub's deliveries; whether each is captured or reference-built is in the `README.md` of its folder, the rules in [`docs/UNIT_TESTS.md`](../docs/UNIT_TESTS.md#fixtures)
- **D1** — the real D1 binding of the Workers test pool, with the migrations applied (`test/d1.ts`)
