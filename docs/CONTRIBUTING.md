# Contributing

<!-- project:begin getting-started -->
## Getting started

### Machine setup

Git, Node.js 24 with npm, and Python 3 (for the squad tools under `.squad/tools/`). A free Cloudflare account is
only needed to deploy, not to build or test.

### Cloning the repository

```shell
git clone https://github.com/LarsLaskowski/Seluna.git
```

### Building and running

```shell
npm ci
npm run build          # wrangler deploy --dry-run --outdir dist
npx wrangler dev       # run the Worker locally
```

No configuration is needed to build; the local Worker answers `GET /health` and `POST /webhook`, and 404 for everything else.

### Running tests

```shell
npm test
```

For detailed rules on how unit tests are structured and named, see [`UNIT_TESTS.md`](UNIT_TESTS.md).
**Unit tests are mandatory for newly written code** — see the checklist there before opening a pull
request.

### Commits and language

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
`refactor:`, `test:`, `chore:`, `ci:`, …). Everything in the repository — code, comments, documentation, commit
messages, issues and pull requests — is written in English.
<!-- project:end getting-started -->

## Submitting a pull request

Nothing is ever committed or pushed directly to `main` — every change goes through a separate branch and
a pull request.

Pull requests are merged with **Squash and merge**: the PR title becomes the single commit subject on
`main` and the description its body, so the commits on the branch are working history and need not be
curated. Keep the branch up to date by merging the current `main` into it (no force-push needed); do not
use the plain *Create a merge commit* or *Rebase and merge* buttons (see the decision record on
squash-merging in [`decisions/`](decisions/README.md)).

For PR naming use the following convention: `[area] Description` (no period at the end).

- For the area, use one of the areas listed below, capitalized.
- For the description, do not reference an issue number in there. A clear, short summary of what
  the change entails is enough; there is room to elaborate in the description.

<!-- project:begin areas -->
Areas: `Repo`, `Webhook`, `Rules`, `Delivery`, `Setup`, `Tests`, `CI`, `Docs`.
<!-- project:end areas -->

When a PR is related to an issue, use the `Closes #issuenumber` syntax so the issue links to the
PR automatically and closes when the PR is merged.

Follow the PR template in [`.github/pull_request_template.md`](../.github/pull_request_template.md).

## Quality gates

Code-style rules are documented in [`CLAUDE.md`](../CLAUDE.md) and in
[`.squad/stack.md`](../.squad/stack.md), and are binding for all contributions. Before opening a pull
request, run the commands from `stack.md`: *Format*, *Build*, the *Analyzer gate* (no analyzer diagnostic
of any severity in a changed file) and the *Coverage gate* (line coverage on new or changed production code
and overall, thresholds in [`UNIT_TESTS.md`](UNIT_TESTS.md#code-coverage)). A pull request is
expected to arrive clean (see the decision record on quality gates in [`decisions/`](decisions/README.md)).

<!-- project:begin releases -->
## Versioning and releases

Versions follow [Semantic Versioning](https://semver.org/): a **major** version for incompatible changes (for
example when the setup has to be redone), a **minor** version for new features, a **patch** version for fixes.
Versions below 1.0.0 are published as normal releases, not as pre-releases.

A release is cut only by pushing a `v<major>.<minor>.<patch>` tag on `main`
([decision 0009](decisions/0009-releases-only-by-tag-push.md)); merging a PR by itself never publishes a
release. User-visible changes are listed in the `Unreleased` section of [`CHANGELOG.md`](../CHANGELOG.md).
To release version `A.B.C`:

1. In a pull request, set the version with `npm version A.B.C --no-git-tag-version` (updates `package.json`
   and `package-lock.json`) and rename `## [Unreleased]` in `CHANGELOG.md` to `## [A.B.C] - YYYY-MM-DD`,
   adding a new empty `## [Unreleased]` above it.
2. Merge the pull request.
3. Tag the merge commit on `main` and push the tag:
   `git switch main && git pull && git tag vA.B.C && git push origin vA.B.C`. Do not create the release or the
   tag on GitHub's release page: the workflow creates the release, and fails if one already exists.
4. Once the release workflow has passed, open the draft release `vA.B.C` on GitHub, edit its text as needed
   (leave *Set as a pre-release* unchecked) and publish it.

The release workflow (`.github/workflows/release.yml`) rejects a tag that is not exactly `vA.B.C`, a tag on a
commit that is not on `main`, a version that differs from `package.json` and a missing or empty changelog
section, runs the format, lint, type-check, test and build checks, and then creates the GitHub release with the
changelog section followed by GitHub's generated notes as a **draft**; nothing is published until the maintainer
publishes the draft. If it fails, it has created no release: delete the tag (and, if it failed because a release for the tag already exists, that release)
(`git push origin :refs/tags/vA.B.C && git tag -d vA.B.C`), fix `main` and tag again.

The "on `main`" check only catches mistakes: a tag-triggered run uses the workflow file of the tagged commit,
so it cannot stop someone who is allowed to push tags. Restrict who can push `v*` tags with a repository tag
ruleset; that is the actual control.

### Release plan up to 1.0.0

A release is due when the last issue of its row has been closed, not earlier and not later. Each row
is something an owner can try out on a deployed copy. The version in `package.json` stays at the last released
version until that release pull request; it is never raised on its own.

| Version    | Issues               | What an owner can do afterwards                                                         |
| ---------- | -------------------- | --------------------------------------------------------------------------------------- |
| **0.1.0**  | #1–#8, #35           | Deploy an instance with one click, `/health`, signed webhooks, secure `/setup` login    |
| **0.2.0**  | #9, #10, #11, #40    | Finish the whole setup in the wizard: Telegram chat, GitHub App, settings, status page  |
| **0.3.0**  | #12, #13             | Receive the first real Telegram messages: pull request rules, outbox, deduplication     |
| **0.4.0**  | #14, #15, #16        | Quiet hours, GitHub App authentication, CI failure messages                             |
| **0.5.0**  | #17, #18             | Security alert messages, retry of failed messages, cleanup, notice of new releases      |
| **0.6.0**  | #19                  | Update a copy with one click                                                            |
| **1.0.0**  | #20                  | Setup guide, external setup test and one week without a lost or duplicated message      |

- A fix on a released version that cannot wait for the next row is a patch release (for example 0.2.1).
- Issues opened later join the earliest row that has not been tagged yet, unless the Lead assigns a later one; a row
  is closed once its version is tagged.
- Pull requests merged after a row is complete but before its release pull request ship in that release, because the
  tag contains everything on `main`; cut the release pull request first when the last issue of a row is closed.
- 1.0.0 is tagged only after the acceptance criteria of #20 are met; nothing else makes a version 1.0.0.
<!-- project:end releases -->

<!-- project:begin stability -->

## Stability policy

An essential consideration in every pull request is its impact on the system. Avoid introducing
unnecessary breaking changes, performance or functional regressions, or negative impacts on usability. In
particular, preserve the guarantees listed in [`.squad/project.md`](../.squad/project.md) (_Guarantees_)
and described in [`ARCHITECTURE.md`](ARCHITECTURE.md) unless a change explicitly intends to alter one.
<!-- project:end stability -->

## Reporting security issues

Do not report security vulnerabilities through public GitHub issues. See
[`SECURITY.md`](../SECURITY.md) for the private reporting process.

## License

<!-- project:begin license -->

By contributing to this project, you agree that your contributions will be licensed under the
same license that covers the project (see `LICENSE` or `LICENSE.md` in the repository root).
<!-- project:end license -->
