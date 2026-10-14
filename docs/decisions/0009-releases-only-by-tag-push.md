# 0009: Releases only by tag push

- **Status:** Accepted
- **Date:** 2026-10-14
- **Area:** —
- **Source:** Issue #2, Issue #3
- **Supersedes:** —

## Context

Users deploy Seluna from the repository. A release has to be a deliberate, traceable act, and decision records
become append-only once a `v*` tag contains them. Users should only ever run a release, never an intermediate
state, so a release must not be publishable from a commit that failed the quality gates, that is not on `main`,
or whose `package.json` version disagrees with the tag. The release job needs a token that can write repository
contents; everything else the workflow runs (dependency installation, lint, tests) does not.

## Options considered

1. **Release on every merge to `main`** — always current, but every squash merge would publish, including
   documentation changes.
2. **Release by tag push** — a maintainer pushes `v<major>.<minor>.<patch>` on `main`; the release workflow runs
   from the tag. Chosen.

How the tag-triggered workflow is built:

3. **One job with `contents: write`** — simplest, but `npm ci` and every dev dependency's code would run with a
   token that can create releases and push to the repository.
4. **A read-only verification job and a separate release job** — the verification job (tag format, tag on
   `main`, version match, changelog section, the format, lint, type-check, test and build checks) runs with `contents: read`; only the release job, which installs nothing
   and runs no project code, gets `contents: write`. Chosen.
5. **Creating the release with a third-party release action** — one more external action holding the write
   token. Lost against the GitHub CLI, which is preinstalled on the runner and maintained by GitHub, and which
   prepends a notes file to GitHub's generated notes (`--notes-file` with `--generate-notes`).
6. **Filtering malformed tags only in the trigger pattern** — a tag such as `v0.1` would start no run at all,
   so the maintainer gets no signal. Lost against triggering on `v*` and rejecting a malformed tag in the first
   step with an error, as the issue asks.
7. **Publishing versions below 1.0.0 as GitHub pre-releases** — closer to the semver meaning, but GitHub's
   "latest release" excludes pre-releases, so the daily release check in each instance would see no release
   at all until 1.0.0. Lost: every version is published as a normal release.

## Decision

A release is created only by pushing a `v*` tag on `main`; merging a pull request never publishes a release.
The release workflow publishes only after a read-only job has verified the tag and run the format, lint, type-check, test and build checks (not the dependency audit and
SonarQube jobs of `ci.yml`), and only the job that creates the release holds a write token, after it has
checked that the tag still points to the verified commit. The release steps and checks are documented in
[`CONTRIBUTING.md`](../CONTRIBUTING.md#versioning-and-releases).

## Consequences

Releases are rare and intentional, and the tag is the release boundary for decision records. The daily cron in
each instance compares its version with the latest release, which works from the first 0.x release on because
no release is marked as a pre-release. A tag that fails a check leaves a failed workflow run and no release; the
maintainer deletes the tag, fixes `main` and tags again. The full release path (the GitHub API call) can only be
exercised by pushing a real tag; the checks before it are verified locally.

The check that the tag is on `main` prevents mistakes, not misuse: a tag-triggered run uses the `release.yml` of
the tagged commit, so someone who can push a `v*` tag can also change the workflow. The actual control is a
repository tag ruleset restricting who can push `v*` tags.
