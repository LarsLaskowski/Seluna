# Plan: Release workflow triggered by version tags

Source: Issue #3
Status: Draft
Tier: security — a new GitHub workflow that holds a `contents: write` token is CI configuration with a new
permission, beyond what `patch/security` allows.

## Problem / root cause

Feature: there is no release workflow. `.github/workflows/` holds only `ci.yml` and `codeql.yml`; decision 0009
and `docs/CONTRIBUTING.md` (*Versioning and releases*) already say a release is cut by pushing a `v*` tag on
`main`, but nothing acts on such a tag.

Claims of the issue, checked:

- *Releases are only ever created this way* — consistent with decision 0009 and the guarantee in
  `.squad/project.md`; there are no tags and no releases yet (`git tag` is empty), so 0009 is unreleased and is
  extended in place.
- *`version` in `package.json`* — confirmed: `"version": "0.0.0"` (`package.json` line 3); `package-lock.json`
  carries the same version twice (lines 3 and 9), which `npm version` keeps in step.
- *The tag's section from `CHANGELOG.md`* — confirmed format: Keep a Changelog 1.1.0, currently only
  `## [Unreleased]` with `### Added`; no link reference definitions at the bottom yet. A released section will be
  headed `## [A.B.C] - YYYY-MM-DD`.
- *GitHub's generated release notes after the changelog section* — confirmed from `gh release create --help`:
  "Additional release notes can be prepended to automatically generated notes by using the `--notes` flag"
  (`--notes-file` is the file form of `--notes`); the REST field `generate_release_notes` likewise prepends a
  given body.
- *Lint, type check and tests* exist as scripts (`lint`, `typecheck`, `test`), as do `format:check` and `build`.
- *Versions below 1.0.0 are published as normal releases* — adopted; it is also what the daily release check
  (ARCHITECTURE, *Cron triggers*) needs, because GitHub's "latest release" ignores pre-releases.
- *`contents: write` for the release job* — adopted, and narrowed further: only the job that creates the release
  gets it (decision 0009, option 4).

Related gap found on the way: decision 0009 says the tag is pushed **on `main`**, but nothing would stop a tag on
a feature-branch commit. The workflow checks that the tagged commit is an ancestor of `origin/main` (AC4).

Accepted forms of the tag guard (git ref-name rules: no space, `~ ^ : ? * [ \`, control character, `..`, `@{`;
`/` allowed; the trigger glob `v*` does not match `/`, so `v1/x` starts no run). With `LC_ALL=C` and the bash
test `[[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]`:

| Tag | Run starts | Guard |
| --- | ---------- | ----- |
| `v0.1.0`, `v1.2.3`, `v10.20.30` | yes | accepted |
| `v0.1`, `v1`, `v1.2.3.4` | yes | rejected |
| `v1.2.3-rc.1`, `v1.2.3+build.5`, `v1.2.3-` | yes | rejected |
| `v`, `va.b.c` | yes | rejected |
| `vv1.2.3` | yes | rejected |
| a tag with non-ASCII digits, e.g. `v` followed by U+0661 `.` U+0662 `.` U+0663 (Arabic-Indic digits) | yes | rejected (`LC_ALL=C`: `[0-9]` is ASCII only) |
| `v01.2.3` (leading zero) | yes | accepted by the issue's regex, then rejected by AC3 because a valid `package.json` version cannot have a leading zero |
| `V1.2.3`, `1.2.3`, `release-1.2.3` | no (glob is case-sensitive, needs leading `v`) | not reached |
| `v1.2.3/x` | no (`*` does not match `/`) | not reached |

## Acceptance criteria

Error texts below are exact (printed as GitHub `::error::` annotations; `<tag>` is the pushed tag name,
`<version>` the tag without `v`, `<pkg>` the `package.json` version).

- [ ] AC1: Pushing `v0.1.0` on a `main` commit whose `package.json` version is `0.1.0` and whose `CHANGELOG.md`
  has a non-empty `## [0.1.0] - <date>` section creates a normal (not pre-release) GitHub release `v0.1.0`, titled
  `v0.1.0`, whose body is that section's content (without its heading) followed by GitHub's generated release
  notes.
- [ ] AC2: Any tag that does not match `^v[0-9]+\.[0-9]+\.[0-9]+$` exactly fails the first step of the workflow
  with `Tag '<tag>' is not a release tag; expected vMAJOR.MINOR.PATCH, for example v1.2.3.` and creates no release;
  every case of the table above that starts a run behaves as listed.
- [ ] AC3: A well-formed tag whose version differs from `package.json` fails with
  `Tag <tag> does not match version <pkg> in package.json; set "version" to <version> before tagging.` and creates
  no release.
- [ ] AC4: A well-formed tag on a commit that is not contained in `origin/main` fails with
  `Tag <tag> points to a commit that is not on main; releases are cut from main only.` and creates no release.
- [ ] AC5: A failure of format check, lint, type check, tests or build creates no release.
- [ ] AC6: When `CHANGELOG.md` has no section headed `## [<version>]` (exactly, or followed by a space and the
  date), or the section has no non-blank line, the workflow fails with
  `CHANGELOG.md has no entries under "## [<version>]"; move the Unreleased entries to that section before tagging.`
  and creates no release. The section ends at the next line starting with `## ` or at the first link reference
  definition (a line matching `^\[[^]]+\]: `), whichever comes first; leading and trailing blank lines are dropped.
  `## [0.1.0]` must not match `## [0.1.0.1]` or `## [10.1.0]`.
- [ ] AC7: Only the release job has `contents: write`; the workflow default is `contents: read`. The tag name
  reaches every shell only through an environment variable, never through `${{ }}` inside a `run:` script.
- [ ] AC8: `docs/CONTRIBUTING.md` documents the maintainer's release steps and the semver policy (text under
  *Documentation updates*).

No content is supplied verbatim by the issue except the regex, which is used unchanged.

## Verification without tests

The change touches no production or test code (a workflow and Markdown only), so steps 4 (*Skeleton*),
5 (*Tests first*) and the *Coverage gate* are not applicable. Each criterion is verified instead:

| AC | Verified by | Who, when |
| -- | ----------- | --------- |
| all | *Analyzer gate* (actionlint with shellcheck on the `run:` scripts) on `.github/workflows/release.yml`; *Format check* | Code Officer / orchestrator, step 7 |
| AC2 | Run the tag-check step's script verbatim with `bash -e` and `TAG` set to each tag in the table above that starts a run (`v0.1.0`, `v1.2.3`, `v10.20.30`, `v0.1`, `v1`, `v1.2.3.4`, `v1.2.3-rc.1`, `v1.2.3+build.5`, `v`, `va.b.c`, `vv1.2.3`, the Arabic-Indic digit tag (U+0661 . U+0662 . U+0663), `v01.2.3`): exit code and output recorded | Dev, step 6, before the review; output in the Dev report |
| AC3 | Run the version step's script verbatim in a scratch copy of the repository with `TAG=v0.0.0` (passes), `TAG=v0.1.0` (fails with the exact text), and with `TAG=v01.2.3` (fails) | Dev, step 6 |
| AC4 | Run the main-ancestry step's script in a scratch clone: `HEAD` on `origin/main` (passes), `HEAD` on a commit not on `origin/main` (fails with the exact text) | Dev, step 6 |
| AC5 | Read check: the gate steps precede and the release job `needs:` the verification job; each runs the same npm script as `ci.yml` | Reviewer and Security, step 8 |
| AC6 | Run the changelog step's script in a scratch copy against these `CHANGELOG.md` variants: the current file (no `0.1.0` section: fails); a `## [0.1.0] - 2026-10-20` section with entries followed by `## [0.0.9]` (only its entries, heading dropped); the same as the last section followed by link references `[0.1.0]: https://…` (link lines excluded); a heading `## [0.1.0]` without date (matches); an empty `## [0.1.0] - …` section (fails); sections `## [10.1.0]` and `## [0.1.0.1]` only (fails for `0.1.0`). The produced notes file is shown | Dev, step 6 |
| AC1 | The `gh release create` invocation is checked against `gh release create --help`: `--verify-tag`, `--title "$TAG"`, `--notes-file`, `--generate-notes`, no `--prerelease`. End to end only with the first real tag `v0.1.0` after merge (residual risk named in decision 0009) | Reviewer and Security, step 8; the maintainer at the first release |
| AC7 | Read check of `permissions:` and of every `run:` script for `${{` | Reviewer and Security, step 8 |
| AC8 | Read check of the `docs/CONTRIBUTING.md` diff against the text below | Reviewer, step 8 |

The Dev keeps every scratch copy and harness under the session scratchpad, not in the repository.

## Approach

New file `.github/workflows/release.yml`:

- `name: Release`; `on: push: tags: ["v*"]`; top-level `permissions: contents: read`;
  `concurrency: { group: release-${{ github.ref }}, cancel-in-progress: false }`.
- Job `verify` (`runs-on: ubuntu-latest`, no extra permissions), steps in this order:
  1. **Check tag format** — first step, before checkout. `env: TAG: ${{ github.ref_name }}`, `LC_ALL: C`; bash
     regex test as in the table; on mismatch `printf '::error::%s\n' "…"` with the AC2 text and `exit 1`.
  2. Checkout (`actions/checkout`, same pinned SHA as `ci.yml`, `fetch-depth: 0`, `persist-credentials: false`).
  3. **Check tag is on main** — `git merge-base --is-ancestor HEAD origin/main` (HEAD is the tagged commit, also for
     annotated tags); AC4 text on failure.
  4. **Check version** — reads `package.json`'s version with `node -p` (after setup-node) or `jq -r .version`; AC3
     text on mismatch.
  5. **Check changelog section** — extracts the section (AC6 rules) to a file; fails with the AC6 text if empty.
     It runs in `verify` so a missing section fails before any write token exists; the release job repeats the
     extraction (or receives the file as a job artifact — the Dev's choice, stated in the report; extraction
     twice from the same checked-out tag is simplest and needs no artifact action).
  6. Setup Node (same pinned SHA and `node-version: 24`, `cache: npm` as `ci.yml`), `npm ci`,
     `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Job `release` (`needs: verify`, `runs-on: ubuntu-latest`, `permissions: contents: write`): checkout of the tag
  (`persist-credentials: false`), the changelog extraction into `release-notes.md` (no `npm ci`, no project
  code), then
  `gh release create "$TAG" --verify-tag --title "$TAG" --notes-file release-notes.md --generate-notes` with
  `env: GH_TOKEN: ${{ github.token }}`, `TAG: ${{ github.ref_name }}`.
- Every `run:` script starts with `set -euo pipefail` (bash is the default shell on ubuntu runners; state
  `shell: bash` where `pipefail` matters) and uses only `"$TAG"`-style quoted variables. Messages use `printf`,
  never `echo -e`.
- The same scripts must be runnable verbatim outside Actions given `TAG` and a working directory, so the Dev can
  run the *Verification without tests* cases.

Documentation per *Documentation updates*.

## Options considered

- **Single job with `contents: write`** — lost: `npm ci` and dev-dependency code would run with a write token
  (decision 0009, option 3).
- **Third-party release action** (e.g. a "create release" marketplace action) — lost against the preinstalled
  GitHub CLI (decision 0009, option 5).
- **Trigger filter `v[0-9]+.[0-9]+.[0-9]+` instead of a rejecting first step** — lost: a malformed tag would leave
  no trace, and the issue asks for a rejecting first step (decision 0009, option 6).
- **Pre-releases for 0.x** — lost (decision 0009, option 7).
- **Not enforcing "on `main`"** — lost: decision 0009 states it, and it costs one `git merge-base` call.
- **Logic in a separate shell script under `.github/scripts/`** — would make the checks re-runnable from the
  repository, but adds a file and a script entry point for four short checks that actionlint already lints inline;
  inline `run:` scripts were chosen.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| CI | `.github/workflows/release.yml` | new |
| Docs | `docs/CONTRIBUTING.md` (project block `releases`) | release steps |
| Docs | `docs/ARCHITECTURE.md` (*Deployment*, project block) | name the workflow |
| Docs | `CHANGELOG.md` | `Unreleased` entry |
| Decisions | `docs/decisions/0009-releases-only-by-tag-push.md`, `docs/decisions/README.md` | extended, `Proposed` (done in this plan) |

## Signatures (for the Dev's skeleton)

None (no TypeScript). Workflow job ids: `verify`, `release`.

## Test files

None: no production or test code changes.

Existing test code that calls a changed signature: none.

Files of the change no unit test can cover: `.github/workflows/release.yml` — a workflow, not part of the
TypeScript project or the coverage measure (`COVERAGE_PATHSPECS` covers `src/`); no exclusion is needed.

## Areas

None: release process is not an area (`docs/areas/README.md`, *Size*: "Development and release process are not
areas (see `CONTRIBUTING.md`)").

## Documentation updates

All owned by the **Dev**:

- `docs/CONTRIBUTING.md`, inside `<!-- project:begin releases -->` … `<!-- project:end releases -->`, replace the
  paragraph with:

  > Versions follow [Semantic Versioning](https://semver.org/): a **major** version for incompatible changes (for
  > example when the setup has to be redone), a **minor** version for new features, a **patch** version for fixes.
  > Versions below 1.0.0 are published as normal releases, not as pre-releases.
  >
  > A release is cut only by pushing a `v<major>.<minor>.<patch>` tag on `main`
  > ([decision 0009](decisions/0009-releases-only-by-tag-push.md)); merging a PR by itself never publishes a
  > release. User-visible changes are listed in the `Unreleased` section of [`CHANGELOG.md`](../CHANGELOG.md).
  > To release version `A.B.C`:
  >
  > 1. In a pull request, set the version with `npm version A.B.C --no-git-tag-version` (updates `package.json`
  >    and `package-lock.json`) and rename `## [Unreleased]` in `CHANGELOG.md` to `## [A.B.C] - YYYY-MM-DD`,
  >    adding a new empty `## [Unreleased]` above it.
  > 2. Merge the pull request.
  > 3. Tag the merge commit on `main` and push the tag:
  >    `git switch main && git pull && git tag vA.B.C && git push origin vA.B.C`.
  >
  > The release workflow (`.github/workflows/release.yml`) rejects a tag that is not exactly `vA.B.C`, a tag on a
  > commit that is not on `main`, a version that differs from `package.json` and a missing or empty changelog
  > section, runs the CI checks, and then creates the GitHub release with the changelog section followed by
  > GitHub's generated notes. If it fails, no release exists: delete the tag
  > (`git push origin :refs/tags/vA.B.C && git tag -d vA.B.C`), fix `main` and tag again.

- `docs/ARCHITECTURE.md`, *Deployment* (project block): the last sentence becomes "A release is created only by
  pushing a `v*` tag, which the release workflow (`.github/workflows/release.yml`) verifies before it publishes
  ([decision 0009](decisions/0009-releases-only-by-tag-push.md))."
- `CHANGELOG.md`, `## [Unreleased]` → `### Added`: "Release workflow that publishes a GitHub release when a
  `vA.B.C` tag is pushed on `main`, after checking the tag, the `package.json` version, the changelog section and
  the CI gates."

`README.md`, `.squad/stack.md` (no new command) and `.squad/project.md` (the guarantee "A release is created only
by pushing a `v*` tag" still holds; no new security area) need no change.

## Architecture check

The guarantee "A release is created only by pushing a `v*` tag" (decision 0009) is implemented, not changed: the
workflow is the only release path and adds the "on `main`" check the decision already states. No runtime
component, endpoint, table or cron changes; the daily release check depends on releases not being marked as
pre-releases, which this plan keeps.

## Security considerations

- [x] No limits on parsed input (the tag name is matched against an anchored ASCII regex; git already forbids
  control characters, spaces and newlines in ref names).
- [x] User-visible failure texts: only the AC2, AC3, AC4 and AC6 messages, in the workflow log of the
  repository's own Actions run; they echo the tag and the `package.json` version, no secret.
- Script injection: `github.ref_name` is pusher-controlled; it is passed via `env:` only and quoted (AC7).
- Token scope: `contents: read` by default, `contents: write` only in `release`, which runs no dependency code;
  `persist-credentials: false` on both checkouts; actions pinned by full SHA as in `ci.yml` (no new action).
- The `npm` cache in `verify` is only read by a job without a write token, and the release publishes no build
  artifact.

## Decision records

- `docs/decisions/0009-releases-only-by-tag-push.md` (unreleased, extended in place with the workflow's design
  options; set to `Proposed`, index row `Proposed`).

## Out of scope / follow-ups

- Attaching build artifacts to the release, and reporting the version through `GET /health` or the daily
  release check (the cron job) — separate features.
- Branch or tag protection rules for `v*` in the repository settings (a settings change, not a file); worth a
  note to the maintainer, who may add a tag ruleset restricting who can push `v*`.

## Challenge notes

Minor objections of the Devil's Advocate, verbatim (no major objection; Security plan review: APPROVED).

1. **Tag moved between jobs.** `verify` and `release` each check out the tag separately, so a tag force-moved in between would publish a commit that was never verified. `gh release create --verify-tag` only checks that the tag exists.
   - Instruction for the Dev: in `release`, check out `${{ github.sha }}` (or compare `git rev-parse HEAD` to `$GITHUB_SHA`). Also fail if the remote tag now resolves to a different commit, for example with `git ls-remote origin "refs/tags/$TAG^{}" "refs/tags/$TAG"`. Add one exact error text for this and mention it in the plan.
2. **Workflow comes from the tag's commit.** A tag-triggered run uses the `release.yml` of the tagged commit. A tag on a feature branch with an edited workflow skips the AC4 guard. The maintainer note in "Out of scope" should say the real enforcement is a tag ruleset for `v*`, and that AC4 only catches mistakes.
3. **"CI gates" is incomplete.** `ci.yml` also runs a `npm audit --omit=dev --audit-level=high` job and a SonarQube job. The release workflow runs neither. The wording in the CONTRIBUTING and CHANGELOG text should say "format, lint, type-check, test and build checks" rather than "the CI gates". Say so in the plan, or add the audit step to `verify`, which is cheap and needs no write token.

Non-blocking findings of Security (plan review), for the Dev:

- AC4 prevents mistakes, not misuse: say so plainly in decision 0009 and the security considerations, and name a tag ruleset restricting `v*` as the actual control.
- Moved tag between jobs: before `gh release create`, compare the tag's current commit (e.g. `gh api "repos/$GITHUB_REPOSITORY/commits/$TAG" --jq .sha`) with `$GITHUB_SHA` and fail if they differ (same as objection 1).
- Changelog heading match: compare the heading as a literal string (or escape the dots); add one AC6 case such as `## [0x1y0]` for `0.1.0`.
