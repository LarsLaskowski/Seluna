# Spec: Update workflow for users' copies

Source: Issue #19
Status: Draft

## Problem

Every owner runs an independent copy of `LarsLaskowski/Seluna` that the Deploy to Cloudflare button created in the
owner's GitHub account, not a fork ([decision 0013](../../docs/decisions/0013-deploy-to-cloudflare-and-workers-builds.md)):
a new release never reaches it by itself. Since the daily release check
([decision 0030](../../docs/decisions/0030-release-notice-without-credentials.md)) the owner is told that a release
exists, but `docs/setup.md` (_Updates_) only says that every push to `main` of the copy deploys; how a release gets
into `main` is not described, and doing it means fetching the upstream tag and merging it with Git on a command line,
which the setup promises the owner never needs. Owners stay on old versions, and the database migrations a release
brings never reach their D1 database.

## Scenarios

- S1: Given a copy on release `vX` that contains the update workflow, its Workers Build set to `npm run deploy`, and a
  newer latest release `vY` of `LarsLaskowski/Seluna` in the same major version, when the owner opens **Actions →
  Update Seluna → Run workflow** on `main` and starts it, then the run brings `vY` into `main` of the copy with one
  push, ends green with the summary `Updated Seluna from vX to vY.`, and Workers Builds builds that push, applies the
  release's new migrations and deploys it, so `/health` answers with version `Y`.
- S2: Given a copy whose `main` already contains the latest release, when the owner runs the workflow, then the run
  ends green with the summary `Seluna is already on the latest release vY; nothing to update.` and pushes nothing, so
  no build starts.
- S3: Given the original repository `LarsLaskowski/Seluna` (name compared without regard to case), when anyone runs
  the workflow there, then it ends green with the summary
  `This is the original repository LarsLaskowski/Seluna; it is not updated by this workflow.`, reads no release and
  pushes nothing.
- S4: Given a copy with local changes in files the release does not change in the same lines — the D1 database id
  the button wrote into `wrangler.jsonc` among them — when the owner runs the workflow, then the release is applied
  as in S1 and every local change is still in `main` afterwards.
- S5: Given a copy on `v0.4.0` or earlier, which has no update workflow, when the owner follows `docs/update.md`, then
  the guide has them add `.github/workflows/update.yml` with the content of the latest release in GitHub's web
  interface (**Add file → Create new file**), without a command line, and run it as in S1.
- S6: Given a latest release whose major version is higher than the copy's, when the owner runs the workflow with the
  checkbox **Allow a new major version** left off (its default), then the run fails with
  `Release vY is a new major version (copy on vX). Read its release notes and docs/update.md, then run the workflow again with "Allow a new major version" checked.`
  and changes nothing; started with the checkbox on, it updates as in S1.
- S7: Given a release `vY` that adds, changes or removes files under `.github/workflows/` compared with `vX` (as the
  release after `v0.4.0` does: `codeql.yml` and `release.yml` changed, `update.yml` added), when the owner runs the
  workflow, then everything else of the release is applied as in S1, every file under `.github/workflows/` of the
  copy stays exactly as it was (none added, changed or removed), and the run still ends green with the summary of S1
  followed by
  `The release changed these workflow files, which your copy keeps as they are: <file>, <file>. See docs/update.md, "Workflow files".`
  The list names each such file whose content in the copy differs from the release's (a file the owner already took
  over is not listed); when none differs, the line is left out.
- S8: Given the summary of S7 names `update.yml`, when the owner follows `docs/update.md` (_Workflow files_), then the
  guide has them open the file in the release on GitHub, copy its content and paste it over the copy's file in
  GitHub's web interface (**Edit file → Commit changes** on `main`), without a command line and without a token; the
  next run uses the new workflow. The guide says the same steps take over any other listed file, and that the other
  workflow files only serve the original repository's own checks and releases, so keeping them is safe.

## Errors and edge cases

- E1: A local change in the copy and the release change the same lines of a file: the run fails with
  `The update to vY conflicts with changes in your copy: <file>, <file>. Nothing was changed. See docs/update.md, "Conflicts".`
  naming every conflicting file, and `main` is left exactly as it was (no push, no branch, no commit).
- E2: The upstream repository cannot be read (GitHub outage, a refused request) or has no latest release: the run
  fails with `Could not read the latest Seluna release: <reason>. Nothing was changed; run the workflow again later.`
  and pushes nothing. `<reason>` is a fixed text chosen by the workflow, never text from the answer.
- E3: The latest release's tag is not exactly `vA.B.C` (each part a whole number without leading zeros), or its tag
  cannot be fetched: the run fails with `The latest Seluna release has no usable version tag. Nothing was changed.`
  and pushes nothing; no part of the tag is printed.
- E4: The copy's `package.json` version is not `A.B.C`, or is newer than the latest release (a copy built from
  upstream `main` between releases): the run fails with
  `Your copy's version cannot be compared with the latest release vY. Nothing was changed. See docs/update.md.`
  and pushes nothing; the version from `package.json` is not printed.
- E5: `main` of the copy changes while the run works (the owner commits on GitHub, a second run pushed first): the
  push is refused rather than overwriting it, and the run fails with
  `main of your copy changed during the update. Nothing was changed; run the workflow again.` — the workflow never
  force-pushes and never rewrites history.
- E6: Two runs started at once: they run one after the other, never in parallel; the second then ends as in S2.
- E7: The workflow is started on a branch other than `main`: the run fails with
  `Start the update on the main branch.` and changes nothing.
- E8: GitHub refuses the push for lack of permission (the repository or organization limits the workflow token to
  read access): the run fails with
  `GitHub refused the push: the workflow may not write to this repository. See docs/update.md, "Permissions".` and
  nothing was changed.
- E9: A copy whose Git history shares no commit with the upstream repository (if the button created it that way,
  see Q2) updates as in S1, S4 and E1: the local changes since the release the copy is on are kept, and a conflict is
  reported, never resolved by taking either side wholesale.
- E10: Workers Builds fails after the push (a migration fails, the deploy command is wrong): the run has already
  ended green and `main` holds the new release; the previously deployed version keeps running
  ([Deployment](../../docs/areas/deployment.md#deploy-command)). `docs/update.md` tells the owner to check the build
  log and the deploy command `npm run deploy` after an update.
- E11: A release removes or renames a file the copy changed locally: reported as a conflict as in E1.
- E12: GitHub Actions is disabled in the copy: there is no **Run workflow** button; `docs/update.md` says how to
  enable Actions for the copy.
- E13: The copy changed a file under `.github/workflows/` locally, and the release changes the same file: no
  conflict is reported (the copy's file is kept as in S7), and the file is listed in the summary line of S7.
- E14: A release removes a workflow file, or the copy has a workflow file the release never had: the copy's file
  stays; a file the release removed is listed in the summary line of S7, one the release never had is not.

## Non-functional requirements

- Security: the run gets only the permission to write the copy's contents, no other secret or credential (no
  token the owner creates, no Actions secret), and never pushes a change under `.github/workflows/`; it installs nothing and runs no code of the release (no `npm`
  install, no project script), so a release's code first runs in Workers Builds, as it does for any push to `main`.
- Source: only the latest full release of `LarsLaskowski/Seluna` (never a pre-release, a draft or upstream `main`),
  the same release the daily release check reports
  ([decision 0030](../../docs/decisions/0030-release-notice-without-credentials.md)); the repository name is fixed in
  the workflow, not an input.
- History: `main` only ever moves forward from the commit the run started on; the run never force-pushes, never
  deletes or rewrites a commit, and makes at most one push.
- Time: a run finishes within 5 minutes on a GitHub-hosted runner; it is billed to the owner's Actions minutes, which
  a public or private personal repository's free allowance covers.
- Compatibility: works for every copy the button created from `v0.1.0` on, once it has the workflow (S5); a fork of
  the original counts as a copy.
- Configuration: one workflow input, **Allow a new major version** (default off); no new Worker secret, binding,
  setting or D1 change, and no change to the Worker's code.
- Logs: the run's messages and summary name versions, file paths and the fixed texts of this spec only; never a
  token, an answer body or a commit message of the release.

## Acceptance criteria

- [ ] AC1: In a copy on a release `vX` with the update workflow, one run with a newer latest release `vY` of the same
  major version leaves `main` with the release's files and `package.json` version `Y`, keeps every local change in
  lines the release does not touch (the D1 database id in `wrangler.jsonc` included), pushes exactly once, ends green
  with `Updated Seluna from vX to vY.`, and the push starts a Workers Build that deploys `Y` (S1, S4, E10).
- [ ] AC2: A run in a copy that already contains the latest release ends green with
  `Seluna is already on the latest release vY; nothing to update.` and pushes nothing (S2, E6).
- [ ] AC3: A run in `LarsLaskowski/Seluna` (any letter case) ends green with the original-repository summary, makes
  no request for the release and pushes nothing (S3).
- [ ] AC4: A release that changes lines the copy also changed (or removes a file the copy changed) ends the run red
  with the conflict message naming every conflicting file, and `main` of the copy is unchanged (E1, E11).
- [ ] AC5: A latest release that cannot be read, or whose tag is not exactly `vA.B.C`, ends the run red with the
  message of E2 or E3, prints no text from the answer, and pushes nothing (E2, E3).
- [ ] AC6: A copy whose `package.json` version is not `A.B.C` or is newer than the latest release ends the run red
  with the message of E4 and pushes nothing (E4).
- [ ] AC7: A newer major version is applied only when the run was started with **Allow a new major version**;
  without it the run ends red with the message of S6 and pushes nothing (S6).
- [ ] AC8: The run never force-pushes; a `main` that changed during the run, a run started on another branch, or a
  push GitHub refuses ends the run red with the message of E5, E7 or E8 and leaves `main` as it was; two runs never
  run at the same time (E5, E6, E7, E8).
- [ ] AC9: A release that adds, changes or removes files under `.github/workflows/` is applied without them: the
  run ends green, every file under `.github/workflows/` of the copy is byte for byte as before, no conflict is
  reported for a workflow file, and the summary line of S7 lists exactly the workflow files the release added,
  changed or removed since `vX` whose content in the copy differs from the release's, and is left out when there is
  none (S7, E13, E14).
- [ ] AC10: A copy whose Git history shares no commit with the upstream repository is updated with the same results
  as AC1 and AC4 (E9).
- [ ] AC11: `docs/update.md` explains, without a command line: starting the update; adding the workflow to a copy
  on `v0.4.0` or earlier; conflicts and how to resolve them on GitHub; a new major version; checking the build and
  the deploy command afterwards; the permission and Actions settings the run needs; and, in a section _Workflow
  files_, why the copy keeps its workflow files and how to take one over by hand in GitHub's web interface, `update.yml`
  first. `docs/setup.md` (_Updates_) links it (S5, S8, E10, E12).

## Out of scope

- Updating automatically on a schedule or on the release notice: the owner starts every update.
- Going back to an older release, or choosing a release other than the latest.
- Pre-releases and upstream `main`.
- Changing the Worker's build settings in Cloudflare (the deploy command stays the owner's check, decision 0020).
- A link from the Telegram release notice to `docs/update.md` (the notice's text is decision 0030's).
- Resolving a conflict for the owner.
- A German version of `docs/update.md` (issue #20 covers the translated guides).
- Applying workflow files with a token the owner creates and saves as an Actions secret (a possible later add-on,
  see Q1); the workflow never changes `.github/workflows/` itself.

## Open questions

- Q1: GitHub refuses any push that creates or changes a file under `.github/workflows/` with a workflow's own token:
  that token (`GITHUB_TOKEN`) has no _Workflows_ permission (GitHub docs, `github-token-scope-descriptions.md` at
  github/docs `5815d11`: no `workflows` entry; `choosing-permissions-for-a-github-app.md`: editing
  `.github/workflows` needs the _Workflows_ permission). The update from `v0.4.0` to the next release already changes
  `codeql.yml` and `release.yml` and adds `update.yml` (`git diff --stat v0.4.0..main -- .github/workflows`), so the
  issue's "merge and push" cannot work with that token. How should the update treat workflow files?
  Answered: by the Product Manager — the copy keeps its own workflow files; the update applies everything else and
  lists the workflow files the release changed, and `docs/update.md` shows how to copy one over by hand, `update.yml`
  above all (S7, S8, E13, E14, AC9, AC11). No token and no extra setup; an owner-created token saved as an Actions
  secret may follow later as an add-on (out of scope).
- Q2: Does a copy the button created share Git history with `LarsLaskowski/Seluna`, so a plain merge has a common
  base? Answered: not documented — Cloudflare's `workers/platform/deploy-buttons` (cloudflare-docs `ef31931`) says
  only that the button "clones your source repository" and updates the Wrangler configuration with the ids of new
  resources. The spec therefore requires both kinds of copy to update (E9, AC10); which kind exists is verified on
  the maintainer's copy from issue #46 when planning.
- Q3: How does a copy on `v0.4.0` or earlier get the workflow, since it ships first with the next release? Answered:
  only a commit in the copy can add it, and neither the Worker nor the upstream repository can write to the copy;
  `docs/update.md` has the owner create the file once in GitHub's web interface (S5).
- Q4: What happens for a new major version? Answered: `docs/CONTRIBUTING.md` (_Versioning and releases_) defines a
  major version as an incompatible change, for example one that needs the setup redone, so the workflow applies one
  only on the owner's explicit choice after the release notes (S6, AC7).
- Q5: Which release is "the latest"? Answered: the latest full release, as GitHub marks it and as the daily release
  check reads it; the release workflow makes a release the latest only after its checks
  ([decision 0009](../../docs/decisions/0009-releases-only-by-tag-push.md), decision 0030).
- Q6: Does Workers Builds deploy a push made by a workflow? Answered: GitHub only stops such a push from starting
  other _workflow_ runs (github/docs `actions-do-not-trigger-workflows.md`); Workers Builds is started by Cloudflare's
  GitHub App, which that rule does not name, so the push is expected to start a build. The plan marks it unverified
  with a live check on a copy (AC1).
- Q7: Does the issue's claim "Workers Builds then deploys, including D1 migrations" hold? Answered: only with the
  deploy command `npm run deploy`, which the owner checks after the button's deploy
  ([decision 0020](../../docs/decisions/0020-deploy-command-checked-in-the-setup-guide.md)); E10 and AC11 cover it.

## Area documents

- [`docs/areas/deployment.md`](../../docs/areas/deployment.md): a new section _Update_ — the workflow, who starts
  it, the release it takes (latest full release, `vA.B.C`), what it keeps (local changes, and every file under
  `.github/workflows/`, listed in the summary when the release changed it), the original-repository and other-branch cases, the major-version checkbox, the conflict and
  the other failures with their messages, no force-push and one run at a time; under _Limits and errors_ the build
  that fails after an update. Its *Scope* and its index row in `docs/areas/README.md` name the update of a copy.
- `docs/update.md` (user guide, not an area document) and `docs/setup.md` (_Updates_) as AC11 lists them;
  `docs/ARCHITECTURE.md` (_Deployment_) names the update path of a copy.
