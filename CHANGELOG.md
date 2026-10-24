# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Setup wizard: the setup pages have a new look — a header with the language links, the parts of each page in separate cards, grouped settings, distinct buttons for sign-out and the reset, error and info notices, a dark mode that follows the system setting, a visible focus ring and a layout that fits a 360 px phone screen; texts, forms and the strict Content-Security-Policy are unchanged.
- Setup wizard: the signed-in setup pages have a step navigation in the header (Start page, Telegram chat, GitHub App) with the current step marked, so every one of them leads back to the start page in one click; the sign-in and not-configured pages keep only the language links.

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
