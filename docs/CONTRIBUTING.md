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
Versions below 1.0.0 end up as normal releases, not as pre-releases; the pre-release state only lasts while the
release workflow checks a new release.

A release is cut only on GitHub's release page, as a pre-release that the release workflow promotes
([decision 0009](decisions/0009-releases-only-by-tag-push.md)); merging a PR by itself
never publishes a release. User-visible changes are listed in the `Unreleased` section of
[`CHANGELOG.md`](../CHANGELOG.md). To release version `A.B.C`:

1. In a pull request, set the version with `npm version A.B.C --no-git-tag-version` (updates `package.json`
   and `package-lock.json`) and rename `## [Unreleased]` in `CHANGELOG.md` to `## [A.B.C] - YYYY-MM-DD`,
   adding a new empty `## [Unreleased]` above it.
2. Merge the pull request.
3. On GitHub, draft a new release: create the new tag `vA.B.C` with target `main`, use `vA.B.C` as the title,
   write the release text, check **Set as a pre-release** and publish it.

Publishing the pre-release creates the tag and starts the release workflow (`.github/workflows/release.yml`).
It rejects a tag that is not exactly `vA.B.C`, a tag on a commit that is not on `main`, a version that differs
from `package.json` and a missing or empty changelog section, and runs the format, lint, type-check, test and
build checks. When all of them pass, it turns the pre-release into a full release and marks it as the latest
release; the release text stays as written. If it fails, the release stays a pre-release, which the daily
release check of the instances does not see: delete the release and its tag
(`git push origin :refs/tags/vA.B.C`, or on the tags page), fix `main` and create the release again. A release
published without *Set as a pre-release* is checked too, but it is public before the checks run; the workflow
warns about it.

The "on `main`" check only catches mistakes: a release-triggered run uses the workflow file of the tagged commit,
so it cannot stop someone who is allowed to create tags. Restrict who can create `v*` tags with a repository tag
ruleset; that is the actual control.

### Release plan up to 1.0.0

The GitHub milestones are the release plan: one milestone is one release. A release is due when the last open
issue of its milestone has been closed, not earlier and not later. The version in `package.json` stays at the last
released version until that release pull request; it is never raised on its own.

| Milestone                           | Issues            | Version    | What an owner can do afterwards                                          |
| ----------------------------------- | ----------------- | ---------- | ------------------------------------------------------------------------ |
| M0 – Repository foundation          | #1–#3             | **0.1.0**  | (released together with M1 and #7–#9)                                    |
| M1 – Endpoint and deployment        | #4–#6             | **0.1.0**  | Deploy an instance with one click, `/health`, signed webhooks            |
| M2 – Setup wizard                   | #7–#11, #35, #40  | **0.2.0**  | Finish the whole setup in the wizard, including settings and status page |
| M3 – Pull request notifications     | #12–#14           | **0.3.0**  | Receive the first real Telegram messages, with quiet hours               |
| M4 – CI and security alerts         | #15–#17           | **0.4.0**  | Messages for failed CI runs and new security alerts                      |
| M5 – Ready for everyone             | #18–#20           | **1.0.0**  | Retry, cleanup, update workflow, setup guide and an external setup test  |

- Version 0.1.0 was published when M0, M1 and the first three issues of M2 (#7–#9) were done, so M0 and M1 share it
  and 0.2.0 is the release of the rest of M2. Every later milestone has a release of its own.
- A fix on a released version that cannot wait for the next release is a patch release (for example 0.2.1).
- An issue opened later gets the milestone of the earliest release that has not been tagged yet, unless the Lead
  assigns a later one.
- Pull requests merged after a milestone is complete but before its release pull request ship in that release,
  because the tag contains everything on `main`; cut the release pull request first when the last issue of a
  milestone is closed.
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
