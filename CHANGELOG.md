# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GitHub App: the manifest also asks for read-only Contents and Issues and subscribes to the events `issues`, `issue_comment`, `fork` and `star`; these deliveries are accepted and recorded. Seluna stores the app's owner (account id, login and type) beside the App ID for the rules to come.
- Notifications: three rules and switches (on by default), _New issue_, _New comment on an issue_ and _New comment on a pull request_, report a new issue and a comment by another account, with the author and the beginning of the text on line 3; issues and comments by the owner (once the status page has stored the owner, personal accounts only) and by bots are left out, as are comments on draft pull requests or on pull requests whose draft state cannot be read. On a public repository every stranger's issue or comment gives one message.
- Setup wizard: the status section shows the GitHub App's owner, with a notice for an organization's app, and names the permissions and events the app or an installation still lacks, with links to add and accept them on GitHub.

- Notifications: two rules and switches (off by default), _New star on a repository_ and _New fork of a repository_, report a star or fork by another account (not the owner, not a bot). A new setting, _Stars and forks_, sends them immediately or collects them into one digest per hour or per day (daily at 18:00 by default); the digest lists each repository with the new stars (and the star count), forks and the accounts, and an unstar takes a collected star back. A new migration (`0002_activity.sql`) adds the table the digest collects into; deploy with `npm run deploy` so it is applied.

### Changed

- Installation tokens are requested with only `metadata: read` and `pull_requests: read` and refused when GitHub's answer grants more; tokens cached by earlier versions are requested again once.
- The setup guide and the created page recommend installing the app on _Only select repositories_ instead of _All repositories_.
- Setup wizard: the time zone setting accepts every named zone the runtime knows, also an alias such as `Asia/Kolkata`, a letter-case variant such as `europe/berlin` and a zone the list does not offer such as `Etc/GMT+5`, instead of answering 400 or falling back to UTC; fixed offsets are still rejected. The time zone select shows a configured zone missing from the list as an extra selected first option, and the status page shows the runtime's name of the zone.

## [0.7.0] - 2026-10-27

### Added

- Setup wizard: the start page has a _Messengers_ card that lists the messengers, shows which one is active and, for each, lets you set it up, activate it and remove its saved credentials; the status section names the active messenger. Telegram is the only messenger so far and stays the default.

### Changed

- Messages wait in the outbox without Telegram formatting (as a JSON notification in the existing `text` column, no migration) and are formatted when they are sent; what Telegram receives is unchanged, and messages stored by earlier versions are sent as they are.

## [0.6.0] - 2026-10-25

### Added

- Opening the Worker URL (`/`) leads to the setup page `/setup`; other unknown paths still answer 404.
- Setup wizard step _Telegram chat_: the bot token is entered, changed and removed in the step; Seluna checks it with Telegram (`getMe`) and saves it encrypted like the GitHub App credentials, and the reset on the start page deletes it with them. The status section shows where the token comes from. The Worker secret `TELEGRAM_BOT_TOKEN` stays optional and takes precedence over a saved token.

### Changed

- The Deploy to Cloudflare form asks only for `SELUNA_SECRET`; the Telegram bot token is entered in the setup wizard.
- Setup wizard: the setup pages have a new look — a header with the language links, the parts of each page in separate cards, grouped settings, distinct buttons for sign-out and the reset, error and info notices, a dark mode that follows the system setting, a visible focus ring and a layout that fits a 360 px phone screen; texts, forms and the strict Content-Security-Policy are unchanged.
- Setup wizard: the start page, the Telegram and GitHub App steps and the GitHub review and finish pages have a step navigation in the header (Start page, Telegram chat, GitHub App) with the current page marked, so every step page leads back to the start page in one click; the sign-in and not-configured pages keep only the language links.

## [0.5.0] - 2026-10-23

### Added

- Unsent messages are retried every ten minutes; a message that is still unsent after its fifth attempt is marked `failed` and not retried again.
- Old rows are cleaned up (recorded deliveries after 7 days, sent or failed messages after 30 days, expired installation tokens).
- A daily check for a new Seluna release sends a notice with a button to the release page; switch "Notice about a new Seluna release" (on by default).
- The workflow **Update Seluna** applies the latest release to a copy of Seluna with **Run workflow**, as one new commit on `main` that keeps your own changes and workflow files; [`docs/update.md`](docs/update.md) explains it, including how to add the workflow to a copy of version 0.4.0 or earlier.

## [0.4.0] - 2026-10-21

### Added

- The status page lists where the GitHub App is installed (account, all or selected repositories, suspended), and Seluna can now call the GitHub API as the app, caching each installation's token encrypted.
- Notifications for failed CI runs (failure or timeout) on the default branch and in pull requests that are not drafts, each with its own switch; when GitHub cannot tell in time whether the pull request is a draft, the message is sent marked _draft status unknown_.
- Notifications for new and reopened Dependabot, code scanning (on the default branch) and secret scanning alerts, each with its existing switch; a leaked secret is reported even from a draft pull request, and the secret itself never appears in a message, the outbox or the log.

## [0.3.0] - 2026-10-18

### Added

- Webhook deliveries are recorded once each (a redelivery is acknowledged and ignored), and the status page shows the time of the last delivery from GitHub; messages are stored in the outbox and sent to Telegram in a fixed format in English or German.
- Notifications for pull requests: a message when a pull request is opened, when a draft pull request is marked ready for review, and when a review is requested; draft pull requests trigger nothing, and each of the three has its own switch in the settings.
- Quiet hours: during the hours set on the setup page, read in the configured time zone (daylight saving time included), notifications arrive without sound; they are still sent at once. Off by default.

## [0.2.0] - 2026-10-17

### Added

- Start page of the setup wizard: shows the status (version, Telegram chat, GitHub App with a link, time of the last delivery) and the settings (notification language, time zone, quiet hours, one switch for each kind of notification, update notice), which take effect without a new deployment; after a changed `SELUNA_SECRET` it offers a reset that deletes the saved GitHub credentials and leads through the GitHub App step again.
- Setup wizard step _GitHub App_: creates a private GitHub App for your personal account or an organization through GitHub's manifest flow, with read-only access to Actions, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts and Metadata, and saves its App ID, private key (converted to PKCS#8) and webhook secret encrypted in one step; the app GitHub returns must belong to the account you chose. The optional Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` take precedence over the saved credentials.
- Webhook signature check: without the `GITHUB_WEBHOOK_SECRET` Worker secret, `POST /webhook` verifies deliveries with the webhook secret the setup wizard saved; it still answers 503 when no secret is usable.

### Changed

- Setup wizard: on an instance whose deploy skipped the database migrations, signing in shows that the database is missing its tables and names the deploy command `npm run deploy`, instead of _The setup is unavailable right now_.

### Fixed

- Setup guide: after the Deploy to Cloudflare button's deploy, check that the **Deploy command** in the Worker's build settings is `npm run deploy`; the button may set `npx wrangler deploy`, which skips the D1 migrations and leaves the database without tables (issue #46).

## [0.1.0] - 2026-10-17

### Added

- Setup wizard step _Telegram chat_: lists the private chats and groups your bot has seen (`getUpdates`), sends a test message with a code to the chosen one and saves its id once the code is entered; an optional `TELEGRAM_CHAT_ID` Worker secret takes precedence; a missing or invalid `TELEGRAM_BOT_TOKEN` is explained.
- Setup login: `/setup` asks for `SELUNA_SECRET` (compared in constant time) and keeps the owner signed in for 12 hours with a signed `HttpOnly`, `Secure`, `SameSite=Strict` cookie; after 5 failed attempts the login is locked for 15 minutes; every form carries a CSRF token, bound to the session on the forms behind the login; the pages use no scripts or external resources, a strict Content-Security-Policy, and English or German. Without a `SELUNA_SECRET` of at least 32 characters the page explains how to set it.
- D1 schema: the first migration creates the tables for settings, encrypted credentials, deliveries, the outbox, installation tokens and instance metadata; credentials and installation tokens are stored only encrypted (AES-256-GCM, key derived from `SELUNA_SECRET`, which needs at least 32 characters).
- Deploy to Cloudflare button: deploys Seluna into your own Cloudflare account with a D1 database `DB` and the secrets `SELUNA_SECRET` and `TELEGRAM_BOT_TOKEN`; every push to `main` of the copy applies the D1 migrations and deploys. Cron triggers every 10 minutes and daily (no jobs yet).
- Cloudflare Workers project skeleton in TypeScript.
- HTTP routes: `GET /health` with the version of the build, `POST /webhook` (see below), 404 with an empty body for everything else, 413 for request bodies over 1 MiB, and one log entry per request with method, path and status.
- Webhook signature check: `POST /webhook` verifies `X-Hub-Signature-256` (HMAC-SHA256 over the raw body) with the `GITHUB_WEBHOOK_SECRET` Worker secret and answers 202 for a valid signature, 401 for a missing or wrong one and 503 when no secret is configured; its log entry also holds the delivery id and event.
- Squad, quality gates (Prettier, type-aware ESLint with SonarJS, Istanbul coverage) and CI adopted from the Squad-Spec-Repository-Template `typescript` profile, with architecture documentation and decision records.
- Release workflow: a release published on GitHub as a pre-release with a `vA.B.C` tag on `main` is checked (the tag, the `package.json` version, the changelog section and the format, lint, type-check, test and build checks) and then turned into the latest full release, keeping its text.
