# 0017: Releases created by hand, verified by the release workflow

- **Status:** Accepted
- **Date:** 2026-10-16
- **Area:** —
- **Source:** Failed release workflow run for v0.1.0
- **Supersedes:** 0009

## Context

[Decision 0009](0009-releases-only-by-tag-push.md) let the release workflow create the GitHub release from the
changelog section once its checks had passed. The maintainer creates the tag and the release by hand on GitHub
instead, to write the release text themselves. Creating a release there creates the tag at the same moment, the
tag push starts the workflow, and its release job failed with "Release.tag_name already exists" although every
check had passed. A release has to stay a deliberate act on `main`, and the daily release check in each instance
still needs a normal (non-pre-release) GitHub release for every version.

## Options considered

1. **Keep 0009 and push only the tag** — the workflow keeps publishing after its checks, but the release text is
   always the changelog section plus generated notes; the maintainer loses control over it.
2. **Workflow creates a draft release that the maintainer edits and publishes** — keeps the checks before
   publishing, but changes the maintainer's way of releasing and still fails when the release is created by hand.
3. **Workflow updates an existing release** — overwrites the text the maintainer wrote.
4. **Workflow only verifies; tag and release are created by hand** — matches how releases are made; the checks
   run right after publishing instead of before it. Chosen.

## Decision

The maintainer creates the `v*` tag on `main` and the GitHub release by hand and writes its text. The release
workflow runs on the tag push with `contents: read` only, verifies the tag and runs the checks, and creates
nothing. The steps are in [`CONTRIBUTING.md`](../CONTRIBUTING.md#versioning-and-releases).

## Consequences

The release text is fully under the maintainer's control, and no workflow job holds a write token any more. A
release is published before its checks have run: a failed run means a published release of a broken commit, which
the maintainer deletes together with its tag before fixing `main` and releasing again. Every version is still
published as a normal release, so the daily release check keeps working. As before, the "on `main`" check only
catches mistakes; a tag ruleset restricting who can create `v*` tags is the actual control.
