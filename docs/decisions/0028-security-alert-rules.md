# 0028: Security alert rules

- **Status:** Proposed
- **Date:** 2026-10-20
- **Area:** Notifications
- **Source:** Issue #17
- **Supersedes:** —

## Context

Issue #17 asks for three rules: `dependabot_alert`, `code_scanning_alert` and `secret_scanning_alert`, each reported on
`created` and `reopened`, with "all other actions are not reported". Line 3 shows the severity and the package
(Dependabot), the severity and the rule (code scanning) or the secret type (secret scanning), and a message never
contains the secret or any part of it. The GitHub App has requested the permissions and subscribed to the three events
since 0.2.0 (`src/github/manifest.ts`), and the three switches exist (`src/settings.ts`).

Forces: the guarantee "a draft pull request triggers no notification" (`.squad/project.md`, _Guarantees_); a rule is
a pure function with no I/O ([decision 0023](0023-webhook-processing-and-delivery-through-the-outbox.md)); the
signature does not cover the event header, so a rule checks that the payload has the shape of its event; texts in
alert payloads come from the GitHub Advisory Database, an analysis tool, a repository's manifest or a repository
administrator's custom secret pattern; GitHub's webhook schema for `secret_scanning_alert` has no `secret` field, but its REST
alert has one, so the rules must not depend on its absence.

According to GitHub's documentation, a code scanning alert can also exist on a pull request's ref alone, and an alert
first found on another branch reaches the default branch as `appeared_in_branch`, not as `created`. Secret scanning
scans pushes to every branch and the text of pull requests, and its delivery names no branch or pull request.

## Options considered

Which code scanning deliveries are reported (Product Manager's decision, 2026-10-20):

1. **Every `created`/`reopened`, whatever the ref** — a draft pull request's finding would trigger a message, a second
   exception to the draft guarantee, and findings in unmerged work would be noise.
2. **`created`/`reopened` on any ref that is not a pull request** — keeps the guarantee, but an alert introduced
   through a pull request is never reported, since it reaches the default branch as `appeared_in_branch`.
3. **The default branch only: `created`/`reopened` with `ref` `refs/heads/<default branch>` or the bare default branch
   name, plus `appeared_in_branch` into it** — each alert is reported once, when it reaches the default branch; the guarantee holds
   and pull requests cause no message. Adds one action beyond the issue's list. Chosen.

Secret scanning alerts and draft pull requests (Product Manager's decision, 2026-10-20):

4. **Report every secret scanning alert, whatever its source, as a second named exception to the draft guarantee** — a pushed secret is exposed the moment it is pushed and must be revoked whether or not the pull
   request is merged; the delivery offers nothing to filter on anyway. Chosen.
5. **Keep the guarantee as written** — drop the secret scanning rule, or look up each alert's locations through the
   API (a new call, and a secret in a pull request's text is hard to trace to its draft state).

Keeping the secret out of the message:

6. **Read only an allow-list of fields (`alert.number`, `alert.html_url`, `alert.secret_type`,
   `alert.secret_type_display_name`, `repository.full_name`)** — the secret cannot reach a message because no code
   reads the field that holds it. Chosen.
7. **Scrub the secret out of the texts** — needs the secret value in the rule, and fails for a part of it or for an
   encoding the scrubber does not know.

The Dependabot title: the issue's table says "Dependabot alert (with severity)"; the title stays "Dependabot alert"
and the severity is in line 3, as the issue's line-3 rule says, so it is not shown twice (confirmed by the Product
Manager, 2026-10-20).

Missing fields: a field that identifies the alert or tells the events apart (number, URL, repository; the advisory,
the rule and the ref, the secret type) is required, and a delivery without it sends nothing, as for the other rules; a
field only shown (summary, severity, package, rule description, display name) is optional and its absence only
shortens its line, because losing a security alert over a missing text is worse than a shorter message.

## Decision

Three rules in `src/rules/` over a shared narrowing in `src/rules/security-alert.ts` report `created` and `reopened`
of the three events, and for code scanning only on the default branch, `appeared_in_branch` into it included. They read
only the fields listed in the area document; a secret scanning alert is reported whatever its source. The fields,
fallbacks, titles and the edge cases are in [`areas/notifications.md`](../areas/notifications.md#security-alert-rules).

## Consequences

- The guarantee now reads: a draft pull request triggers no notification; the exceptions are the CI failure marked
  _draft status unknown_ ([decision 0027](0027-ci-failure-rules-and-the-draft-lookup.md)) and a secret scanning alert,
  which is reported whatever its source. Dependabot and code scanning stay under it (code scanning reports no pull
  request ref). `docs/ARCHITECTURE.md` and `.squad/project.md` say so.
- Dependabot's `reintroduced` and `auto_reopened` and code scanning's `reopened_by_user` stay silent, as the issue
  says; a reintroduced vulnerability is not reported again.
- A code scanning alert that only ever exists on a pull request or a feature branch is never reported.
- Many alerts at once (a first scan, a new advisory across repositories) give one message each, without grouping.
- No real delivery of the three events exists, and none will be supplied (Product Manager's decision, 2026-10-20):
  the fixtures are reference-built from GitHub's OpenAPI description (`github/rest-api-description`, commit
  `755ee33b`, the webhook schemas `webhook-<event>-<action>` and the REST alert examples), as the GitHub API fixtures of
  [decision 0026](0026-github-app-authentication-and-installation-tokens.md) are. Residual risk, accepted: the field
  paths, the format of the code scanning `ref` (the webhook schema says only "the Git reference"; the REST schema `code-scanning-ref` documents
  `refs/pull/<n>/merge`, `refs/pull/<n>/head`, `refs/heads/<branch>` or simply `<branch name>`, so both branch forms
  are accepted), the action names, and
  whether a real `secret_scanning_alert` delivery carries `alert.secret` (the webhook schema has no such field; the
  REST alert does) may differ from what GitHub sends. The schema documents no `rule.security_severity_level` for code
  scanning webhooks, so line 3 normally shows `rule.severity`. Because the rules read only an allow-list of fields, a
  difference can only shorten a line or silence an alert, never put a secret into a message; a captured delivery that
  shows a difference is fixed in a new issue.
