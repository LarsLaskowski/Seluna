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

No configuration is needed to build; the local Worker answers 404 until the endpoints exist.

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

Versions follow [Semantic Versioning](https://semver.org/). A release is cut by pushing a `v<major>.<minor>.<patch>`
tag on `main` ([decision 0009](decisions/0009-releases-only-by-tag-push.md)). Merging a PR by itself never
publishes a release; user-visible changes are listed in the `Unreleased` section of [`CHANGELOG.md`](../CHANGELOG.md).
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
