# 0033: V8 coverage under the Workers test plugin

- **Status:** Proposed
- **Date:** 2026-10-23
- **Area:** —
- **Source:** Issue #95
- **Supersedes:** [0010](0010-istanbul-coverage.md)

## Context

[0010](0010-istanbul-coverage.md) chose `@vitest/coverage-istanbul` because `@cloudflare/vitest-pool-workers` could
not run V8 coverage inside the Workers runtime, and said to return to the `typescript` profile's
`@vitest/coverage-v8` once the test integration supports it. Its successor `@cloudflare/vitest-plugin` (adopted in
PR #97) does: with `coverage.provider: "v8"` it adds the compatibility flags `nodejs_inspector_module` and
`nodejs_inspector_local_dev` to the test runner worker only (`ensureFeature` in its pool), never to
`wrangler.jsonc` or the deployed Worker.

Measured on the same commit (`a914f41`, Node.js 22 in a scratch copy, 68 files, 2950 tests): both providers
report 69 production files and the same covered lines, 1942 of 2001 (97.1 %) in the _Coverage gate_; functions
384 of 390 in both; branches 1445 (Istanbul) and 1446 (V8) of 1509, the one difference being a destructuring
default in `src/setup/language.ts` that never applies and that V8 counts as taken. Wall time of
`npm run coverage:lcov` was 80.4 s and 80.3 s with Istanbul, 83.5 s and 76.4 s with V8, a plain `npm test`
84.9 s: no difference beyond run-to-run noise. SonarQube's coverage can only be read from the CI analysis of the
pull request.

## Options considered

1. **Keep Istanbul** — nothing to change, but the deviation from the profile stays, recorded in `.squad/stack.md`,
   0010 and the instruction files, for a reason that no longer holds; the tests keep running on instrumented code.
2. **Switch to V8 (`@vitest/coverage-v8`)** — the profile's default again, the tests run the code as written
   (V8 counts it in the engine, no instrumentation); same line figures and run time as measured above; one more
   runtime flag in the coverage run's test worker, and one branch counted as taken that is not.
3. **Run both** (V8 in CI, Istanbul locally, or the reverse) — two providers whose figures can drift apart, for
   no measured gain.

## Decision

Coverage is measured with `@vitest/coverage-v8` (lcov to `coverage/lcov.info`), with the tests still running in
the Workers runtime through `@cloudflare/vitest-plugin`; `@vitest/coverage-istanbul` is removed.

## Consequences

The _Coverage gate_, SonarQube Cloud (`sonar.javascript.lcov.reportPaths`) and the CI step _Generate coverage_
read the same `coverage/lcov.info` as before, with the same production files (`coverage.include` in
`vitest.config.ts`) and the same exclusions; the coverage scope of [0032](0032-node-test-project-for-workflow-scripts.md)
(`src/` only, workflow scripts unmeasured) is unchanged. A branch V8 cannot resolve below a statement (such as a
destructuring default) may count as taken; the gate measures lines, so only SonarQube's condition figure can be a
branch higher. The coverage run's test worker has `node:inspector` available, which no production code may rely on
(the deployed Worker's flags come from `wrangler.jsonc` alone). If the plugin drops V8 support, Istanbul is the
fallback with no other change than the provider and its package.
