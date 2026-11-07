# Areas

What the software does, area by area. Each area has one document here that states the behavior a user, an
operator or another component can rely on — formats, limits, error behavior, guarantees. The
[decision records](../decisions/README.md) explain *why* individual choices were made; the area documents say
*what holds today*. `ARCHITECTURE.md` shows how the parts fit together and links the areas instead of repeating them.

## Rules

- **One document per area**, `docs/areas/<slug>.md`, created from [`_template.md`](_template.md) and listed in the
  index below. The squad keeps it in step with the code (the Lead plans the update, the Dev writes it against the code as
  built): a change in behavior updates the area document in the same pull request.
- **Normative and stable.** Write what must hold, not how one language or library does it: the test is whether
  the document would still be true if the component were rewritten in another language. No class, package or
  function names as a contract (mention them only as a pointer to where it is implemented).
- **One home per behavior.** A cross-cutting topic (security, offline behavior) lives in the area that owns it; the
  others link there.
- **Size.** One readable document per area: split one that grows past `AREA_MAX_WORDS` words
  (`.squad/tools/squad_settings.py`; `decision-check.py` warns and names the split) into narrower areas — a Lead
  decision like any new area (below) — and fold one that says only a few sentences into a neighbor. Development and
  release process are not areas (see `CONTRIBUTING.md`).
- **A new area is a Lead decision** made in the plan (`plan.md`, *Areas*), with its name and scope; the Dev writes
  the document and its index row with the plan's documentation updates.
- Every decision record names its area in its `Area:` field (`—` for a record about the process). Area documents are
  not frozen by a release; their history is Git.

## Index

<!-- project:begin area-index -->

| Area | Scope | Not here |
| ---- | ----- | -------- |
| [HTTP routes](http-routes.md) | The public routes with their status and body, the request body size limit, the webhook signature check, the per-request log entry | Webhook event processing, the setup wizard |
| [Deployment](deployment.md) | The Deploy to Cloudflare button, the D1 binding and migrations, the Worker secrets, the cron triggers, the deploy command of Workers Builds, the update workflow that applies a release to the user's copy | What the cron jobs do and the release notice (Scheduled jobs), the release process |
| [Setup wizard](setup-wizard.md) | The pages under `/setup` as a whole: which request reaches which page, the refusal without a usable `SELUNA_SECRET`, cookies, the page and header rules, the languages and the requirements on the texts | The login, session and CSRF protection (Setup login), the start page (Status page), the two steps (Telegram step, GitHub App step), the routes outside `/setup` and the body size limit (HTTP routes) |
| [Setup login](setup-login.md) | The login with `SELUNA_SECRET`, the count of failed attempts and the lock, the signed session, sign-out, the CSRF protection of every form | The pages and cookies as a whole (Setup wizard), the `meta` table and the keys (Storage) |
| [Status page](status-page.md) | The start page `GET /setup`: the status, the GitHub App's owner, check and installations, the settings form, the Messengers card that activates a delivery channel, the reset of credentials that no longer decrypt | What each setting does (Notifications, Delivery, Stars and forks), the GitHub API calls (GitHub API), the `settings` and `secrets` tables (Storage) |
| [Telegram step](telegram-step.md) | `/setup/telegram`: the bot token and its check with `getMe`, the chat search with `getUpdates`, the test message and the chat proof | Sending notifications through Telegram (Delivery), the encryption of the token (Storage) |
| [GitHub App step](github-app-step.md) | `/setup/github`: the Worker secrets' precedence, the manifest, the signed state, GitHub's return, the conversion, the owner check and storing the credentials | Calls as the app after setup (GitHub API), the encryption of the credentials (Storage) |
| [Notifications](notifications.md) | Processing of a signed webhook delivery: deduplication, the hourly bound on other senders' deliveries and its limit notice, the payload, the stored notification and its languages, the delivery log entry | The route, its body limit and signature check (HTTP routes), what the rules report (Notification rules, Stars and forks), sending a row (Delivery), the tables (Storage) |
| [Notification rules](notification-rules.md) | The rule interface and the rules for pull requests, CI failures, security alerts, issues and comments, the sender of a delivery, the draft lookup | Stars, forks and the digest (Stars and forks), the hourly bound (Notifications), the switches on the status page (Status page) |
| [Stars and forks](stars-and-forks.md) | The star and fork rules, collecting them into the `activity` table, the removal of a star, the content of the digest | When a digest is built and sent (Scheduled jobs), the `activity` table (Storage) |
| [Delivery](delivery.md) | The delivery channels and the active one, the Telegram rendering, rows of earlier versions and damaged rows, sending a row and the retry after a 429, the quiet hours | Choosing the chat and activating a messenger (Telegram step, Status page), resending rows and marking them `failed` (Scheduled jobs), the `outbox` table (Storage) |
| [GitHub API](github-api.md) | Calls of the GitHub API as the app: the app JWT, App ID and private key, installation tokens per installation and their cache, the request rules, the pull request read, the installations list, the failure result | The `token_cache` table and its encryption (Storage), how the status page shows the installations (Status page), the manifest conversion (GitHub App step) |
| [Storage](storage.md) | The D1 tables and columns, data access through `src/store/`, the encryption of credentials and installation tokens, the key check for a changed `SELUNA_SECRET` | How migrations are applied (Deployment), what each setting means (Status page and the areas it names), row cleanup (Scheduled jobs) |
| [Scheduled jobs](scheduled-jobs.md) | The cron runs: the dispatch by expression, the retry of `pending` outbox rows and marking them `failed`, the cleanup of old rows, building and sending the digest, the daily release check and its notice, their log entries and residual risks | The cron triggers in `wrangler.jsonc` (Deployment), sending a row and the message format (Delivery, Notifications), the tables (Storage) |

<!-- project:end area-index -->
