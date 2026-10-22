# 0031: Update workflow for copies

- **Status:** Proposed
- **Date:** 2026-10-22
- **Area:** Deployment
- **Source:** Issue #19
- **Supersedes:** —

## Context

Every owner runs an independent copy that the Deploy to Cloudflare button made from `main` of
`LarsLaskowski/Seluna` ([0013](0013-deploy-to-cloudflare-and-workers-builds.md)); since the daily release check
([0030](0030-release-notice-without-credentials.md)) the owner learns about a release but has no way to apply it
without Git on a command line. Issue #19 asks for a workflow the owner starts with **Run workflow**. Five constraints
shape it:

- A workflow's own token (`GITHUB_TOKEN`) has no _Workflows_ permission, so GitHub refuses any push that creates or
  changes a file under `.github/workflows/` with it. The Product Manager decided that a copy keeps its own workflow
  files, the run lists the ones a release changed, and the owner copies one over by hand (no token, no extra setup).
- A copy on `v0.4.0` or earlier has no workflow; the owner adds it once by hand in GitHub's web interface, so the
  whole workflow must be one file that works on its own.
- A copy says the last released version in `package.json` but may hold later upstream commits, because the button
  clones `main` and the version is raised only by the release pull request (`docs/CONTRIBUTING.md`). Whether the
  button's copy shares Git history with upstream is not documented.
- The run must not run the release's code: a release's code first runs in Workers Builds, as for any push.
- Dependabot bumps the pinned actions of every workflow weekly; a workflow that uses actions changes in almost every
  release, and the copy would be told to take it over each time.

## Options considered

How the update is built:

1. **One Bash script inside `update.yml`, using only Git, `curl` and `jq` of the runner, no action** — one file to add
   by hand, nothing but this file runs with the write token, and Dependabot has nothing to bump in it. Bash cannot be
   measured by the coverage tool; the script is tested by running it against local Git repositories
   ([0032](0032-node-test-project-for-workflow-scripts.md)). Chosen.
2. **A TypeScript script under the repository, called by a thin `update.yml`** — testable like the rest of the code,
   but a copy on `v0.4.0` would have to add two files by hand, and the update would replace the script while the copy
   keeps its old `update.yml`, so both would drift apart.
3. **`actions/checkout` and a sync action from the marketplace** — less code, but third-party code with the write
   token, a pinned action that changes the workflow file with every Dependabot bump, and the actions merge upstream
   commits.

How the release reaches `main`:

1. **One new commit on top of `main`, computed by a three-way merge from the copy's base to the release with the
   copy's workflow files kept, carrying the trailer `Seluna-Release: vY`** — the push holds no upstream commit, so
   GitHub's workflow-file check never sees one, and history only moves forward. Chosen.
2. **`git merge` of the release tag (the issue's wording)** — the push would carry upstream commits that touch
   workflow files, which GitHub refuses for this token, and needs shared history.

Which state the merge starts from (the base):

1. **The release named by the newest `Seluna-Release` trailer, else the newest common commit with the release (a
   fork), else the upstream commit whose files equal the copy's first commit apart from `wrangler.jsonc`; none of these
   fails the run** — right for a copy built between releases and for both kinds of history. Chosen.
2. **The tag of the version in `package.json`** — wrong for every copy built between releases: upstream changes
   revised later would conflict, reverted ones would stay.

## Decision

The update is one Bash step in `.github/workflows/update.yml` without actions, with `contents: write` only, that
applies the latest full release as one commit on top of `main` from the base found as above, keeps every file under
`.github/workflows/`, and pushes without force. The rules — messages, order of the checks, the base, the listed
workflow files — are in [Deployment](../areas/deployment.md#update).

## Consequences

- `update.yml` is the one file every copy keeps until its owner replaces it; a change to it reaches copies only by
  hand, so it changes rarely, stays free of actions and keeps working with every later release's files
  (`docs/CONTRIBUTING.md`).
- A conflict stops the run; the owner resolves it in GitHub's web interface and runs it again. No pull request or
  branch is created.
- The base search rests on the form of the button's first commit, which no documentation states; a copy whose base
  cannot be found fails with a message (fail closed) and needs the maintainer. The form is checked once on a real
  copy before the pull request is marked ready.
- That Workers Builds deploys a push made with the workflow token is checked on the same copy; GitHub only documents
  that such a push starts no other workflow.
- A fork that the owner also syncs with GitHub's **Sync fork** is not supported beyond what the base rule gives.
