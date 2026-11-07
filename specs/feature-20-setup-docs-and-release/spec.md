# Spec: Setup documentation, troubleshooting and the path to 1.0.0

Source: Issue #20
Status: Approved by Product Manager

## Problem

Issue #20 (*Goal*) wants a reader without prior knowledge to set up Seluna alone, without a command line. Today's
[`docs/setup.md`](../../docs/setup.md) is a text-only stopgap in English, suggests `openssl` for `SELUNA_SECRET` and
never checks that a message arrives; there is no troubleshooting page. Every dependency of the issue is closed and
released (up to v0.8.0), so the pages the guides describe are final for 1.0.0.

## Scenarios

- S1: Given a reader with a GitHub, a Cloudflare and a Telegram account, a web browser and the Telegram app, when
  they follow `docs/setup.md` from top to bottom, then they create the bot at @BotFather, create a `SELUNA_SECRET`
  without a command line, deploy with **Deploy to Cloudflare**, check the deploy command, open the Worker URL and
  sign in on `/setup`, finish the **Telegram chat** step, the **GitHub App** step and the installation on
  **Only select repositories**, review the settings, and open a test pull request — and receive its Telegram message.
  The test pull request goes into a new private repository with a README that the reader creates on GitHub and adds
  to the installation; they edit a file there and open a pull request from the change (not as a draft). The guide
  warns against testing in the Seluna copy, where merging a change to `main` redeploys the instance. Each step on a
  Seluna page names its controls exactly as the page shows them, shows a screenshot of that page and ends with what
  the reader sees when the step worked. A step on another service (@BotFather, the Cloudflare deploy flow and build
  settings, GitHub's app creation, installation and pull requests, Telegram) says in plain words what the reader does
  there and links that service's own documentation, with no screenshot and without depending on that service's
  labels (N6).
- S2: Given a German-speaking reader, when they open `docs/setup.de.md` (linked from the top of `docs/setup.md` and
  from the README), then they find the same steps in the same order in German, with the setup pages' German labels
  (the pages' **Deutsch** language link) and screenshots of the German pages.
- S4: Given a reader whose setup does not work, when they open `docs/troubleshooting.md` (linked from both guides
  and the README), then they find their symptom as a heading and, under it, how to tell the causes apart (the status
  page, the app's webhook deliveries on GitHub, the Workers build log) and the fix for each.
- S5: Given a visitor of the repository, when they read the README, then it says what Seluna does, offers the Deploy
  button, links the setup guide in English and German and the troubleshooting page, lists every reported event,
  gives the security notes an owner needs (what is stored encrypted, what `SELUNA_SECRET` protects, why *Only select
  repositories*, how to report a vulnerability) and names the license.

## Errors and edge cases

- E1: The Deploy button set the deploy command to `npx wrangler deploy` (decision 0020): the guide's deploy step has
  the reader check the deploy command in the Worker's build settings (with a link to Cloudflare's documentation), and
  the troubleshooting page has the sign-in notice _The database of this instance is missing its tables_ as a symptom.
- E2: The reader's `SELUNA_SECRET` is shorter than 32 characters or missing: the guide says how to create one with a
  password manager's generator first, and the troubleshooting page explains the page `/setup` shows then and points
  to the password-manager way (that page itself also names `openssl rand -hex 32`; no change to it).
- E3: The reader signs in wrongly five times: the troubleshooting page explains the 15-minute lock.
- E4: The GitHub App flow is not finished within one hour, or the reader signed out in between: the guide says so at
  the step, the troubleshooting page has the notice the finish page shows and how to start again (delete the
  half-created app on GitHub).
- E5: No message arrives: the troubleshooting page lists, each checked against the code, a draft pull request, a
  repository not picked for the installation, the notification's switch off (stars and forks off by default), the
  owner's own issues and comments (left out), no bot token saved (notifications wait unsent), a permission or event
  the app or installation lacks (named on the status page), the limit of 20 per kind and hour (one notice), and quiet
  hours (the message arrives without sound, not late).
- E6: GitHub's webhook deliveries of the app show 401 (signature: an old app still installed after a new one was
  created) or 503 (no webhook secret yet): troubleshooting entries per status.
- E7: The bot does not answer `/start`: Seluna never answers in Telegram (it only sends); the troubleshooting page
  says so and points to the Telegram step's chat search and test message instead. The step's own failures are
  entries too: _No chat found_ (24 hours, newest 100 messages) and the conflict when the bot already has a webhook
  set elsewhere.
- E8: The reader changed `SELUNA_SECRET`: the troubleshooting page leads to setting the earlier secret again or to
  **Reset and create the GitHub App again**, then re-entering the bot token and deleting the old app on GitHub.
- E9: A screenshot of a Seluna page would show a private value (bot token, `SELUNA_SECRET`, chat id, e-mail address,
  a real account, Worker subdomain or App ID): it is never published; the pages are rendered with made-up values.
- E10: A setup page or a button label changes in a later release: the guides are correct for the release this
  change ships with; `docs/CONTRIBUTING.md` gains the rule that a change of a setup page's text or look updates both
  guides and their screenshots in the same pull request. Another service changing its pages needs no guide change
  (N6).

## Non-functional requirements

- N1: Reader environment (S1, S2), as the Product Manager answered: a desktop browser and the Telegram app on a phone;
  new or existing free accounts at GitHub, Cloudflare and Telegram; a personal GitHub account; no command line and
  no local tools.
- N2: Every label, notice and page name a guide quotes from a Seluna page is the text of the version it ships with
  (`src/setup/texts.ts`, `src/i18n/`), in the language of the guide.
- N3: Screenshots: of Seluna's own pages only, in English and German, rendered with made-up values and captured with a
  headless browser, no new dependency and no committed generator (decision 0047); one file each under
  `docs/assets/`, with alt text, size limit in the plan; none shows a secret or a private value (E9).
- N4: `docs/setup.md` and `docs/setup.de.md` stay equivalent: same sections, same order, same screenshots or their German
  counterparts; a later change to one changes the other in the same pull request.
- N5: No change to the Worker, its configuration or its behavior; no new setting.
- N6: The documents do not depend on the wording of other services' pages (Product Manager, after the AC7 run): a
  step there says what the reader does and why, and links that service's documentation; it gives no click path
  through that service's menus and no label of it the reader must find verbatim, and no document carries a note that
  a statement was not confirmed by a test run.
- N7: No document states how long the setup takes (Product Manager: it takes as long as the reader needs).

## Acceptance criteria

- AC1: `docs/setup.md` contains the steps of S1 in that order, each with the check that shows it worked; every
  step on a Seluna page has at least one screenshot of that page in English, every step on another service a link
  to that service's documentation, no screenshot and no dependence on its labels; it addresses a personal GitHub
  account, quotes every control and notice of a Seluna page as `src/setup/texts.ts` (English) has it, contains no
  shell command, keeps the deploy-command check the sign-in notice refers to, links `docs/update.md` and
  `docs/troubleshooting.md`, and covers the secret length, the one-hour limit and the test repository and pull
  request of S1 (S1, E1, E2, E4, E5, N1, N2, N3, N6, N7).
- AC2: `docs/setup.de.md` has the same sections in the same order as `docs/setup.md`, quotes the German texts of
  `src/setup/texts.ts`, shows the screenshots of AC1 rendered in German, and the two guides link each other at the
  top (S2, N2, N4).
- AC4: `docs/troubleshooting.md` has one entry per symptom of E1–E8 with cause and fix, every status code, notice
  and page text it quotes matches [HTTP routes](../../docs/areas/http-routes.md) and
  [Setup wizard](../../docs/areas/setup-wizard.md), and it describes steps on GitHub and Cloudflare as AC1 does
  (S4, E1, E2, E3, E4, E5, E6, E7, E8, N6).
- AC5: The README links `docs/setup.md`, `docs/setup.de.md` and `docs/troubleshooting.md`, lists the reported events
  as the rules of `src/rules/registry.ts` plus the release notice (`src/release-check.ts`) and the limit notice
  (`src/limit-notice.ts`), has a security notes section with the points of S5, and states no setup duration (S5, N7).
- AC6: No screenshot or text of the change shows a secret or a private value of a real account: every value a
  screenshot shows is made up for the rendering; checked by the Reviewer and confirmed by the Product Manager at the
  PR approval (E9, N3).
- AC7: Before the documentation is reviewed, the Product Manager (or a stand-in the plan names) runs `docs/setup.md`
  on a new instance deployed with the Deploy button (the change holds no code, so `main` deploys what the branch
  head would), reading the guides of the branch head, and ends with the test pull request's message, then switches the
  pages to **Deutsch** and checks the labels and screenshots of `docs/setup.de.md` against them; every step where the
  run differed from a guide is fixed in both guides (S1, S2, N1).
- AC9: `docs/CONTRIBUTING.md` states that a change of a setup page's text or look updates `docs/setup.md`,
  `docs/setup.de.md` and their screenshots in the same pull request, and that the guides describe other services'
  steps without depending on their labels (E10, N4, N5, N6).

## Out of scope

- The issue's criteria only time and people outside the squad can meet (an external setup test, one week of real
  use, v1.0.0): the Product Manager verifies them after the merge; the pull request refers to #20 without closing it,
  and v1.0.0 is cut by its own release pull request, which also changes the README's *Status*.
- A manual setup with the Wrangler command line or a GitHub App created by hand (the former S3, AC3 and AC8, and
  `docs/manual-setup.md`): dropped by the Product Manager (*Amendments*).
- Guides for the messengers of #70–#73 (they bring their own sections, issue comment of 2026-10-18).
- Any change to the Worker, its configuration or the setup pages; a defect the screenshots reveal (decision 0034,
  *Consequences*) becomes a new issue.
- A German translation of any document other than the setup guide.
- Screenshots of other services (Product Manager, Q4) and a setup for a GitHub organization: the guides address a
  personal account; the wizard's organization choice stays as it is, undocumented in the guides beyond a mention.

## Open questions

- Q1: Which dependencies are still open? Answered: none (#13, #14, #16–#19, #65–#69, #108–#110 closed); the issue's
  *Context* lists fewer events than today's, so the documents list the current set from the code.
- Q2: May a German document live in an English-only repository (`AGENTS.md`)? Answered: yes, `docs/setup.de.md` only —
  [decision 0047](../../docs/decisions/0047-setup-guides-screenshots-and-languages.md).
- Q3: How are the issue's criteria handled that the squad cannot run (external test, one week of use, v1.0.0)?
  Answered: Lead decision — *Out of scope*, verified by the Product Manager after the merge.
- Q4: Who takes the screenshots, of which screens, and what may the guides assume about the reader? Answered: by the
  Product Manager — S1's last sentences, N1 and N3.
- Q5: Can a reader create `SELUNA_SECRET` without a command line? Answered: yes — a password manager's generator; the
  guides name only that way. The not-configured page of `/setup` also names `openssl rand -hex 32`
  (`src/setup/texts.ts`); it stays unchanged.
- Q6: Does an owner's own test pull request give a message? Answered: yes — the pull request rules report an opened
  non-draft pull request whoever opened it (`src/rules/pull-request-opened.ts`); only issues and comments leave the
  owner's own out.
- Q7: Is a manual setup needed, and who runs it? Answered: by the Product Manager after the AC7 run — no, it is
  dropped (*Out of scope*, *Amendments*).

## Area documents

None describes new behavior: the change is documentation only. The plan's *Documentation updates* list every
reference to `docs/setup.md` to sweep and where each part of today's `docs/setup.md` goes.

## Challenge

Spec challenge (1 major, 9 minor), all accepted; the spec text above carries each change.

- M1 (manual setup without environment or run): answered with an environment and a run; the manual setup was later
  dropped by the Product Manager (*Amendments*).
- 1: E5 and E7 list the causes. 2: AC7 checks the German guide. 3: N3. 4: E10 narrowed, AC9 added.
- 5: the sweep of references to `docs/setup.md` is done (tasks G2). 6: AC5 names the notices. 7: S1 names the test
  repository. 8: AC7 recorded the duration; dropped with N7. 9: Q5 corrected; E2 and AC1 reworded.

## Amendments

| Criterion | Change | Reason | Step | Decided by |
| --------- | ------ | ------ | ---- | ---------- |
| AC3 | dropped: no `docs/manual-setup.md` | a fully manual setup is not needed; one path to keep correct | 7 (AC7 dry run) | Product Manager |
| AC8 | dropped: no dry run of a manual setup | follows from AC3 | 7 (AC7 dry run) | Product Manager |
| AC1 | other services' steps without dependence on their labels (N6), no duration (N7), no link to a manual setup | other services change their pages faster than the guides can follow | 7 (AC7 dry run) | Product Manager |
| AC4 | describes GitHub and Cloudflare steps as AC1 does; no manual-setup entry | as AC1 | 7 (AC7 dry run) | Product Manager |
| AC5 | no manual-setup link; no setup duration | as AC3 and N7 | 7 (AC7 dry run) | Product Manager |
| AC7 | no duration recorded; no marking of unconfirmed statements | it takes as long as the reader needs; the run confirmed the guide | 7 (AC7 dry run) | Product Manager |
| AC9 | adds the rule on other services' labels | as AC1 | 7 (AC7 dry run) | Product Manager |
