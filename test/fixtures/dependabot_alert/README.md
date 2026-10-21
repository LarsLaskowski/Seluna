# Dependabot alert fixtures

These three files are **reference-built from GitHub's OpenAPI description, not captured**: no real `dependabot_alert`
delivery exists and none will be supplied (Product Manager's decision on issue #17, 2026-10-20, recorded in
[decision 0028](../../../docs/decisions/0028-security-alert-rules.md)). Each file has every property of the webhook
schema named below (`components.schemas` of `descriptions/api.github.com/api.github.com.json` in
`github/rest-api-description`, commit `755ee33b4a81d51f6f07a902cce26cbec3b822f2`), with the alert's values taken from
the REST example named below and, where the example has no such property, a value of the schema's type. The optional
top-level `organization` and `enterprise` are left out (the repository is a user's); `repository`, `sender` and
`installation` are copied from the anonymized `../workflow_run/completed-success-default-branch.json`. Names in the
examples (`octocat`, `hello-world`) are replaced by `example-owner` and `example-repo`.

| File             | `action`    | Schema                               | Alert values from (`components.examples`) | Covers                                        |
| ---------------- | ----------- | ------------------------------------ | ----------------------------------------- | --------------------------------------------- |
| `created.json`   | `created`   | `webhook-dependabot-alert-created`   | `dependabot-alert-open`                   | Alert 1, severity `medium`, package `ansible` |
| `reopened.json`  | `reopened`  | `webhook-dependabot-alert-reopened`  | `dependabot-alert-open`                   | The same alert reopened                       |
| `dismissed.json` | `dismissed` | `webhook-dependabot-alert-dismissed` | `dependabot-alert-dismissed`              | Alert 2, severity `high`, package `django`    |

The residual risk (field paths, action names, types of real deliveries) is accepted in decision 0028. A later captured
delivery is added as its own file, never edited into these.
