# Plan: Apply the other-services rule to docs/update.md

Source: Issue #158
Tier: trivial — documentation only, but widening the CONTRIBUTING rule extends decision 0047 (`docs` excludes `docs/decisions/`).
Security areas touched: none
Plan size: the revision only splits AC5 off AC1 for the matrix after the code and review round were done; cutting reviewed sections now would change what step 8 checked.

## Problem / root cause

The rule of `docs/CONTRIBUTING.md` (*Setup guides*, line 160) covers only the setup guides and
`docs/troubleshooting.md`; `docs/update.md` quotes other services' labels in most sections. Decision (the issue's question): widen the rule to `docs/update.md` and rewrite every
other-service label, since 0047's reason holds for GitHub's Actions pages as for Cloudflare's; rewriting only the
two named steps would leave a dozen labels. Same decision as 0047, so no new record.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | Labels the issue names: **Workers & Pages**, **Deployments**; **Settings**, **Actions**, **General**, **Workflow permissions** | `docs/update.md` lines 49, 56–57 | confirmed |
| 2 | Labels it does not name: **Actions**, **Run workflow**, **Copy raw file**, **Add file**, **Create new file**, **Commit changes**, **Edit this file** / "the pencil", **Read and write permissions**, **Save**, **Actions permissions** | `docs/update.md` | confirmed |
| 3 | The workflow's messages name *Conflicts*, *Permissions*, *Unknown base*, *Workflow files*; a test pins these and four more headings | `update.yml` lines 50, 393, 419, 428; `test/update-workflow.test.ts` lines 1068–1096 | confirmed |
| 4 | **Update Seluna**, **Allow a new major version** are Seluna's own (workflow name, input) | `update.yml` lines 1, 7 | confirmed |
| 5 | The status-page labels quoted exist, except "the **Missing** text" | `src/setup/texts.ts` lines 280, 297–303 | confirmed |
| 6 | No German `update.md` exists | `ls docs/` | confirmed |
| 7 | Decision 0047 is unreleased | `git tag --contains da9047e`, `14f7633`: empty | confirmed |
| 8 | The links of *Approach* exist and document the step | to verify: vendor pages unreachable here (proxy 403); AC5 | unverified |
| 9 | "an ordinary commit that you can revert on GitHub": the web interface reverts merged pull requests only | to verify: GitHub's documentation, follow-up issue | unverified |

## Acceptance criteria

- AC1: `docs/update.md` contains none of the labels of facts 1 and 2; each such step says in plain words what the reader does and why, with a link to that service's documentation where it documents the step in its web interface, as `docs/setup.md` does.
- AC2: Its headings are unchanged, every workflow message it quotes matches `update.yml` verbatim, and `update.yml` is unchanged.
- AC3: Only Seluna's own labels stay bold, each verbatim from `texts.ts`, `update.yml` or the README's **Deploy to Cloudflare**.
- AC4: `docs/CONTRIBUTING.md` applies the rule to `docs/update.md` and `CHANGELOG.md` has the entry, both as *Documentation updates* words them.
- AC5: Each link of AC1 opens that service's documentation of the step (fact 8).

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | check: grep for each label of facts 1 and 2 finds none; the Reviewer reads each step | — |
| AC2 | has a heading for every section the workflow names and for the other sections of the guide | `test/update-workflow.test.ts` (unchanged) |
| AC3 | check: the Reviewer finds each bold span in its source | — |
| AC4 | check: the Reviewer reads the diffs | — |
| AC5 | manual: the Product Manager opens each link on the pushed branch before PR approval | — |

## Verification without tests

Steps 4, 5 and the *Coverage gate* are not applicable: no production or test code changes.

- AC1, AC3–AC5: as *Tests per criterion*; the Dev also runs AC1's grep before handing back.
- AC2: check: Dev runs `npx vitest run --project node test/update-workflow.test.ts`; Reviewer compares each quoted message with `update.yml`.

## Approach

Rewrite the steps of facts 1 and 2 in plain words, same sections, lists and order; fix "the **Missing** text" to a verbatim label. Links (unverified, fact 8), under `https://docs.github.com/en/`:

- run by hand: `actions/how-tos/manage-workflow-runs/manually-run-a-workflow`
- enable workflows, token write permission: `repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository`
- create a file: `repositories/working-with-files/managing-files/creating-new-files`
- edit a file (already in the guides): `repositories/working-with-files/managing-files/editing-files`
- raw text: `repositories/working-with-files/using-files/viewing-and-understanding-files`
- rulesets: `repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets`

and Cloudflare's build and its log (already in the guides): `https://developers.cloudflare.com/workers/ci-cd/builds/`.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| docs | *Documentation updates* | wording (Dev) |

## Signatures (for the Dev's skeleton)

none

## Test files

None new; `test/update-workflow.test.ts` unchanged. Call sites: none. Uncoverable code: none.

## Areas

none (no change in behavior).

## Documentation updates

- `docs/update.md` (Dev): *Approach*.
- `docs/CONTRIBUTING.md` line 160 (Dev): begin "In the setup guides, the troubleshooting page and the update guide (`docs/update.md`)"; last sentence "Only Seluna's own labels are quoted, verbatim from where Seluna defines them: `src/setup/texts.ts`, the README's deploy button and the update workflow's name and input (`.github/workflows/update.yml`)."
- `CHANGELOG.md`, *Unreleased*, new `### Changed` (Dev): "Documentation: the update guide (`docs/update.md`) describes GitHub's and Cloudflare's steps in plain words with links to their documentation instead of their menu paths and labels."
- Sweep: `docs/ARCHITECTURE.md` and `docs/areas/` list no pages under the rule — unchanged.

## Architecture check

No guarantee touched.

## Security considerations

- [x] no limits
- [x] none

## Decision records

- `docs/decisions/0047-setup-guide-screenshots-of-selunas-own-pages.md` (Accepted, unreleased) — edited in place: source #158, one consequence.

## Out of scope / follow-ups

- Issue "[Setup] Setup page texts quote Cloudflare's and GitHub's menu paths": `src/setup/texts.ts` lines 239, 262, 307, 369 (German 478, 502, 547, 610); production code, outside the guide rule.
- Issue "[Docs] Undoing an update in the web interface" (fact 9): say how to undo an update without a command.

## Amendments

| Criterion | Change | Reason | Step | Decided by |
| --------- | ------ | ------ | ---- | ---------- |
| AC5 | added: split from AC1 | one kind per criterion; same verification | 7 | Lead |
