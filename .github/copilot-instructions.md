# Copilot instructions

Project guidance for GitHub Copilot when working in this repository. These rules mirror
[`CLAUDE.md`](/CLAUDE.md): everything from the first `##` heading on is generated from it by the template's
`adopt-template` skill (Claude Code's `@` import lines aside — Copilot reads
`.github/instructions/*.instructions.md` through their `applyTo` front matter), and
`.squad/tools/config-check.py` fails when the two differ. Change both files together. This file is a
summary; the binding, detailed references are [`ARCHITECTURE.md`](/docs/ARCHITECTURE.md) (how the system is
put together and why), [`CONTRIBUTING.md`](/docs/CONTRIBUTING.md) (workflow, PR conventions, versioning),
[`UNIT_TESTS.md`](/docs/UNIT_TESTS.md) (test conventions — **unit tests are mandatory for new code**) and
[`.squad/stack.md`](/.squad/stack.md) (toolchain and commands). Read them before making a non-trivial
change; when this file and one of them appear to disagree, treat that as a sync bug to fix, not as
license to pick either one.

## What this project is

<!-- project:begin overview -->
Seluna sends a Telegram message when something in the owner's GitHub repositories needs attention (a pull request is
ready, a review is requested, CI failed, a security alert was opened; draft pull requests trigger nothing). Every user
runs their own instance: a private GitHub App sends webhooks to a Cloudflare Worker in the user's own account, which
keeps its state in D1 and delivers through the user's own Telegram bot. See
[`ARCHITECTURE.md`](/docs/ARCHITECTURE.md) for how it fits together.
<!-- project:end overview -->

## Golden rules

- **Never commit or push to `main`** — no one, not even with approval. Every change goes through a
  separate branch and a pull request.
- **Commits and pushes to a feature branch are always allowed** without asking: commit finished work and
  push it to the current feature branch (creating that branch off `main` if needed), so nothing is lost
  when a session ends. Force-pushing or otherwise rewriting published history, deleting branches, and
  creating tags (a `v*` tag may trigger a release) still need explicit user approval.
- **Pull requests are only opened by the squad or by the user.** The `squad-issue` and `squad-spec`
  skills open a PR after the Lead's approval (tiers `docs` and `patch`: after a clean review); outside the squad, a PR
  is opened only when the user explicitly asks for one (e.g. by running the `create-pr` skill). Never open
  a PR on your own initiative.
- Run *Format* from [`.squad/stack.md`](/.squad/stack.md) after editing code and before building; CI is
  not meant to find formatting issues. In the squad skills the member that changed the files runs it on
  them before handing back (`.squad/team.md`, *Shared rules*).
- A changed file may not carry **any analyzer diagnostic of any severity**, including info-level ones that
  never show up as build warnings but that the CI code analysis (e.g. SonarQube Cloud) reports. Check with
  the *Analyzer gate* from `.squad/stack.md` and fix every finding before considering the work done (in
  the squad skills, the Code Officer owns this).
- New or changed production code needs unit tests until the *Coverage gate* in `.squad/stack.md` passes:
  **at least 80 % line coverage** on new or changed lines and overall (the thresholds live in
  `.squad/tools/squad_settings.py`, see [`UNIT_TESTS.md`](/docs/UNIT_TESTS.md#code-coverage)).
<!-- stack:begin golden-rules -->
- Every tool runs through a `package.json` script (`format`, `format:check`, `lint`, `typecheck`, `test`,
  `coverage:lcov`); **typescript-eslint with type information** (`strictTypeChecked`) and
  **eslint-plugin-sonarjs** run locally, so type-aware and SonarQube issues surface before the CI analysis.
- The compiler is the first reviewer: `tsc --noEmit` passes for the whole repository, and a type error is
  never silenced with `any`, a cast or `@ts-ignore`.
- Add dependencies with npm and commit `package-lock.json` with them.
<!-- stack:end golden-rules -->

## Commit messages and pull requests

- Commit subject: one summary of **no more than 80 characters**, no trailing period, not in the first
  person. A body only where the subject does not explain the change; pull requests are squash-merged, so
  branch commits never reach `main` and may simply name the pipeline step.
- Pull request title `[area] Description` (areas in `docs/CONTRIBUTING.md`), description of **3–5
  sentences** on what changed and why: they become the commit on `main`. Title and description are always
  written in **English**, regardless of the language used in the conversation.

## Commands

<!-- stack:begin commands -->
```bash
npm ci
npm run format                                              # prettier --write
npm run typecheck                                           # tsc --noEmit
npm run build
npm test
npm run coverage:lcov                                       # coverage/lcov.info
python3 .squad/tools/analyzer-check.py                      # analyzer gate
python3 .squad/tools/coverage-check.py                      # coverage gate
```
<!-- stack:end commands -->

All commands, with what each one checks, are listed in [`.squad/stack.md`](/.squad/stack.md).

## Architecture

<!-- project:begin architecture -->
- `src/` — the Worker (TypeScript): the `fetch` handler (`POST /webhook`, `GET /health`, `/setup`), the rules as
  pure functions, the D1 outbox and Telegram delivery, the `scheduled` handler (cron).
- `src/*.test.ts` — tests beside the code; `test/fixtures/<event>/<action>.json` — real GitHub payloads.
- `wrangler.jsonc` — Worker configuration and bindings; `worker-configuration.d.ts` is generated by `wrangler types`.
- `migrations/` — D1 schema migrations (never edited once released).
<!-- project:end architecture -->

## Project configuration

<!-- stack:begin configuration -->
- **TypeScript** with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `verbatimModuleSyntax`
  in `tsconfig.json`; **Node.js** version from `engines` in `package.json`; **npm** with a committed
  `package-lock.json`.
- **ESLint** (flat config) with **typescript-eslint** `strictTypeChecked` (type-aware, `projectService`) and
  **eslint-plugin-sonarjs**; **Prettier**; **Vitest** with `@vitest/coverage-v8`.
<!-- stack:end configuration -->
<!-- project:begin configuration -->
- **Cloudflare Workers** with **Wrangler**; tests run in `@cloudflare/vitest-pool-workers`, which has no V8
  coverage, so coverage uses `@vitest/coverage-istanbul` (lcov) instead of `@vitest/coverage-v8` — see
  [`.squad/stack.md`](/.squad/stack.md) and decision 0010.
- Commits follow Conventional Commits (`feat:`, `fix:`, …); everything in the repository is written in English.
<!-- project:end configuration -->

## Code style

<!-- stack:begin code-style -->
ES modules with `import type` for type-only imports; no `any` — `unknown` narrowed by a type guard at the
boundary; no `as` cast and no non-null assertion to silence the compiler (a cast only after a runtime check,
with a comment); `@ts-expect-error` with a reason instead of `@ts-ignore`; exhaustive `switch` over a union
with a `never` check; `readonly` where nothing mutates; `const` by default; `===` only; async/await; every
promise awaited or explicitly handled; formatting is Prettier's, never hand-tuned.
<!-- stack:end code-style -->
<!-- project:begin code-style -->
<!-- project:end code-style -->

## Testing

<!-- stack:begin testing -->
**Unit tests are mandatory for newly written code.** One test file per module under test
(`<module>.test.ts`), test names describing scenario and expected result, an assertion message where the
assertion API accepts one, no real network or clock (the one exception, a time bound tested as a ratio of
two durations, is in `docs/UNIT_TESTS.md`). Test code is type-checked and linted like production code.
<!-- stack:end testing -->
Full conventions, including the project's test doubles and the checklist to run before committing a new
test, are in [`UNIT_TESTS.md`](/docs/UNIT_TESTS.md).

## Related skills

Project-specific workflow skills live under `.claude/skills/` and run in Claude Code:

- `create-pr` — verify (format, build, tests, analyzer and coverage gates), review the change locally,
  then open a PR following [`.github/pull_request_template.md`](/.github/pull_request_template.md).
- `squad-issue` — fix a GitHub issue with the squad: the Lead plans and picks a tier
  (`docs` / `patch` / `trivial` / `standard` / `security`), the Devil's Advocate challenges `standard`/`security`
  plans that weigh options once, Security reviews plan and diff of `security` changes, the Tester writes failing tests first,
  the Dev implements until the *Coverage gate* passes, the Code Officer clears format and analyzer
  diagnostics, the Reviewer reviews the diff, the PR is approved by checklist (the Lead decides what is
  open), then a PR referencing the issue is opened.
- `squad-spec` — the same squad pipeline for a new feature, planned as `spec.md`, `plan.md` and
  `tasks.md` in a working folder under `specs/`.
- `decision-consolidate` — merge unreleased decision records (Superseded chains, records on one topic) into
  one record each, delete the obsolete ones, lift behavior that sits in records into the area documents and fix
  links and index; released records stay untouched.
- `review-pr` — review an open pull request against this project's stack, analyzer, security and
  unit-test conventions, and post the findings with an explicit verdict.

Review is defined in `.claude/agents/squad-reviewer.md`, which Claude Code runs as a subagent (read-only,
pinned to Opus, fresh context). `create-pr` and the squad skills call it *before* pushing, so a change is reviewed while it is
still local; `review-pr` calls the same agent for a pull request that is already open. The review
checklist, the integration-surface sweep, the blocking/non-blocking severity model and the "round 1 is a
full review, later rounds review only the delta" rule live in that one file, so they are identical either
way.

The squad skills run a multi-role pipeline defined in [`.squad/`](/.squad/team.md) — Lead (plan, decisions,
PR approval decisions), Devil's Advocate (one plan challenge), Security (plan and diff on the `security` tier), Tester (tests first,
coverage), Dev, Code Officer (format, analyzers) and Reviewer — as Claude Code subagents under
`.claude/agents/squad-*.md` (read-only where the role demands it: a hook in each agent denies Git and
GitHub writes, so only the orchestrating session commits, pushes and posts), with the loop limits and
escalation rules in [`.squad/routing.md`](/.squad/routing.md). Stack commands live in [`.squad/stack.md`](/.squad/stack.md),
the project's guarantees, security areas and integration surface in
[`.squad/project.md`](/.squad/project.md). Their working records (`plan.md`, `log.md`, for features also
`spec.md` and `tasks.md`) live under `specs/` on the work branch only; before the PR they are posted as a
comment on the issue and removed, so `main` keeps no working records. An issue or feature PR never changes
the squad or these instructions (`.squad/` except `stack.md` and `project.md`, `.claude/`, `CLAUDE.md`,
`.github/copilot-instructions.md`): squad
lessons are filed as GitHub issues labelled `squad` and never fixed in a product PR. The squad and these
rules come from the template repository named in `.squad/template.json`: a lesson about a template-managed
file becomes an issue there and is rolled out with its `adopt-template` skill; a lesson about project
knowledge (`.squad/stack.md`, `.squad/project.md`, a project block) becomes an issue here and is worked in
a squad-maintenance PR checked with `python3 .squad/tools/config-check.py` (`.squad/routing.md`,
*Squad lessons*); `python3 .squad/tools/scope-check.py` reports a squad file in a product change. The user
acts as Product Manager and is only asked when the Lead escalates. Pull requests are merged with *Squash and merge*, so only the
PR title and description reach `main`.

The reasoning behind code decisions — why something was built the way it was — is recorded by the Lead
as one decision record per decision in [`docs/decisions/`](/docs/decisions/README.md) (unreleased records are
edited in place, released ones are append-only and superseded), not in `ARCHITECTURE.md`. What holds today —
formats, limits, error behavior, guarantees — is written once in the area document of the change in
[`docs/areas/`](/docs/areas/README.md), which the same pull request updates. Read the relevant records and area
documents before changing code they cover, and do not contradict an accepted record without changing it
(unreleased) or superseding it (released).

Two rules these skills enforce that are easy to get wrong:

- **A pull request documents the change, not how it was produced.** The internal review loop — its
  pass count, its findings, the commits that resolved them — never appears in the PR title, body or
  commit messages.
- **A finding posted as a review comment gets worked in that pull request**, blocking or not. It is
  never deferred to "the next change that touches this code": no such change is scheduled, and the
  session holding the context to act on it will not exist later. If it really should not be fixed
  here, reply with the reason or open a linked issue now — then resolve the thread.

## Pull requests, contributing and architecture

Follow [`CONTRIBUTING.md`](/docs/CONTRIBUTING.md) for branch/PR naming (`[area] Description`), the PR
checklist in [`.github/pull_request_template.md`](/.github/pull_request_template.md), and the
stability policy. Consult [`ARCHITECTURE.md`](/docs/ARCHITECTURE.md) before changing the behavior it
describes — the guarantees listed in [`.squad/project.md`](/.squad/project.md) are deliberate, not
incidental behavior.
