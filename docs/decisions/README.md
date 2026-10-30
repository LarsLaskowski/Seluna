# Decision records

Why the code is the way it is. Each file records one decision — its context, the options considered, what
was chosen and the consequences — so that months later the reasoning is still available without the
pull request, the issue thread or the session that produced it.

A record explains the *why*. What holds today — formats, limits, error behavior, guarantees — is written down
once in the [area document](../areas/README.md) of the record's area, and the record links to it.
`docs/ARCHITECTURE.md` describes how the parts fit together. When a decision changes the architecture,
`ARCHITECTURE.md` is updated as well and links the record.

## Rules

- One decision per file: `NNNN-short-title.md` (four digits, next free number), created from
  [`_template.md`](_template.md). In the index row and in a `Superseded by NNNN` status the number may be
  written as a link, `[NNNN](NNNN-short-title.md)`.
- **The record states the decision in one to three sentences and does not restate behavior.** Context,
  *Options considered* and *Consequences* carry the reasoning; the rules of the resulting behavior (values,
  formats, limits, error texts) belong in the area document and are linked from the record.
- The `Area:` field names the record's area as listed in [`docs/areas/README.md`](../areas/README.md), or `—`
  for a record about the process or about no area. Once areas are defined, every record needs the field. For a
  released record it is part of the content: it changes only through a new record. A released record without
  the field gets its area from an `## Area assignment` table (`| Record | Area |`) in a new record; the
  released record itself stays unedited.
- Written by the squad Lead (see [`.claude/agents/squad-lead.md`](../../.claude/agents/squad-lead.md));
  anyone may add one for a change made outside the squad.
- Committed together with the change it explains.
- **Released or not decides how a record changes.** A record is *released* once the commit that added it is
  contained in a release tag (`v*`; check with `git tag --contains <commit>`, the commit is
  `git log --diff-filter=A --format=%H -- <file>`). Until the first release nothing is released.
- A record that is **not yet released** is edited in place, in the pull request that changes the decision
  (status stays `Proposed` or `Accepted`). Its history is Git and the pull request; there is no
  `Superseded by` chain for it. A record that no longer applies is deleted (numbers are never reused, gaps are
  fine) together with its index row and every link to it.
- A **released** record is **append-only**: it is never rewritten. A changed decision gets a new record that
  names the old one under *Supersedes*, and the old record's status becomes `Superseded by NNNN` (the only
  edit allowed). `Superseded by` is therefore only ever set on a released record.
- A new record that **amends** a released record without superseding it names the older one under
  *Supersedes* and says there, in one sentence, what it amends. The older record is **not edited** — not even
  with a pointer; a reader of the older record finds the amendment through the index and the new record.
- **One record per decision that has lasting weight, grouped by topic — not one per pull request.** Not for
  routine changes: a record is needed when a choice between real alternatives was made that shapes the
  architecture or behavior, a trade-off or limitation was accepted, or a documented guarantee was touched.
  Before adding a record, look for an unreleased record on the same topic and extend it instead. A review
  finding that was deliberately not fixed, a follow-up split, or a dependency change gets its own record only
  if it touches a guarantee or the architecture; otherwise it belongs in the pull request description or the
  follow-up issue, or as a sentence in the record of the topic it concerns.
- `.squad/tools/decision-check.py` (also run by `config-check.py`) checks the index, the links between records
  and that no released record was changed.

## Index

<!-- project:begin index -->

| #   | Title | Status | Date |
| --- | ----- | ------ | ---- |
| [0001](0001-quality-gates-before-the-pull-request.md) | Quality gates before the pull request | Accepted | 2026-10-14 |
| [0002](0002-squad-working-records-off-main.md) | Squad working records stay off main, and product PRs never change the squad | Superseded by [0022](0022-squad-working-records-off-main.md) | 2026-10-14 |
| [0003](0003-squash-merge-pull-requests.md) | Squash-merge pull requests | Accepted | 2026-10-14 |
| [0004](0004-typescript-instead-of-go.md) | TypeScript instead of Go | Accepted | 2026-10-14 |
| [0005](0005-one-instance-per-user.md) | One instance per user instead of a central service | Accepted | 2026-10-14 |
| [0006](0006-github-app-per-user-manifest-flow.md) | A GitHub App per user, created through the manifest flow | Accepted | 2026-10-14 |
| [0007](0007-github-app-credentials-encrypted-in-d1.md) | GitHub App credentials encrypted in D1 | Accepted | 2026-10-15 |
| [0008](0008-delivery-through-a-d1-outbox.md) | Delivery through a D1 outbox | Accepted | 2026-10-14 |
| [0009](0009-releases-only-by-tag-push.md) | Releases published as a pre-release and promoted by the release workflow | Accepted | 2026-10-14 |
| [0010](0010-istanbul-coverage.md) | Istanbul coverage instead of V8 | Superseded by [0033](0033-v8-coverage.md) | 2026-10-14 |
| [0011](0011-public-http-surface.md) | Public HTTP surface of the Worker | Accepted | 2026-10-14 |
| [0012](0012-webhook-signature-verification.md) | Webhook signature verification | Accepted | 2026-10-14 |
| [0013](0013-deploy-to-cloudflare-and-workers-builds.md) | Deployment through the Deploy to Cloudflare button and Workers Builds | Accepted | 2026-10-14 |
| [0014](0014-d1-schema-and-data-access.md) | D1 schema and data access | Accepted | 2026-10-15 |
| [0015](0015-setup-login.md) | Setup login | Accepted | 2026-10-15 |
| [0016](0016-telegram-chat-in-the-setup-wizard.md) | Telegram chat in the setup wizard | Accepted | 2026-10-16 |
| [0017](0017-github-app-manifest-flow.md) | GitHub App creation through the manifest flow in the setup wizard | Accepted | 2026-10-17 |
| [0018](0018-settings-and-status-page.md) | Settings, status page and reset in the setup wizard | Accepted | 2026-10-17 |
| [0019](0019-language-tables-excluded-from-duplication.md) | Language tables of the setup wizard excluded from duplication detection | Accepted | 2026-10-17 |
| [0020](0020-deploy-command-checked-in-the-setup-guide.md) | Deploy command checked in the setup guide | Accepted | 2026-10-17 |
| [0021](0021-missing-tables-notice-on-the-setup-login.md) | Missing-tables notice on the setup login | Accepted | 2026-10-17 |
| [0022](0022-squad-working-records-off-main.md) | Squad working records stay off main, and product PRs never change the squad | Superseded by [0037](0037-squad-working-records-off-main.md) | 2026-10-17 |
| [0023](0023-webhook-processing-and-delivery-through-the-outbox.md) | Webhook processing, message format and delivery through the outbox | Accepted | 2026-10-17 |
| [0024](0024-pull-request-rules.md) | Pull request rules | Accepted | 2026-10-18 |
| [0025](0025-quiet-hours-decided-at-sending.md) | Quiet hours decided at sending | Accepted | 2026-10-18 |
| [0026](0026-github-app-authentication-and-installation-tokens.md) | GitHub App authentication and cached installation tokens | Accepted | 2026-10-19 |
| [0027](0027-ci-failure-rules-and-the-draft-lookup.md) | CI failure rules and the draft lookup | Accepted | 2026-10-20 |
| [0028](0028-security-alert-rules.md) | Security alert rules | Accepted | 2026-10-20 |
| [0029](0029-outbox-retry-and-cleanup-by-the-cron.md) | Outbox retry and cleanup by the cron | Accepted | 2026-10-21 |
| [0030](0030-release-notice-without-credentials.md) | Release notice from an unauthenticated release check | Accepted | 2026-10-21 |
| [0031](0031-update-workflow-for-copies.md) | Update workflow for copies | Accepted | 2026-10-22 |
| [0032](0032-node-test-project-for-workflow-scripts.md) | Node test project for workflow scripts | Accepted | 2026-10-22 |
| [0033](0033-v8-coverage.md) | V8 coverage under the Workers test plugin | Accepted | 2026-10-23 |
| [0034](0034-setup-page-layout-checked-on-the-style.md) | Setup page layout and navigation, checked on the style instead of in a browser | Accepted | 2026-10-23 |
| [0035](0035-root-url-redirects-to-setup.md) | The root URL redirects to the setup wizard | Accepted | 2026-10-24 |
| [0036](0036-telegram-bot-token-in-the-setup-wizard.md) | Telegram bot token entered in the setup wizard and checked with getMe | Accepted | 2026-10-25 |
| [0037](0037-squad-working-records-off-main.md) | Squad working records stay off main, and product PRs never change the squad | Accepted | 2026-10-25 |
| [0038](0038-channel-neutral-outbox-and-active-delivery-channel.md) | Channel-neutral outbox and one active delivery channel | Accepted | 2026-10-26 |
| [0039](0039-issue-comment-fork-star-events-and-the-app-owner.md) | Issue, comment, fork and star events, the app owner and narrowed installation tokens | Accepted | 2026-10-29 |
| [0040](0040-issue-and-comment-rules.md) | Issue and comment rules | Accepted | 2026-10-30 |

<!-- project:end index -->
