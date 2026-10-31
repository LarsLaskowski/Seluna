# Star fixtures

`created.json` and `deleted.json` are **reference-built from GitHub's webhook payload documentation, not captured**: no real
`star` delivery of this repository exists yet. `created.json` is shaped like the documented `star` (`created`) payload (issue #108);
`deleted.json` is `created.json` with `action` `deleted` and `starred_at` `null`, as the documentation shows a star taken back (issue
#110). Both are the inputs of the rule tests, which read only the fields the rules read (`sender`, `repository.id`,
`repository.full_name`, `repository.html_url`, `repository.stargazers_count`); a real delivery may differ in the rest. The live check on a deployed copy before the pull request is ready may
replace it with a captured delivery (secrets and personal data removed); #109 and #110 replace it with real deliveries
for their rule tests.

Names are invented values: the repository and its owner are `example-owner` and `example-repo`, copied with the
`installation` from the anonymized `../workflow_run/completed-success-default-branch.json`. The `sender` is
`example-other-user` (id 1000002, type `User`), so the file documents a sender other than the owner, unlike the
captured fixtures, whose sender is `example-owner`.

| File           | `action`  | Covers                                                    |
| -------------- | --------- | --------------------------------------------------------- |
| `created.json` | `created` | a star given by `example-other-user`                      |
| `deleted.json` | `deleted` | the same account taking its star back (`starred_at` null) |
