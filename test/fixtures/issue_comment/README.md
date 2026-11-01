# Issue comment fixtures

All files are **reference-built from GitHub's webhook payload documentation, not captured**: no real `issue_comment` delivery of this
repository exists yet. They are shaped like the documented `issue_comment` (`created`) payload and the OpenAPI schema
`webhook-issue-comment-created` of GitHub's `rest-api-description` (issue #108, extended in #109) and serve the rule tests of the
`issue_comment` and `pull_request_comment` rules ([decision 0040](../../../docs/decisions/0040-issue-and-comment-rules.md)).
The residual risk (a field path, an action name or the way a real delivery marks a draft differs from the documentation; each deviation
sends no message) and the live check that confirms the cases on a deployed copy before the pull request is ready are in that record. The
live check may replace a file with a captured delivery (secrets and personal data removed).

Names are invented values: the repository and its owner are `example-owner` and `example-repo`, copied with the
`installation` from the anonymized `../workflow_run/completed-success-default-branch.json`. The `sender` is
`example-other-user` (id 1000002, type `User`), so the files document a sender other than the owner, unlike the
captured fixtures, whose sender is `example-owner`. Owner, bot and action variants are built in the tests from these files.

| File                              | `action`  | Covers                                                                                                                                  |
| --------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `created.json`                    | `created` | a comment written by `example-other-user` on issue #7 (`issue.pull_request` absent)                                                     |
| `created-pull-request.json`       | `created` | a comment on the conversation of pull request #12, which is not a draft: `issue.pull_request` is an object and `issue.draft` is `false` |
| `created-draft-pull-request.json` | `created` | a comment on the conversation of draft pull request #12: `issue.pull_request` is an object and `issue.draft` is `true`                  |

In the two pull request files `issue.html_url` is the pull request's (`.../pull/12`) and `comment.html_url` ends in `#issuecomment-5000002`.
The documentation marks `issue.draft` as optional; a variant without it (built in the tests) covers the draft lookup.
