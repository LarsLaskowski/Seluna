# 0017: Releases published as a pre-release and promoted by the release workflow

- **Status:** Accepted
- **Date:** 2026-10-17
- **Area:** —
- **Source:** Release of v0.1.0
- **Supersedes:** 0009

## Context

Under [decision 0009](0009-releases-only-by-tag-push.md) the maintainer pushes a `v*` tag from a console, and the
release workflow verifies it and creates a draft release. The maintainer wants to create the release and its tag
on GitHub's release page, without a console, and write the release text there. GitHub starts no workflow for a
draft release and creates a draft's tag only when it is published, so a draft created on the page can neither
start nor be verified by a tag-triggered workflow. The requirements of 0009 still hold: a release users see as
the latest must come from a verified commit on `main`, and the daily release check of each instance reads the
latest release, which never is a pre-release.

## Options considered

1. **Keep 0009: tag push from a console, workflow creates a draft** — verified before anything is public, but
   needs a console for every release.
2. **Publish a full release on the page, workflow only verifies** — no console, but the release is the latest
   release, and is reported to every instance, before its checks have run.
3. **Draft on the page, workflow started by hand (`workflow_dispatch`) verifies and publishes it** — nothing is
   public before the checks, but every release needs a second, manual step in the Actions tab.
4. **Pre-release on the page, workflow started by publishing verifies and promotes it** — no console and no
   second step; until the checks pass the release is only a pre-release, which the instances' release check
   does not see. Chosen.

## Decision

The maintainer publishes each release on GitHub's release page as a pre-release with a new `v*` tag on `main`.
The release workflow runs on the published release, verifies the tag (format, on `main`, matching `package.json` version, changelog section) and runs the checks with `contents: read`,
and only then, in a separate job with `contents: write`, turns the pre-release into the latest full release
without changing its text. The steps are in [`CONTRIBUTING.md`](../CONTRIBUTING.md#versioning-and-releases).

## Consequences

Releases need no console and the release text is the maintainer's. A release whose checks fail stays visible on
the releases page as a pre-release until the maintainer deletes it and its tag; it never becomes the latest
release, so no instance reports it. Option 7 of 0009 still holds: every finished release is a normal release. A
tag pushed from a console without a release starts nothing, and a release published without the pre-release
flag is checked but already public, which the workflow warns about. The "on `main`" check still only catches
mistakes; a tag ruleset restricting who can create `v*` tags is the actual control.
