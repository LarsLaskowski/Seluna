# Plan: Update workflow for users' copies

Source: [spec.md](spec.md)
Status: Revised (1)
Tier: security — a new workflow gets `contents: write` and pushes to `main`, which deploys: a CI permission and the trust of what reaches the deploy (`.squad/routing.md`, *Tiers*).
Security areas touched: CI configuration (new `.github/workflows/update.yml` with `contents: write`, handling of the workflow token and of the upstream release answer and tag as external input); build and test configuration (`vitest.config.ts`, `package.json`, `tsconfig.json` if needed); dependency (`@types/node`, dev only); `.squad/project.md` (*Security areas*: a new entry *Update workflow*)

## Problem / root cause

See [spec.md](spec.md), *Problem*.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | The `package.json` version stays at the last release until the release pull request, and the button clones `main`, so a copy can hold commits after `vX` | `docs/CONTRIBUTING.md:116-117`; `README.md:13` (button URL names the repository, no ref); decision 0030 *Consequences* | confirmed |
| 2 | `v0.4.0` changed `codeql.yml` and `release.yml` since `v0.3.0`; `main` changes no workflow file since `v0.4.0` (the spec's earlier claim that the next release changes both was refuted and is fixed in S7 and Q1) | `git diff --stat v0.3.0 v0.4.0 -- .github/workflows` (2 files); `git diff --stat v0.4.0 HEAD -- .github/` (empty) | confirmed |
| 3 | `GITHUB_TOKEN` cannot push a change under `.github/workflows/` | github/docs `github-token-scope-descriptions.md`, `choosing-permissions-for-a-github-app.md` (spec Q1) | confirmed |
| 4 | A push of one commit whose tree under `.github/workflows/` equals its parent's is accepted with `contents: write` | to verify: live run on a copy (task 13), Product Manager with the orchestrator, before the PR is marked ready | unverified |
| 5 | Workers Builds builds and deploys a push made with the workflow token (spec Q6, AC1's last part) | to verify: same live run: a Workers Build starts for the pushed commit and `/health` reports the new version (task 13) | unverified |
| 6 | The button's copy either shares history with upstream or has a first commit whose files equal an upstream commit apart from `wrangler.jsonc` and `.github/workflows/` (spec Q2, S9) | to verify: the Product Manager on the maintainer's copy from issue #46 (task 1a, before task 5), confirmed live in task 13: `git rev-list --max-parents=0 HEAD`, `git merge-base HEAD v0.4.0`, and `git diff --stat <upstream commit> <root>` against upstream `main`; not reachable from the session (repository-scoped API) | unverified |
| 7 | `ubuntu-latest` (24.04) has Bash 5.2, Git 2.55, jq 1.7 and curl 8.5 | `actions/runner-images` `images/ubuntu/Ubuntu2404-Readme.md` (fetched 2026-10-22) | confirmed |
| 8 | `git merge-tree --write-tree` takes `--merge-base=<commit>`, `--name-only`, `-z`, `-X <option>`, exits 0 for a clean merge and 1 for conflicts, and prints the result tree first | git `Documentation/git-merge-tree.txt` at v2.43.0; `git merge-tree -h` with local Git 2.43.0 | confirmed |
| 9 | With `concurrency` and `cancel-in-progress: false` one run is in progress and at most one waits; a newer waiting run cancels the older waiting one | github/docs `data/reusables/actions/actions-group-concurrency.md` (default `queue: single`) | confirmed |
| 10 | `git merge-tree -X no-renames` turns a release's rename of a locally changed file into a modify/delete conflict (E11) | Devil's Advocate on Git 2.43.0: exit 0, the copy's change carried to the new name (also with `git merge`); a delete does conflict. Step 11 detects renames itself | refuted |
| 11 | `@types/node` and the Workers types type-check together under `tsc --noEmit` | to verify: the Dev in step 4 (skeleton); fallback in decision 0032 | unverified |
| 12 | `@cloudflare/vitest-pool-workers` 0.23's `cloudflareTest` plugin works inside one Vitest 4 project beside a `node` project | to verify: the Dev in step 4: `npm test` runs all existing tests and the new file | unverified |
| 13 | The captured `test/fixtures/github/release-latest.json` is the latest-release answer (`tag_name` `v0.4.0`) | the file and `test/fixtures/github/README.md` | confirmed |
| 15 | The header key `http.https://github.com/<copy>.git/.extraheader` matches `https://github.com/<copy>.git/info/refs` and not `https://github.com/LarsLaskowski/Seluna.git`, `<copy>-x.git` or another case; the key `https://github.com/<copy>/` matches nothing | Security, `git config --get-urlmatch http.extraheader <url>` on Git 2.43 (plan review, SHA 26823ca) | confirmed |
| 16 | curl `--max-filesize 1048576` stops a larger answer with exit 63 | Security's measurement (plan review) | confirmed |
| 14 | No workflow, Worker code or setting reads `update.yml` or the trailer; the Worker is unchanged | `grep -rn update src/ .github/` | confirmed |

## Tests per criterion

All tests in `test/update-workflow.test.ts` (Node project); the script runs exactly as taken from
`.github/workflows/update.yml`.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | updates a copy on vX to vY with one commit whose parent is the start commit and whose trailer is `Seluna-Release: vY`; keeps a local change in another file; keeps the button's `database_id` line and a renamed `name` in `wrangler.jsonc` while the release changes `compatibility_date`; summary is exactly `Updated Seluna from vX to vY.`; the pushed `package.json` says `Y`; under the script's environment `git config --get-urlmatch http.extraheader` (recorded by the `git` wrapper at the clone) returns the header for `https://github.com/<copy>.git/info/refs` and nothing for `https://github.com/LarsLaskowski/Seluna.git/info/refs`; the script prints `::add-mask::` once, before the clone; the Workers Build is fact 5 | `test/update-workflow.test.ts` |
| AC2 | ends green with the already-on-latest summary and leaves origin unchanged when the version equals the release; a second run after a first update ends the same way; the workflow text declares `concurrency` group `seluna-update` with `cancel-in-progress: false` and the script clones `main` at its start | `test/update-workflow.test.ts` |
| AC3 | ends green with the original-repository summary for `LarsLaskowski/Seluna` and `larslaskowski/SELUNA`, calls `curl` zero times and leaves origin unchanged | `test/update-workflow.test.ts` |
| AC4 | fails with the conflict message on the same line and on an adjacent line; names every conflicting file once, sorted; release deletes a file the copy changed; release renames a file the copy changed, with and without an edit of the new file (conflict names the old path); a file name outside the allow-list prints `(a file with an unusual name)`; origin unchanged in each | `test/update-workflow.test.ts` |
| AC5 | E2 for no answer (curl exit 28), status 404, status 500, a body over 1 MiB, invalid JSON, `tag_name` missing or a number; E3 for `v1.2`, `v01.2.3`, `v1.2.3-rc.1`, `1.2.3`, a ten-digit part, a tag with an inner newline, `v1.2.3` followed by a trailing newline, and a valid tag missing upstream; output never contains a marker planted in the answer; origin unchanged | `test/update-workflow.test.ts` |
| AC6 | E4 for `package.json` without version, version `1.2`, version `0.6.0` while the release is `v0.5.0`, `0.4.0` followed by a trailing newline; the version text is not printed | `test/update-workflow.test.ts` |
| AC7 | `v1.4.0` to `v2.0.0` fails with the S6 message without the input and updates with `ALLOW_MAJOR=true`; `v0.4.0` to `v1.0.0` updates without it | `test/update-workflow.test.ts` |
| AC8 | E5 when origin `main` moves after the clone (a fake `git` on `PATH` pushes a commit to origin before it runs `merge-tree`), origin keeps that commit; E7 for `refs/heads/other`; E8 when origin refuses every push (pre-receive hook); E16 when a fake `git` on `PATH` fails `merge-tree` with exit 128; the script contains no `--force`, `-f` push or `+` refspec | `test/update-workflow.test.ts` |
| AC9 | release changes `codeql.yml`, adds `update.yml`, removes `old.yml`: files under `.github/workflows/` byte for byte as before, the pushed commit changes no path under it, the summary lists the three; a file the copy already took over is not listed; no line when none differs; a local change to a workflow file the release changes is no conflict and is listed; a copy-only workflow file is not listed | `test/update-workflow.test.ts` |
| AC10 | the AC1 and AC4 cases for a fork (shared history) and for a button copy (unrelated root) give the same tree and messages | `test/update-workflow.test.ts` |
| AC11 | copy built from an upstream commit between vX and vY: a change revised before vY raises no conflict and ends as in vY, a change reverted before vY is gone, a local change is kept; a copy updated before by the workflow (and with a commit of the owner after that update) merges from the trailer's release; a fork whose upstream history carries a `Seluna-Release: v0.1.0` trailer in a squash commit is updated from the merge base; a button copy whose first commit lacks the upstream workflow files is matched | `test/update-workflow.test.ts` |
| AC12 | no trailer, no shared history, root matches no upstream commit: E15 message, origin unchanged; a trailer naming a tag upstream lacks: E15; two upstream commits match the root and differ in `wrangler.jsonc`: E15 | `test/update-workflow.test.ts` |
| AC13 | every `docs/update.md, "<section>"` the workflow text names is a heading of `docs/update.md`; `docs/setup.md` links `update.md`; the rest of AC13 by the Reviewer against its list | `test/update-workflow.test.ts` |

## Approach

**The workflow** (`.github/workflows/update.yml`, Dev), no action, one job, one step:

- `name: Update Seluna`; `on: workflow_dispatch` with the boolean input `allow-major-version` (description `Allow a
  new major version`, default `false`); top-level `permissions: contents: write` and nothing else; `concurrency:
  {group: seluna-update, cancel-in-progress: false}`; job `update` on `ubuntu-latest`, `timeout-minutes: 10`; step
  `id: update`, `shell: bash`, `env: ALLOW_MAJOR: ${{ inputs.allow-major-version }}` and `REPO_TOKEN: ${{
  github.token }}`; no `${{ }}` inside `run`.
- The script starts `set -Eeuo pipefail`, `LC_ALL=C`, an `ERR` trap that fails with E16, works in a `mktemp -d`.
  Every failure prints `::error::<message>`, writes the message to `$GITHUB_STEP_SUMMARY` and exits 1; a green end
  writes the summary and exits 0. Nothing else is printed but fixed texts; Git's own output goes to `/dev/null`
  except on the E16 path, where it is not printed either.

**Order of the checks** (each before any later step, so nothing is fetched or pushed early):

1. `GITHUB_REPOSITORY` equal to `LarsLaskowski/Seluna` ignoring case → S3, exit 0.
2. `GITHUB_REF` not `refs/heads/main` → E7.
3. `curl` `https://api.github.com/repos/LarsLaskowski/Seluna/releases/latest` with `--proto =https`, `--max-time 10`,
   `--max-filesize 1048576`, `Accept: application/vnd.github+json`, `-w '%{http_code}'` and the body to a file; the
   `Authorization: Bearer` header is read from a file in the temporary directory (`-H @<file>`, mode 600), never from
   the command line. E2 reasons, fixed: curl failed (exit 63 included) → `GitHub did not
   answer`; 404 → `there is no latest release`; other non-200 → `GitHub answered with an error`; not JSON or
   `tag_name` not a string → `the answer could not be read`.
4. Tag checked inside `jq` on the raw string, anchored on the whole text: `jq -e -j '.tag_name | select(type ==
   "string" and test("\\Av(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\z"))'`, so a trailing
   newline fails (command substitution would strip it) → else E3.
5. Clone the copy: `git clone --no-tags --branch main https://github.com/${GITHUB_REPOSITORY}.git` with the token
   only in `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`, key exactly
   `http.https://github.com/${GITHUB_REPOSITORY}.git/.extraheader` (the clone URL plus `/`, fact 15), value
   `AUTHORIZATION: basic <base64 of x-access-token:token>`, never on a command line or on disk; before that one
   line `::add-mask::<base64 value>`; `core.hooksPath=/dev/null`.
   Record the start commit.
6. Version of `HEAD:package.json` (checked in `jq` like step 4, without the `v`) → else E4; equal → S2; newer → E4.
7. Major: copy major ≥ 1, release major higher, `ALLOW_MAJOR` not exactly `true` → S6.
8. `git fetch --no-tags https://github.com/LarsLaskowski/Seluna.git refs/tags/vY:refs/seluna/vY` → failure E3.
9. Base (S9), first that applies:
   - the newest commit of `git log --first-parent HEAD ^refs/seluna/vY` whose subject is exactly `Update Seluna to
     v<A.B.C>`, whose committer email is `41898282+github-actions[bot]@users.noreply.github.com` and that carries a
     `Seluna-Release` trailer equal to that version (checked with the rule of step 4, its tag fetched the same way;
     invalid or not fetchable → E15) — a trailer in any other commit, such as an upstream squash commit in a fork,
     counts for nothing;
   - `git merge-base HEAD refs/seluna/vY`;
   - the single root of `HEAD` compared with every commit of `git rev-list refs/seluna/vY` by
     `git diff --quiet <c> <root> -- . ':(exclude)wrangler.jsonc' ':(exclude).github/workflows'`: the matches are
     collected; when they all have the same `wrangler.jsonc` and `.github/workflows` (same blob and tree ids, or
     absent alike) the newest is the base, otherwise E15.

   None → E15.
10. Release tree without workflow changes: a temporary index from `vY`, `.github/workflows` replaced by the base's
    (or removed when the base has none), written as a tree and wrapped by `git commit-tree` as commit `T`.
11. Renames: `git diff --find-renames --name-status -z <base> T`; every `R` entry whose source path differs between
    `<base>` and `HEAD` (`git diff --quiet <base> HEAD -- <source>` fails) adds that source path to the conflict list.
    Then `git merge-tree --write-tree --name-only -z --no-messages --merge-base=<base> HEAD T` (no `-X no-renames`,
    fact 10): exit 0 → result tree, exit 1 → its paths join the conflict list, other → E16. A non-empty list → E1
    with the paths unique, sorted and joined by `, `.
12. Commit: `git commit-tree <tree> -p <start>` with message `Update Seluna to vY`, blank line, `Seluna-Release: vY`;
    author and committer `github-actions[bot]` `<41898282+github-actions[bot]@users.noreply.github.com>`.
13. `git push origin <commit>:refs/heads/main` (never `--force`, never `+`). On failure `git ls-remote origin
    refs/heads/main`: differs from the start commit → E5, else E8.
14. Workflow-file line: paths of `git diff --no-renames --name-only -z <base> refs/seluna/vY -- .github/workflows`
    whose content in `HEAD` differs from `vY`'s (`git diff --quiet HEAD refs/seluna/vY -- <path>`), sorted.

A printed path matches `^[A-Za-z0-9._/-]{1,255}$`, else it is printed as `(a file with an unusual name)`.

**Summary layout:** the message of the outcome as the first line; on S1 with workflow files, a blank line and the S7
line. Failures: the same message once on stdout as `::error::` and once in the summary.

**Tests** (Tester): `test/update-workflow.ts` builds a sandbox under a temporary directory: a bare upstream with
tagged commits, a bare origin for the copy (fork-like clone, button-like unrelated root with `wrangler.jsonc` edits,
or between-releases), a global Git config file (`GIT_CONFIG_GLOBAL`) with `url.<local>.insteadOf` for
`https://github.com/LarsLaskowski/Seluna.git` and `https://github.com/<copy>.git`, a fake `curl` first on `PATH` that
writes the answer built from `test/fixtures/github/release-latest.json` (its `tag_name` replaced) or a status, a
failure or a planted marker, and a fake `git` wrapper (only for `moveMainDuringRun`, `failingGitCommand` and
`recordHeaderMatch`) that pushes to origin, fails, or records `git config --get-urlmatch http.extraheader` for the
copy's and the upstream URL before it calls the real Git. `runUpdate` passes an explicit environment, never
`process.env`: `PATH` (fakes first, then the system directories), `HOME` inside the sandbox, `GIT_CONFIG_GLOBAL`,
`GIT_CONFIG_NOSYSTEM=1`, `GIT_ALLOW_PROTOCOL=file`, a dummy `REPO_TOKEN`, `LC_ALL=C`. It extracts the `run: |` block of step `id: update`
by indentation and runs it with `bash` and the environment above, `GITHUB_STEP_SUMMARY` a file. No network, no
clock.

## Options considered

Weighed in [decision 0031](../../docs/decisions/0031-update-workflow-for-copies.md) (how the update is built, how
the release reaches `main`, the base, renames) and [decision 0032](../../docs/decisions/0032-node-test-project-for-workflow-scripts.md)
(how it is tested). Chosen: logic inline in `update.yml` without actions, one commit, base as step 9, tests through a
Node Vitest project. Lost: a TypeScript script beside a thin YAML (two files for S5, drift), `actions/checkout` with
a sync action (third-party code with the token, Dependabot churn, upstream commits pushed), `git merge` of the tag
(refused for workflow files, needs shared history), the `vX` tag as base (spec M1), only a live run (no regression
tests).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| CI | `.github/workflows/update.yml` | new: the update workflow |
| Tests | `vitest.config.ts` | two projects: `workers` (existing config, every test but `test/*-workflow.test.ts`), `node` (`environment: "node"`, `test/*-workflow.test.ts`); coverage settings unchanged |
| Tests | `package.json`, `package-lock.json` | dev dependency `@types/node` `^24` |
| Tests | `test/update-workflow.ts`, `test/update-workflow.test.ts` | new: harness and tests |
| Tests | `tsconfig.json` | only if fact 11 fails: the fallback of decision 0032 |

## Signatures (for the Dev's skeleton)

Workflow skeleton (Dev, step 4): the full YAML above, the `run` block only `printf '::error::Not implemented\n'` and
`exit 1`, so the tests load and fail.

Harness (Tester, `test/update-workflow.ts`, with `/// <reference types="node" />`):

```ts
export type FileTree = Readonly<Record<string, string | null>>; // null deletes the file
export type ReleaseAnswer =
  | { readonly kind: "release"; readonly tag: string }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "body"; readonly body: string }
  | { readonly kind: "no-answer" };
export type CopyKind = "fork" | "button";
export interface Sandbox { readonly root: string; readonly upstream: string; readonly origin: string; readonly copyName: string }
export interface RunOptions {
  readonly release: ReleaseAnswer;
  readonly repository?: string; // default the sandbox's copy name
  readonly ref?: string; // default "refs/heads/main"
  readonly allowMajor?: boolean;
  readonly refusePush?: boolean;
  readonly moveMainDuringRun?: boolean;
  readonly failingGitCommand?: string;
  readonly recordHeaderMatch?: boolean;
}
export interface RunResult {
  readonly exitCode: number; readonly stdout: string; readonly stderr: string; readonly summary: string;
  readonly curlCalls: number; readonly originMainBefore: string; readonly originMainAfter: string;
  readonly headerMatches: Readonly<Record<string, string>>; // URL -> header value, "" when none applies
}
export function createSandbox(): Sandbox;
export function removeSandbox(sandbox: Sandbox): void;
export function commitUpstream(sandbox: Sandbox, files: FileTree, tag?: string): string;
export function createCopy(sandbox: Sandbox, kind: CopyKind, fromCommit: string, edits: FileTree): string;
export function commitToCopy(sandbox: Sandbox, files: FileTree, message: string): string;
export function readOriginFile(sandbox: Sandbox, path: string, ref?: string): string | null;
export function originCommit(sandbox: Sandbox, ref: string): { readonly parents: readonly string[]; readonly message: string; readonly changedPaths: readonly string[] };
export function extractUpdateScript(workflowText: string): string;
export function runUpdate(sandbox: Sandbox, options: RunOptions): RunResult;
```

## Test files

`test/update-workflow.test.ts` (one file for the one module under test, `update.yml`), its harness
`test/update-workflow.ts`. Like `test/migrations.test.ts`, the test of a non-`src` artifact lives in `test/`.

Existing test code that calls a changed signature: none; the existing tests move into the `workers` project unchanged.

Files no unit test can cover: none measured. `.github/workflows/update.yml` is Bash, outside `COVERAGE_PATHSPECS`
and Istanbul's `src/**`; it is exercised by the tests, not measured, so no exclusion is added (decision 0032).

## Areas

- [Deployment](../../docs/areas/deployment.md): new section *Update* (spec, *Area documents*), *Scope* names the
  update of a copy, *Limits and errors* the failed build after an update; index row in `docs/areas/README.md`.
- [Scheduled jobs](../../docs/areas/scheduled-jobs.md): *Not here* gains "applying a release: Deployment".

## Documentation updates

| File | Change | Owner |
| ---- | ------ | ----- |
| `docs/update.md` (new) | the guide of AC13, sections exactly `Start the update`, `Add the workflow to an older copy`, `Conflicts`, `New major version`, `After the update`, `Permissions`, `Workflow files`, `Unknown base` | Dev |
| `docs/setup.md` | *Updates* links `update.md` | Dev |
| `CHANGELOG.md` | *Added* under `[Unreleased]`: the update workflow | Dev |
| `docs/CONTRIBUTING.md` | release steps: a release that changes `update.yml` says so in its notes; `update.yml` stays free of actions and works with later releases (decision 0031) | Dev |
| `.squad/stack.md` (*Layout*), `docs/UNIT_TESTS.md` (*Test stack*, *Where tests live*) | the Node project for `test/*-workflow.test.ts` | Dev |
| `.squad/project.md` | *Security areas*: new entry *Update workflow* (`contents: write` only, no action, token only in the environment for the copy's URL, fixed upstream, tag allow-list, bounded answer narrowed to `tag_name`, no force push, no workflow file pushed, fixed texts) | Dev |
| `docs/areas/deployment.md`, `docs/areas/README.md`, `docs/areas/scheduled-jobs.md` | as *Areas* | Lead |
| `docs/ARCHITECTURE.md` (*Deployment*) | one sentence: the owner applies a release with the update workflow, linking decision 0031 and the area | Lead |

Sweep: `grep -n -i "updat"` over `README.md`, `docs/ARCHITECTURE.md`, `docs/areas/*.md`: only `README.md:88` (release
table, already names the feature) and the *Deployment* sentence above; `.squad/project.md` *Security areas* lists
every guarded surface, hence its new entry.

## Architecture check

No guarantee of `.squad/project.md` changes: the Worker, its data and its routes are untouched; each user's data stays
in their account (the run reads only the public upstream). The release guarantee (decision 0009) is relied on: only
the latest full release is applied. *Deployment* in `docs/ARCHITECTURE.md` gains the update path.

## Security considerations

- [ ] Limits: the release answer is limited to 1 MiB raw bytes by `curl --max-filesize` before parsing (no decoding);
  tag parts at most nine digits; printed paths at most 255 allow-listed characters.
- [ ] Failure texts: every exit path prints only a fixed text of the spec (E1–E8, E15, E16, S2, S3, S6, S7) with
  versions and allow-listed paths; Git, `curl` and `jq` output is never printed; the `ERR` trap gives E16.
- The write token is only in the job's environment, a mode-600 header file for `curl` and Git's environment
  configuration under the exact key of fact 15, masked in base64 form, never sent to the upstream fetch (AC1 test); no action runs; hooks are off in the clone; no code of the release runs (merge
  drivers and filters need configuration the run never sets).
- The release tag is external input: allow-listed before it enters a ref, a message or a summary.

## Decision records

- `docs/decisions/0031-update-workflow-for-copies.md` (Proposed)
- `docs/decisions/0032-node-test-project-for-workflow-scripts.md` (Proposed)

## Challenge

- M1 (fact 10 refuted, `-X no-renames` follows the rename): accepted. Step 11 detects the release's renames itself
  and lists a renamed source path the copy changed as a conflict, before and beside `merge-tree`; `-X no-renames` is
  dropped; fact 10 is marked refuted; the AC4 test covers a rename with and without an edit of the new file. E11 stays
  as the spec says.
- m1 (extraheader key): accepted with Security B1 below.
- m2 (the button's copy may lack workflow files): accepted. The root comparison also excludes `.github/workflows`;
  spec S9 and E15 say so; AC11 has the test.
- m3 (matches differing only in `wrangler.jsonc`): accepted. All matches are collected; differing `wrangler.jsonc`
  or workflow files end in E15 (spec E15); AC12 has the test.
- m4 (fact 6 before step 9): the design does not depend on the answer: step 9 handles shared history (merge base) and
  an unrelated root (root match), and fails closed otherwise. So the plan goes on with fact 6 unverified, and the
  orchestrator asks the Product Manager now (task 1a, in parallel with groups G1 and G2) for three read-only outputs
  on the issue #46 copy: `git rev-list --max-parents=0 HEAD`, `git merge-base HEAD v0.4.0` (after fetching upstream
  tags), and `git diff --stat <upstream commit the copy was created from> <root>`. If the answer shows another form
  (the root differs from that commit in more than `wrangler.jsonc` and the workflow files), the Lead revises step 9
  before task 5. Task 13 confirms it live. The trailer rule is the newest in the first-parent history (Security B2);
  the AC11 test includes an owner's commit after an earlier update.

## Security review

- B1 (extraheader key does not match the clone URL): accepted. Step 5 names the key
  `http.https://github.com/${GITHUB_REPOSITORY}.git/.extraheader` (fact 15); the AC1 test records `--get-urlmatch`
  under the script's environment for the copy's and the upstream URL.
- B2 (a trailer in upstream history picks a wrong base): accepted. Only a first-parent commit not reachable from the
  release, with the exact subject, the bot committer and a matching trailer counts (step 9); AC11 tests a fork whose
  upstream history carries a trailer.
- N1 (a trailing newline survives command substitution): accepted. Tag and version are checked inside `jq` with
  whole-text anchors (steps 4 and 6); AC5 and AC6 test a trailing newline.
- N2 (token on curl's command line): accepted. The header comes from a mode-600 file (`-H @<file>`, step 3).
- N3 (harness environment): accepted. `runUpdate` passes the explicit environment listed under *Approach*.
- N4 (mask the base64 header): accepted. One `::add-mask::` line before the clone (step 5); AC1 asserts it.
- The accepted forms of the external inputs, re-checked: the tag and the version only as a whole JSON string matching
  the anchored rule (no prefix, suffix, sign, leading zero, newline, more than nine digits per part); a trailer only
  from the bot's own first-parent commit and under the same rule; a printed path only from the allow-list; the
  release answer only up to 1 MiB (fact 16), and only `tag_name` is read.

## Out of scope / follow-ups

The spec's *Out of scope*. No follow-up issue now; a token add-on for workflow files (spec Q1) would be a new issue
when the Product Manager asks for it.
