# Secret scanning alert fixtures

These three files are **reference-built from GitHub's OpenAPI description, not captured**: no real
`secret_scanning_alert` delivery exists and none will be supplied (Product Manager's decision on issue #17,
2026-10-20, recorded in [decision 0028](../../../docs/decisions/0028-security-alert-rules.md)). Each file has every
property of the webhook schema named below (`components.schemas` of `descriptions/api.github.com/api.github.com.json`
in `github/rest-api-description`, commit `755ee33b4a81d51f6f07a902cce26cbec3b822f2`), with the alert's values taken from
the REST example named below and, where the example has no such property, a value of the schema's type. The webhook
schema has **no `secret` field**, and the REST example's `secret` is left out; no file holds a secret. The optional
top-level `organization` and `enterprise` are left out; `repository`, `sender` and `installation` are copied from the
anonymized `../workflow_run/completed-success-default-branch.json`. Names in the examples (`owner/private-repo`,
`monalisa`, `octocat`) are replaced by `example-owner` and `example-repo`.

| File            | `action`   | Schema                                   | Alert values from (`components.examples`)      | Covers                                       |
| --------------- | ---------- | ---------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `created.json`  | `created`  | `webhook-secret-scanning-alert-created`  | `secret-scanning-alert-open` (no `secret`)     | Alert 42, type `mailchimp_api_key`           |
| `reopened.json` | `reopened` | `webhook-secret-scanning-alert-reopened` | `secret-scanning-alert-open` (no `secret`)     | The same alert reopened                      |
| `resolved.json` | `resolved` | `webhook-secret-scanning-alert-resolved` | `secret-scanning-alert-resolved` (no `secret`) | A resolved alert with a `resolution_comment` |

The delivery names no branch, ref or pull request. The residual risk (field paths, whether a real delivery carries
`alert.secret`) is accepted in decision 0028. A later captured delivery is added as its own file, never edited into
these.
