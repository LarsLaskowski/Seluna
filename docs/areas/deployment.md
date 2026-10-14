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

### D1 database

- The Worker has exactly one D1 binding, `DB`. The configuration names a default database, `seluna`, and carries
  no database id: the button provisions the database in the user's account and records its id in the copy.
- The schema is defined by the migrations in `migrations/` (files `*.sql`, applied in name order, each once). A
  released migration is never edited; a change to the schema is a new migration.

### Deploy command

- A deploy first applies every unapplied migration to the remote database, addressed by the binding name `DB`, and
  then deploys the Worker. A migration that fails stops the deploy; the previously deployed version keeps running.
- Without unapplied migrations the first step changes nothing, so every deploy runs the same command.

### Worker secrets

| Secret                  | Holds                                                                          | Set                                       |
| ----------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| `SELUNA_SECRET`         | A random string of at least 32 characters chosen by the user                   | Deploy form                               |
| `TELEGRAM_BOT_TOKEN`    | The token of the user's Telegram bot from @BotFather                           | Deploy form                               |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret, optional ([HTTP routes](http-routes.md#webhook-signature)) | By hand, until the setup wizard stores it |

- The deploy form asks for exactly `SELUNA_SECRET` and `TELEGRAM_BOT_TOKEN`; `.dev.vars.example` names them with
  a description each and holds no value.
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

- A deploy against an account in which the database does not exist yet fails at the migration step with
  Wrangler's message and deploys nothing.
- Without `GITHUB_WEBHOOK_SECRET` an instance answers every `POST /webhook` with 503
  ([HTTP routes](http-routes.md#webhook-signature)).

## Related decisions

- [`decisions/0013-deploy-to-cloudflare-and-workers-builds.md`](../decisions/0013-deploy-to-cloudflare-and-workers-builds.md)
  — the button and Workers Builds, the binding without a database id, migrations before the deploy, the Telegram
  bot token as a Worker secret.

## Not here

- What the cron jobs do: [`ARCHITECTURE.md`](../ARCHITECTURE.md#cron-triggers).
- The public routes, including `/health`: [HTTP routes](http-routes.md).
- Releases of the upstream repository: [`CONTRIBUTING.md`](../CONTRIBUTING.md#versioning-and-releases).
