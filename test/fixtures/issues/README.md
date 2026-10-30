# Issues fixtures

`opened.json` is **reference-built from GitHub's webhook payload documentation, not captured**: no real `issues` delivery of this
repository exists yet. It is shaped like the documented `issues` (`opened`) payload (issue #108) and is the fixture of the `issue_opened` rule tests
of issue #109 ([decision 0040](../../../docs/decisions/0040-issue-and-comment-rules.md)), which also states the residual risk of a payload
built from the documentation. The live check on a deployed copy before the pull request is ready may replace it with a captured delivery
(secrets and personal data removed). Owner, bot and action variants are built in the tests.

Names are invented values: the repository and its owner are `example-owner` and `example-repo`, copied with the
`installation` from the anonymized `../workflow_run/completed-success-default-branch.json`. The `sender` is
`example-other-user` (id 1000002, type `User`), so the file documents a sender other than the owner, unlike the
captured fixtures, whose sender is `example-owner`.

| File          | `action` | Covers                                  |
| ------------- | -------- | --------------------------------------- |
| `opened.json` | `opened` | an issue opened by `example-other-user` |
