# Plan: Setup documentation, troubleshooting and the path to 1.0.0

Source: [spec.md](spec.md)
Status: Revised (1)
Tier: trivial — documentation and screenshots only, with a decision record; no production, test, configuration or workflow file changes.
Security areas touched: Encrypted credentials (`docs/manual-setup.md` tells the reader how to set `SELUNA_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` and the other Worker secrets by hand); Minimal GitHub App permissions (`docs/manual-setup.md` lists the permissions and events of a hand-made app, which must equal `src/github/manifest.ts`). No security control changes.

## Problem / root cause

Feature: see [spec.md](spec.md) (AC1–AC9).

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | Every dependency of #20 is closed and released | `gh api repos/larslaskowski/seluna/issues/<n>` for #13, #14, #16–#19, #65–#69, #108–#110: `closed completed`, milestones M3–M8; tag `v0.8.0` | confirmed |
| 2 | An owner's own non-draft pull request gives a message (S1's test) | `src/rules/pull-request-opened.ts` has no sender filter; `src/rules/stranger.ts` exempts the owner from the hourly bound | confirmed |
| 3 | The hand-made app needs permissions `actions`, `contents`, `issues`, `pull_requests`, `vulnerability_alerts`, `security_events`, `secret_scanning_alerts`, `metadata` (all read) and events `pull_request`, `workflow_run`, `dependabot_alert`, `code_scanning_alert`, `secret_scanning_alert`, `issues`, `issue_comment`, `fork`, `star`; webhook URL `<origin>/webhook` | `src/github/manifest.ts:12-32,67` | confirmed |
| 4 | With `database_name: "seluna"` and no id, Wrangler looks the database up by name; if it is missing, `wrangler d1 migrations apply DB --remote` fails with "Couldn't find a D1 DB named 'seluna' … Run 'wrangler d1 create seluna'" — so the manual path is `npx wrangler d1 create seluna` once, no edit of `wrangler.jsonc` | wrangler 4.156.0, `node_modules/wrangler/wrangler-dist/cli.js` `getDatabaseByNameOrBinding` (lines 238443–238497), read in the source; `wrangler.jsonc` | confirmed |
| 5 | `npx wrangler d1 create seluna` does not require a config edit to proceed, and `npx wrangler deploy` then binds the existing database by name | to verify: AC8 run, Product Manager, dry run before step 8; any prompt it shows is described in the guide | unverified |
| 6 | The Worker accepts GitHub's downloaded PKCS#1 key as the Worker secret `GITHUB_APP_PRIVATE_KEY` | `src/github/private-key.ts:4,63` (PKCS#1 and PKCS#8 PEM) | confirmed |
| 7 | `npx wrangler secret put GITHUB_APP_PRIVATE_KEY < <key file>` stores a multi-line PEM unchanged; the interactive prompt takes one line | to verify: AC8 run, Product Manager, dry run (the status page then shows the app, not _cannot be read_) | unverified |
| 8 | The setup pages render outside the Worker: `src/setup/pages.ts` exports `renderLoginPage`, `renderStartPage`, `renderTelegramPage`, `renderGitHubPage`, `renderGitHubReviewPage`, `renderGitHubFinishPage` taking language and view data; the CSP is a header, so the HTML renders as a file | `src/setup/pages.ts:167,551,784,856,894,921` | confirmed |
| 9 | Those renderers, bundled by Wrangler's own esbuild (`node_modules/wrangler/node_modules/esbuild`) into a scratch Node script and captured with `/usr/bin/google-chrome --headless --screenshot`, give the pages as a browser shows them | to verify: Dev, step 6, first screenshot; fallback in *Approach* | unverified |
| 10 | The branch holds no code, so the Deploy button (which deploys `main`) gives the instance the branch head would | the change's file list (*Affected projects and types*); orchestrator checks `git diff main --stat` at step 7 | confirmed |
| 11 | Texts the documents quote: the not-configured page names `openssl rand -hex 32` (`src/setup/texts.ts:339`), _No chat found_ with 24 hours / newest 100 (`:216`), the webhook conflict `telegram-conflict` (`:389`), the missing-tables notice "as the setup guide describes" (`:369`), **Reset and create the GitHub App again** (`:308`) | `src/setup/texts.ts` | confirmed |
| 12 | Seluna never answers in Telegram: no Telegram route, no webhook set | `.squad/project.md`, *Outbound delivery channels* | confirmed |
| 13 | The hourly bound is 20 per kind | `src/webhook.ts:46` `BOUNDED_DELIVERIES_PER_HOUR = 20` | confirmed |
| 14 | `docs/CONTRIBUTING.md` is template-marked: the AC9 rule goes into its project block `releases` (lines 104–183) | `<!-- project:begin releases -->` | confirmed |
| 15 | The links to @BotFather's, Cloudflare's and GitHub's documentation point to pages that describe today's steps | to verify: Dev writes them from the official documentation (`core.telegram.org/bots/features#botfather`, `developers.cloudflare.com/workers/…`, `docs.github.com/…/registering-a-github-app`, `…/installing-your-own-github-app`); Product Manager confirms in the AC7/AC8 runs | unverified |
| 16 | The browser setup takes under 15 minutes | to verify: Product Manager, AC7 run, duration in `log.md` | unverified |
| 17 | `npm ci --ignore-scripts` leaves Wrangler working for `wrangler d1 create`, `npm run deploy` and `wrangler secret put` | to verify: AC8 run, Product Manager, on a reader's machine (CI already builds and tests with it, `.squad/stack.md:39`, `.github/workflows/ci.yml:27,58,82`) | unverified |

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1–AC9 | none: no production or test code; see *Verification without tests* | — |

Shell procedure of `docs/manual-setup.md` (`.squad/routing.md`, *Operator environments*): no unit or CI test can run
it (it needs a Cloudflare account and a browser login); every case below is held by the guide's design and checked
in the AC8 run.

- (a) **All lines pasted at once:** each code block holds exactly one command; nothing in the guide is meant to be
  pasted as a whole. The commands that prompt (`wrangler login`, `wrangler secret put`) stand in a block of their
  own, with the warning that a further pasted line would become the secret's value.
- (b) **One line at a time:** the intended use; each block is followed by what its output shows when it worked.
- (c) **One line fails:** each step says "stop here" and points to the troubleshooting entry; no later step works on
  a half-finished state: a failed `git checkout vX.Y.Z` leaves nothing to install; `npm ci --ignore-scripts` runs
  before `wrangler login`, so no dependency script runs and a failed install leaves no stored login; `npm run deploy` already stops before `wrangler deploy` when the migrations fail
  (`package.json:19`, `&&`), and the secrets step comes after a successful deploy.
- (d) **A variable is lost:** the guide uses no shell variables. Values are entered at prompts or read from a file
  (`< <key file>`), never typed as arguments, so no secret lands in the shell history.

## Verification without tests

Steps 4 (*Skeleton*), 5 (*Tests first*) and the *Coverage gate* are not applicable: the change holds no production
or test code (*Changes without production or test code*). Step 6 is the Dev's edits; step 7 runs every gate but the
*Coverage gate*.

| AC | Verified by | Where |
| -- | ----------- | ----- |
| AC1 | Reviewer: steps and order of S1, one screenshot per Seluna-page step, a documentation link per other-service step, no shell command, every quoted label found verbatim in the English table of `src/setup/texts.ts` (Dev lists each quote with its key in the hand-back); Product Manager in the AC7 run | step 8, dry run |
| AC2 | Reviewer: same headings in the same order as `docs/setup.md`, German quotes found in the German table; Product Manager checks against the German pages in the AC7 run | step 8, dry run |
| AC3 | Reviewer: permission and event lists equal fact 3; installable on this account only, webhook **Active**, SSL verification on; secret names equal `docs/areas/deployment.md` (*Worker secrets*); the webhook secret generated with at least 32 random characters and entered only in GitHub's field and at the prompt; first deploy and updates on a release tag (or the own copy's `main`), never upstream `main`; `npm ci --ignore-scripts` before `wrangler login`; the bot-token warning; Product Manager in the AC8 run | step 8, dry run |
| AC4 | Reviewer: one entry per symptom of E1–E8, each quoted status or text found in `docs/areas/http-routes.md`, `docs/areas/setup-wizard.md` or `src/setup/texts.ts`; no advice to turn on Workers traces or outbound-request logs without the bot-token warning | step 8 |
| AC5 | Reviewer: the 13 rules of `src/rules/registry.ts` plus the release and limit notices, the four links; the security notes checked against `.squad/project.md` (*Encrypted credentials*: what D1 holds as AES-256-GCM ciphertext, `SELUNA_SECRET` as key source and setup password, Worker secrets taking precedence) and `SECURITY.md` for reporting, claiming no protection beyond those | step 8 |
| AC6 | Reviewer opens every image; Product Manager confirms at step 9 | step 8, step 9 |
| AC7, AC8 | Product Manager runs both procedures on the early draft PR's head; the orchestrator logs the result, the duration and every deviation; the Dev fixes deviations and marks unshown statements | dry run before step 8 |
| AC9 | Reviewer: the rule is in the `releases` project block of `docs/CONTRIBUTING.md` | step 8 |

**Early draft PR** (`.squad/routing.md`, *Early draft PR*): the dry runs need the guides with their images as GitHub
renders them. The orchestrator opens the PR as a draft right after step 7, the Product Manager runs AC7 and AC8 on
that head (the browser guide with the Deploy button from `main`, fact 10; the manual guide read on the branch
and run as written, on the latest release tag), fixes go back to the Dev (step 6) and through step 7 again, and the Reviewer's round of step 8 runs on the
head after the last fix. The PR body says "Part of #20", never "Closes #20".

## Approach

Documents (layout below fixed by this plan):

- `docs/setup.md` / `docs/setup.de.md`: an intro line linking the other language, *What you need* (S1's reader
  environment), then one `##` section per step in S1's order: 1 Telegram bot, 2 `SELUNA_SECRET`, 3 Deploy to
  Cloudflare (with the deploy-command check), 4 Open the setup page and sign in, 5 Telegram chat, 6 GitHub App,
  7 Install the app, 8 Settings, 9 Test pull request; then *Updates* (link to `docs/update.md`) and *If something
  does not work* (link to `docs/troubleshooting.md`). Each step: numbered actions, the screenshot or the external
  link, and a last line "**It worked when** …". The organization option gets one sentence in step 6 (personal
  account is what the guide follows). The note on the owner's own issues and comments stays in step 8.
- `docs/manual-setup.md` (English): *What you need* (spec NFR), then in this order:
  1. Clone. 2. Choose the release: a clone of the original repository runs `git fetch --tags` and
  `git checkout vX.Y.Z` with the latest release from the repository's releases page, never `main`; a clone of the
  reader's own copy stays on its `main`, which only the update workflow advances. 3. Install with
  `npm ci --ignore-scripts`, before any login. 4. Log in (`npx wrangler login`). 5. Create the database
  (`npx wrangler d1 create seluna`). 6. Deploy (`npm run deploy`). 7. Set `SELUNA_SECRET` at the
  `npx wrangler secret put SELUNA_SECRET` prompt: at least 32 random characters from a password manager or
  `openssl rand -hex 32`. 8. Either the wizard (continue at `docs/setup.md` step 4) or *Create the GitHub App by
  hand*: the permissions and events of fact 3; **Where can this GitHub App be installed?** set to only this account;
  webhook **Active**, URL `https://<worker>.<subdomain>.workers.dev/webhook`, SSL verification left on; a **Webhook
  secret** generated like `SELUNA_SECRET` (at least 32 random characters), entered in GitHub's field and at the
  `npx wrangler secret put GITHUB_WEBHOOK_SECRET` prompt, never as an argument; the App ID at the `GITHUB_APP_ID`
  prompt; the private key with `npx wrangler secret put GITHUB_APP_PRIVATE_KEY < <key file>`, the file then deleted
  or kept in a password manager. 9. Optional `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` with their precedence (moved
  from today's `docs/setup.md`) and the warning of `docs/areas/deployment.md` (*Worker secrets*, 2nd bullet) that
  Workers traces or logs of outbound requests record the bot token. *Updates*: a clone of the original fetches the
  tags and checks out the next release tag; a clone of the own copy runs the update workflow (`docs/update.md`)
  and then pulls its `main`; both then run `npm ci --ignore-scripts` and `npm run deploy` — never upstream `main`.
  Shell rules: (a)–(d) above.
- `docs/troubleshooting.md` (English): one `##` per symptom (E1–E8), each with *Cause* bullets and *Fix*; _No
  message arrives_ checks the causes in E5's order, cheapest first. It never suggests Workers traces or logs of
  outbound requests without the bot-token warning of `docs/areas/deployment.md`.
- Screenshots: `docs/assets/setup/<en|de>/<nn>-<name>.png`, the same names in both languages: `01-login`,
  `02-start-empty`, `03-telegram-token`, `04-telegram-chats`, `05-telegram-code`, `06-github-account`,
  `07-github-review`, `08-github-finish`, `09-github-created`, `10-start-done`, `11-settings`. PNG, 1280 px wide
  viewport, full page, at most 300 KB each. Made-up values only: account `your-account`, app `seluna-your-account`,
  App ID `123456`, bot `@your_seluna_bot`, chat _Your Name_, Worker `seluna.your-subdomain.workers.dev`, fixed
  dates; no real token, id or address. Alt text names the page and what it shows.
- Screenshot method (decision 0046): in a scratch directory outside the repository, the Dev writes a script that
  imports the renderers of fact 8 with made-up view data, bundles it with Wrangler's esbuild, writes one HTML file
  per page and language, and captures each with `google-chrome --headless --screenshot --window-size=1280,<height>`.
  Fallback when that fails (fact 9): `npx wrangler dev` with a local D1 (`wrangler d1 migrations apply DB --local`)
  and made-up `.dev.vars`, captured through Chrome's DevTools protocol after signing in. Nothing of either is
  committed. The hand-back names the method used.

## Options considered

Settled in [decision 0046](../../docs/decisions/0046-setup-guides-screenshots-and-languages.md): screenshots of
Seluna's pages only vs. all steps (Product Manager); no committed generator vs. a script or browser test project;
a German guide; database found by name vs. an edited `wrangler.jsonc`. Further: one bilingual document instead of
two files (lost: the issue names two files, and a reader would scroll past the other language).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| docs | `docs/setup.md` | rewritten (AC1) |
| docs | `docs/setup.de.md` | new (AC2) |
| docs | `docs/manual-setup.md` | new (AC3) |
| docs | `docs/troubleshooting.md` | new (AC4) |
| docs | `docs/assets/setup/en/*.png`, `docs/assets/setup/de/*.png` | new, 11 each (AC1, AC2, AC6) |
| docs | `README.md`, `docs/CONTRIBUTING.md`, `docs/update.md`, `docs/ARCHITECTURE.md`, `docs/areas/deployment.md`, `CHANGELOG.md` | *Documentation updates* |
| decisions | `docs/decisions/0046-…`, `docs/decisions/README.md` | Lead (done) |

## Signatures (for the Dev's skeleton)

none

## Test files

none. Existing test call sites affected: none. Files no unit test can cover: none (no code; images and Markdown are
not measured).

## Areas

[Deployment](../../docs/areas/deployment.md): a *Manual deployment* subsection — the Worker can be deployed with
Wrangler from a clone; the binding finds the database by its name `seluna` (`wrangler d1 create seluna` once); the
secrets are set with `wrangler secret put`; only a release is deployed (a release tag, or the own copy's `main`), installed with `npm ci --ignore-scripts`. Link to `docs/manual-setup.md`
and decision 0046 under *Related decisions*. No other area changes.

## Documentation updates

Owner: Dev, after the screenshots exist. Sweep done (`grep -rn "setup\.md\|setup guide"` over `*.md` and `src/`):

- `docs/setup.md`, `docs/setup.de.md`, `docs/manual-setup.md`, `docs/troubleshooting.md`: as *Approach*. Today's
  `docs/setup.md` content: *Updates* → step section *Updates*; Worker-secret overrides → `docs/manual-setup.md`;
  owner note → step 8; deploy-command check → step 3 (the sign-in notice `src/setup/texts.ts:369` and
  `docs/areas/setup-wizard.md:679` say "as the setup guide describes"; both stay true, unchanged).
- `README.md`: *Get started* links both guides, the manual setup and troubleshooting (line 69); the event table
  keeps its rows (AC5 checked against registry); a *Security notes* paragraph in *Security* (S5); *Status* unchanged
  (release PR).
- `docs/update.md:47,84`: "see [Setup](setup.md)" → the step anchors of the new guide
  (`setup.md#3-deploy-to-cloudflare`, or the anchor GitHub generates).
- `docs/CONTRIBUTING.md` (`releases` block): a `### Setup guides` subsection with the AC9 rule; line 182 "one step to
  the setup guide" → "one step to both setup guides".
- `docs/ARCHITECTURE.md` (*Deployment*, project block): one clause that an instance can also be deployed by hand with
  Wrangler ([`manual-setup.md`](manual-setup.md), `areas/deployment.md`).
- `docs/areas/deployment.md`: as *Areas*.
- `CHANGELOG.md` `Unreleased`, *Added*: setup guide in English and German with screenshots, manual setup,
  troubleshooting.

## Architecture check

No guarantee touched: no code, no configuration. The manual path documents the existing deploy command and Worker
secrets; the guarantee that credentials are only stored encrypted holds (Worker secrets are Cloudflare's encrypted
secrets; the guide never has a secret written to a file in the repository or typed as an argument).

## Security considerations

- [x] no limits (no parsed input).
- [x] none (no code that can fail).
- `docs/manual-setup.md`: secrets only at Wrangler's prompt or from a file outside the clone (the key file is deleted
  or stored in a password manager afterwards); never `.dev.vars` for the deployed instance. The webhook secret is the
  one secret a person chooses on this path, and the Worker accepts any non-empty value (`src/webhook-secret.ts:13-17`,
  `src/github/worker-secrets.ts:13-15`), so the guide has it generated with at least 32 random characters, like
  `SELUNA_SECRET`. The app equals the manifest beyond permissions and events: private, installable on this account
  only, webhook active with SSL verification; *Only select repositories*. Only released code is deployed (a release
  tag, or the own copy's `main`), and no dependency script runs (`npm ci --ignore-scripts`, before the login).
  Screenshots: made-up values only (AC6).

## Security review

Security's plan review at 70ec8df, `CHANGES_REQUIRED`:

- B1 (webhook secret of the hand-made app): accepted — *Approach* and *Security considerations* have it generated
  with at least 32 random characters and entered only in GitHub's field and at Wrangler's prompt; AC3's check looks
  for it.
- B2 (unreleased code, install scripts): accepted — first deploy and updates on a release tag (a clone of the own
  copy stays on its `main`, advanced only by the update workflow), `npm ci --ignore-scripts` throughout, install
  before `wrangler login`; shell case (c), AC3's check and fact 17 follow.
- N1 (bot token in traces): taken — the manual guide repeats the warning, troubleshooting never suggests traces
  without it, AC4's check names it.
- N2 (README security notes): taken — AC5's check names `.squad/project.md` and `SECURITY.md` as the reference.
- N3 (app settings beyond permissions): taken — this account only, webhook **Active**, SSL verification on, in
  *Approach* and AC3's check.

## Decision records

- [`docs/decisions/0046-setup-guides-screenshots-and-languages.md`](../../docs/decisions/0046-setup-guides-screenshots-and-languages.md) (Proposed)

## Out of scope / follow-ups

The external setup test, one week of real use and v1.0.0 (spec, *Out of scope*): the Product Manager after the
merge; #20 stays open. A page defect the screenshots reveal: a new issue (decision 0034).
