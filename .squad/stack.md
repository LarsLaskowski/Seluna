# Stack: TypeScript

The toolchain and the exact commands of this repository. Every squad member, skill and instruction file
refers to the entries below by their *italic name*. Seeded from the Squad-Spec-Repository-Template `typescript`
profile and owned by this repository: keep it true when the build changes.

## Toolchain

- TypeScript `6.0` (`tsc`; not 7, because typescript-eslint does not support it yet, decision 0004), `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride` and `verbatimModuleSyntax`; Node.js `24` (`engines` in
  `package.json`), npm with a committed `package-lock.json`.
- **ESLint** with **typescript-eslint** `strictTypeChecked` and `stylisticTypeChecked` (type-aware, through
  `parserOptions.projectService`) and **eslint-plugin-sonarjs** (the SonarQube JS/TS rules locally, so SonarQube
  issues surface before the push); **Prettier** as the formatter.
- **Vitest** running in `@cloudflare/vitest-pool-workers` (the tests execute inside the Workers runtime) as test
  runner. That pool does not support V8 coverage, so coverage uses `@vitest/coverage-istanbul` instead of the
  profile's `@vitest/coverage-v8` (decision 0010).
- **Wrangler** bundles and deploys the Worker; `wrangler types` regenerates `worker-configuration.d.ts`.
- The SessionStart hook `.claude/hooks/session-start.sh` runs `npm ci` in remote sessions.

## Layout

- Production code: `src/`; build output: `dist/` (bundled by Wrangler, not committed).
- Tests: colocated `*.test.ts` next to the code in `src/`, real GitHub payloads as fixtures under
  `test/fixtures/<event>/<action>.json`; one test file per module under test, named
  `<module>.test.ts`; test files and `test/` are part of the TypeScript project (`include` in `tsconfig.json`), so the type
  check and the type-aware lint cover them.
- Tests of workflow scripts (`.github/workflows/*.yml` with a Bash script): `test/*-workflow.test.ts` with their
  harness `test/*-workflow.ts`, run in the `node` project of `vitest.config.ts` (they start Git and Bash, which the
  Workers runtime cannot; decision 0032). Every other test runs in the `workers` project. `npx vitest run --project node`
  runs only the former.

## Commands

All commands go through `package.json` scripts; a missing script is added, not worked around.

| Name | Command |
| ---- | ------- |
| *Restore* | `npm ci` |
| *Format* (in the squad: by the member that changed the files, `.squad/team.md`) | `npm run format` (`prettier --write .`) |
| *Format check* | `npm run format:check` (`prettier --check .`) |
| *Type check* | `npm run typecheck` (`tsc --noEmit`, or `tsc -b --noEmit` with project references) |
| *Build* | `npm run build` (`wrangler deploy --dry-run --outdir dist`) |
| *Test* | `npm test` (`vitest run`) |
| *Single test* | `npx vitest run src/index.test.ts -t "<name>"` |
| *Test (project)* | `npx vitest run src/<dir>/` (the tests of the changed code; a `patch` that changes only test code, `.squad/routing.md` *Gates of a patch* — it writes no coverage report, so a `patch` that changes production code runs *Test with coverage* instead) |
| *Test with coverage* | `npm run coverage:lcov` (`vitest run --coverage --coverage.reporter=lcov` with Istanbul, overwrites `coverage/lcov.info`) |
| *Coverage gate* | `python3 .squad/tools/coverage-check.py` |
| *Analyzer gate* | `python3 .squad/tools/analyzer-check.py` |
| *Sonar gate* | `python3 .squad/tools/sonar-check.py branch -- npx --yes @sonar/scan@5.0.1 -Dsonar.branch.name="$(git branch --show-current)"` (after *Test with coverage*, so the analysis carries coverage; needs `SONAR_TOKEN`, see *Sonar gate* below) |
| *Image build check* | none (Seluna builds no image) |

## Analyzer gate

`analyzer-check.py` runs the npm scripts in `CHECK_SCRIPTS` of `.squad/tools/squad_settings.py` (at least
`typecheck`, which must pass for the whole repository) and ESLint on every TypeScript file changed since the
merge base with `origin/main`; any ESLint message — error or warning — in a changed file fails the gate. A
changed file outside the TypeScript project is reported as a parse error by the project service: add it to
`include` in `tsconfig.json` (or a `tsconfig.eslint.json`), never to the ESLint ignores.
Fixable style findings are the Code Officer's (`eslint --fix` on the changed files, then *Format*); rule
findings that need a code change go to the Dev or Tester. A rule is disabled only on the line, with
`// eslint-disable-next-line <rule> -- <reason>`.

SonarQube Cloud can still report rules the local plugin version does not have, and its non-lint checks
(hotspots, taint analysis, duplication) have no local equivalent: the *Sonar gate* below is the first to
report their issues and hotspots, and squad step 11 reads the quality gate, duplication included.

Changed shell scripts (`*.sh`), GitHub workflows (`.github/workflows/*.yml`) and Dockerfiles are checked with
`shellcheck`, `actionlint` and `hadolint`; the SessionStart hook installs the three as pinned, checksum-verified
binaries (`.claude/hooks/install-linters.sh`), and the gate reports NOT RUN for one that is missing (a refused
download, for example). The gate itself checks two SonarQube Cloud shell rules shellcheck does not report:
`shelldre:S7679` (a positional parameter `$1`…`$9` used as a word of its own inside a function — assign it to a
local variable first) and `shelldre:S7688` (`[ … ]` instead of `[[ … ]]`). Other `shelldre:*` findings are first
reported by the *Sonar gate* below.

*Sonar gate* runs SonarQube Cloud's own analysis on the work branch before the pull request (squad step 7):
`sonar-check.py` runs the scanner with the branch name, waits for the analysis and fails on every open issue or
security hotspot on a line the branch changed, so the rules no local analyzer has stop surfacing only after the
pull request. It runs on the committed change (the scanner uploads the working tree, so it refuses uncommitted or
untracked files other than the coverage reports) and needs `SONAR_TOKEN` in the session's environment (an environment secret) and network access to the
scanner's download hosts (`api.sonarcloud.io`, `scanner.sonarcloud.io` and the package registry); without them it
reports NOT CHECKED, and step 11 reads the draft pull request with `python3 .squad/tools/sonar-check.py pr <number>`
instead. A finding of a rule no local analyzer reports is noted in this section, in the same change, instead of a
squad lesson.

## Image build check

None: Seluna builds no image, the Worker is bundled and deployed by Wrangler (*Build*).

## Coverage exclusions

Two places compute coverage and must agree (`.squad/routing.md`, *Code a unit test cannot cover*): the
*Coverage gate* reads `COVERAGE_PATHSPECS` and `COVERAGE_EXCLUDES` in `.squad/tools/squad_settings.py`, and
SonarQube Cloud reads `sonar.coverage.exclusions` in `sonar-project.properties`. Declaration files (`*.d.ts`)
hold no executable lines and are excluded in both. A file no unit test can cover (a generated file, the
process entry point) is added to both with a decision record — never to `sonar.exclusions`, which would drop it
from the analysis too. Vitest's `coverage.include` (Istanbul) covers the same production files, so a file no test
imports still counts as uncovered instead of missing from the report.

Duplication exclusions live in `sonar.cpd.exclusions` in `sonar-project.properties`, only for files that hold
nothing but data, each with a decision record (0019); never use `sonar.exclusions` for this.

## Writing code

- ES modules; `import type` for type-only imports (`verbatimModuleSyntax`).
- No `any`: data from outside (JSON, environment, network, user input) is `unknown` and narrowed by a type
  guard or a schema at the boundary; inside, the types are trusted.
- No `as` cast and no non-null assertion `!` to silence the compiler; a cast only after a runtime check, with
  a comment. `@ts-expect-error` with a reason instead of `@ts-ignore`.
- Unions of literal types over enums; an exhaustive `switch` ends with a `never` check.
- `readonly` properties and `ReadonlyArray` where nothing mutates; `const` by default; `===` only.
- async/await over raw promise chains, every promise awaited or explicitly handled (`no-floating-promises`).
- Exported functions declare their return type.
- Worker code uses only Web-standard and Workers APIs (`fetch`, `crypto.subtle`, `Request`/`Response`); no Node.js
  built-ins unless `compatibility_flags` enables them deliberately.
- Rules (what to notify, and why) are pure functions of a parsed event: no I/O, no clock, no D1 inside them; the
  handler passes everything in. Time comes from an injected clock.
- Payloads from GitHub and Telegram are `unknown` and narrowed at the boundary; the rest of the code uses the
  narrowed types only.
- Expected failures (bad signature, unknown event, Telegram error) are values or typed results, not exceptions
  used for control flow; the Worker never returns an error body that reveals configuration or secrets.
- Modules are named after what they own (`signature.ts`, `outbox.ts`); one module per file, tests beside it.

## Logger arguments

CodeQL's *Clear-text logging of sensitive information* (`js/clear-text-logging`) judges a value by its
**name**: a variable, property or call whose name contains `secret`, `trusted`, `confidential`,
`account`/`accnt`, `puid`, `uid`, `username`/`userid`, `sessionid`/`sessionkey`, `password`, `passwd`,
`passcode`, `passphrase`, `authkey`, `oauth`, `apikey`/`apitoken`, `mfa`, `cert`, or names private data
(`ssn`, `zipcode`, `phone`, `creditcard`, `iban`, `birthdate`, `gender`, `medical`, …) counts as sensitive,
unless it also contains `hash`, `md5`, `sha`, `random`, `crypt`, `encode`, `redact`, `censor`, `obfuscate`,
`file`, `path`, `url` (or `accounting`, `certain`, `concert`, `secretary`, `wildcard`, `coauthor`)
(`shared/concepts/codeql/concepts/internal/SensitiveDataHeuristics.qll` in `github/codeql`, `HeuristicNames`).
Such a name passed to a log call fails the PR in CI, also when it holds only a label, and no local gate
reports it. The remedy is a neutral name for the value whose text a test pins, never a suppression.

## Writing tests

See `docs/UNIT_TESTS.md`. Tests follow the same type check and ESLint rules as production code; every
assertion carries a message where the assertion API accepts one. Test doubles are typed against the real
interface (`satisfies`, or `vi.fn<…>()` with the signature), never `as any`.

## Skeleton

New exports with their full signature, return type and TSDoc, bodies `throw new Error("Not implemented");`,
so `typecheck` passes and the tests load and fail.

Constructors store their arguments and never throw: a test harness builds these types, so only member bodies
fail.

Zero-value stubs (`return 0`, `return []`, `return ""`) are not allowed, not even where the `throw` would break
a test that exists and passes today, for example an existing caller of the changed export: that test is
expected to fail until the real body lands, and the Dev reports it in the hand-back.

## Dependencies

Added with `npm install <pkg>` (or `--save-dev`), committed together with `package-lock.json`; exact or
caret versions as the repository already uses. A package without bundled types gets its `@types/…` package as a
dev dependency. A new runtime dependency is a `security`-tier change.

## Concurrency

Test runs and builds share `dist/`, `coverage/`, `*.tsbuildinfo` and caches; run one at a time.

## Known pitfalls

- `npx --no-install eslint` fails when dependencies are not installed — run *Restore* first.
- Type-aware linting needs every linted file in the TypeScript project; a new top-level directory needs an
  `include` entry, or every file in it fails the gate with a parse error.
