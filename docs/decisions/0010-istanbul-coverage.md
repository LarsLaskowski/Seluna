# 0010: Istanbul coverage instead of V8

- **Status:** Superseded by [0033](0033-v8-coverage.md)
- **Date:** 2026-10-14
- **Area:** —
- **Source:** Issue #2
- **Supersedes:** —

## Context

The template's `typescript` profile measures coverage with `@vitest/coverage-v8`. Seluna's tests run in
`@cloudflare/vitest-pool-workers`, inside the Workers runtime, which does not support V8 coverage.

## Options considered

1. **Run the tests in Node.js with V8 coverage** — supported coverage, but D1, `crypto.subtle` and the `fetch` handler would be tested against fakes of the runtime instead of the runtime.
2. **Workers pool with Istanbul coverage (`@vitest/coverage-istanbul`)** — tests run in the real runtime; the code is instrumented, which is slower and counts lines slightly differently, but lcov output feeds the same gates.

## Decision

Coverage is measured with `@vitest/coverage-istanbul` (lcov) while tests run in the Workers pool. This deviates from the `typescript` profile, which names `@vitest/coverage-v8`.

## Consequences

The _Coverage gate_ and SonarQube read the same `coverage/lcov.info`. If the pool gains V8 support, switch back to the profile's default; the stack block of `CLAUDE.md` still names V8, the repository's `.squad/stack.md` states the deviation.
