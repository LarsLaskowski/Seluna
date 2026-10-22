# 0032: Node test project for workflow scripts

- **Status:** Proposed
- **Date:** 2026-10-22
- **Area:** —
- **Source:** Issue #19
- **Supersedes:** —

## Context

The update workflow ([0031](0031-update-workflow-for-copies.md)) is a Bash script with many paths (versions,
conflicts, bases, refused pushes). Every test so far runs inside the Workers runtime
(`@cloudflare/vitest-pool-workers`, [0010](0010-istanbul-coverage.md)), which cannot start a process, so it cannot
run Git or Bash. The type check covers `test/` with the Workers types only.

## Options considered

1. **A second Vitest project with the `node` environment for `test/*-workflow.test.ts`, and `@types/node` as a dev
   dependency** — the tests run the script taken from the workflow file against local Git repositories, with the
   upstream URL redirected by Git configuration and `curl` replaced on `PATH`, so no network is used. One more
   dependency and two type sets in one program. Chosen.
2. **Only a live run on a copy** — every path would be checked by hand once; regressions would go unnoticed.
3. **A Bash test framework (bats)** — a new toolchain outside the stack, not run by `npm test`.

## Decision

`vitest.config.ts` defines two projects: the Workers project for every existing test and a `node` project for the
tests of workflow scripts; both run with `npm test` and the coverage run. The layout is in `.squad/stack.md`
(*Layout*) and `docs/UNIT_TESTS.md`.

## Consequences

- Bash in a workflow is exercised but not measured: Istanbul measures `src/` only, so the coverage gate is
  unchanged and the workflow is outside it without an exclusion.
- These tests need `git` (2.40 or later), `bash`, `jq` on the machine that runs them, as the CI runner and the
  session have.
- Should `@types/node` and the Workers types conflict in one type check, the Node tests get a `tsconfig` of their own
  and the type check runs both.
