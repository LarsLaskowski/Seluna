# Workflow run fixtures

These two files are **real `workflow_run` deliveries** with `action` `completed`, captured from the owner's GitHub App
(the private App each Seluna instance registers) and supplied on issue #16 on 2026-10-20 (Product Manager's decision:
real payloads instead of reference-built ones). They are anonymized: logins, ids, `node_id`s, repository names, the
description, topics, the homepage, the branch name, the commit SHAs, the commit message and the installation id are
replaced by invented values (`example-owner`, `example-repo`, `ANON_NODE_ID_n`, `https://example.com`, ...). The
structure and the field set are untouched, so the shape the rules read is the shape GitHub sends.

| File                                    | `conclusion` | `event`        | Covers                                                                                                   |
| --------------------------------------- | ------------ | -------------- | -------------------------------------------------------------------------------------------------------- |
| `completed-success-default-branch.json` | `success`    | `schedule`     | A run on the default branch (`head_branch` equals `repository.default_branch`); `pull_requests` is empty |
| `completed-failure-pull-request.json`   | `failure`    | `pull_request` | A failed run in a pull request of the same repository (#296); `pull_requests` has one entry              |

In both, `sender`, `actor` and `triggering_actor` are the owner.

## Variants not available

No real sample exists for these shapes, so none is invented as a fixture; tests that need a variant of a real payload
build it in the test from one of these files:

- A **failed run on the default branch** (`failure`, `timed_out`) and the `cancelled` and `timed_out` conclusions.
- A run of a pull request from a **fork**: `head_repository` is the fork and `pull_requests` is expected to be empty
  (not observed).
- A run in a **draft** pull request: the payload carries no draft state either way.
- A re-run (`run_attempt` above 1).

A later real sample is added as its own file, never edited into these.
