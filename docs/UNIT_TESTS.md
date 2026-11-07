# Unit Tests

This document describes how unit tests are written in this repository. It is binding for human
contributors and AI agents alike: **unit tests are mandatory for newly written code**, new tests follow the
conventions below, and existing tests are the reference implementation — when in doubt, look at a
neighboring test file before inventing a new pattern.

## Test stack

<!-- project:begin stack -->

- Test runner: Vitest (`vitest run`), coverage with `@vitest/coverage-v8`; assertions: `expect`
  (`expect(actual, "message").toBe(expected)`).
- Tests of workflow scripts run in a second Vitest project, `node` (`vitest.config.ts`), because they start Git and
  Bash against local repositories; all other tests run in the `workers` project. `npx vitest run --project node` runs
  only the first kind (decision 0032).
- No mocking library beyond what Vitest ships with (`vi.fn`, `vi.useFakeTimers`) — prefer real objects and the
  hand-written fakes listed in `.squad/project.md` (_Test doubles_), typed against the real interface.

<!-- project:end stack -->

## Where tests live

<!-- project:begin layout -->

- One test file per module under test, `<module>.test.ts`, next to the module (or under `test/`, mirroring
  `src/`).
- A script in a workflow file is tested as `test/<name>-workflow.test.ts` with the harness `test/<name>-workflow.ts`
  (the node project); the harness runs the script from the YAML against local Git repositories and a local release
  answer, never the network.

<!-- project:end layout -->

## Naming

- `describe` (or the file) names the module; each test name states the scenario and the expected result,
  e.g. `"parseLine returns null for an empty line"`.

## Criterion ids

A test written for an acceptance criterion of a squad plan or spec carries the criterion's id at the start of its
name, `"AC3 parseLine returns null for an empty line"`, or of the `describe` block that groups the criterion's
tests (`describe("AC3 …")`), so that `.squad/tools/plan-check.py --matrix` finds it by id after a rename or a
split; a test that asserts several criteria carries each id.

## Structure

- Arrange / Act / Assert, separated by blank lines; **one act per test**.
- No logic in tests (no `if`, loops or `switch`); use a table of cases with one test per case for several
  inputs.
- Every assertion carries a message (`expect(actual, "message").toBe(expected)`).
- Test code is type-checked and linted like production code: no `as any`, no `!` to reach into a result —
  narrow it with an assertion first (`expect(result).toBeDefined()`, then a type guard).
- No real network, no real clock (inject a clock or use `vi.useFakeTimers()`), temporary directories
  for file-system tests, cleaned up afterwards.
- Every promise is awaited; a test never relies on timing.
- **Time bounds as a ratio.** A time bound that cannot be tested as a count (allocations, iterations) — a
  quadratic check that must stay linear, say — is an exception to the real clock: measure two durations
  in the same test (the base input and a multiple of it) and assert their **ratio**, never an absolute
  duration; set the limit to at least three times the highest ratio measured, with the coverage
  run of _Test with coverage_ included.

## Tests that read repository documents

`.gitattributes` may check files out with CRLF (`*.md text eol=crlf`), so on a CI runner a document carries
`\r\n` where the repository blob has `\n`. A test or script that reads a repository document (`*.md`, and the
other files `.gitattributes` checks out with CRLF) normalizes `\r\n` to `\n` before it compares lines or feeds
them to a shell. The first such test also tests the normalizer with CRLF input.

## Fixtures

- A rule test reads a real webhook payload, `test/fixtures/<event>/<action>.json`, never a hand-invented one. A
  delivery used to test the signature stays unaltered, since any edit breaks its signature, and is signed with a
  throwaway secret (decision 0012).
- A fixture that is reference-built from GitHub's or Telegram's documentation instead of captured says so, with the
  record that accepted it, in the `README.md` of its folder; a live check on a deployed copy may replace it with a
  captured answer. Squad sessions cannot reach `api.telegram.org`, so a plan that reads a new Bot API answer asks the
  Product Manager for a captured sample up front or plans that live check before the pull request is marked ready
  (decision 0016).
- When the Lead finds no real payload for a rule test in `test/fixtures/` or on the issue, the plan escalates and the
  Product Manager supplies raw deliveries; the Lead never picks a hand-built payload instead. The orchestrator turns
  them into fixtures before the Lead's second plan launch:
  1. **Replace** every identifying value and nothing else: logins, numeric ids, `node_id`s, avatar and profile URLs,
     repository and organization names, the homepage, the installation id, commit SHAs, and the text of titles,
     bodies and commit messages, consistently (one original value, one replacement). Structure, field set, types and
     the values that decide a rule (`action`, `draft`, `state`, `conclusion`, labels, review states) stay. A delivery
     used to test the signature is not edited.
  2. **Grep for leaks:** every original login, repository name, id and SHA of the raw delivery finds nothing in the
     new files.
  3. **Format** the new files with `npx prettier --write test/fixtures` and confirm that the parsed JSON is unchanged.

## Code coverage

**Threshold: at least 80 % line coverage on new or changed production code, and at least 80 % overall** —
the same measure as SonarQube's "coverage on new code". Both values are set in `.squad/tools/squad_settings.py`
(`COVERAGE_THRESHOLD`, `COVERAGE_OVERALL_THRESHOLD`); the overall one may start lower in a repository adopted
with a coverage debt and is only ever raised. Check it locally before a push with _Test with coverage_ and the
_Coverage gate_ from [`.squad/stack.md`](../.squad/stack.md). Lines that genuinely
cannot be covered by a unit test (for example process startup glue) need an explicit, recorded decision.

## Checklist for new tests

- [ ] New production code has accompanying unit tests — mandatory, not optional.
- [ ] The _Analyzer gate_ reports nothing in a changed test file.
- [ ] At least 80 % line coverage on new/changed production code and overall (_Coverage gate_).
- [ ] File and test names as above (with the criterion id of a squad test); Arrange / Act / Assert; one act; assertion messages.
- [ ] No real network or clock (a time bound only as a ratio of two durations).
- [ ] _Format_ from `.squad/stack.md` run before committing.
