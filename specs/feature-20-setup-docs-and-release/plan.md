# Plan: Setup documentation, troubleshooting and the path to 1.0.0

Source: [spec.md](spec.md)
Status: Revised (2)
Tier: trivial — documentation and screenshots only, with a decision record; no production, test, configuration or workflow file.
Security areas touched: Encrypted credentials and Minimal GitHub App permissions (`docs/manual-setup.md` sets the Worker secrets and lists a hand-made app's permissions by hand); no security control changes.

## Problem / root cause

Feature: see [spec.md](spec.md).

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | Hand-made app: permissions, events and webhook URL as the manifest builds them | `src/github/manifest.ts:12-32,67` | confirmed |
| 2 | An owner's own non-draft pull request gives a message (S1's test) | `src/rules/pull-request-opened.ts`, no sender filter | confirmed |
| 3 | The branch holds no code, so the Deploy button (deploys `main`) gives what the head would | orchestrator: `git diff main --stat`, step 7 | confirmed |
| 4 | Screenshots render from `src/setup/pages.ts` outside the Worker | Dev, step 6: rendered and captured (Playwright over Chrome, scratch only) | confirmed |
| 5 | `wrangler d1 create seluna` needs no config edit, and `npm run deploy` binds it by name | to verify: Product Manager, AC8 dry run before step 8 | unverified |
| 6 | `wrangler secret put GITHUB_APP_PRIVATE_KEY < <key file>` stores the multi-line PEM unchanged | to verify: Product Manager, AC8 dry run (status page shows the app) | unverified |
| 7 | `npm ci --ignore-scripts` leaves Wrangler working for every command of the guide | to verify: Product Manager, AC8 dry run | unverified |
| 8 | The external documentation links describe today's steps | to verify: Product Manager, AC7/AC8 dry runs | unverified |
| 9 | The browser setup takes under 15 minutes | to verify: Product Manager, AC7 dry run, duration in `log.md` | unverified |

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1–AC9 | none: see *Verification without tests* | — |

Shell procedure of `docs/manual-setup.md`: no test can run it; the guide's design holds each case, checked in the AC8 run:

- (a) all pasted at once: one command per code block; prompting commands stand alone, with a warning;
- (b) one at a time: the intended use, each block followed by what success shows;
- (c) one fails: each step says "stop here" and links troubleshooting; `npm run deploy` stops before deploying when migrations fail (`package.json:19`, `&&`), secrets follow a successful deploy;
- (d) a variable is lost: no shell variables; secrets only at prompts or from a file.

## Verification without tests

Not applicable: steps 4, 5 and the *Coverage gate*. Early draft PR (#153, *Early draft PR*): the dry runs run on its
head before step 8; it says "Part of #20", never "Closes #20".

- AC1: check: Reviewer, step 8 — S1's steps in order, screenshot per Seluna page, link per other service, no shell command, every quote verbatim in the English table of `src/setup/texts.ts`.
- AC2: check: Reviewer, step 8 — same headings and order as `docs/setup.md`, German quotes from the German table.
- AC3: check: Reviewer, step 8 — fact 1, secret names of `docs/areas/deployment.md`, the manual-path rules of *Manual deployment* there, the bot-token warning.
- AC4: check: Reviewer, step 8 — one entry per E1–E8, quotes found in `docs/areas/http-routes.md`, `docs/areas/setup-wizard.md` or `src/setup/texts.ts`; no traces advice without the bot-token warning.
- AC5: check: Reviewer, step 8 — rules of `src/rules/registry.ts` plus release and limit notices, four links, security notes no broader than `.squad/project.md` and `SECURITY.md`.
- AC6: check: Reviewer opens every image, step 8; Product Manager confirms, step 9.
- AC7: manual: Product Manager, dry run on PR #153's head before step 8; result, duration and deviations in `log.md`.
- AC8: manual: Product Manager, dry run on the latest release tag alongside AC7; deviations fixed by the Dev.
- AC9: check: Reviewer, step 8 — the rule in the `releases` block of `docs/CONTRIBUTING.md`.

## Approach

Built (G1–G2); the documents are the layout. Screenshots: `docs/assets/setup/<en|de>/<nn>-<name>.png`, 11 per
language, same names, 1280 px viewport, at most 300 KB each, made-up values only. Dev deviations accepted: Playwright
instead of Chrome's `--screenshot` flag (nothing committed); AC3's "record its id" not needed (fact 5, decision 0047
option 5).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| docs | `docs/setup.md`, `docs/setup.de.md`, `docs/manual-setup.md`, `docs/troubleshooting.md`, `docs/assets/setup/` | rewritten / new |
| docs | `README.md`, `docs/CONTRIBUTING.md`, `docs/update.md`, `docs/ARCHITECTURE.md`, `docs/areas/deployment.md`, `CHANGELOG.md` | sweep |

## Signatures (for the Dev's skeleton)

none

## Test files

none (no code).

## Areas

[Deployment](../../docs/areas/deployment.md): *Manual deployment* (done).

## Documentation updates

Done (G2); dry-run deviations go into both guides.

## Architecture check

No guarantee touched: no code or configuration; secrets stay Cloudflare's encrypted Worker secrets.

## Security considerations

- [x] no limits.
- [x] none.

## Security review

Approved at the delta review: B1 (generated webhook secret) and B2 (release tag only, `npm ci --ignore-scripts`
before login) accepted, N1–N3 taken; all stand in `docs/areas/deployment.md` (*Manual deployment*), checked by AC3 and AC4.

## Decision records

- [`docs/decisions/0047-setup-guides-screenshots-and-languages.md`](../../docs/decisions/0047-setup-guides-screenshots-and-languages.md) (Proposed)

## Out of scope / follow-ups

External setup test, one week of use and v1.0.0: Product Manager after the merge; #20 stays open.
