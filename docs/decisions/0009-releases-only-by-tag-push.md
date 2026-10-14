# 0009: Releases only by tag push

- **Status:** Accepted
- **Date:** 2026-10-14
- **Area:** —
- **Source:** Issue #2
- **Supersedes:** —

## Context

Users deploy Seluna from the repository. A release has to be a deliberate, traceable act, and decision records
become append-only once a `v*` tag contains them.

## Options considered

1. **Release on every merge to `main`** — always current, but every squash merge would publish, including documentation changes.
2. **Release by tag push** — a maintainer pushes `v<major>.<minor>.<patch>` on `main`; the release workflow runs from the tag.

## Decision

A release is created only by pushing a `v*` tag on `main`. Merging a pull request never publishes a release.

## Consequences

Releases are rare and intentional, and the tag is the release boundary for decision records. The daily cron in each instance compares its version with the latest release.
