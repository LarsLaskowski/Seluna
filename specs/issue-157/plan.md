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
| 6 | The new external links (deleting a repository on GitHub, deleting a Worker, deleting a D1 database, Cloudflare's GitHub connection) point to the step they describe, and `/deletebot` is BotFather's command | to verify: the Product Manager, in the dry run (AC6), before the review (the session's proxy refused these sites) | unverified |

## Acceptance criteria

- AC1: `docs/setup.md` gets a section `## Uninstall` between *Updates* and *If something does not work*, and `docs/setup.de.md` gets `## Deinstallation` in the same position with the same content. The section has numbered steps in this order: (1) on the start page, note the app shown after **GitHub App:**, uninstall it from the account on GitHub, then delete it; (2) in Cloudflare, delete the Worker, then its D1 database; (3) delete the bot by sending `/deletebot` to @BotFather; (4) delete the copy of the repository, and the test repository from step 7 if you made one. Two optional steps follow: remove Cloudflare's access to the GitHub account if nothing else uses it, and delete the password manager entry for `SELUNA_SECRET`.
- AC2: The section explains the order. The app goes first because GitHub sends deliveries only through it (fact 1). The Worker goes next because until then its cron still sends messages (fact 2). The repository goes after the Worker, because before that a push to it deploys again. One sentence covers a wrong order: if the Worker is already deleted, delete the app now.
- AC3: Before the steps, the section says what is lost. That is the stored GitHub App credentials and bot token, the Telegram chat and the settings, notifications not yet sent, stars and forks collected for a digest not yet sent, and the Worker secrets. Seluna keeps none of it anywhere else, so a new instance means the whole setup again.
- AC4: Other services' steps follow `docs/CONTRIBUTING.md` *Setup guides* (plain words, no label or menu path of theirs, no "unconfirmed" note, one documentation link per step; existing links reused; German marks English links "(englisch)"). The only quoted Seluna label is fact 5's, verbatim.
- AC5: `README.md:69` names the uninstall section. The Unreleased *Added* entry in `CHANGELOG.md` for the setup guide also mentions the uninstall section. `docs/troubleshooting.md` stays unchanged.
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
- `README.md:69`: after the troubleshooting sentence, add that the setup guide's last sections say how to update and how to uninstall an instance.
- `CHANGELOG.md`, `[Unreleased]` → *Added*, the documentation entry: add "and how to uninstall an instance" to the guide's description.
- Sweep: `docs/troubleshooting.md`, the area documents and `docs/ARCHITECTURE.md` enumerate no guide sections.

## Architecture check

No guarantee touched.

## Security considerations

- [x] no limits
- [x] none

## Decision records

none: documents existing behavior under decision 0047.

## Out of scope / follow-ups

- A troubleshooting entry: a wrong order is fixed by finishing the steps, which AC2 says.
