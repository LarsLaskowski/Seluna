# 0013: Deployment through the Deploy to Cloudflare button and Workers Builds

- **Status:** Proposed
- **Date:** 2026-10-14
- **Area:** Deployment
- **Source:** Issue #6, issue #46
- **Supersedes:** —

## Context

Every user runs their own instance ([decision 0005](0005-one-instance-per-user.md)), so getting Seluna into a
Cloudflare account has to work without a command line and without the maintainer. Cloudflare's Deploy to Cloudflare
button copies a public repository into the user's GitHub account (an independent copy, not a fork), provisions the
resources the Wrangler configuration declares, asks for the Worker secrets listed in `.dev.vars.example`, and
connects the copy to Workers Builds, which builds and deploys every push to the production branch. According to
Cloudflare's documentation the button pre-fills the build and deploy commands from the `build` and `deploy` scripts
in `package.json` and falls back to `npx wrangler deploy` without a `deploy` script; descriptions for the secrets
come from `cloudflare.bindings` in `package.json` (Cloudflare documentation, `workers/platform/deploy-buttons`,
read at cloudflare-docs commit `7b23ded` and again for issue #46). The first real deployment (issue #46) took the
`build` script but set the deploy command to `npx wrangler deploy`, so no migration ran and the database stayed
empty; with the deploy command changed to `npm run deploy` in the Worker's build settings, the next build applied
the migrations with the token Workers Builds generates. Workers Builds runs whatever deploy command is stored in
those settings; the repository has no other place to set it. Issue #6 asks for a D1 binding `DB` without a fixed database id, cron
triggers every 10 minutes and once a day (no-ops until issue #18), exactly the secrets `SELUNA_SECRET` and
`TELEGRAM_BOT_TOKEN` in the deploy form, and D1 migrations applied before each deploy. Issues #7 and #9 likewise
keep the Telegram bot token out of the D1 table `secrets`, which [decision 0007](0007-github-app-credentials-encrypted-in-d1.md)
had included.

## Options considered

Where the Telegram bot token lives:

1. **Worker secret `TELEGRAM_BOT_TOKEN`, asked for by the deploy form** — Cloudflare stores it encrypted and never
   shows it again; the user enters it once while deploying, before the setup wizard exists. Chosen.
2. **Encrypted in D1, entered in the setup wizard** (decision 0007 as first written) — keeps every credential in one
   place, but the deploy form already asks for secrets, and a second entry point for the same token adds a
   wizard form, an encryption path and a reset case for nothing.

How the database is declared:

3. **Binding `DB` with a default `database_name` and no `database_id`** — the button provisions a database in the
   user's account and writes its id into the copy; the Cloudflare documentation asks for default resource names.
   Chosen.
4. **A fixed `database_id`** — points at the maintainer's database, which no other account can reach.

How the migrations run:

5. **A `deploy` script that applies the migrations by binding name, then deploys** — `npm run deploy` is the deploy
   command (the button is documented to pre-fill it, and the setup guide has the user check it, below), the binding
   name survives a database renamed in the form, and a failed migration stops the deploy (the old version keeps
   running). Chosen.
6. **Deploy first, then migrate** — succeeds on a database that does not exist yet, but new code would run against
   the old schema until the migration finishes.

How an empty schema is represented until issue #7:

7. **A `migrations/` directory with a `README.md` and no `.sql` file** — Wrangler finds the directory and applies
   nothing; issue #7 adds the first migration with all tables. Chosen.
8. **A baseline migration now** — a migration is never edited once released, so issue #7's first schema would be
   split over two files for no gain.

Required secrets:

9. **`secrets.required` in `wrangler.jsonc`** — Wrangler would refuse a first deploy of a Worker whose secrets are not
   set yet; whether the button sets them before its first deploy is not documented, so this could break the button.
   Rejected: the code that reads each secret treats a missing one as not configured instead.

The daily trigger:

10. **`17 5 * * *` (05:17 UTC)** — off the full hour and off the 10-minute schedule, so the two triggers never fire
    in the same minute. Chosen; any fixed daily time would serve.

Preview URLs:

11. **`preview_urls: false`** — a version built from another branch of the copy would otherwise get its own URL and
    run with the production database and secrets; Seluna has no use for previews. Chosen; `workers_dev` stays on so
    `/health` is reachable.
12. **Cloudflare's default** — less configuration, but an unreviewed branch of the copy could answer requests and
    write to the instance's data.

How the deploy command `npm run deploy` gets into the copy's build settings (issue #46):

13. **The setup guide has the user check the deploy command after the button's deploy** and set it to
    `npm run deploy` and retry the build if it reads anything else — works whatever the button pre-fills, and the
    retry was verified in issue #46. Chosen; the first build may run without migrations, which the retry repairs.
14. **Apply the migrations in the `build` script** — the button did take `npm run build`, but the build command also
    runs in CI (`npm run build` in `ci.yml` and `release.yml`, without Cloudflare credentials) and, when preview
    builds are on, in Workers Builds for branches other than `main`, so an unmerged migration would reach the
    instance's database.
    Rejected.
15. **Apply the migrations from Wrangler's custom build (`build.command` in `wrangler.jsonc`)** — runs on every
    `wrangler deploy`, whatever the deploy command, but also on `wrangler dev`, on `--dry-run` in CI and on a
    preview build of another branch, with the same effects as option 14. Rejected.
16. **The Worker applies the schema itself at runtime** — needs no deploy command at all, but replaces Wrangler's
    migration tracking with Seluna's own, and a failed migration no longer stops a deploy: new code would run
    against the old schema, the risk option 6 rejects. Rejected.

## Decision

Seluna is deployed through the Deploy to Cloudflare button and kept up to date by Workers Builds: the Wrangler
configuration declares the D1 binding `DB` without a database id and the two cron triggers, the deploy form asks
for `SELUNA_SECRET` and `TELEGRAM_BOT_TOKEN`, and the deploy command `npm run deploy` applies the D1 migrations
before `wrangler deploy`; the setup guide has the user make sure the copy's build settings use that command.
The Telegram bot token is a Worker secret, not a value in D1; preview URLs are off, and Git ignores every local
secret file Wrangler reads. The rules are in
[`areas/deployment.md`](../areas/deployment.md).

## Consequences

A user needs a GitHub account, a Cloudflare account and the two secret values, and no command line. Each copy is
independent: an update from the upstream repository reaches it only when the user brings it into the copy's
`main` (issue #19). A deploy run by hand with `npm run deploy` against an account without the database fails at
the migration step until the database exists (`wrangler deploy` once, or `wrangler d1 create`), which the manual
setup guide (issue #20) has to say. The flow of the button itself — provisioning before the first build, the
secrets prompt, the build on a push — can only be verified with a real Cloudflare account after the change is on
`main`; issue #46 was that verification and found the deploy command not taken from `package.json`. Until the user
corrects the deploy command, every build deploys without migrations and `/setup` answers with the _unavailable_
notice; `/health` reads no D1 and does not show it. Whether a later version of the button pre-fills
`npm run deploy` as documented is not known, so the check stays in the guide either way. Until the setup wizard stores a webhook secret (issue #10), an instance deployed by the button answers
`POST /webhook` with 503.
