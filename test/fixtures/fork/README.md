# Fork fixtures

`fork.json` is **reference-built from GitHub's webhook payload documentation, not captured**: no real `fork` delivery of this
repository exists yet. It is shaped like the documented `fork` payload (issue #108) and is the input of the fork rule tests (issue #110),
which read only `sender`, `forkee.full_name`, `forkee.html_url`, `repository.id`, `repository.full_name` and
`repository.html_url`; a real delivery may differ in the rest. The live check on a deployed copy before the pull request is ready may
replace it with a captured delivery (secrets and personal data removed); #109 and #110 replace it with real deliveries
for their rule tests.

Names are invented values: the repository and its owner are `example-owner` and `example-repo`, copied with the
`installation` from the anonymized `../workflow_run/completed-success-default-branch.json`. The `sender` is
`example-other-user` (id 1000002, type `User`), so the file documents a sender other than the owner, unlike the
captured fixtures, whose sender is `example-owner`.

| File        | `action`                                | Covers                                                |
| ----------- | --------------------------------------- | ----------------------------------------------------- |
| `fork.json` | none: a `fork` delivery has no `action` | a fork of the repository made by `example-other-user` |
