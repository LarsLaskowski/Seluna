# 0009: Releases published as a pre-release and promoted by the release workflow

- **Status:** Accepted
- **Date:** 2026-10-14
- **Area:** —
- **Source:** Issue #2, Issue #3
- **Supersedes:** —

## Context

Users deploy Seluna from the repository. A release has to be a deliberate, traceable act, and decision records
become append-only once a `v*` tag contains them. Users should only ever run a release, never an intermediate
state, so a release must not become the latest release from a commit that failed the quality gates, that is not
on `main`, or whose `package.json` version disagrees with the tag. Changing a release needs a token that can
write repository contents; everything else the workflow runs (dependency installation, lint, tests) does not.
The maintainer writes the text of each release and creates releases and tags on GitHub's release page, without a
console. GitHub starts no workflow for a draft release and creates a draft's tag only when it is published.

## Options considered

1. **Release on every merge to `main`** — always current, but every squash merge would publish, including
   documentation changes.
2. **A deliberate release of a `v<major>.<minor>.<patch>` tag on `main`, verified by a release workflow** —
   Chosen.

How the release is started and published:

3. **Tag push from a console, the workflow publishes the release** — verified before anything is public, but
   needs a console, and the release text is always the changelog section plus generated notes.
4. **Tag push from a console, the workflow creates a draft that the maintainer edits and publishes** — verified
   before anything is public and the text is the maintainer's, but needs a console for every release.
5. **Full release on the release page, the workflow only verifies** — no console, but the release is the latest
   release, and is reported to every instance, before its checks have run.
6. **Draft on the release page, the workflow started by hand (`workflow_dispatch`) verifies and publishes it** —
   nothing is public before the checks, but every release needs a second, manual step in the Actions tab.
7. **Pre-release on the release page, the workflow started by publishing verifies and promotes it** — no
   console and no second step; until the checks pass the release is only a pre-release, which the instances'
   release check does not see. Chosen.

How the workflow is built:

8. **One job with `contents: write`** — simplest, but `npm ci` and every dev dependency's code would run with a
   token that can change releases and push to the repository.
9. **A read-only verification job and a separate promotion job** — the verification job (tag format, tag on
   `main`, version match, changelog section, the format, lint, type-check, test and build checks) runs with
   `contents: read`; only the promotion job, which installs nothing and runs no project code, gets
   `contents: write`. Chosen.
10. **Changing the release with a third-party release action** — one more external action holding the write
    token. Lost against the GitHub CLI, which is preinstalled on the runner and maintained by GitHub.
11. **Filtering malformed tags only in a trigger pattern** — a tag such as `v0.1` would start no run at all, so
    the maintainer gets no signal. Lost against running on every published release and rejecting a malformed
    tag in the first step with an error.
12. **Keeping versions below 1.0.0 as GitHub pre-releases** — closer to the semver meaning, but GitHub's "latest
    release" excludes pre-releases, so the daily release check in each instance would see no release at all
    until 1.0.0. Lost: the pre-release state only lasts while the workflow checks a release; every finished
    version is a normal release.

## Decision

The maintainer publishes each release on GitHub's release page as a pre-release with a new `v*` tag on `main`;
merging a pull request never publishes a release. The release workflow runs on the published release, verifies
the tag (format, on `main`, matching `package.json` version, changelog section) and runs the format, lint,
type-check, test and build checks (not the dependency audit and SonarQube jobs of `ci.yml`) with
`contents: read`, and only then, in a separate job with `contents: write` that has checked the tag still points
to the verified commit and the release is still a pre-release, turns it into the latest full release without
changing its text. The steps are in [`CONTRIBUTING.md`](../CONTRIBUTING.md#versioning-and-releases).

## Consequences

Releases are rare and intentional, need no console, and the release text is the maintainer's; the tag is the
release boundary for decision records. A release whose checks fail stays visible on the releases page as a
pre-release until the maintainer deletes it and its tag; it never becomes the latest release, so no instance
reports it. A tag pushed from a console without a release starts nothing, and a release published without the
pre-release flag is checked but already public, which the workflow warns about. The promotion path (the GitHub
API call) can only be exercised by publishing a real release; the checks before it are verified locally.

The check that the tag is on `main` prevents mistakes, not misuse: a release-triggered run uses the
`release.yml` of the tagged commit, so someone who can create a `v*` tag can also change the workflow. The
actual control is a repository tag ruleset restricting who can create `v*` tags.
