# 0024: Pull request rules

- **Status:** Proposed
- **Date:** 2026-10-18
- **Area:** Notifications
- **Source:** Issue #13
- **Supersedes:** —

## Context

Issue #13 asks for the first three rules on the pipeline of [decision 0023](0023-webhook-processing-and-delivery-through-the-outbox.md):
`pull_request` with action `opened`, `ready_for_review` and `review_requested`, each switchable in the settings, with
the guarantee from `docs/ARCHITECTURE.md` that a draft pull request triggers no notification. The issue's table sets
the condition `pull_request.draft == false` for `opened` and `review_requested` and "none" for `ready_for_review`.
Issue #12 fixes the message lines for pull requests: line 2 the title, line 3 the author and the branches.

Five real deliveries of the owner's GitHub App, anonymized, are the fixtures (`test/fixtures/pull_request/`): a
non-draft and a draft `opened`, a `ready_for_review` and a non-draft and a draft `review_requested` with a user as
reviewer. The `ready_for_review` delivery carries `draft` `false`. No delivery of a review requested from a team and
none of a pull request from a fork was available. The payload is attacker-reachable only through a signed body
(decision 0012), but a captured signed body can be replayed with a different `X-GitHub-Event` header, and titles and
branch names are text anyone who can open a pull request chooses.

## Options considered

How the rules are built:

1. **One file per rule, each a call of one shared factory that narrows the payload and builds the notification** —
   the issue's "one file per case"; the narrowing and the draft check exist once, so the three rules cannot drift
   apart. Chosen.
2. **Three self-contained rule functions** — each reads the payload on its own; three copies of the same narrowing,
   which the duplication measure of the CI analysis reports and which can diverge on the draft check.
3. **One rule for all three actions** — fewer files, but the settings have three switches (issue #11), and a rule
   has exactly one switch id.

The draft condition of `ready_for_review`:

4. **`draft` must be the boolean `false` for all three actions** — for a genuine `ready_for_review` delivery this
   holds (the real sample has `false`; the action means a draft became ready), so the issue's "none" is met in
   effect; a payload claiming a draft that is ready is inconsistent and is silent, which keeps the guarantee "a
   draft triggers nothing" true for every payload, not only for well-formed ones. Chosen.
5. **No condition for `ready_for_review`, as the table says** — identical on every real payload seen, but a
   `ready_for_review` body with `draft` `true` (a race with a conversion back to draft, which no sample shows and
   GitHub's documentation does not exclude) would report a draft, against the guarantee.

What a missing or malformed field does:

6. **The rule returns no notification** when any field it reads is absent or of another type (`draft` not a
   boolean, the number not a whole number from 1 to 2^53 − 1, a text field not a string, `pull_request.user` not an
   object) — fails closed, as the notifications area requires of every rule. Chosen.
7. **A notification with the field left empty** — reports more, but turns an unexpected shape into a message whose
   meaning is guessed; a missing `draft` would even report a possible draft.

What line 3 of a review request shows:

8. **The author and the branches, as for the other two cases** — what issue #12 specifies; the rule reads only
   fields of `pull_request`, so it does not depend on the shape of `requested_reviewer` or `requested_team`, of
   which only the user variant was sampled. Chosen.
9. **The requested reviewer or team** — tells two review requests on one pull request apart, but departs from
   issue #12 and would rest on the unsampled team shape.

## Decision

`src/rules/pull-request.ts` narrows a `pull_request` delivery of one action and builds its notification; each of
`src/rules/pull-request-opened.ts`, `pull-request-ready-for-review.ts` and `pull-request-review-requested.ts` is one
rule made by it and registered in `RULES`. All three report only when the event name is `pull_request`, the action
matches and `pull_request.draft` is the boolean `false`; any unexpected shape returns no notification. The cases,
texts and lines are in [`areas/notifications.md`](../areas/notifications.md#pull-request-rules).

## Consequences

- The first notifications are sent; the first real one is the live check of the Telegram client
  (decision 0023).
- A review requested from several reviewers is expected to arrive as one delivery per reviewer (the payload names
  one `requested_reviewer`; unverified, no sample of a request for several), and would then produce one message
  each, with the same three lines. Accepted: line 3 follows
  issue #12; telling them apart is a follow-up that needs a sample of the team variant.
- Unverified shapes: a review requested from a team, and a pull request from a fork (whose `head.repo` may differ or
  be `null` once the fork is deleted). The rules read neither `requested_reviewer`, `requested_team` nor `head.repo`,
  so both are expected to be reported like the sampled cases; a fork's branch is shown without its owner. If GitHub
  sends one of them without a field the rules read, it is silent, not misreported, and a captured sample is the fix.
- A pull request whose author account was deleted (`user` not an object) is silent. Accepted as rare at the moment of
  these three actions.
- There is no filter by sender or reviewer: the owner's own pull requests, including those opened by tools under the
  owner's account, are reported, and so are review requests for other reviewers.
- A signed body replayed under another `X-GitHub-Event` reaches these rules only with the event name
  `pull_request`, and another event's body sent under that name must also carry a matching action and a complete
  `pull_request` object; the cleaning and escaping of `src/message.ts` apply to every text either way.
