# Spec: Update workflow for users' copies

Source: Issue #19
Status: Approved by Lead

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
  Update Seluna → Run workflow** on `main` and starts it, then the run applies the changes from the copy's base (see
  S9) to `vY` as one new commit on top of `main`, pushes it once, ends green with the summary
  `Updated Seluna from vX to vY.`, and Workers Builds builds that push, applies the release's new migrations and
  deploys it, so `/health` answers with version `Y`. No commit of the upstream repository enters the copy's history.
- S2: Given a copy whose `package.json` version equals the latest release `vY`, when the owner runs the workflow, then
  the run ends green with the summary `Seluna is already on the latest release vY; nothing to update.` and pushes
  nothing, so no build starts.
- S3: Given the original repository `LarsLaskowski/Seluna` (name compared without regard to case), when anyone runs
  the workflow there, then it ends green with the summary
  `This is the original repository LarsLaskowski/Seluna; it is not updated by this workflow.`, reads no release and
  pushes nothing.
- S4: Given a copy the button created, which carries the button's edits — the package `name` in `package.json`, the
  Worker `name` and the `database_name` in `wrangler.jsonc` set to the names the owner chose, the `database_id`
  appended to the `migrations_dir` line, and no file under `.github/workflows/` — and other local changes in lines
  the release neither changes nor borders on, when the owner runs the workflow on a release that changes the
  `version` line next to the package `name` and `compatibility_date` in `wrangler.jsonc`, then the release is applied
  as in S1, the names the owner chose stay as they are without a conflict, and every local change is still in
  `main` afterwards.
- S5: Given a copy on `v0.4.0` or earlier, which has no update workflow, when the owner follows `docs/update.md`, then
  the guide has them add `.github/workflows/update.yml` with the content of the latest release in GitHub's web
  interface (**Add file → Create new file**), without a command line, and run it as in S1.
- S6: Given a copy on major version 1 or higher and a latest release whose major version is higher than the copy's,
  when the owner runs the workflow with the
  checkbox **Allow a new major version** left off (its default), then the run fails with
  `Release vY is a new major version (copy on vX). Read its release notes and docs/update.md, then run the workflow again with "Allow a new major version" checked.`
  and changes nothing; started with the checkbox on, it updates as in S1.
- S7: Given a release `vY` that adds, changes or removes files under `.github/workflows/` compared with `vX` (as `v0.4.0`
  did by changing `codeql.yml` and `release.yml` since `v0.3.0`, and as the release after it does by adding
  `update.yml`), when the owner runs the
  workflow, then everything else of the release is applied as in S1, every file under `.github/workflows/` of the
  copy stays exactly as it was (none added, changed or removed), and the run still ends green with the summary of S1
  followed by
  `The release changed these workflow files, which your copy keeps as they are: <file>, <file>. See docs/update.md, "Workflow files".`
  The list names each file the copy has under `.github/workflows/` whose content differs from the release's or that
  the release removed (a file the owner already took over is not listed, nor is a file the copy does not have, so a
  copy the button created, which has no workflow file but the `update.yml` its owner added, is only ever told about
  `update.yml`); when none is left, the line is left out.
- S8: Given the summary of S7 names `update.yml`, when the owner follows `docs/update.md` (_Workflow files_), then the
  guide has them open the file in the release on GitHub, copy its content and paste it over the copy's file in
  GitHub's web interface (**Edit file → Commit changes** on `main`), without a command line and without a token; the
  next run uses the new workflow. The guide says the same steps take over any other listed file, and that the other
  workflow files only serve the original repository's own checks and releases, so keeping them is safe.
- S9: Given a copy whose `package.json` says `vX` but which the button built from upstream `main` between `vX` and the
  next release (the version stays at the last release until the release pull request, `docs/CONTRIBUTING.md`, so it
  holds `vX` plus later upstream commits), when the owner runs the workflow, then the run takes as the copy's base the
  upstream commit the copy was built from, not the `vX` tag: an upstream change the copy already holds is never
  reported as a conflict, one that upstream revised or reverted before `vY` ends up as `vY` has it, and the update
  ends as in S1. The base of
  every copy is the upstream state it was built from or last updated to: after an update by this workflow, the release
  its own latest update commit on `main` names (a release named in any other commit, such as an upstream commit in a
  fork's history, counts for nothing); otherwise, for a copy sharing history with upstream (a fork), the latest
  upstream commit in its history; otherwise the upstream commit whose files equal the copy's first commit apart from
  `wrangler.jsonc`, `.github/workflows/` and the package `name` in `package.json`.
- S10: Given a copy on `v0.x` and a latest release `v1.0.0`, when the owner runs the workflow without the checkbox,
  then it updates as in S1: `1.0.0` marks the project ready for everyone, not an incompatible change
  (`docs/CONTRIBUTING.md`, _Release plan up to 1.0.0_).

## Errors and edge cases

- E1: A local change in the copy and the release change the same or adjacent lines of a file: the run fails with
  `The update to vY conflicts with changes in your copy: <file>, <file>. Nothing was changed. See docs/update.md, "Conflicts".`
  naming every conflicting file, and `main` is left exactly as it was (no push, no branch, no commit).
- E2: The upstream repository cannot be read (GitHub outage, a refused request) or has no latest release: the run
  fails with `Could not read the latest Seluna release: <reason>. Nothing was changed; run the workflow again later.`
  and pushes nothing. `<reason>` is a fixed text chosen by the workflow, never text from the answer.
- E3: The latest release's tag is not exactly `vA.B.C` (each part a whole number of at most nine digits without leading
  zeros), or its tag
  cannot be fetched: the run fails with `The latest Seluna release has no usable version tag. Nothing was changed.`
  and pushes nothing; no part of the tag is printed.
- E4: The copy's `package.json` version is not `A.B.C`, or is newer than the latest release (a copy built from
  upstream `main` after the release pull request raised the version and before that release was published): the run
  fails with
  `Your copy's version cannot be compared with the latest release vY. Nothing was changed. See docs/update.md.`
  and pushes nothing; the version from `package.json` is not printed.
- E5: `main` of the copy changes while the run works (the owner commits on GitHub, a second run pushed first): the
  push is refused rather than overwriting it, and the run fails with
  `main of your copy changed during the update. Nothing was changed; run the workflow again.` — the workflow never
  force-pushes and never rewrites history.
- E6: Two runs started at once: they run one after the other, never in parallel; the second works from `main` as it
  is when it starts (not as it was when it was queued) and then ends as in S2. GitHub keeps at most one waiting run: a
  third start while one runs and one waits cancels the waiting one, which shows as cancelled, not green, and changes
  nothing.
- E7: The workflow is started on a branch other than `main`: the run fails with
  `Start the update on the main branch.` and changes nothing.
- E8: GitHub refuses the push for lack of permission (the repository or organization limits the workflow token to
  read access): the run fails with
  `GitHub refused the push: the workflow may not write to this repository. See docs/update.md, "Permissions".` and
  nothing was changed. Because the run pushes one commit of its own that changes nothing under `.github/workflows/`
  (S1, S7), GitHub's refusal of upstream commits touching workflow files never arises.
- E9: A copy whose Git history shares no commit with the upstream repository (if the button created it that way,
  see Q2) and a copy that shares it (a fork) update alike, as in S1, S4, S9 and E1: the local changes since the
  copy's base are kept, and a conflict is reported, never resolved by taking either side wholesale.
- E10: Workers Builds fails after the push (a migration fails, the deploy command is wrong): the run has already
  ended green and `main` holds the new release; the previously deployed version keeps running
  ([Deployment](../../docs/areas/deployment.md#deploy-command)). `docs/update.md` tells the owner to check the build
  log and the deploy command `npm run deploy` after an update.
- E11: A release removes or renames a file the copy changed locally: reported as a conflict as in E1.
- E12: GitHub Actions is disabled in the copy: there is no **Run workflow** button; `docs/update.md` says how to
  enable Actions for the copy.
- E13: The copy changed a file under `.github/workflows/` locally, and the release changes the same file: no
  conflict is reported (the copy's file is kept as in S7), and the file is listed in the summary line of S7.
- E14: A release removes a workflow file, adds one, or the copy has a workflow file the release never had: the
  copy's files stay; a file the copy has and the release removed is listed in the summary line of S7, a file the
  copy lacks and one the release never had are not.
- E15: The run cannot find the copy's base (S9): no release applied by this workflow is recorded, no upstream commit
  matches the copy's first commit and its history holds no upstream commit (several matching commits count as found when
  they also agree in `wrangler.jsonc`, and as not found when they differ there). The run fails with
  `The update cannot tell which Seluna version your copy was built from. Nothing was changed. See docs/update.md, "Unknown base".`
  and pushes nothing; it never falls back to the `vX` tag. `docs/update.md` tells the owner to open an issue in
  `LarsLaskowski/Seluna`.
- E16: A tool on the runner fails in a way none of the cases above covers (a Git too old for the update, a full
  disk): the run fails with `The update stopped because of an unexpected error. Nothing was changed.` and pushes
  nothing.

## Non-functional requirements

- Security: the run gets only the permission to write the copy's contents, no other secret or credential (no
  token the owner creates, no Actions secret), and never pushes a change under `.github/workflows/`; it installs nothing and runs no code of the release (no `npm`
  install, no project script), so a release's code first runs in Workers Builds, as it does for any push to `main`.
- Source: only the latest full release of `LarsLaskowski/Seluna` (never a pre-release, a draft or upstream `main`),
  the same release the daily release check reports
  ([decision 0030](../../docs/decisions/0030-release-notice-without-credentials.md)); the repository name is fixed in
  the workflow, not an input.
- History: `main` only ever moves forward from the commit the run started on; the run never force-pushes, never
  deletes or rewrites a commit, makes at most one push, and that push holds exactly one new commit whose parent is
  that start commit — no upstream commit enters the copy's history.
- Time: a run finishes within 5 minutes on a GitHub-hosted runner; it is billed to the owner's Actions minutes, which
  a public or private personal repository's free allowance covers.
- Compatibility: works for every copy the button created from `v0.1.0` on, once it has the workflow (S5); a fork of
  the original counts as a copy.
- Configuration: one workflow input, **Allow a new major version** (default off); no new Worker secret, binding,
  setting or D1 change, and no change to the Worker's code.
- Logs: the run's messages and summary name versions, file paths and the fixed texts of this spec only; never a
  token, an answer body or a commit message of the release. A file path is printed only when it consists of the
  characters `A`-`Z`, `a`-`z`, `0`-`9`, `.`, `_`, `/` and `-` (at most 255); any other path is printed as
  `(a file with an unusual name)`.

## Acceptance criteria

- [ ] AC1: In a copy on a release `vX` with the update workflow, one run with a newer latest release `vY` of the same
  major version leaves `main` with the release's files and `package.json` version `Y`, keeps every local change in
  lines the release neither changes nor borders on and, in a copy the button created, the names the button wrote
  into `package.json` and `wrangler.jsonc` and its `database_id` without a conflict, also when the release changes the
  `version` line next to the package name and `compatibility_date`, pushes exactly once a single new
  commit whose parent is the start commit, ends green with `Updated Seluna from vX to vY.`, and the push starts a
  Workers Build that deploys `Y` (S1, S4, E10).
- [ ] AC2: A run in a copy whose `package.json` version equals the latest release ends green with
  `Seluna is already on the latest release vY; nothing to update.` and pushes nothing; a run queued behind another
  that updated `main` reads the current `main` and ends the same way (S2, E6).
- [ ] AC3: A run in `LarsLaskowski/Seluna` (any letter case) ends green with the original-repository summary, makes
  no request for the release and pushes nothing (S3).
- [ ] AC4: A release that changes lines the copy also changed or lines adjacent to them (or removes a file the copy
  changed) ends the run red
  with the conflict message naming every conflicting file, and `main` of the copy is unchanged (E1, E11).
- [ ] AC5: A latest release that cannot be read, or whose tag is not exactly `vA.B.C`, ends the run red with the
  message of E2 or E3, prints no text from the answer, and pushes nothing (E2, E3).
- [ ] AC6: A copy whose `package.json` version is not `A.B.C` or is newer than the latest release ends the run red
  with the message of E4 and pushes nothing (E4).
- [ ] AC7: For a copy on major version 1 or higher, a newer major version is applied only when the run was started
  with **Allow a new major version**; without it the run ends red with the message of S6 and pushes nothing. A copy
  on `0.x` updates to `1.0.0` without the checkbox (S6, S10).
- [ ] AC8: The run never force-pushes; a `main` that changed during the run, a run started on another branch, or a
  push GitHub refuses, or an unexpected failure ends the run red with the message of E5, E7, E8 or E16 and leaves `main` as it was; two runs never
  run at the same time, and a waiting run cancelled by a third start changes nothing (E5, E6, E7, E8, E16).
- [ ] AC9: A release that adds, changes or removes files under `.github/workflows/` is applied without them: the
  run ends green, every file under `.github/workflows/` of the copy is byte for byte as before, no conflict is
  reported for a workflow file, and the summary line of S7 lists exactly the copy's workflow files whose content
  differs from the release's or that the release removed since the copy's base, and is left out when there is none
  (S7, E13, E14).
- [ ] AC10: A copy whose Git history shares no commit with the upstream repository and a fork are updated with the
  same results as AC1 and AC4 (E9).
- [ ] AC11: A copy built from an upstream commit between `vX` and `vY` (its `package.json` saying `X`) is updated
  from that commit, not from the `vX` tag: an upstream change after `vX` that the copy holds and `vY` revised again
  raises no conflict and ends as in `vY`, one that upstream reverted before `vY` is gone afterwards, and a local
  change is kept as in AC1. A copy updated before by this workflow is updated from the release that update applied
  (S9).
- [ ] AC12: A copy whose base cannot be found ends the run red with the message of E15, pushes nothing and is never
  updated from the `vX` tag instead (E15).
- [ ] AC13: `docs/update.md` explains, without a command line: starting the update; adding the workflow to a copy
  on `v0.4.0` or earlier; in a section _Conflicts_, resolving one in GitHub's web interface by editing each listed
  file so its conflicting lines match the release's, running the workflow again and re-applying the owner's own
  change afterwards; a new major version; a section _Unknown base_ (E15); checking the build and
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
  `.github/workflows` needs the _Workflows_ permission). Releases change workflow files: `v0.4.0` changed `codeql.yml`
  and `release.yml` (`git diff --stat v0.3.0 v0.4.0 -- .github/workflows`), and the next release adds `update.yml`, so
  the issue's "merge and push" cannot work with that token. How should the update treat workflow files?
  Answered: by the Product Manager — the copy keeps its own workflow files; the update applies everything else and
  lists the workflow files the release changed, and `docs/update.md` shows how to copy one over by hand, `update.yml`
  above all (S7, S8, E13, E14, AC9, AC13). No token and no extra setup; an owner-created token saved as an Actions
  secret may follow later as an add-on (out of scope).
- Q2: Does a copy the button created share Git history with `LarsLaskowski/Seluna`, so a plain merge has a common
  base? Answered: not documented — Cloudflare's `workers/platform/deploy-buttons` (cloudflare-docs `ef31931`) says
  only that the button "clones your source repository" and updates the Wrangler configuration with the ids of new
  resources. The spec therefore requires both kinds of copy to update (E9, AC10), and the update never relies on
  shared history: it is one new commit computed from the copy's base (S1, S9). Checked when planning on the
  Product Manager's button copy `LarsLaskowski/selunatest` (public; its Workers Builds log and a clone): its history is
  one commit `source repo import` by `cloudflare[bot]` sharing nothing with upstream; its files equal upstream
  `main` at `f26cad2` (after `v0.4.0`, while `package.json` says `0.4.0`, the case of S9) except `package.json`
  (package `name`), `wrangler.jsonc` (`name`, `database_name`, `database_id` appended to the `migrations_dir` line)
  and `.github/workflows/`, which is missing entirely (S4).
- Q8: How does a copy built from upstream `main` between releases look? Answered: `docs/CONTRIBUTING.md` (_Release
  plan up to 1.0.0_): the `package.json` version stays at the last release until the release pull request, and the
  button clones `main` (`README.md`), so such a copy says `vX` but holds later upstream commits (decision 0030,
  _Consequences_); only between the release pull request and the release is its version newer (E4). S9, E15, AC11
  and AC12 cover it.
- Q3: How does a copy on `v0.4.0` or earlier get the workflow, since it ships first with the next release? Answered:
  only a commit in the copy can add it, and neither the Worker nor the upstream repository can write to the copy;
  `docs/update.md` has the owner create the file once in GitHub's web interface (S5).
- Q4: What happens for a new major version? Answered: `docs/CONTRIBUTING.md` (_Versioning and releases_) defines a
  major version as an incompatible change, for example one that needs the setup redone, so the workflow applies one
  only on the owner's explicit choice after the release notes (S6, AC7). `1.0.0` is the exception: it is tagged when
  issue #20's criteria are met, "nothing else makes a version 1.0.0" (_Release plan up to 1.0.0_), so `0.x` to
  `1.0.0` needs no checkbox (S10).
- Q5: Which release is "the latest"? Answered: the latest full release, as GitHub marks it and as the daily release
  check reads it; the release workflow makes a release the latest only after its checks
  ([decision 0009](../../docs/decisions/0009-releases-only-by-tag-push.md), decision 0030).
- Q6: Does Workers Builds deploy a push made by a workflow? Answered: GitHub only stops such a push from starting
  other _workflow_ runs (github/docs `actions-do-not-trigger-workflows.md`); Workers Builds is started by Cloudflare's
  GitHub App, which that rule does not name, so the push is expected to start a build. The plan marks it unverified
  with a live check on a copy (AC1).
- Q7: Does the issue's claim "Workers Builds then deploys, including D1 migrations" hold? Answered: only with the
  deploy command `npm run deploy`, which the owner checks after the button's deploy
  ([decision 0020](../../docs/decisions/0020-deploy-command-checked-in-the-setup-guide.md)); E10 and AC13 cover it.

## Area documents

- [`docs/areas/deployment.md`](../../docs/areas/deployment.md): a new section _Update_ — the workflow, who starts
  it, the release it takes (latest full release, `vA.B.C`), the base it updates from (the release last applied, or
  the upstream commit the copy was built from) and the one commit it adds, what it keeps (local changes, and every
  file under `.github/workflows/`, listed in the summary when the release changed it), the original-repository and
  other-branch cases, the major-version checkbox (not needed for `1.0.0`), the conflict, the unknown base and the
  other failures with their messages, no force-push and one run at a time; under _Limits and errors_ the build
  that fails after an update. Its *Scope* and its index row in `docs/areas/README.md` name the update of a copy.
- `docs/update.md` (user guide, not an area document) and `docs/setup.md` (_Updates_) as AC13 lists them;
  `docs/ARCHITECTURE.md` (_Deployment_) names the update path of a copy.

## Challenge

- M1 (major; a copy built between releases says `vX` but holds later upstream commits, so the `vX` tag is the wrong
  base): accepted. Confirmed against `docs/CONTRIBUTING.md` (_Release plan up to 1.0.0_: the version "is never raised
  on its own"), decision 0030 (_Consequences_) and the button's URL in `README.md`, which names the repository, not a
  tag. Of the options I chose to find the real base, failing closed when it cannot be found. Accepting the risk
  would leave silent wrong results (reverted upstream code kept), and refusing every such copy would block most
  copies, since the button always clones `main`. New S9 defines the base: the release last applied by the workflow;
  otherwise the upstream commit whose files equal the copy's first commit (`wrangler.jsonc` aside); for a fork, the
  latest upstream commit in its history. New E15 and AC12 fail the run without falling back to the tag. AC11 covers
  S9, Q8 records the facts, and E4's parenthetical now names the window between the release pull request and the
  release. Whether the button's first commit has that form is added to Q2's check on the copy from issue #46.
- m1 (one new commit instead of a merge of upstream commits): accepted. S1 and the *History* requirement now say the
  push holds exactly one new commit whose parent is the start commit, and no upstream commit enters the copy's
  history. S2 and AC2 decide "already on the latest" by the `package.json` version. E8 notes that the workflow-file
  refusal cannot arise, so it is never reported as the permission message. The base for every copy comes from S9
  (the fetched release, not Git ancestry), and E9 and AC10 treat a fork the same way.
- m2 ("same lines" vs. adjacent lines; the button's `wrangler.jsonc` edits): accepted. E1 and AC4 say "the same or
  adjacent lines". S4 and AC1 name the button's `database_id` line after `database_name` and a renamed `name` or
  `database_name`, with the release changing `compatibility_date`.
- m3 (a queued run must read the current `main`; GitHub keeps one waiting run): accepted. E6 says a queued run
  works from `main` as it is when it starts and that a third start cancels the waiting run (shown as cancelled,
  nothing changed). AC2 and AC8 test both.
- m4 (no conflict editor without a pull request): accepted. AC13 names the path `docs/update.md` gives in
  _Conflicts_: edit each listed file in the web interface so its conflicting lines match the release's, run the
  workflow again, then re-apply the owner's own change.
- m5 (`0.x` to `1.0.0` would need the checkbox): accepted and settled from the documentation. `1.0.0` marks issue
  #20's criteria, not an incompatible change (`docs/CONTRIBUTING.md`, "nothing else makes a version 1.0.0"). S6 and
  AC7 now apply the checkbox from major version 1 on, new S10 covers `0.x` to `1.0.0`, and Q4 records the reason.

Fixed while planning (Lead): S7 and Q1 claimed the release after `v0.4.0` changes `codeql.yml` and `release.yml`;
`git diff --stat v0.4.0 HEAD -- .github/` is empty, so both now name `v0.4.0`'s own change since `v0.3.0` and the new
`update.yml`. Added E16 (an unexpected tool failure, covered by AC8), the nine-digit bound of a version part (E3) and
the allow-list for printed paths (*Logs*), which the plan's script needs and the spec lacked.

Plan challenge (Lead, revise): the base rule of S9 now ignores a release named outside the workflow's own update
commits (Security B2), and the first-commit match ignores `.github/workflows/` (m2); E15 fails when several
matching commits differ in `wrangler.jsonc` or the workflow files (m3).

Plan revision after the button copy `LarsLaskowski/selunatest` was read (Lead): the button renames the package in
`package.json` next to the `version` line and removes every workflow file. S4 and AC1 now require the button's names
to survive a version change without a conflict, S9 and Q2 name the package name as ignored, E15 drops the workflow
files from the ambiguity rule, and S7, E14 and AC9 list only workflow files the copy has.
