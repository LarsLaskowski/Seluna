# Plan: Document how to uninstall a Seluna instance

Source: Issue #157
Tier: trivial — documentation only, but it needs a `CHANGELOG.md` entry (PR template checklist; #153 logged the guides there), a file the `docs` tier does not allow.
Security areas touched: none

## Problem / root cause

Confirmed: neither guide nor `docs/troubleshooting.md` covers uninstalling.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | Webhooks reach the Worker only from the GitHub App. No webhook is set for the bot. | `docs/troubleshooting.md:127`; `docs/areas/http-routes.md` (`POST /webhook` only) | confirmed |
| 2 | Until the Worker is deleted, its cron keeps sending: it retries pending messages, sends digests and release notices | `wrangler.jsonc:15`; `docs/ARCHITECTURE.md:105` | confirmed |
| 3 | Seluna stores data only in D1 and in Worker secrets: credentials, chat id, settings, pending `outbox` rows, `activity` rows of an unsent digest | `docs/areas/storage.md:19-109`; `docs/areas/deployment.md:42-50` | confirmed |
| 4 | Each push to `main` of the copy deploys again, and the deploy form connected the reader's GitHub account to Cloudflare | `docs/setup.md:40,45`; `docs/areas/deployment.md:12-18` | confirmed |
| 5 | The start page shows the app after **GitHub App:** / **GitHub-App:** | `src/setup/texts.ts:272,512` | confirmed |
| 6 | The new external links (deleting a GitHub App, deleting a repository on GitHub, Cloudflare's GitHub connection) point to the step they describe, and `/deletebot` is BotFather's command | to verify: the Product Manager, in the dry run (AC6), before the review (the session's proxy refused these sites) | unverified |
| 7 | Cloudflare documents deleting a Worker only as a Wrangler command, which the guide's "You type no command" excludes | the Product Manager | confirmed |

## Acceptance criteria

- AC1: `docs/setup.md` gets `## Uninstall` between *Updates* and *If something does not work*, `docs/setup.de.md` `## Deinstallation` in the same position and content. Numbered steps: (1) note the app after **GitHub App:** on the start page, uninstall it on GitHub, then delete it; (2) in Cloudflare, delete the Worker, then its D1 database; (3) send `/deletebot` to @BotFather; (4) delete the copy of the repository and the test repository from step 7, if any. Optional: remove Cloudflare's access to the GitHub account if nothing else uses it; delete the password manager entry for `SELUNA_SECRET`.
- AC2: The section gives each step's reason: the app first (fact 1), the Worker next (fact 2), the repository after the Worker (fact 4). One sentence: if the Worker is already deleted, delete the app now.
- AC3: Before the steps, the section says what is lost (fact 3's data, the Telegram chat, unsent notifications and digest stars and forks) and that a new instance means the whole setup again.
- AC4: Other services' steps follow `docs/CONTRIBUTING.md` *Setup guides* (plain words, no label or menu path of theirs, no "unconfirmed" note, one documentation link per step the service documents in its web interface, none otherwise (fact 7: step 2); existing links reused; German marks English links "(englisch)"). The only quoted Seluna label is fact 5's, verbatim.
- AC5: `README.md:69` and the `CHANGELOG.md` Unreleased *Added* guide entry name the uninstall section; `docs/troubleshooting.md` stays unchanged.
- AC6: The Product Manager runs through the section on a throwaway instance and confirms fact 6.

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1–AC5 | none: documentation only (*Verification without tests*) | — |
| AC6 | manual: Product Manager, throwaway instance of the branch head | — |

## Verification without tests

Steps 4 and 5 and the *Coverage gate* do not apply.

- AC1–AC5: check: the Reviewer reads the diff against each criterion and compares the two guides.
- AC6: manual: Product Manager's dry run before the review (`.squad/routing.md`, *Operator environments and documented procedures*); a link that misses its step gets the Product Manager's replacement.

## Approach

Layout: what is lost (AC3), numbered steps (AC1) with link and reason (AC2), optional steps as bullets, the wrong-order sentence.

## Affected projects and types

See *Documentation updates*.

## Signatures (for the Dev's skeleton)

none

## Test files

none. Call sites: none. Code a unit test cannot cover: none.

## Areas

none (no change in behavior).

## Documentation updates

All owned by the Dev:

- `docs/setup.md` and `docs/setup.de.md`: AC1–AC4.
- `docs/CONTRIBUTING.md:159`: the link is required only where the service documents the step in its web interface; a step it documents only as a command goes without one (AC4, decision 0047).
- `README.md:69`, `CHANGELOG.md` (`[Unreleased]` → *Added*, the guide entry): AC5.
- Sweep: no area document, `docs/ARCHITECTURE.md` or troubleshooting enumerates guide sections.

## Architecture check

No guarantee touched.

## Security considerations

- [x] no limits
- [x] none

## Decision records

none: documents existing behavior under decision 0047.

## Out of scope / follow-ups

- A troubleshooting entry: AC2's sentence covers a wrong order.

## Amendments

| Criterion | Change | Reason | Step | Decided by |
| --------- | ------ | ------ | ---- | ---------- |
| AC4 | a link only where the service documents the step in its web interface; step 2 goes without one | fact 7; a menu path instead breaks the plain-words rule | 8 | Lead |
