# Spec: Setup documentation, troubleshooting and the path to 1.0.0

Source: Issue #20
Status: Draft

## Problem

Seluna's aim is that someone without prior knowledge sets up their own instance alone, in under 15 minutes and
without a command line (issue #20, *Goal*). Today [`docs/setup.md`](../../docs/setup.md) calls itself a stopgap
("A fuller guide follows in a later version"): it is text only, packs the Telegram step, the GitHub App step, the
installation and the settings into three dense paragraphs, suggests `openssl rand -hex 32` (a command line) for
`SELUNA_SECRET`, never ends with a check that a real message arrives, and exists in English only. There is no guide
for a setup without the Deploy button, and no page that turns a symptom (no message, GitHub's delivery log showing
401, a bot that "does not answer") into a cause and a fix, so a stuck user has to read the area documents or ask.
Every dependency the issue lists (#13, #14, #16–#19, #65–#69, #108–#110) is closed and released in v0.3.0–v0.8.0, so
the pages and events the guide describes are final for 1.0.0.

## Scenarios

- S1: Given a reader with a GitHub, a Cloudflare and a Telegram account, a web browser and the Telegram app, when
  they follow `docs/setup.md` from top to bottom, then they create the bot at @BotFather, create a `SELUNA_SECRET`
  without a command line, deploy with **Deploy to Cloudflare**, check the deploy command, open the Worker URL and
  sign in on `/setup`, finish the **Telegram chat** step, the **GitHub App** step and the installation on
  **Only select repositories**, review the settings, and open a (non-draft) test pull request in a repository they
  picked — and receive its Telegram message. Each step names the controls exactly as the page shows them and ends
  with what the reader sees when the step worked. A step on one of Seluna's own pages shows a screenshot of that
  page; a step on another service (@BotFather, the Cloudflare deploy flow and build settings, GitHub's app creation
  and installation, Telegram) is described in text and links that service's own documentation, no screenshot.
- S2: Given a German-speaking reader, when they open `docs/setup.de.md` (linked from the top of `docs/setup.md` and
  from the README), then they find the same steps in the same order in German, with the setup pages' German labels
  (the pages' **Deutsch** language link) and screenshots of the German pages.
- S3: Given a reader who prefers the Wrangler CLI or creates the GitHub App by hand, when they follow
  `docs/manual-setup.md`, then they deploy the Worker and apply the migrations with Wrangler, create a GitHub App
  with exactly the permissions, events and webhook URL the wizard's manifest uses, set the Worker secrets of
  [Deployment](../../docs/areas/deployment.md#worker-secrets) they need, and continue with the Telegram step and the
  same test pull request as S1.
- S4: Given a reader whose setup does not work, when they open `docs/troubleshooting.md` (linked from both guides
  and the README), then they find their symptom as a heading and, under it, how to tell the causes apart (the status
  page, GitHub's **Recent Deliveries** of the app, the Workers build log) and the fix for each.
- S5: Given a visitor of the repository, when they read the README, then it says what Seluna does, offers the Deploy
  button, links the setup guide in English and German, the manual setup and the troubleshooting page, lists every
  reported event, gives the security notes an owner needs (what is stored encrypted, what `SELUNA_SECRET` protects,
  why *Only select repositories*, how to report a vulnerability) and names the license.

## Errors and edge cases

- E1: The Deploy button set the deploy command to `npx wrangler deploy` (decision 0020): the guide's deploy step has
  the reader check **Settings → Build → Deploy command** (text and a link to Cloudflare's documentation), and the troubleshooting page has the
  sign-in notice _The database of this instance is missing its tables_ as a symptom.
- E2: The reader's `SELUNA_SECRET` is shorter than 32 characters or missing: the guide says how to create one in a
  password manager or a browser-only way first, and the troubleshooting page explains the page `/setup` shows then.
- E3: The reader signs in wrongly five times: the troubleshooting page explains the 15-minute lock.
- E4: The GitHub App flow is not finished within one hour, or the reader signed out in between: the guide says so at
  the step, the troubleshooting page has the notice the finish page shows and how to start again (delete the
  half-created app on GitHub).
- E5: The test pull request is a draft, or is in a repository not picked for the installation: no message — the guide
  says "not a draft, in a picked repository", the troubleshooting page has both under _No message arrives_.
- E6: GitHub's **Recent Deliveries** show 401 (signature: an app created by hand with another webhook secret, an old
  app still installed after a new one was created) or 503 (no webhook secret yet): troubleshooting entries per status.
- E7: The bot does not answer `/start`: Seluna never answers in Telegram (it only sends); the troubleshooting page
  says so and points to the Telegram step's chat search and test message instead.
- E8: The reader changed `SELUNA_SECRET`: the troubleshooting page leads to setting the earlier secret again or to
  **Reset and create the GitHub App again**, then re-entering the bot token and deleting the old app on GitHub.
- E9: A screenshot of a Seluna page would show a private value (bot token, `SELUNA_SECRET`, chat id, e-mail address,
  a real account, Worker subdomain or App ID): it is never published; the pages are rendered with made-up values.
- E10: A setup page, a button label or a third-party screen changes in a later release: the reader finds a guide
  whose text matches the pages of the version it ships with (see the non-functional requirements).

## Non-functional requirements

- Reader environment (S1, S2), as the Product Manager answered: a desktop browser and the Telegram app on a phone;
  new or existing free accounts at GitHub, Cloudflare and Telegram; a personal GitHub account; no command line and
  no local tools.
- Every label, notice and page name a guide quotes is the text of the version it ships with (`src/setup/texts.ts`,
  `src/i18n/`), in the language of the guide.
- Screenshots: of Seluna's own pages only, rendered by the squad in English and German; one file per screenshot
  under `docs/assets/`, each with alt text that says what the image shows, sized
  to stay readable on GitHub without blowing up the repository (limit fixed in the plan); none shows a secret or a
  private value (E9).
- `docs/setup.md` and `docs/setup.de.md` stay equivalent: same sections, same order, same screenshots or their German
  counterparts; a later change to one changes the other in the same pull request.
- No change to the Worker, its configuration or its behavior; no new setting.
- English everywhere else in the repository; `docs/setup.de.md` is the one German document (open question 2).

## Acceptance criteria

- [ ] AC1: `docs/setup.md` contains the steps of S1 in that order, each with the check that shows it worked; every
  step on a Seluna page has at least one screenshot of that page in English, every step on another service a link
  to that service's documentation and no screenshot; it addresses a personal GitHub account, quotes every control and notice as `src/setup/texts.ts` (English) has it, contains no
  command a reader must type, and covers the deploy-command check, the secret length, the one-hour limit and the
  test pull request's conditions (S1, E1, E2, E4, E5).
- [ ] AC2: `docs/setup.de.md` has the same sections in the same order as `docs/setup.md`, quotes the German texts of
  `src/setup/texts.ts`, shows the screenshots of AC1 rendered in German, and the two guides link each other at the
  top (S2).
- [ ] AC3: `docs/manual-setup.md` lists the GitHub App permissions and events exactly as `src/github/manifest.ts`
  builds them, the webhook URL `https://<worker>.<subdomain>.workers.dev/webhook`, the Worker secrets as
  [Deployment](../../docs/areas/deployment.md#worker-secrets) names them, and the Wrangler commands to create the
  database, apply the migrations and deploy (S3).
- [ ] AC4: `docs/troubleshooting.md` has one entry per symptom of E1–E8 with cause and fix, and every status code,
  notice and page text it quotes matches [HTTP routes](../../docs/areas/http-routes.md) and
  [Setup wizard](../../docs/areas/setup-wizard.md) (S4, E1, E2, E3, E4, E5, E6, E7, E8).
- [ ] AC5: The README links `docs/setup.md`, `docs/setup.de.md`, `docs/manual-setup.md` and
  `docs/troubleshooting.md`, lists the reported events as `src/rules/registry.ts` registers them, and has a security
  notes section with the points of S5 (S5).
- [ ] AC6: No screenshot or text of the change shows a secret or a private value of a real account: every value a
  screenshot shows is made up for the rendering; checked by the Reviewer and confirmed by the Product Manager at the
  PR approval (E9).
- [ ] AC7: Before the documentation is reviewed, the Product Manager (or a stand-in the plan names) runs `docs/setup.md`
  on a new instance deployed from the branch head and ends with the test pull request's message; every step where
  the run differed from the guide is fixed in both guides (S1, E10).

## Out of scope

- The issue's own acceptance criteria that only time and people outside the squad can meet — the setup test by an
  external person with their own accounts, one week of real use without a lost or duplicated message, and the
  release v1.0.0 — are verified by the Product Manager after this pull request is merged. The pull request refers to
  issue #20 without closing it; stumbling points from the external test are fixed in follow-up documentation pull
  requests; v1.0.0 is cut by its own release pull request as `docs/CONTRIBUTING.md` (*Versioning and releases*,
  *Release plan up to 1.0.0*) describes, which also changes the README's *Status* section, and #20 is closed then.
- Guides for the messengers of #70–#73 (they bring their own sections, issue comment of 2026-10-18).
- Any change to the setup pages; a defect the screenshots reveal (decision 0034, *Consequences*) becomes a new issue.
- A German translation of any document other than the setup guide.
- Screenshots of other services (Product Manager, Q4) and a setup for a GitHub organization: the guides address a
  personal account; the wizard's organization choice stays as it is, undocumented in the guides beyond a mention.

## Open questions

- Q1: Which dependencies are still open? Answered: none — #13, #14, #16–#19, #65–#69, #108–#110 are closed (milestones
  M3–M8, released up to v0.8.0); the issue's *Context* lists fewer events than Seluna reports today (issues,
  comments, stars, forks, the release notice and the limit notice were added later), so the guides and README list
  the current set from the code, not the issue's.
- Q2: May a German document live in the repository, which writes everything in English (`AGENTS.md`)? Answered: yes
  for `docs/setup.de.md` — the owner asks for it in the issue's *Scope*, and user-facing German already ships in
  `src/i18n/` and `src/setup/texts.ts`; the rule governs the project's working language, not translations for users.
- Q3: How are the issue's criteria handled that the squad cannot run in a session (external test, one week of use,
  v1.0.0)? Answered: Lead decision — out of scope of this pull request and verified by the Product Manager afterwards
  (*Out of scope*); the squad's part ends with AC7, the dry run the routing requires for a documented procedure.
- Q4: Who takes the screenshots, of which screens, in which languages, and what may the guide assume about the
  reader's browser and accounts? Answered: by the Product Manager — screenshots of Seluna's own pages only, rendered
  by the squad in both languages; other services' steps in text with a link to their own documentation; the reader
  has a desktop browser, the Telegram app on a phone, new or existing free accounts, a personal GitHub account only
  and no command line.
- Q5: Can a reader create `SELUNA_SECRET` without a command line? Answered: yes — a password manager's generator (or
  any 32+ character random string); `openssl` stays as an alternative in `docs/manual-setup.md` only.
- Q6: Does an owner's own test pull request give a message? Answered: yes — the pull request rules report an opened
  non-draft pull request whoever opened it (`src/rules/pull-request-opened.ts`); only issues and comments leave the
  owner's own out.

## Area documents

None describes new behavior: the change is documentation only. [Deployment](../../docs/areas/deployment.md) keeps
saying the setup guide has the user check the deploy command (still true) and gains a link to `docs/manual-setup.md`
for the Wrangler path; the plan sweeps the area documents and `docs/ARCHITECTURE.md` for every reference to
`docs/setup.md` whose section moves.
