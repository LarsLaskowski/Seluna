# Plan: Setup documentation, troubleshooting and the path to 1.0.0

Source: [spec.md](spec.md)
Status: Revised (3)
Tier: trivial — documentation and screenshots only, with a decision record; no production, test, configuration or workflow file.
Security areas touched: none
Plan size: the Product Manager's AC7 decisions need an exact removal list across ten documents for the Dev (G3).

## Problem / root cause

Feature: see [spec.md](spec.md); scope narrowed after the AC7 dry run (spec, *Amendments*).

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | An owner's own non-draft pull request gives a message (S1's test) | `src/rules/pull-request-opened.ts`, no sender filter; the AC7 run ended with the message | confirmed |
| 2 | The branch holds no code, so the Deploy button (deploys `main`) gives what the head would | orchestrator: `git diff main --stat`, step 7 | confirmed |
| 3 | Screenshots render from `src/setup/pages.ts` outside the Worker | Dev, step 6: rendered and captured (Playwright over Chrome, scratch only) | confirmed |
| 4 | The browser guide runs through as written and is understandable | Product Manager, AC7 dry run on PR #153, 2026-11-07 | confirmed |
| 5 | Cloudflare's deploy form today: connect a Git account, create a (private) repository, project name `seluna`, a new D1 database named `seluna`, location automatic | Product Manager's screenshot of the form, 2026-11-07 | confirmed |
| 6 | Only Seluna's own texts quote **Only select repositories** in the guides' sense | `src/setup/texts.ts:259,262,499,502` | confirmed |
| 7 | AC7's German half: the German pages checked against `docs/setup.de.md` | to verify: Product Manager, confirms or runs it on the G3 head before step 8; the orchestrator logs it | unverified |

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1, AC2, AC4–AC7, AC9 | none: see *Verification without tests* | — |

## Verification without tests

Not applicable: steps 4, 5 and the *Coverage gate*. Early draft PR #153 ("Part of #20", never "Closes #20"). No
second English run after G3: G3 only removes text and loosens third-party wording; the Reviewer checks it.

- AC1: check: Reviewer, step 8 — S1's steps in order, screenshot per Seluna page, link per other service, no shell command, every Seluna quote verbatim in the English table of `src/setup/texts.ts`; N6/N7 as *Documentation updates* states them.
- AC2: check: Reviewer, step 8 — same headings and order as `docs/setup.md`, German quotes from the German table.
- AC4: check: Reviewer, step 8 — one entry per E1–E8, quotes found in `docs/areas/http-routes.md`, `docs/areas/setup-wizard.md` or `src/setup/texts.ts`; no traces advice without the bot-token warning; N6.
- AC5: check: Reviewer, step 8 — rules of `src/rules/registry.ts` plus release and limit notices, three links, security notes no broader than `.squad/project.md` and `SECURITY.md`, no duration.
- AC6: check: Reviewer opens every image, step 8; Product Manager confirms, step 9.
- AC7: manual: Product Manager, done in English on PR #153 (fact 4); German half fact 7.
- AC9: check: Reviewer, step 8 — both rules in the `releases` block of `docs/CONTRIBUTING.md`.

## Approach

G1–G2 are built; G3 applies the Product Manager's decisions. N6 in practice: a step on another service says what
the reader does and why ("create a new private repository with a README", "open a pull request from your change, not
as a draft", "the app's webhook deliveries on GitHub") and links that service's documentation of the step; no bold or
quoted label of the service, no menu path, no `_Not yet confirmed …_` note. Seluna's own labels stay quoted.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| docs | `docs/setup.md`, `docs/setup.de.md`, `docs/troubleshooting.md`, `docs/assets/setup/` | rewritten / new |
| docs | `docs/manual-setup.md` | deleted (G3) |
| docs | `README.md`, `docs/CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/areas/deployment.md`, `CHANGELOG.md` | sweep |

## Signatures (for the Dev's skeleton)

none

## Test files

none (no code).

## Areas

[Deployment](../../docs/areas/deployment.md): the *Manual deployment* subsection added in G2 is removed again (G3).

## Documentation updates

G3, Dev, against the head (line numbers of 46641cc):

- `docs/manual-setup.md`: delete.
- `docs/setup.md` and `docs/setup.de.md` alike: line 5, drop the manual-setup sentence; line 7, delete the paragraph
  on _Not yet confirmed_ notes; delete the notes on lines 24, 49, 106, 121, 150; line 85, link
  [Worker secrets](areas/deployment.md#worker-secrets) instead of the manual setup; rewrite N6-wise the other
  services' steps: step 1 items 1–2, step 3 items 2–4 (fact 5 says what the form does, in plain words; the
  deploy-command check stays, as "the deploy command in the Worker's build settings"), step 6 item 3, step 7 items
  1–3, step 9 items 1–4. Keep the 15-minute sign-in lock (behavior, not a setup duration).
- `docs/troubleshooting.md`: line 3, drop the manual-setup clause; lines 8–9 and 11, name the delivery log and the
  build log N6-wise and drop the "menus … may differ" sentence; remove TOC line 24 and the section from line 176; line
  51, drop the `wrangler secret put` sentence; lines 106 and 111, drop the hand-made-app cause and fix; line 123,
  "set all three Worker secrets if you use them"; rewrite N6-wise the GitHub and Cloudflare click paths on lines 36–38,
  83, 90–91, 112–113, 173–174 (headings "GitHub's Recent Deliveries show …" become "GitHub's webhook deliveries show
  …", anchors updated where linked).
- `README.md`: line 29, drop "The aim is a working setup in under 15 minutes."; line 69, drop the manual-setup sentence.
- `docs/CONTRIBUTING.md`, *Setup guides*: add that other services' steps are described without depending on their
  labels, with a link to their documentation (decision 0047).
- `docs/ARCHITECTURE.md:182`: drop the added sentence on deploying by hand.
- `docs/areas/deployment.md`: delete *Manual deployment* (lines 24–36); the 0047 entry under *Related decisions*
  reads "the setup guides (English and German) with screenshots".
- `CHANGELOG.md` `Unreleased`: drop the manual-setup clause.
- `docs/update.md`: no change, unless step 3's heading changes (then the two `setup.md#3-deploy-to-cloudflare` anchors).

## Architecture check

No guarantee touched: no code or configuration.

## Security considerations

- [x] no limits.
- [x] none.

## Security review

Security approved Revised (1). Its two areas (Encrypted credentials, Minimal GitHub App permissions) came in only
through `docs/manual-setup.md`; the README's security notes describe existing controls without changing them. Its findings B1, B2 and N3 concerned `docs/manual-setup.md` only and fall with it; N1
(bot-token warning in troubleshooting) and N2 (README security notes) stay, checked by AC4 and AC5. With no security
area touched, no new plan review is due.

## Decision records

- [`docs/decisions/0047-setup-guides-screenshots-and-languages.md`](../../docs/decisions/0047-setup-guides-screenshots-and-languages.md) (Proposed; edited in place: manual setup and label-quoting as rejected options)

## Out of scope / follow-ups

External setup test, one week of use and v1.0.0: Product Manager after the merge; #20 stays open. Uninstalling an
instance: a follow-up issue (Lead decision, see result).
