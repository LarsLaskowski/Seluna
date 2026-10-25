# Deployment

## Scope

What a Seluna instance consists of in the user's Cloudflare account and how it gets there and stays current: the
Deploy to Cloudflare button, the D1 database binding, the Worker secrets, the cron triggers, the deploy command
Workers Builds runs, and the update workflow that applies a release to the user's copy of the repository. The user
(who deploys and updates an instance) and the Worker code (which relies on the bindings) rely on it.

## Behavior

### Deploy to Cloudflare

- The button at the top of `README.md` deploys the public repository `LarsLaskowski/Seluna`. It creates an
  independent copy of the repository in the user's GitHub account (not a fork), provisions the D1 database,
  asks for the Worker secret `SELUNA_SECRET` ([Worker secrets](#worker-secrets)), and deploys the Worker through
  Workers Builds.
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
| `TELEGRAM_BOT_TOKEN`     | The bot token from @BotFather, optional; takes precedence over the saved one ([Setup wizard](setup-wizard.md#the-bot-token))          | By hand; the deploy form does not ask for it |
| `GITHUB_APP_ID`          | The App ID of the GitHub App, optional; takes precedence over the app the wizard created ([Setup wizard](setup-wizard.md#github-app)) | By hand; the deploy form does not ask for it |
| `GITHUB_APP_PRIVATE_KEY` | The private key of the GitHub App, optional; takes precedence over the stored key                                                     | By hand; the deploy form does not ask for it |
| `GITHUB_WEBHOOK_SECRET`  | The webhook secret, optional; takes precedence over the stored one ([HTTP routes](http-routes.md#webhook-signature))                  | By hand; the deploy form does not ask for it |
| `TELEGRAM_CHAT_ID`       | The id of the chat to send to, optional; takes precedence over the wizard's choice ([Setup wizard](setup-wizard.md#telegram-chat))    | By hand; the deploy form does not ask for it |

- The deploy form asks for exactly `SELUNA_SECRET` (the only entry of `cloudflare.bindings` in `package.json`); the
  bot token is entered in the setup wizard's Telegram step and stored encrypted in D1. `.dev.vars.example` names
  `SELUNA_SECRET` and, commented out as optional with its precedence, `TELEGRAM_BOT_TOKEN`, each with a description
  and no value. An instance deployed with `TELEGRAM_BOT_TOKEN` keeps using it after an update.
- The Bot API takes the bot token in the request URL (`https://api.telegram.org/bot<token>/<method>`). Seluna never
  logs that URL, but turning on Workers traces or logs that record outbound requests in the Cloudflare dashboard
  records the token with them, whichever source it came from: treat those traces as secret, or replace the token
  with `/revoke` at @BotFather afterwards.
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

- Both triggers invoke the Worker's scheduled handler, which runs the jobs of the expression: every 10 minutes the
  cleanup and the retry, daily the release check ([Scheduled jobs](scheduled-jobs.md#schedules)). The handler
  recognizes exactly these two expressions; a changed or added expression runs no job and writes one log entry.

### Update

How the owner uses it is in [`update.md`](../update.md); the rules it follows are these.

- **Start.** The owner applies a release to the copy with the workflow **Update Seluna**
  (`.github/workflows/update.yml`), started only by hand (**Run workflow**), never on a schedule or by another event.
  It has one input, **Allow a new major version**, off by default. It runs with the permission to write the copy's
  contents and nothing else, uses no action and no credential besides the run's own token, installs nothing and runs
  no code of the release: a release's code first runs in Workers Builds, as for any push to `main`.
- **One run at a time.** Runs of the workflow in one copy never run in parallel: a started run waits for the running
  one and then reads `main` as it is when it starts. GitHub keeps at most one waiting run; a further start cancels
  the waiting one, which shows as cancelled and changes nothing. A run is stopped after 10 minutes.
- **Release.** The run takes the latest full release of `LarsLaskowski/Seluna` (the name is fixed in the workflow,
  never an input), the one the daily release check reports ([Scheduled jobs](scheduled-jobs.md)); never a
  pre-release, a draft or upstream `main`. Of the answer only the tag is read, and only when the answer arrives
  within 10 seconds and is at most 1 MiB. The tag must be exactly `vA.B.C`: each part a whole number of one to nine digits without a leading zero,
  nothing before or after it (a trailing newline included). The release's files are fetched from the public
  repository without any credential.
- **Order of the checks.** Each check runs before anything later is read, fetched or pushed:
  1. In `LarsLaskowski/Seluna` itself (the repository name compared without regard to case) the run ends green and
     reads no release.
  2. A run started on a branch other than `main` fails.
  3. The latest release is read and its tag checked.
  4. The copy's version is the `version` in `package.json` of `main`, which must be exactly `A.B.C` under the same
     rule. Equal to the release's: the run ends green and pushes nothing. Not of that form, or newer than the
     release's: the run fails.
  5. From major version 1 on, a release with a higher major version than the copy's is applied only when the run was
     started with **Allow a new major version**; otherwise the run fails. From a `0.x` version, `1.0.0` and any
     later release are applied without it.
- **Base.** The run applies what changed between the copy's base and the release. The base is the first of these
  that applies:
  1. the release named by the newest update commit of this workflow in the first-parent history of `main` that the
     release does not contain: a commit whose committer email is
     `41898282+github-actions[bot]@users.noreply.github.com`, whose subject is exactly `Update Seluna to vA.B.C` (a
     tag under the rule above) and whose `Seluna-Release` trailer is that same tag. A commit that does not meet all
     three counts for nothing, so a trailer in an upstream commit of a fork's history is ignored. When the tag it
     names cannot be fetched from the upstream repository, the run fails;
  2. the newest commit that `main` shares with the release (a fork);
  3. when `main` has exactly one first commit: the newest commit of the release's history whose files equal that
     first commit's, apart from `wrangler.jsonc`, everything under `.github/workflows/`, and the name line (see
     _Names_) of `package.json`. Several such commits count only when they all have the same `wrangler.jsonc` (or
     all lack it).

  When none applies, the run fails; it never falls back to the tag of the copy's version.

- **Names.** The copy's own names stay: for the package `name` in `package.json` and `package-lock.json`, and the
  Worker `name` and the `database_name` in `wrangler.jsonc`, a _name line_ is a whole line of one or more spaces,
  `"<key>": "<value>"` and an optional comma, the value 1 to 214 characters of `A`–`Z`, `a`–`z`, `0`–`9`, `.`, `_`
  and `-`. When the first name line of a key in the copy's file and in the base's file both exist and differ, every
  name line of that key whose value equals the base's value is given the copy's value, in the base and in the
  release, before the merge (values compared and replaced as whole literal strings). So the names the button wrote
  are no local change and the release's lines beside them merge without a conflict.
- **The commit.** The run merges the copy's `main` with the release, both measured from the base, and adds exactly
  one commit on top of the commit `main` pointed to when the run started: parent that start commit, subject
  `Update Seluna to vY`, trailer `Seluna-Release: vY`, author and committer `github-actions[bot]`. No upstream
  commit enters the copy's history. The commit is pushed once to `main`, never forced, and Workers Builds builds and
  deploys it like any push.
- **Workflow files.** The workflow's token cannot push a change under `.github/workflows/`, so every file there stays
  as the copy has it, byte for byte: the release's additions, changes and removals there are not applied, a local
  change to a workflow file is never a conflict, and a commit that would still change a path there is not pushed
  (the run fails with the unexpected-error message). After a green update the run summary lists each workflow file
  the copy has whose content differs from the release's, or that the base has and the release removed; a file only
  the release has and one only the copy has are not listed. The owner takes one over by hand
  ([`update.md`](../update.md#workflow-files)).
- **Conflicts.** A conflict is a file that the copy and the release changed in the same or adjacent lines, a file
  the copy changed and the release removed, or a file the copy changed and the release renamed (named by its old
  path). Any conflict fails the run; it is never resolved by taking either side. A renamed file stays a conflict
  until the copy's file at the old path equals the base's again; a removed one clears once the copy removes it too.
- **Messages.** Every message is a fixed text with at most versions (`vA.B.C`) and file paths in it: nothing from the
  release answer, from Git or from the tools is printed. A path is printed only when it is 1 to 255 characters of
  `A`–`Z`, `a`–`z`, `0`–`9`, `.`, `_`, `/` and `-`, otherwise as `(a file with an unusual name)`; several paths are
  printed once each, sorted, joined by `, `. A green run prints its message in the log and as the first line of the
  run summary; a red run prints its message once as an error annotation and once in the run summary, and exits with
  failure. Every red run has pushed nothing.

| Outcome                                                                                    | Run   | Message                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Updated                                                                                    | green | `Updated Seluna from vX to vY.`                                                                                                                                    |
| Updated, and workflow files are listed (a blank line, then this line, in the summary only) | green | `The release changed these workflow files, which your copy keeps as they are: <file>, <file>. See docs/update.md, "Workflow files".`                               |
| Already on the latest release                                                              | green | `Seluna is already on the latest release vY; nothing to update.`                                                                                                   |
| The original repository                                                                    | green | `This is the original repository LarsLaskowski/Seluna; it is not updated by this workflow.`                                                                        |
| Started on another branch                                                                  | red   | `Start the update on the main branch.`                                                                                                                             |
| No answer (also an answer over 1 MiB)                                                      | red   | `Could not read the latest Seluna release: GitHub did not answer. Nothing was changed; run the workflow again later.`                                              |
| No latest release (status 404)                                                             | red   | `Could not read the latest Seluna release: there is no latest release. Nothing was changed; run the workflow again later.`                                         |
| Any other status than 200                                                                  | red   | `Could not read the latest Seluna release: GitHub answered with an error. Nothing was changed; run the workflow again later.`                                      |
| Not JSON, or no string `tag_name`                                                          | red   | `Could not read the latest Seluna release: the answer could not be read. Nothing was changed; run the workflow again later.`                                       |
| Tag not `vA.B.C`, or not fetchable                                                         | red   | `The latest Seluna release has no usable version tag. Nothing was changed.`                                                                                        |
| Copy's version not `A.B.C`, or newer than the release                                      | red   | `Your copy's version cannot be compared with the latest release vY. Nothing was changed. See docs/update.md.`                                                      |
| New major version without the input                                                        | red   | `Release vY is a new major version (copy on vX). Read its release notes and docs/update.md, then run the workflow again with "Allow a new major version" checked.` |
| No base                                                                                    | red   | `The update cannot tell which Seluna version your copy was built from. Nothing was changed. See docs/update.md, "Unknown base".`                                   |
| Conflict                                                                                   | red   | `The update to vY conflicts with changes in your copy: <file>, <file>. Nothing was changed. See docs/update.md, "Conflicts".`                                      |
| Push refused and `main` moved since the start                                              | red   | `main of your copy changed during the update. Nothing was changed; run the workflow again.`                                                                        |
| Push refused and `main` unchanged                                                          | red   | `GitHub refused the push: the workflow may not write to this repository. See docs/update.md, "Permissions".`                                                       |
| Anything else (a tool failure, a failed clone, a commit that would change a workflow file) | red   | `The update stopped because of an unexpected error. Nothing was changed.`                                                                                          |

## Limits and errors

- With any other deploy command, such as Workers Builds' default `npx wrangler deploy`, no migration is applied: the
  Worker deploys against a missing or outdated schema: when a table of the schema is missing, `/setup` answers the
  sign-in with the _migrations missing_ notice ([Setup wizard](setup-wizard.md#login)), otherwise it answers with the
  _unavailable_ notice where it reads D1, and `/health`, which reads no D1, still answers. Setting the command
  to `npm run deploy` and retrying the build applies the missing migrations.
- A deploy against an account in which the database does not exist yet fails at the migration step with
  Wrangler's message and deploys nothing.
- A Workers Build that fails after an update (a migration fails, the deploy command is not `npm run deploy`) does not
  change the run, which has already ended green: `main` holds the release and the previously deployed version keeps
  running until a build succeeds. The update commit is an ordinary commit the owner can revert.
- A copy in which GitHub Actions is disabled has no **Run workflow**; a copy on `v0.4.0` or earlier has no update
  workflow until the owner adds the file by hand ([`update.md`](../update.md)).
- A name line of the same key whose value equals the base's name is given the copy's name wherever it sits in the
  file, not only the first one. A release that renames the package, the Worker or the database away from the base's
  name changes a line the copy did not change (the copy's name counts as the base's), so the update replaces the
  copy's name with the release's new one; the owner sets their own name again by hand.
- The base found by the first-commit rule rests on the form of the button's first commit seen in one real copy
  (the button changes only the names and the database id in `package.json` and `wrangler.jsonc` and drops the
  workflow files); a copy whose first commit differs in any other file fails with the no-base message.
- Without `GITHUB_WEBHOOK_SECRET` and without a webhook secret stored by the setup wizard an instance answers every
  `POST /webhook` with 503, and so it does when the stored secret cannot be read or D1 fails
  ([HTTP routes](http-routes.md#webhook-signature)).
- Without a `SELUNA_SECRET` of at least 32 characters every request under `/setup` answers 503 with a page that
  explains how to set it ([Setup wizard](setup-wizard.md#paths)).

## Related decisions

- [`decisions/0013-deploy-to-cloudflare-and-workers-builds.md`](../decisions/0013-deploy-to-cloudflare-and-workers-builds.md)
  — the button and Workers Builds, the binding without a database id, migrations before the deploy.
- [`decisions/0036-telegram-bot-token-in-the-setup-wizard.md`](../decisions/0036-telegram-bot-token-in-the-setup-wizard.md)
  — the bot token entered in the wizard instead of the deploy form, `TELEGRAM_BOT_TOKEN` optional with precedence.
- [`decisions/0020-deploy-command-checked-in-the-setup-guide.md`](../decisions/0020-deploy-command-checked-in-the-setup-guide.md)
  — why the setup guide has the user check the deploy command after the button's deploy, and why the migrations
  stay out of the build command.
- [`decisions/0017-github-app-manifest-flow.md`](../decisions/0017-github-app-manifest-flow.md) — the optional
  GitHub Worker secrets and their precedence over the credentials the wizard stores.
- [`decisions/0031-update-workflow-for-copies.md`](../decisions/0031-update-workflow-for-copies.md) — why the
  update is one Bash step without actions that pushes one commit computed from the copy's base, and keeps the
  copy's workflow files.

## Not here

- What the cron jobs do: [Scheduled jobs](scheduled-jobs.md).
- The tables the migrations create and the encryption of stored credentials: [Storage](storage.md).
- The public routes, including `/health`: [HTTP routes](http-routes.md).
- Releases of the upstream repository: [`CONTRIBUTING.md`](../CONTRIBUTING.md#versioning-and-releases).
- The notice that a release exists: [Scheduled jobs](scheduled-jobs.md).
- The owner's steps for an update, a conflict or a workflow file: [`update.md`](../update.md).
