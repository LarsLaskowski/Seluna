# Code scanning alert fixtures

These five files are **reference-built from GitHub's OpenAPI description, not captured**: no real `code_scanning_alert`
delivery exists and none will be supplied (Product Manager's decision on issue #17, 2026-10-20, recorded in
[decision 0028](../../../docs/decisions/0028-security-alert-rules.md)). Each file has every property of the webhook
schema named below (`components.schemas` of `descriptions/api.github.com/api.github.com.json` in
`github/rest-api-description`, commit `755ee33b4a81d51f6f07a902cce26cbec3b822f2`), with the alert's values taken from
the REST example named below and, where the example has no such property, a value of the schema's type. The webhook
`rule` has no `security_severity_level`, so none is in the files and the severity is `rule.severity` (`error`). An
alert that is open in the webhook (`created`, `appeared_in_branch`, `reopened`) has `state` `open` and no dismissal
fields, as the schema types them, not the dismissed state of the REST example. The optional top-level `organization`
and `enterprise` are left out; `repository`, `sender` and `installation` are copied from the anonymized
`../workflow_run/completed-success-default-branch.json` (default branch `main`). Names in the examples (`octocat`,
`hello-world`) are replaced by `example-owner` and `example-repo`, the commit SHA by an invented one.

| File                        | `action`             | Schema                                           | Alert values from (`components.examples`) | `ref`                |
| --------------------------- | -------------------- | ------------------------------------------------ | ----------------------------------------- | -------------------- |
| `created.json`              | `created`            | `webhook-code-scanning-alert-created`            | `code-scanning-alert`                     | `refs/heads/main`    |
| `created-pull-request.json` | `created`            | `webhook-code-scanning-alert-created`            | `code-scanning-alert`                     | `refs/pull/1/merge`  |
| `appeared_in_branch.json`   | `appeared_in_branch` | `webhook-code-scanning-alert-appeared-in-branch` | `code-scanning-alert`                     | `refs/heads/main`    |
| `reopened.json`             | `reopened`           | `webhook-code-scanning-alert-reopened`           | `code-scanning-alert`                     | `refs/heads/main`    |
| `closed_by_user.json`       | `closed_by_user`     | `webhook-code-scanning-alert-closed-by-user`     | `code-scanning-alert-dismissed`           | `""` (as the schema) |

The format of the `ref` (`refs/heads/<branch>`, `refs/pull/<n>/merge`) is documented for the REST API only
(`code-scanning-ref`), not observed in a delivery. The residual risk is accepted in decision 0028. A later captured
delivery is added as its own file, never edited into these.
