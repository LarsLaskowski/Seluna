# Plan: Recovering from a failed update without a command

Source: Issue #165
Tier: trivial — documentation only, but it corrects the same claim in an area document (`docs/areas/deployment.md`), which the `docs` tier excludes.
Security areas touched: none

## Problem / root cause

`docs/update.md:47` and `docs/areas/deployment.md:190` say the update commit can be reverted, but GitHub's web
interface reverts merged pull requests only (fact 1) and the guide promises no command (`docs/update.md:3`). The
working recovery rests on fact 3, which the guide does not state.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | GitHub's web interface offers no revert for a commit pushed directly to `main`, only for a merged pull request (issue's claim) | to verify: the Product Manager opens a direct commit on `main` of a copy and confirms it offers no revert, before step 9. docs.github.com refused (403); the `github/docs` source documents a web revert for merged pull requests only, a commit revert for GitHub Desktop only | unverified |
| 2 | The update commit is pushed directly to `main`, no pull request | `docs/areas/deployment.md:136-140`; decision 0031 | confirmed |
| 3 | A failed Workers Build after an update leaves the previously deployed version running | `docs/areas/deployment.md:188-190` | confirmed |
| 4 | A build can be retried in the Cloudflare dashboard | `cloudflare-docs` source `workers/ci-cd/builds/troubleshoot.mdx`; `docs/troubleshooting.md:37` | confirmed |
| 5 | A later run of the update workflow updates from the release `main` holds, so a fixed release applies over a failing one | `docs/areas/deployment.md:116-120` (base rule 1) | confirmed |
| 6 | `docs/update.md` gives other services' steps in plain words with a link, no labels | `docs/CONTRIBUTING.md:160` | confirmed |

## Acceptance criteria

- AC1: `docs/update.md` no longer says that the update commit can be reverted on GitHub; it says that GitHub's web
  interface undoes merged pull requests only, not the update commit, which the workflow pushes directly to `main`.
- AC2: `docs/update.md` has a section on a failed build after an update that tells the owner, without any command:
  the version that ran before keeps running; open the failed build's log (link to Cloudflare's build documentation);
  when the deploy command is not `npm run deploy`, set it and retry the build; when the release itself fails to
  build, leave `main` as it is, open an issue in the original repository with the error from the log, and run the
  update again once a newer release is out; until a build succeeds, no later commit to `main` goes live either. Fact 6 applies.
- AC3: `docs/areas/deployment.md` (*Limits and errors*) no longer says the owner can revert the update commit; it
  says GitHub's web interface offers no revert for it and links the section of AC2.

## Tests per criterion

None: every criterion is verified under *Verification without tests*.

## Verification without tests

Documentation only: steps 4, 5 and the *Coverage gate* are not applicable.

- AC1: check: Reviewer reads `docs/update.md`; `grep -n -i revert` hits only *Unknown base*. Fact 1 is confirmed by the Product Manager before step 9.
- AC2: check: Reviewer reads the new section against facts 3–6.
- AC3: check: Reviewer reads *Limits and errors* of `docs/areas/deployment.md`.

## Approach

Layout: a new `##` section *If the build fails* after *After the update*, before *Permissions*: a paragraph on what
keeps running, a numbered list (open the log; deploy command case; failing release case), then the sentence on later
commits. Step 2 of *After the update* ends with "If the build fails after an update, see _If the build fails_." in
place of the revert sentence. No dry run: fact 1 is the only statement no run has shown.

## Options considered

- Roll back to the previous Worker version in the Cloudflare dashboard: lost — after a failed build the previous
  version still runs; a rollback leaves D1 migrations applied (`cloudflare-docs` `rollbacks.mdx`).
- Revert with GitHub Desktop: lost — an application to install, against the guide's web-only promise.
- Let the workflow open a pull request, so GitHub's revert applies: lost — a behavior change against decision 0031.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| docs | `docs/update.md`, `docs/areas/deployment.md`, `CHANGELOG.md` | AC1–AC3, entry |

## Signatures (for the Dev's skeleton)

None: no code changes.

## Test files

None. Existing test call sites affected: none. Files no unit test can cover: none.

## Areas

Deployment (`docs/areas/deployment.md`): the revert sentence of *Limits and errors* replaced (AC3).

## Documentation updates

Sweep (`grep -rn -i revert docs README.md`): beyond the two lines changed, only `docs/update.md:81` and decision
0031, both unrelated.

- `docs/update.md`, `docs/areas/deployment.md`: as the criteria say (Dev).
- `CHANGELOG.md`, *Unreleased* / *Changed*: one line — the update guide says how to recover from a failed build
  after an update without a command, instead of reverting the update commit on GitHub (Dev).

## Architecture check

None touched.

## Security considerations

- [x] no limits
- [x] none

## Decision records

- none: no decision beyond the correction.

## Out of scope / follow-ups

- Undoing an update whose build succeeded but whose version misbehaves; the old version running against migrations
  applied before a failed deploy step (see the Lead's result).
