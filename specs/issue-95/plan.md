# Plan: Switch coverage from Istanbul to V8 under @cloudflare/vitest-plugin

Source: Issue #95
Status: Draft
Tier: standard — swaps a dev dependency (`@vitest/coverage-istanbul` for `@vitest/coverage-v8`) and the test
build configuration with a decision record, changing no production code and no security control.
Security areas touched: dependencies (`package.json`, `package-lock.json`: dev dependency `@vitest/coverage-v8`
added with its transitive packages, `@vitest/coverage-istanbul` removed); test build configuration
(`vitest.config.ts`, `coverage.provider`, which makes `@cloudflare/vitest-plugin` add the compatibility flags
`nodejs_inspector_module` and `nodejs_inspector_local_dev` to the test runner worker of coverage runs). None of the
areas listed in `.squad/project.md` (*Security areas*); CI workflows unchanged.

## Problem / root cause

Not a defect: an evaluation. Decision 0010 chose Istanbul because `@cloudflare/vitest-pool-workers` could not run
V8 coverage; its own consequence says to switch back to the profile's `@vitest/coverage-v8` once the pool can.
Since PR #97 the tests run under `@cloudflare/vitest-plugin`, which supports `coverage.provider: "v8"`
(`node_modules/@cloudflare/vitest-plugin/dist/pool/index.mjs:69762-69764`). The Lead measured both providers on
`origin/main` (`a914f41`) in a scratch worktree: identical line figures in the *Coverage gate*, no difference in
run time beyond noise (facts 3–6). The measurement holds, so the plan switches and supersedes 0010 with 0033.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | The issue: `@cloudflare/vitest-plugin` supports `coverage.provider: "v8"` by enabling `nodejs_inspector_module` for the test runner | `dist/pool/index.mjs:69762-69764` (plugin 1.4.7): `if (coverage.enabled && coverage.provider === "v8")` adds `nodejs_inspector_module` **and** `nodejs_inspector_local_dev` to `runnerWorker.compatibilityFlags`; `dist/worker/index.mjs:920,925` start V8 collection in the worker; two flags, not one as the issue says | confirmed |
| 2 | The issue: the plugin was adopted in #94 | `git log`: adopted by PR #97 (`a914f41`), which resolved issue #94 | confirmed |
| 3 | Line figures of the *Coverage gate* are the same under V8 | Scratch worktree at `a914f41`, Node 22.22.0, `npm run coverage:lcov` then `coverage-check.py`: Istanbul `Overall: 97.1% (1942/2001 lines)`, V8 `Overall: 97.1% (1942/2001 lines)`; 69 `SF:` records in both; the set of `DA` lines with zero/non-zero hits identical (only hit counts differ) | confirmed |
| 4 | Function and branch figures | Same lcov files: `FNH/FNF` 384/390 both; `BRH/BRF` 1445/1509 (Istanbul), 1446/1509 (V8); the one differing branch is `BRDA:34,5,0` in `src/setup/language.ts:34` (destructuring default `range = ""`, never taken, since `split` yields at least `""`) which V8 counts as taken; function names `(anonymous_2)`/`(anonymous_9)` become `fetch`/`scheduled` in `src/index.ts` | confirmed |
| 5 | Run time | `npm run coverage:lcov` wall time: Istanbul 80.4 s, 80.3 s; V8 83.5 s, 76.4 s; `npm test` without coverage 84.9 s; Vitest's `transform` 5.7 s (Istanbul) vs 2.7 s (V8), `import` 30 s vs 18 s, test time dominates; no difference beyond noise | confirmed |
| 6 | All tests pass under V8, the time-ratio tests (`docs/UNIT_TESTS.md`, *Time bounds as a ratio*) included | Both V8 runs: `Test Files 68 passed (68)`, `Tests 2950 passed (2950)`, exit 0 (Node 22; Node 24 is fact 7) | confirmed |
| 7 | The same on Node 24 (`engines`, CI) | to verify: `npm run coverage:lcov` and `coverage-check.py` on the head, owner Dev, step 6; CI job running *Generate coverage* (`.github/workflows/ci.yml:84-85`), owner orchestrator, step 11 | unverified |
| 8 | SonarQube Cloud's new-code and overall coverage are not lower under V8 | to verify: `sonar-check.py pr <number>` passes and the PR analysis shows coverage (not missing, not 0 %) with overall coverage within 0.1 point of `main`'s last analysis; owner orchestrator, step 11 (no `SONAR_TOKEN` in the session; the *Sonar gate* of step 7 reads it if the token is there) | unverified |
| 9 | The report path and format consumers stay unchanged | `sonar-project.properties`: `sonar.javascript.lcov.reportPaths=coverage/lcov.info`; `squad_settings.py`: `COVERAGE_FORMAT = "lcov"`, `COVERAGE_REPORT_GLOB = "coverage/lcov.info"`; `package.json` `coverage:lcov` passes `--coverage.reporter=lcov`; the gate parsed the V8 lcov (fact 3) | confirmed |
| 10 | `@vitest/coverage-v8` must match Vitest's version | installed `vitest` and `@vitest/coverage-istanbul` are 4.1.12; `npm install --save-dev @vitest/coverage-v8@^4.1.12` resolved 4.1.12 and added `@bcoe/v8-coverage`, `ast-v8-to-istanbul` (+ nested `@jridgewell/trace-mapping`, `js-tokens`) | confirmed |
| 11 | The lockfile swap keeps every platform package | Scratch: after `npm install --save-dev @vitest/coverage-v8@^4.1.12` and `npm uninstall @vitest/coverage-istanbul` (npm 10.9.4) the lockfile still holds the same 31 distinct `@esbuild/*`/`@cloudflare/workerd-*` package names (378 → 352 entries, nested duplicates collapsed, Babel/browserslist chain of Istanbul gone); npm 11 and `--package-lock-only` produced larger, different rewrites; the head's lockfile is checked again by the Dev under AC3 | confirmed |
| 12 | `docs/UNIT_TESTS.md:12` already names `@vitest/coverage-v8` (stale today, true after the switch) | `docs/UNIT_TESTS.md:12` | confirmed |
| 13 | Nothing else in `docs/`, `docs/areas/`, `docs/ARCHITECTURE.md`, `README.md`, `sonar-project.properties` or the workflows names Istanbul | `grep -rni "istanbul\|coverage-v8\|V8"` over the repository outside `node_modules`: hits only in `vitest.config.ts:7-8`, `package.json:25`, `.squad/stack.md:16-17,48,98`, `docs/UNIT_TESTS.md:12` (and 53-54 "instrumentation"), `CHANGELOG.md:62` (0.1.0 history), decisions 0010 and 0032 (released), `AGENTS.md:108-113`, `.github/copilot-instructions.md:107-112` | confirmed |
| 14 | 0010 and 0032 are released | `git ls-remote --tags origin`: `v0.5.0` = `f461b27`; `git cat-file -e v0.5.0:docs/decisions/0032-…` succeeds (0010 is older) | confirmed |

## Acceptance criteria

- [ ] AC1: `vitest.config.ts` sets `coverage.provider: "v8"` with `include` and `exclude` unchanged; `package.json`
  lists `@vitest/coverage-v8` at `^4.1.12` (the installed Vitest version) and no longer lists
  `@vitest/coverage-istanbul`; `npm run coverage:lcov` on Node 24 passes every test and writes
  `coverage/lcov.info` with one `SF:` record per production file under `src/` (69 on `a914f41`).
- [ ] AC2: `python3 .squad/tools/coverage-check.py` on that report passes and counts the same number of coverable
  lines as an Istanbul run of the same tree (2001 on `a914f41`) with an overall figure not below Istanbul's
  (97.1 % on `a914f41`).
- [ ] AC3: `package-lock.json` changes only by the swap: `npm ci` on a clean checkout succeeds, the set of
  `@esbuild/*` and `@cloudflare/workerd-*` package names is the one of `origin/main`, the `overrides` of `sharp`
  and `undici` still resolve to 0.35.5 and 7.30.1, and no other direct dependency changes version.
- [ ] AC4: On the pull request, the CI job that runs *Generate coverage* passes and the SonarQube Cloud analysis
  carries coverage, with overall coverage within 0.1 point of `main`'s last analysis.
- [ ] AC5: `.squad/stack.md`, `docs/UNIT_TESTS.md`, the `vitest.config.ts` comment and the decision records state
  V8 coverage per 0033, and 0010 is `Superseded by 0033`; no file names Istanbul as the current provider except
  the released records, `CHANGELOG.md`'s history and the instruction files left to #96.

## Verification without tests

The change touches no production or test code (configuration, dependency manifest, documentation): steps 4
(*Skeleton*) and 5 (*Tests first*) are not applicable. The *Coverage gate* still runs in step 7 — it is the
verification of AC2, not a coverage obligation.

| AC | Verified by | Where / how |
| -- | ----------- | ----------- |
| AC1 | Dev (step 6), orchestrator (step 7) | `npm run coverage:lcov` exit 0 with `68 passed` files on Node 24; `grep -c '^SF:' coverage/lcov.info` equals the number of `src/**/*.ts` files without `*.test.ts`/`*.d.ts`; read `vitest.config.ts` and `package.json` |
| AC2 | Dev (step 6) | On the head: `coverage-check.py` output of the V8 run; then once with `--coverage.provider=istanbul` from a scratch worktree of `origin/main` (where Istanbul is still installed), comparing the `Overall:` line; report both lines in the hand-back |
| AC3 | Dev (step 6), Reviewer (step 8) | `rm -rf node_modules && npm ci` exit 0; a read-only comparison of the package names matching `@esbuild/` or `@cloudflare/workerd-` in `packages` of `package-lock.json` on `origin/main` and on the head (equal sets); `npm ls sharp undici` shows the override versions; `git diff origin/main -- package.json` shows only the one devDependency line |
| AC4 | Orchestrator (step 11) | CI check runs of the head green; `python3 .squad/tools/sonar-check.py pr <number>` exit 0; the analysis' coverage read against `main`'s (fact 8). A red result is worked in step 11 — the fallback is reverting to Istanbul (0033, *Consequences*), a Lead decision |
| AC5 | Reviewer (step 8) | Read the diff and `grep -rni istanbul` over the repository outside `node_modules`: remaining hits only in `docs/decisions/0010-*`, `docs/decisions/0032-*`, `docs/decisions/0033-*`, `docs/decisions/README.md` (0010's title), `CHANGELOG.md:62`, `AGENTS.md`, `.github/copilot-instructions.md`; `decision-check.py` passes |

## Approach

1. Dev, on a tree restored with `npm ci` on the Node 24 toolchain: `npm install --save-dev @vitest/coverage-v8@^4.1.12`,
   then `npm uninstall @vitest/coverage-istanbul` (the order measured in fact 11). Do not use `--package-lock-only`
   and do not delete `package-lock.json` (both rewrote far more in the scratch run). Check AC3 before going on; if
   npm 11 rewrites more than the swap, regenerate with npm 10 (`npx npm@10 …`) and report which one was used.
2. Dev, `vitest.config.ts`: `provider: "istanbul"` → `provider: "v8"`; the comment above it becomes
   `// V8 through @cloudflare/vitest-plugin, which adds the inspector flags to the test worker: see docs/decisions (V8 coverage, 0033).`
   (wording free, it must name 0033 and not claim Istanbul). `include`, `exclude`, projects and bindings untouched.
3. Dev, `.squad/stack.md` (true-making update, *Scope of a product PR*):
   - *Toolchain*, Vitest bullet: replace the sentence "Coverage uses `@vitest/coverage-istanbul` instead of the
     profile's `@vitest/coverage-v8` (decision 0010, …)" with "Coverage uses the profile's `@vitest/coverage-v8`
     (decision 0033; the plugin enables V8 coverage inside the Workers runtime)."
   - *Commands*, *Test with coverage* row: "with Istanbul" → "with V8".
   - *Coverage exclusions*: "Vitest's `coverage.include` (Istanbul)" → "Vitest's `coverage.include` (V8)".
4. Dev, `docs/UNIT_TESTS.md:53-54`: "with the coverage
   instrumentation of _Test with coverage_ included" → "with the coverage run of _Test with coverage_ included"
   (V8 does not instrument; the run with coverage is still the one to measure). Line 12 stays.
   Lead (written in step 2): decision record 0033, the index rows and 0010's status.
5. Nothing else: `package.json` script `coverage:lcov`, `sonar-project.properties`, `.github/workflows/ci.yml`,
   `squad_settings.py` and `coverage-check.py` stay as they are (fact 9).

No user-visible output.

## Options considered

1. **Keep Istanbul** — lost: the measured figures and time are equal, so the deviation from the profile (recorded in
   `.squad/stack.md`, 0010 and the instruction files) would be kept for a reason that no longer holds, against
   0010's own consequence.
2. **Switch to V8** — chosen (0033): profile default, tests run uninstrumented code, same gate figures and run time.
3. **Run both providers** (V8 in CI, Istanbul locally, or keep Istanbul installed as a fallback) — lost: two
   figures that can drift apart, and a dependency nobody runs; the fallback is a two-line revert.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| test configuration | `vitest.config.ts` | `coverage.provider` `"v8"`, comment (Dev) |
| dependencies | `package.json`, `package-lock.json` | devDependency swap (Dev) |
| product documentation | `.squad/stack.md` | three statements (Dev) |
| documentation | `docs/UNIT_TESTS.md` | one phrase (Dev) |
| decision records | `docs/decisions/0033-v8-coverage.md` (new), `docs/decisions/0010-istanbul-coverage.md` (status only), `docs/decisions/README.md` (index) | Lead, done in step 2 |

## Signatures (for the Dev's skeleton)

none

## Test files

none (no test is written: *Verification without tests*).

Existing test code that calls a changed signature: none.

Files of the change no unit test can cover: none (no production file changes; the coverage exclusions stay).

## Areas

none — no change in behavior of the Worker; the coverage tooling is development process (`docs/areas/README.md`,
*Size*), recorded in 0033 with `Area: —`.

## Documentation updates

Sweep: `grep -rni "istanbul\|coverage-v8\|instrument"` over `docs/`, `docs/areas/`, `docs/ARCHITECTURE.md`,
`README.md`, `CONTRIBUTING.md`, `.squad/stack.md`, `.squad/project.md` (fact 13).

- `.squad/stack.md` — *Toolchain*, *Commands* (*Test with coverage*), *Coverage exclusions*: owner Dev (Approach 3).
- `docs/UNIT_TESTS.md:53-54` — owner Dev (Approach 4).
- `docs/decisions/0033-v8-coverage.md`, `docs/decisions/README.md`, `docs/decisions/0010-istanbul-coverage.md`
  (status line only, the one edit a released record allows) — owner Lead (written in step 2).
- `docs/ARCHITECTURE.md`, area documents, `README.md`, `CHANGELOG.md`: none (no mention of the coverage provider;
  `CHANGELOG.md:62` is the 0.1.0 history and a tooling change is not a user-facing entry, as in #97).
- `AGENTS.md`, `.github/copilot-instructions.md` (lines 107-113 / 106-112): out of scope (*Scope of a product PR*),
  covered by #96 — see *Out of scope / follow-ups*.

## Architecture check

No guarantee of `docs/ARCHITECTURE.md` or `.squad/project.md` is touched: the tests still run inside the Workers
runtime (the reason of 0010, option 1, keeps holding), the deployed Worker's compatibility flags still come from
`wrangler.jsonc` alone — the plugin adds the inspector flags only to its own runner worker and only when coverage
is enabled (fact 1). The coverage measure, its thresholds and its exclusions are unchanged.

## Security considerations

- [x] Every byte or length limit on parsed input says whether it applies before or after decoding — no limits.
- [x] Every exception that can reach a user-visible failure reason or message is listed — none.
- New dev dependency `@vitest/coverage-v8` 4.1.12 (same publisher and release as `vitest`), transitive
  `@bcoe/v8-coverage` and `ast-v8-to-istanbul`; it runs only in `npm run coverage:lcov` locally and in CI, never in
  the bundle (`wrangler deploy --dry-run` bundles from `src/index.ts`). `npm audit` reported 0 vulnerabilities in the
  scratch install. The removed Babel chain of `@vitest/coverage-istanbul` shrinks the dev tree.
- `node:inspector` becomes available to the code under test in the coverage run only; a test passing only there is
  not possible to rely on, since `npm test` runs without it and both run in CI.

## Decision records

- `docs/decisions/0033-v8-coverage.md` (Proposed), superseding `docs/decisions/0010-istanbul-coverage.md`
  (status set to `Superseded by 0033`, index row updated).

## Out of scope / follow-ups

- Issue #96 (instruction files) currently asks to "state Istanbul coverage per decision 0010". After this change
  it should state V8 coverage per decision 0033. Proposed comment for the orchestrator to post on #96 once this PR
  merges: "#95 switched coverage to `@vitest/coverage-v8` (decision 0033, superseding 0010). The update of
  `AGENTS.md` and `.github/copilot-instructions.md` should name `@cloudflare/vitest-plugin` and V8 coverage per
  0033, dropping the Istanbul deviation instead of restating it."
- The measurement ran on Node 22 (the session's toolchain); Node 24 is checked by AC1 and AC4.
