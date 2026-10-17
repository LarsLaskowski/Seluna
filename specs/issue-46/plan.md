# Plan: Deploy button sets the deploy command to npx wrangler deploy, so D1 migrations never run

Source: Issue #46
Status: Draft
Tier: trivial — the fix is documentation that needs a decision record and an area document (setup guide, `docs/areas/deployment.md`, decision 0013, `docs/ARCHITECTURE.md`); no production code, test code, configuration or behavior of the Worker changes.

## Problem / root cause

The repository already provides what Cloudflare documents for running migrations through the button:
`package.json` lines 17-18 (`"db:migrations:apply": "wrangler d1 migrations apply DB --remote"`,
`"deploy": "npm run db:migrations:apply && wrangler deploy"`), identical in shape to the example in Cloudflare's
`workers/platform/deploy-buttons` page (*Best practices*: "Cloudflare will automatically detect and pre-populate the
build and deploy fields ... If no `deploy` script is specified, Cloudflare will preconfigure `npx wrangler deploy`
by default"). The live deployment in the issue nevertheless got `npx wrangler deploy`, while the `build` script was
taken. Workers Builds runs exactly the deploy command stored in the Worker's build settings
(`workers/ci-cd/builds/configuration`, *Deploy command*: "defaults to `npx wrangler deploy`"), and neither
`package.json` nor `wrangler.jsonc` has another documented setting the button or Workers Builds reads for it. So
the root cause is outside the repository (the button did not pre-fill the documented value), and what the
repository gets wrong is its documentation: `docs/setup.md` lines 15 and 21, `docs/areas/deployment.md` lines 17-18
and 30-33, `docs/ARCHITECTURE.md` line 124 and decision 0013 (*Context*, option 5, *Decision*) state as fact that
the button picks up `npm run deploy`.

Claims of the issue, checked:

- `package.json` `deploy` and `db:migrations:apply` scripts as quoted: **confirmed** (`package.json` lines 17-18).
- The build ran `npm run build` (`wrangler deploy --dry-run --outdir dist`): **confirmed** against `package.json`
  line 11; it shows the button read the `build` script.
- `npx wrangler deploy` uploads the Worker without applying migrations, and `predeploy`-style hooks would not help:
  **confirmed** — `npx wrangler deploy` runs no npm script (Cloudflare's own `d1-template` relies on a
  `predeploy` script, which also runs only under `npm run deploy`).
- Login on `/setup` answers 503 *unavailable* on the missing table: **confirmed** against
  `docs/areas/setup-wizard.md` line 53 (a D1 failure while counting answers 503 with *unavailable*).
- Decision 0013 option 5 assumes the button and Workers Builds take the `deploy` script; `docs/setup.md` (*Deploy*
  step 2, *Updates*) and `docs/areas/deployment.md` (*Deploy command*) say every deploy migrates first:
  **confirmed**.
- Workaround (deploy command `npm run deploy`, re-run) works with the Workers Builds token: **confirmed** by the
  issue comment (not reproducible here; accepted as the live verification decision 0013 asked for).
- "All seven tables, `meta` included": **consistent** — the first migration creates six tables
  (`docs/areas/storage.md` line 21) and Wrangler adds `d1_migrations` (line 84).
- "The button can be made to take `npm run deploy` by a setting the repository does not provide yet":
  **refuted as far as documented** — Cloudflare documents the `deploy` script as that setting, and it is present.
  Whether the button's behavior differs from its documentation on purpose or by a bug is *unverified* and cannot be
  settled from the session.

Related defect found on the way: `docs/setup.md` line 16 (step 3) tells the user that `/health` answering with the
version confirms the deployment, but `/health` reads no D1 (`src/router.ts` lines 67-69), so it passes on an
instance without schema and hides this very failure. The guide's new step (below) gives the user a check that does
show the migrations.

## Acceptance criteria

- [ ] AC1: `docs/setup.md` has the user, after the button's deploy, open the Worker's build settings (Workers &
  Pages, the Worker, Settings, Build), check that the **Deploy command** is `npm run deploy`, and, when it reads
  anything else (such as `npx wrangler deploy`), change it and retry the latest build; it says what goes wrong
  without it (empty database, `/setup` shows the *unavailable* notice).
- [ ] AC2: `docs/setup.md` tells the user how to see that the migrations ran: the build log of the deploy shows the
  line `> wrangler d1 migrations apply DB --remote` (npm's echo of the script, printed before Wrangler's output).
  Step 3 (`/health`) no longer implies that it confirms the database.
- [ ] AC3: `docs/setup.md` *Updates* states the migrations run on every push "with the deploy command
  `npm run deploy`", not unconditionally.
- [ ] AC4: `docs/areas/deployment.md` *Deploy command* names the command (`npm run deploy`, the `deploy` script),
  says Workers Builds runs the deploy command stored in the Worker's build settings and that the setup guide has the
  user set it; *Limits and errors* states that with any other deploy command (Workers Builds' default
  `npx wrangler deploy`) no migration is applied and the Worker runs against a missing or outdated schema, which
  `/setup` answers with the *unavailable* notice and `/health` does not show.
- [ ] AC5: `docs/areas/deployment.md` *Deploy to Cloudflare* no longer says the button itself sets the deploy
  command; the push bullet still refers to "the deploy command below".
- [ ] AC6: `docs/ARCHITECTURE.md` *Deployment* (line 122-124) says the Workers Build applies the migrations with the
  deploy command `npm run deploy`, which the setup guide has the user check.
- [ ] AC7: decision 0013 records issue #46's finding, the options for getting the deploy command right and the
  chosen one, and links the area document (done by the Lead in this plan step; status `Proposed`, index row
  `Proposed`).
- [ ] AC8: No other file changes: no production code, test code, `package.json`, `wrangler.jsonc` or workflow.

## Verification without tests

The change touches no production or test code: steps 4 (*Skeleton*), 5 (*Tests first*) and the *Coverage gate* of
step 6 are **not applicable**.

| Criterion | Verified where | By |
| --------- | -------------- | -- |
| AC1-AC3 | Reading `docs/setup.md` in the diff against the criteria; *Format check* | Reviewer (step 8); Dev runs *Format* |
| AC4-AC5 | Reading `docs/areas/deployment.md` in the diff; *Format check* | Reviewer |
| AC6 | Reading `docs/ARCHITECTURE.md` in the diff; `config-check.py` (marked file, project block intact) | Reviewer; orchestrator runs `config-check.py` in step 7 |
| AC7 | Reading the record; `python3 .squad/tools/decision-check.py` passes | Reviewer; orchestrator in step 7 |
| AC8 | `git diff --stat` and `python3 .squad/tools/scope-check.py` | Orchestrator (step 7), Reviewer |
| The deploy command fix in a real account | Already verified live in the issue comment; not re-run | — |

The exact Cloudflare dashboard labels (Workers & Pages, Settings, Build, Deploy command, the retry button) come from
the issue and Cloudflare's documentation; the label of the retry action is *unverified* — the guide says "retry the
latest build" without quoting a button name.

## Approach

Keep the repository configuration as it is (it is what Cloudflare documents) and make the setup guide carry the
check the button does not do reliably. Exact edits for the Dev:

1. `docs/setup.md`, *Deploy*:
   - Step 2: end the sentence with "builds and deploys the Worker" unchanged, then add: "If the form lets you edit
     the deploy command, set it to `npm run deploy`."
   - New step 3 (before the `/health` step): "In the Cloudflare dashboard open **Workers & Pages**, your Worker,
     **Settings** and **Build**, and check that the **Deploy command** is `npm run deploy`. The button may set
     `npx wrangler deploy` instead, which deploys the Worker without creating the database tables; `/setup` then
     only shows *The setup is unavailable right now*. If it reads anything else, change it to `npm run deploy` and
     retry the latest build. The build log of a correct deploy shows the line
     `> wrangler d1 migrations apply DB --remote`."
   - Old step 3 becomes step 4: "Open `https://<worker>.<your-subdomain>.workers.dev/health`. It answers with the
     version; it does not check the database."
2. `docs/setup.md`, *Updates*: "Every push to `main` of your copy builds and deploys it; with the deploy command
   `npm run deploy` it applies the database migrations first."
3. `docs/areas/deployment.md`:
   - *Deploy to Cloudflare*, first bullet: unchanged except "and deploys the Worker through Workers Builds" stays;
     add a bullet: "The button is documented to take the deploy command from the `deploy` script in
     `package.json`, but it may set Workers Builds' default `npx wrangler deploy` instead (issue #46); the setup
     guide has the user check the command in the Worker's build settings after the first deploy."
   - *Deploy command*: new first bullet: "The deploy command is `npm run deploy` (the `deploy` script: the
     `db:migrations:apply` script, then `wrangler deploy`). Workers Builds runs the deploy command stored in the
     Worker's build settings, not the `package.json` script by itself." The two existing bullets follow unchanged.
   - *Limits and errors*, new first bullet: "With any other deploy command, such as Workers Builds' default
     `npx wrangler deploy`, no migration is applied: the Worker deploys against a missing or outdated schema,
     `/setup` answers with the _unavailable_ notice where it reads D1 ([Setup wizard](setup-wizard.md#login)), and
     `/health`, which reads no D1, still answers. Setting the command to `npm run deploy` and retrying the build
     applies the missing migrations."
   - *Related decisions*, 0013 bullet: append "and the deploy command the user checks after the button's deploy".
4. `docs/ARCHITECTURE.md` *Deployment* (inside the project block): replace "that copy starts a Workers Build that
   applies the D1 migrations and then deploys" with "that copy starts a Workers Build whose deploy command,
   `npm run deploy`, applies the D1 migrations and then deploys (the setup guide has the user check that command,
   which the button does not always set)".
5. Decision 0013: already extended by the Lead in this step (see *Decision records*).

Wording may be adjusted by the Dev for Prettier and flow; the facts above are fixed. The anchor
`setup-wizard.md#login` must exist (the heading *Login* in `docs/areas/setup-wizard.md`); the Dev checks it.

## Options considered

1. **The setup guide has the user check and correct the deploy command** — works whatever the button pre-fills,
   and the retry is verified live. Chosen.
2. **A repository setting the button reads** — none exists beyond the `deploy` script, which is present
   (Cloudflare documentation, read for this plan). Not available.
3. **Apply migrations in the `build` script**, which the button did take — runs in CI (`ci.yml` line 42,
   `release.yml` line 113) without credentials, and in preview builds of other branches when enabled, so an
   unmerged migration would reach the production database. Rejected.
4. **Wrangler's custom build `build.command` in `wrangler.jsonc`** — runs on every `wrangler deploy`, but also on
   `wrangler dev`, the CI dry run and preview builds (*unverified* for the dry run; rejected on `wrangler dev` and
   preview builds alone). Rejected.
5. **The Worker applies the schema at runtime** — no deploy command needed, but it replaces Wrangler's migration
   tracking and lets new code run against the old schema when a migration fails, which option 6 of decision 0013
   rejects; a production-code change far beyond the issue. Rejected.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| docs | `docs/setup.md` | Deploy steps 2-4, *Updates* (Dev) |
| docs | `docs/areas/deployment.md` | *Deploy to Cloudflare*, *Deploy command*, *Limits and errors*, *Related decisions* (Dev) |
| docs | `docs/ARCHITECTURE.md` | *Deployment* sentence (Dev) |
| docs | `docs/decisions/0013-deploy-to-cloudflare-and-workers-builds.md`, `docs/decisions/README.md` | Extended, `Proposed` (Lead, done) |

## Signatures (for the Dev's skeleton)

None.

## Test files

None. Existing test call sites affected: none. Files no unit test can cover: none (no code).

## Areas

- `docs/areas/deployment.md` — the deploy command is named and its origin (the Worker's build settings) stated; the
  failure with any other command is a documented limit. No change in the Worker's behavior.

## Documentation updates

- `docs/setup.md` — Dev.
- `docs/areas/deployment.md` — Dev.
- `docs/ARCHITECTURE.md` — Dev.
- `docs/decisions/0013-deploy-to-cloudflare-and-workers-builds.md` and its index row — Lead (done; approval sets
  `Accepted`).
- `README.md` — none (the button link is unchanged).

## Architecture check

No guarantee of `.squad/project.md` or `docs/ARCHITECTURE.md` changes. The statement that every deploy applies the
migrations first is kept and made conditional on the deploy command it already depended on; "a failed migration
stops the deploy" is untouched. Migrations stay frozen once on `main`.

## Security considerations

- [x] No limits (no parsed input).
- [x] None (no exception path changes).
- The guide's `/health` wording no longer suggests a verified database; nothing about secrets changes.

## Decision records

- `docs/decisions/0013-deploy-to-cloudflare-and-workers-builds.md` (Proposed; unreleased — no `v*` tag exists, so it
  is extended in place): *Context* records the documented pre-fill and issue #46's live result, option 5 no longer
  claims the button takes the script, new options 13-16 on how the deploy command gets set, *Decision* and
  *Consequences* updated. Index row set to `Proposed`.

## Out of scope / follow-ups

Proposed follow-up issue for the orchestrator to open (a behavior change, not this issue's scope):

- **Title:** `[Setup] Say on /setup that the database has no tables instead of "unavailable"`
- **Body:** An instance whose deploy command skipped the migrations (issue #46) shows only "The setup is
  unavailable right now. Please try again in a moment." on `/setup`, which suggests a transient error. When the D1
  failure is a missing table (the `meta` table does not exist), the page could say that the database migrations
  have not run and point to the deploy command `npm run deploy` in the setup guide. Needs a way to tell a missing
  table from other D1 failures without leaking error text, and an area document change in
  `docs/areas/setup-wizard.md`.
