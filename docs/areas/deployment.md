# Deployment

## Scope

What a Seluna instance consists of in the user's Cloudflare account and how it gets there and stays current: the
Deploy to Cloudflare button, the D1 database binding, the Worker secrets, the cron triggers and the deploy command
Workers Builds runs. The user (who deploys and updates an instance) and the Worker code (which relies on the
bindings) rely on it.

## Behavior

### Deploy to Cloudflare

- The button at the top of `README.md` deploys the public repository `LarsLaskowski/Seluna`. It creates an
  independent copy of the repository in the user's GitHub account (not a fork), provisions the D1 database,
  asks for the Worker secrets below, and deploys the Worker through Workers Builds.
- Every push to the production branch (`main`) of the copy starts a Workers Build that runs the deploy command
  below.
- The button is documented to take the deploy command from the `deploy` script in `package.json`, but it may set
  Workers Builds' default `npx wrangler deploy` instead (issue #46); the setup guide has the user check the command
  in the Worker's build settings after the first deploy.

### D1 database

- The Worker has exactly one D1 binding, `DB`. The configuration names a default database, `seluna`, and carries
  no database id: the button provisions the database in the user's account and records its id in the copy.
- The schema is defined by the migrations in `migrations/` (files `*.sql`, applied in name order, each once); the
  tables are described in [Storage](storage.md#tables). A migration is never edited once it is on `main`: every
  copy deploys its `main`, so a merged migration may already be applied in a user's database, release or not. A
  change to the schema is a new migration.

### Deploy command

- The deploy command is `npm run deploy` (the `deploy` script: the `db:migrations:apply` script, then
  `wrangler deploy`). Workers Builds runs the deploy command stored in the Worker's build settings, not the
  `package.json` script by itself.
- A deploy first applies every unapplied migration to the remote database, addressed by the binding name `DB`, and
  then deploys the Worker. A migration that fails stops the deploy; the previously deployed version keeps running.
- Without unapplied migrations the first step changes nothing, so every deploy runs the same command.

### Worker secrets

| Secret                   | Holds                                                                                                                                 | Set                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `SELUNA_SECRET`          | A random string of at least 32 characters chosen by the user                                                                          | Deploy form                                  |
| `TELEGRAM_BOT_TOKEN`     | The token of the user's Telegram bot from @BotFather                                                                                  | Deploy form                                  |
| `GITHUB_APP_ID`          | The App ID of the GitHub App, optional; takes precedence over the app the wizard created ([Setup wizard](setup-wizard.md#github-app)) | By hand; the deploy form does not ask for it |
| `GITHUB_APP_PRIVATE_KEY` | The private key of the GitHub App, optional; takes precedence over the stored key                                                     | By hand; the deploy form does not ask for it |
| `GITHUB_WEBHOOK_SECRET`  | The webhook secret, optional; takes precedence over the stored one ([HTTP routes](http-routes.md#webhook-signature))                  | By hand; the deploy form does not ask for it |
| `TELEGRAM_CHAT_ID`       | The id of the chat to send to, optional; takes precedence over the wizard's choice ([Setup wizard](setup-wizard.md#telegram-chat))    | By hand; the deploy form does not ask for it |

- The deploy form asks for exactly `SELUNA_SECRET` and `TELEGRAM_BOT_TOKEN`; `.dev.vars.example` names them with
  a description each and holds no value.
- The Bot API takes the bot token in the request URL (`https://api.telegram.org/bot<token>/<method>`). Seluna never
  logs that URL, but turning on Workers traces or logs that record outbound requests in the Cloudflare dashboard
  records the token with them: treat those traces as secret, or replace the token with `/revoke` at @BotFather
  afterwards.
- No secret value is ever committed: Git ignores every file Wrangler loads local secrets from (`.dev.vars`,
  `.dev.vars.<env>`, `.env`, `.env.local`, `.env.<env>`, `.env.<env>.local`); only `.dev.vars.example` and
  `.env.example` are tracked, and they hold names and descriptions only.

### Preview URLs

- Preview URLs are off: a version uploaded from a branch other than `main` is not served under a URL of its own, so
  no code outside `main` answers with the instance's database and secrets. The Worker's own `workers.dev` address
  stays on, so `/health` answers there.

### Cron triggers

| Schedule (UTC)   | Expression     |
| ---------------- | -------------- |
| every 10 minutes | `*/10 * * * *` |
| daily at 05:17   | `17 5 * * *`   |

- Both triggers invoke the Worker's scheduled handler, which does nothing yet; the jobs follow in a later change
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md#cron-triggers)).

## Limits and errors

- With any other deploy command, such as Workers Builds' default `npx wrangler deploy`, no migration is applied: the
  Worker deploys against a missing or outdated schema, `/setup` answers with the _unavailable_ notice where it reads
  D1 ([Setup wizard](setup-wizard.md#login)), and `/health`, which reads no D1, still answers. Setting the command
  to `npm run deploy` and retrying the build applies the missing migrations.
- A deploy against an account in which the database does not exist yet fails at the migration step with
  Wrangler's message and deploys nothing.
- Without `GITHUB_WEBHOOK_SECRET` and without a webhook secret stored by the setup wizard an instance answers every
  `POST /webhook` with 503, and so it does when the stored secret cannot be read or D1 fails
  ([HTTP routes](http-routes.md#webhook-signature)).
- Without a `SELUNA_SECRET` of at least 32 characters every request under `/setup` answers 503 with a page that
  explains how to set it ([Setup wizard](setup-wizard.md#paths)).

## Related decisions

- [`decisions/0013-deploy-to-cloudflare-and-workers-builds.md`](../decisions/0013-deploy-to-cloudflare-and-workers-builds.md)
  — the button and Workers Builds, the binding without a database id, migrations before the deploy, the Telegram
  bot token as a Worker secret.
- [`decisions/0020-deploy-command-checked-in-the-setup-guide.md`](../decisions/0020-deploy-command-checked-in-the-setup-guide.md)
  — why the setup guide has the user check the deploy command after the button's deploy, and why the migrations
  stay out of the build command.
- [`decisions/0017-github-app-manifest-flow.md`](../decisions/0017-github-app-manifest-flow.md) — the optional
  GitHub Worker secrets and their precedence over the credentials the wizard stores.

## Not here

- What the cron jobs do: [`ARCHITECTURE.md`](../ARCHITECTURE.md#cron-triggers).
- The tables the migrations create and the encryption of stored credentials: [Storage](storage.md).
- The public routes, including `/health`: [HTTP routes](http-routes.md).
- Releases of the upstream repository: [`CONTRIBUTING.md`](../CONTRIBUTING.md#versioning-and-releases).
