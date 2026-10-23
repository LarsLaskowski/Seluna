# Plan: Replace the deprecated @cloudflare/vitest-pool-workers with @cloudflare/vitest-plugin

Source: Issue #94
Status: Draft
Tier: standard — a dev dependency is replaced by its renamed successor (a dependency update with a large lock-file diff, which `patch` excludes), with no change to production code or behavior.
Security areas touched: dependency — the dev dependency `@cloudflare/vitest-plugin` replaces `@cloudflare/vitest-pool-workers` (`package.json`, `package-lock.json`); build configuration — `vitest.config.ts`, `tsconfig.json`. No security area of `.squad/project.md` (the package is test tooling and is not bundled into the Worker).

## Problem / root cause

`package.json:22` depends on `@cloudflare/vitest-pool-workers` `^0.23.0`, which the registry marks deprecated
("has been renamed to `@cloudflare/vitest-plugin`. This package will not receive future updates."), so every
`npm ci` — locally, in CI and in the users' Workers Builds — prints the warning, and the test runtime would get no
more fixes. The package is referenced in `vitest.config.ts:1` (import of `cloudflareTest`, `readD1Migrations`),
`tsconfig.json:7` (`types`: `@cloudflare/vitest-pool-workers/types`, which declares the `cloudflare:test` module
used by `test/d1.ts` and `src/index.test.ts`) and in documentation.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | `@cloudflare/vitest-pool-workers@0.23.0` is deprecated with the message the issue quotes, and 0.23.0 is its latest version | `npm view @cloudflare/vitest-pool-workers@latest version deprecated`: `0.23.0`, the issue's text verbatim | confirmed |
| 2 | Only the root project depends on the old package, so swapping the direct dependency removes it from the tree | `npm ls @cloudflare/vitest-pool-workers --all`: one entry, directly under `seluna@0.5.0`; lock entry `node_modules/@cloudflare/vitest-pool-workers` (`package-lock.json:348`) | confirmed |
| 3 | `@cloudflare/vitest-plugin` exists, latest `1.4.7` (published 2026-10-22, first version 2026-08-20), peer `vitest ^4.1.0 \|\| ^5.0.0`; the installed `vitest` is `4.1.12` | `npm view @cloudflare/vitest-plugin version time peerDependencies`; `node_modules/vitest/package.json` | confirmed |
| 4 | The new package keeps the entry points the project uses: `.` exports `cloudflareTest` and `readD1Migrations`, `./types` is `types/cloudflare-test.d.ts` | `exports` and `dist/pool/index.d.mts` of the 1.4.7 tarball (`npm pack`, scratch directory), diffed against 0.23.0: the export list only adds `ReadD1MigrationsOptions` | confirmed |
| 5 | The project's calls compile unchanged against 1.4.7: `readD1Migrations("./migrations")` (now `string \| ReadD1MigrationsOptions`), the `cloudflareTest` options (`wrangler.configPath`, `miniflare.bindings`, `miniflare.d1Databases`; the schema only adds `experimental` and an internal `resolvedConfig`), and `createScheduledController({ cron, scheduledTime })` (`src/index.test.ts:224`; the new `ScheduledControllerOptions` takes `Date \| number`) | diff of `dist/pool/index.d.mts` and `types/cloudflare-test.d.ts`, 0.23.0 against 1.4.7; confirmed by reading; the compiled result is AC3 (`npm run typecheck`, Dev, step 6) | confirmed |
| 6 | The tests run unchanged in the new plugin (same runtime, miniflare `5.20261019.2-beta` instead of `5.20260815.0-alpha`) | to verify: `npm test` before and after the swap, same number of tests passing in both projects, Dev, step 6 | unverified |
| 7 | Istanbul coverage keeps working with the new plugin | to verify: `npm run coverage:lcov` writes `coverage/lcov.info` and `python3 .squad/tools/coverage-check.py` passes, Dev, step 6 | unverified |
| 8 | Unlike 0.23.0, the new plugin supports V8 coverage: 0.23.0 throws "Coverage provider \"v8\" is not supported by `@cloudflare/vitest-pool-workers`" (`dist/pool/index.mjs`, line 60553 of the tarball), 1.4.7 enables `nodejs_inspector_module` when `coverage.provider` is `"v8"` (`dist/pool/index.mjs`, line 69762) and has a V8 coverage session in `dist/worker/index.mjs` | both tarballs, read in a scratch directory; read, not run; whether V8 coverage works for this project is not measured (follow-up issue) | confirmed |
| 9 | The new package runs no install script and is published with SLSA provenance | `scripts` of its `package.json` (1.4.7 tarball) has only `build`, `dev`, `test` and the like, no `preinstall`/`install`/`postinstall`; `npm view @cloudflare/vitest-plugin@1.4.7 dist.attestations`: provenance `slsa.dev/provenance/v1` | confirmed |
| 9a | The copy in the regenerated lock file verifies against the registry signatures and attestations | to verify: `npm audit signatures` after `npm ci`, Dev, step 6 | unverified |
| 10 | The package is not part of the Worker bundle | `wrangler.jsonc:4` `main` is `src/index.ts`; no file under `src/` other than tests imports it or `cloudflare:test` (`grep`) | confirmed |
| 11 | The repository names the old package in `package.json:22`, `vitest.config.ts:1`, `tsconfig.json:7`, `.squad/stack.md:15`, `AGENTS.md:111`, `.github/copilot-instructions.md:110`, `docs/decisions/0010-istanbul-coverage.md:12`, `docs/decisions/0032-node-test-project-for-workflow-scripts.md:13`, besides `package-lock.json` | `grep -rn vitest-pool-workers` outside `node_modules/` | confirmed |
| 12 | Decision records 0010 and 0032 are released (append-only) | `git ls-remote --tags origin`: tags `v0.1.0`–`v0.5.0`; `git cat-file -e v0.5.0:<file>` succeeds for both records (0010 from `v0.1.0` on) | confirmed |
| 13 | The `AGENTS.md` and `.github/copilot-instructions.md` lines sit in their `configuration` project block, and a product PR may not change either file | `AGENTS.md:110-115`, `.github/copilot-instructions.md:109-114`; `.squad/routing.md` *Scope of a product PR*; `scope-check.py` `INSTRUCTION_FILES` | confirmed |
| 14 | The statements "That pool does not support V8 coverage" (`.squad/stack.md:16`) and "The workers pool does not support V8 coverage" (`vitest.config.ts:7`) become untrue with the new plugin (fact 8) | the two lines; fact 8 | confirmed |
| 15 | Dependency changes do not get a `CHANGELOG.md` entry in this repository | `git show --stat 52980e3` (#92, dependency overrides) and #86 (Dependabot bump): neither touches `CHANGELOG.md` | confirmed |

Issue claims: the deprecation warning and its text (fact 1), the files to change (fact 11) and that the API is a
rename (facts 4, 5) are confirmed. Not in the issue: the new plugin supports V8 coverage (fact 8), which meets the
trigger in decision 0010's *Consequences* ("If the pool gains V8 support, switch back") — handled as a follow-up,
see *Options considered*.

## Acceptance criteria

- [ ] AC1: `package.json` lists `@cloudflare/vitest-plugin` (`^1.4.7`) in `devDependencies` and no longer
  `@cloudflare/vitest-pool-workers`; `package-lock.json` has no `node_modules/@cloudflare/vitest-pool-workers`
  entry, and `npm ls @cloudflare/vitest-pool-workers --all` lists nothing.
- [ ] AC2: `npm ci` on a clean `node_modules` prints no `npm warn deprecated @cloudflare/vitest-pool-workers` line.
- [ ] AC3: `vitest.config.ts` imports `cloudflareTest` and `readD1Migrations` from `@cloudflare/vitest-plugin`, the
  `types` of `tsconfig.json` name `@cloudflare/vitest-plugin/types`, and `npm run typecheck` and `npm run lint`
  pass.
- [ ] AC4: `npm test` passes with both projects (`workers`, `node`), with the same number of test files and tests
  as on the base.
- [ ] AC5: `npm run coverage:lcov` still measures with Istanbul and writes `coverage/lcov.info`, and the *Coverage
  gate* passes.
- [ ] AC6: `npm run build` passes.
- [ ] AC7: No file of the repository outside `node_modules/` and `specs/` names `@cloudflare/vitest-pool-workers`
  except the released records 0010 and 0032 (which stay unchanged) and the two instruction files named below; `.squad/stack.md` and the comment in
  `vitest.config.ts` name the new package and no longer state that the pool lacks V8 coverage; `AGENTS.md` and
  `.github/copilot-instructions.md` are unchanged (`scope-check.py` passes).

## Tests per criterion

No criterion gets a unit test: the change has no production or test code (*Verification without tests*).

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1–AC7 | none — see *Verification without tests* | — |

## Verification without tests

The change touches no production code (`src/` except tests) and no test code (`*.test.ts`, `test/`): only the
dependency manifest, the lock file, the test runner configuration, the TypeScript configuration and
documentation. Steps 4 (*Skeleton*) and 5 (*Tests first*) are **not applicable**. The *Coverage gate* is **kept**:
the swap is exactly what could break Istanbul instrumentation (AC5), so step 7 runs every gate.

| AC | Verified by | Where |
| -- | ----------- | ----- |
| AC1 | Dev, step 6: `npm ls @cloudflare/vitest-pool-workers --all` (empty), `grep -c vitest-pool-workers package-lock.json` (0), `npm audit signatures` (verifies the new package) | session |
| AC2 | Dev, step 6: `rm -rf node_modules && npm ci 2>&1 \| grep -i deprecated` — no line naming `@cloudflare/vitest-pool-workers` (any other deprecation line is reported, not fixed) | session; CI's `npm ci` log on the draft PR |
| AC3 | Dev, step 6, and the orchestrator's *Analyzer gate*, step 7 | session |
| AC4 | Dev, step 6: `npm test` on the base before the swap and after it, both summaries (files, tests) in the report; the orchestrator's *Test*, step 7 | session; CI |
| AC5 | Dev, step 6, and the orchestrator's *Test with coverage* and *Coverage gate*, step 7; the overall line figure before and after in the Dev's report | session; CI and SonarQube on the draft PR |
| AC6 | Dev, step 6: `npm run build` | session; CI |
| AC7 | Reviewer, step 8: `grep -rn vitest-pool-workers --exclude-dir=node_modules .` and the diff; orchestrator: `scope-check.py`, `decision-check.py`, step 7 | session |

## Approach

One option for the code: the package is a rename with the same API (facts 4, 5), so the swap is mechanical.

1. Dev: `npm uninstall @cloudflare/vitest-pool-workers` and `npm install --save-dev @cloudflare/vitest-plugin@^1.4.7`
   (npm writes `package.json` and `package-lock.json`; the `overrides` for `sharp` and `undici` stay as they are and
   keep applying — the new miniflare asks for `undici 7.29.1` and `sharp 0.35.5`, as the old one did). Do not
   bump other dependencies: `wrangler` stays at `^4.151.1` (the plugin brings its own pinned `wrangler 4.152.0`,
   as the old package brought `4.124.0`).
2. Dev, `vitest.config.ts`:
   - line 1: `import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";`
   - line 7, the coverage comment, becomes: `// Istanbul instead of V8: see docs/decisions (Istanbul coverage).`
     — the reason "the workers pool does not support V8 coverage" is no longer true (fact 8); whether V8 is
     used now is the follow-up issue's question.
   - the comment "Every test but the tests of workflow scripts runs inside the Workers runtime." stays.
3. Dev, `tsconfig.json` line 7: `"types": ["./worker-configuration.d.ts", "@cloudflare/vitest-plugin/types"],`
4. Dev, `.squad/stack.md` lines 15-17 (*Toolchain*), replaced by (wrapped by *Format*):
   `- **Vitest** with `@cloudflare/vitest-plugin` (the successor of `@cloudflare/vitest-pool-workers`; the tests
   execute inside the Workers runtime) as test runner. Coverage uses `@vitest/coverage-istanbul` instead of the
   profile's `@vitest/coverage-v8` (decision 0010, made when the pool had no V8 coverage; the plugin's V8 support is
   not evaluated yet).`
5. Dev: *Format*, then the verifications of *Verification without tests*.

No user-visible output changes.

## Options considered

1. **Swap the package and keep Istanbul coverage; V8 coverage as a follow-up issue.** Chosen: it is what the issue
   asks, keeps the coverage figures and the gates comparable, and leaves the coverage decision to a change that can
   measure it.
2. **Swap the package and switch to V8 coverage in the same change** (decision 0010's *Consequences* name this
   trigger, fact 8). Lost: it supersedes a released record, changes `@vitest/coverage-istanbul` to
   `@vitest/coverage-v8`, the coverage configuration and possibly the compatibility flags of the test runner, and V8
   counts lines differently, so the gate figures and SonarQube's new-code coverage would move in a change meant to
   be a rename — and nothing about it is measured yet.
3. **Stay on `@cloudflare/vitest-pool-workers` 0.23.0.** Lost: no further updates (fact 1), and the warning stays in
   every install, including the users' Workers Builds.
4. **Also raise `wrangler` to `^4.152.0` so the plugin's pinned `wrangler` dedupes.** Lost: not needed for the swap
   (two `wrangler` copies already exist today), and Dependabot's weekly group updates handle it.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| root | `package.json` | `devDependencies`: `@cloudflare/vitest-pool-workers` removed, `@cloudflare/vitest-plugin` `^1.4.7` added (Dev) |
| root | `package-lock.json` | regenerated by npm (Dev) |
| root | `vitest.config.ts` | import source (line 1), coverage comment (line 7) (Dev) |
| root | `tsconfig.json` | `types` entry (line 7) (Dev) |
| root | `.squad/stack.md` | *Toolchain* bullet (lines 15-17) (Dev) |

## Signatures (for the Dev's skeleton)

none

## Test files

none — no test is added or changed.

Existing test code that calls a changed signature: none (`test/d1.ts` and `src/index.test.ts` import from
`cloudflare:test`, whose declarations keep the used members, fact 5).

Files of the change no unit test can cover: none (no production code changes).

## Areas

none (no change in behavior).

## Documentation updates

Sweep: `grep -rn -i "vitest-pool-workers\|pool\b"` over `docs/`, `README.md`, `.squad/stack.md`,
`.squad/project.md`, `.github/`, `AGENTS.md`. Hits and their handling:

- `.squad/stack.md:15-17` — updated (Dev, *Approach* 4).
- `vitest.config.ts:7` (comment) — updated (Dev, *Approach* 2).
- `docs/decisions/0010-istanbul-coverage.md:12`, `docs/decisions/0032-node-test-project-for-workflow-scripts.md:13`
  — released (fact 12), append-only; their text describes the setup when they were decided and their decisions
  still hold, so they stay unchanged (an edit would also fail `decision-check.py`). No new record: a dependency
  rename touches no guarantee or architecture (`docs/decisions/README.md`, *Rules*).
- `AGENTS.md:111`, `.github/copilot-instructions.md:110` (project block `configuration`) — outside a product PR's
  scope (fact 13). Not changed here; filed as a `squad` issue in this repository (project knowledge, *Squad
  lessons*), for a squad-maintenance PR that edits both files identically (*Out of scope / follow-ups*).
- `docs/areas/storage.md:63`, `.squad/project.md:169`, decisions 0004/0014/0015/0021/0023 — "the Workers test pool"
  as a generic term; still true (the plugin runs the tests in a Vitest pool, `cloudflarePool`), unchanged.
- `CHANGELOG.md` — none (fact 15).
- `docs/ARCHITECTURE.md`, `docs/UNIT_TESTS.md`, `docs/CONTRIBUTING.md`, `README.md` — no hit, none.

## Architecture check

No guarantee of `.squad/project.md` or flow of `docs/ARCHITECTURE.md` is touched: the Worker bundle, its bindings
and its runtime behavior are unchanged (fact 10). The test doubles rule of `.squad/project.md` (*Test doubles*:
the real D1 binding of the test runtime, not a fake) still holds — the plugin provides the same miniflare D1.

## Security considerations

- [x] Every byte or length limit on parsed input says whether it applies before or after decoding — no limits.
- [x] Every exception that can reach a user-visible failure reason or message is listed — none.
- Supply chain: the new package comes from Cloudflare's `workers-sdk` repository with SLSA provenance and no install
  script (fact 9); the Dev runs `npm audit signatures` (AC1). It is a dev dependency, never bundled (fact 10). Its
  newest version is one day old; it carries the same maintainers and repository as the package it replaces.
- The `overrides` (`sharp`, `undici`) of #92 keep applying to the new tree (*Approach* 1).

## Decision records

none: no decision beyond the obvious fix — a dependency rename; the V8 question goes to a follow-up issue and,
if it switches, to a new record superseding 0010.

## Out of scope / follow-ups

The orchestrator creates these:

1. **Issue in this repository, label `squad`** (project knowledge, filed in step 12) — title: `[Squad] Name
   @cloudflare/vitest-plugin in the agent instructions (from #94)`; body: "Issue #94 replaced the deprecated
   `@cloudflare/vitest-pool-workers` with `@cloudflare/vitest-plugin`. The `configuration` project block of
   `AGENTS.md` (line 111) and `.github/copilot-instructions.md` (line 110) still says the tests run in
   `@cloudflare/vitest-pool-workers`, 'which has no V8 coverage'. Update both files identically to name
   `@cloudflare/vitest-plugin` and to state Istanbul coverage per decision 0010 without the V8 claim (the plugin
   supports a V8 provider; see the V8 coverage issue). A product PR may not touch these files (`.squad/routing.md`,
   *Scope of a product PR*); check with `.squad/tools/config-check.py`."
2. **Issue in this repository** — title: `Evaluate V8 coverage under @cloudflare/vitest-plugin`; body: "Decision 0010
   chose Istanbul because `@cloudflare/vitest-pool-workers` rejected the V8 coverage provider. Its successor
   `@cloudflare/vitest-plugin` (adopted in #94) supports `coverage.provider: \"v8\"` by enabling the
   `nodejs_inspector_module` flag for the test runner. 0010's consequences say to switch back to the profile's
   default once the pool gains V8 support. Measure a V8 run against the Istanbul run (line figures of the coverage
   gate, SonarQube new-code coverage, run time), and if it holds, switch with a new record that supersedes 0010."

## Security notes

Security (plan review, APPROVED), non-blocking:

1. The maintainer claim in *Security considerations* is wrong: 0.23.0 has two maintainers (`wrangler-publisher`, `cf-npm-publish`), 1.4.7 has four (those two plus `cf-ci-write` and `dash_service_account`). It should say "same repository and publish workflow (provenance), maintainers extended by two Cloudflare accounts".
2. The Dev adds `npm ls undici sharp --all` (only 7.30.1 and 0.35.5 may appear) and `npm audit` before and after the swap (no new advisories) to its step-6 checks.
