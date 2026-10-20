# 0027: CI failure rules and the draft lookup

- **Status:** Proposed
- **Date:** 2026-10-20
- **Area:** Notifications
- **Source:** Issue #16
- **Supersedes:** —

## Context

Issue #16 asks for two rules on `workflow_run` `completed`: a failed run (`failure`, `timed_out`) on the default branch,
and one in a pull request that is not a draft. The `workflow_run` payload names the pull requests of a run by number
only, so whether one is a draft has to be asked of GitHub (`GET /repos/{owner}/{repo}/pulls/{number}`, the API client
of [decision 0026](0026-github-app-authentication-and-installation-tokens.md)). The issue says that a failed lookup still
sends the message, marked "draft status unknown".

Forces: a rule is a pure function of event, payload and settings with no I/O (issue #12,
[decision 0023](0023-webhook-processing-and-delivery-through-the-outbox.md), `docs/ARCHITECTURE.md`); a delivery is
recorded with its outbox rows in one transaction before the 202; GitHub ends a delivery that is not answered within 10
seconds and does not resend it on its own, while one API client call may take two requests of up to 10 seconds each;
and the guarantee "a draft pull request triggers no notification" (`.squad/project.md`, _Guarantees_).

Two real deliveries of the owner's app are the fixtures (`test/fixtures/workflow_run/`): a `success` of a scheduled
run on the default branch and a `failure` in a pull request of the same repository. They confirm the fields the rules
read (`head_branch`, `head_repository.id`, `name`, `html_url`, `head_commit.message`, `pull_requests[].number`,
`pull_requests[].base.repo.id`, `repository.id`, `repository.default_branch`, `installation.id`). A failure on the
default branch, `timed_out`, `cancelled`, a fork's run and a re-run could not be produced (Product Manager's decision,
2026-10-20).

## Options considered

Where the draft lookup happens:

1. **The rule stays pure and marks its notification with a draft check (the pull request to ask about and the title
   to use when the answer is unknown); the webhook processing runs the lookups of the enabled notifications, bounded in
   time, after the rules and before the transaction** — the rule interface, its purity and the one-transaction
   recording stay as they are; only a notification whose switch is on costs a request; the answer to GitHub waits for
   the lookup. Chosen.
2. **An asynchronous rule that calls the API client itself** — simplest to read, but every rule would take network
   dependencies, contrary to issue #12 and the architecture, and a switched-off rule would still call GitHub before
   `runRules` drops its result.
3. **Record the delivery, answer 202, and run the lookup and write the row in `waitUntil`** — GitHub gets its answer at
   once, but the delivery and its row are no longer one transaction: a lookup cut off by the platform's time after the
   response loses the message for good, since the delivery id is already recorded and a redelivery is ignored.
4. **No lookup: report every failed run in a pull request** — contradicts the issue and the draft guarantee.

The time bound of the lookup:

5. **One limit of 8 seconds around the whole lookup (token and pull request read), a lookup still running then counts
   as failed** — leaves about 2 seconds of GitHub's 10 for the D1 work around it, and fails toward the issue's
   "send anyway". Chosen.
6. **Only the API client's 10-second timeout per request** — a slow token request plus a slow pull request read can
   take 20 seconds, so GitHub marks the delivery failed and the owner gets nothing unless the Worker survives the
   dropped connection.

Telling the default branch from a fork's branch of the same name:

7. **`head_branch` equal to `repository.default_branch` and `head_repository.id` equal to `repository.id`** — an
   outside contributor's branch `main` in a fork is not the default branch. Chosen. The guarantee is "not as a fork's
   branch and not with a text of their choosing": runs that an outsider's event starts in the repository's own context
   (`pull_request_target`, `issue_comment`, a chained `workflow_run`) are reported like any default-branch run, with
   texts that come from the repository.
8. **`head_branch` alone, as the issue's table says** — anyone who can open a pull request from a fork could raise the
   default-branch alarm with a commit message of their choosing.

Assumption: draft checks are resolved one after another, so the 8-second budget and "at most one lookup per delivery"
hold only while exactly one rule (`ci_failed_pull_request`) sets a `draftCheck`; a second such rule needs a shared bound.

## Decision

`src/rules/workflow-run.ts` narrows a failed `workflow_run` delivery; `ci-failed-default-branch.ts` and
`ci-failed-pull-request.ts` are the two rules, the second one returning its notification with a draft check. The
webhook processing resolves draft checks through an injected, time-bounded lookup before the delivery is recorded: a
draft drops the notification, an unknown answer swaps in the "draft status unknown" title. The cases, texts, limits
and failure behavior are in [`areas/notifications.md`](../areas/notifications.md#ci-failure-rules).

## Consequences

- The guarantee "a draft pull request triggers no notification" has one exception: a CI failure in a pull request
  whose draft state could not be read (failure or no answer within 8 seconds) is reported, marked _draft status unknown_ (issue #16).
  `docs/ARCHITECTURE.md` and `.squad/project.md` name it.
- A delivery of a failed run in a pull request can take up to about 8 seconds longer to answer; the D1 work around the
  lookup is expected to fit in the remaining 2 seconds (unverified; the Product Manager's live check on a deployed copy
  measures it in the Worker's logs).
- A lookup that is cut off keeps running until the API client's own timeout; a token it obtains is still cached.
- Unverified until a live check or a later real sample: that a fork's run has a `head_repository.id` other than the
  repository's and an empty `pull_requests` (only GitHub's documentation says so), and that a failed or `timed_out`
  run on the default branch has the shape of the real successful one. A deviation fails toward silence (an unexpected
  shape sends nothing) except that a fork's run with a non-empty `pull_requests` of the base repository would be
  reported as the pull request case; a captured sample is the fix, in a new issue.
- A pull request from a fork is not reported (empty `pull_requests`), a workflow on both `push` and `pull_request`
  gives two messages, and the attempts of a re-run look alike.
