# Spec: Pull request rules

Status: Draft

## Problem / motivation

Issue #13. The webhook pipeline of issue #12 records every delivery but has no rule, so no notification is ever sent.
The owner wants a Telegram message when a pull request in one of the owner's repositories is opened, is marked ready
for review, or has a review requested, and none while the pull request is a draft (guarantee in
`docs/ARCHITECTURE.md`).

## Behavior

- B1: A `pull_request` delivery with action `opened` for a pull request that is not a draft produces one message
  titled "New pull request" ("Neuer Pull Request" in German).
- B2: A `pull_request` delivery with action `opened` for a draft produces no message.
- B3: A `pull_request` delivery with action `ready_for_review` (a draft marked ready) produces one message titled
  "Ready for review" ("Bereit zum Review").
- B4: A `pull_request` delivery with action `review_requested` for a pull request that is not a draft produces one
  message titled "Review requested" ("Review angefordert").
- B5: A `pull_request` delivery with action `review_requested` for a draft produces no message.
- B6: Each of the three cases has its own switch in the settings (issue #11); a case whose switch is off produces no
  message, and the delivery is logged with decision `disabled`.
- B7: The message shows on line 1 the title, the repository `owner/repo` and `#` with the pull request number; on
  line 2 the pull request title; on line 3 the author and the branches ("by author · head → base", in German
  "von author · head → base"); the button opens the pull request on GitHub.
- B8: Pull requests opened by the owner, including those opened by tools under the owner's account, are reported:
  there is no filter by sender, and none by reviewer.
- B9: Any other event or action, and a `pull_request` delivery whose fields the rules read are missing or of an
  unexpected type, produces no message.
- B10: The real payloads the rules are tested with are kept under `test/fixtures/pull_request/`, with a README that
  records their origin and anonymization.

## Acceptance criteria

- [ ] AC1: Draft opened → no message; draft marked ready → message (issue).
- [ ] AC2: Review requested on a draft → no message (issue).
- [ ] AC3: A disabled rule → no message (issue).
- [ ] AC4: Each reported case produces the three lines and the button of B7, in English and German.
- [ ] AC5: Other events, other actions and unexpected shapes produce no message.

The testable criteria with their test names are in [plan.md](plan.md).

## Out of scope

- Telling apart several review requests on one pull request (the requested reviewer or team on line 3).
- Filters by sender, author or reviewer.
- Other `pull_request` actions (`synchronize`, `closed`, `reopened`, `converted_to_draft`, …).
- Quiet hours (issue #14), CI rules (#16), security alert rules (#17).

## Open questions

None. The real payloads were supplied by the owner (Product Manager's decision, option A); a team reviewer and a
fork pull request were not available and are documented as unverified shapes in decision 0024.
