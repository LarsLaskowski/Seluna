# 0040: Issue and comment rules

- **Status:** Proposed
- **Date:** 2026-10-30
- **Area:** Notifications
- **Source:** Issue #109
- **Supersedes:** — (settles what [0039](0039-issue-comment-fork-star-events-and-the-app-owner.md) left to #109: what
  a delivery does without a known owner)

## Context

Issue #109 asks for three rules on the events #108 subscribed to: a new issue, a comment on an issue and a comment on a
pull request's conversation, each left out when the owner or a bot wrote it. A rule is a pure function of the event,
the payload and the settings ([0023](0023-webhook-processing-and-delivery-through-the-outbox.md)), but the owner is a
`meta` row tied to the App ID (0039), and the App ID is a Worker secret or an encrypted D1 credential. The guarantee "a
draft pull request triggers no notification" (`.squad/project.md`, _Guarantees_) covers comments on pull requests.
GitHub's OpenAPI schema lists `draft` on the `issue` object of these webhooks as an optional boolean. Issue bodies
often start with the HTML comments of an issue template, which GitHub does not show. No real delivery of these events
was captured.

## Options considered

How the owner reaches the rules:

1. **A fourth `evaluate` argument, read by the processing beside the settings.** Rules stay pure and testable with a
   plain value. Chosen.
2. **Inside the settings object.** Settings are the owner's choices, written by the form; the owner is learned.
3. **Each rule reads D1.** Breaks the pure-function rule of 0023.

When the owner is read:

4. **On every delivery, before the rules.** One extra D1 batch (and, without the Worker secret `GITHUB_APP_ID`, a key
   derivation and a decryption of the App ID); the rules stay independent of the event list. Chosen.
5. **Only for `issues` and `issue_comment`.** Saves the read for other events but ties the processing to the events
   of particular rules.
6. **The `meta` row without checking its App ID.** No decryption, but an owner row left from an earlier app would
   filter the wrong account.

Without a known owner (an app older than 0039 whose status page was not viewed yet):

7. **Report as from another account.** Only the owner's own activity is extra until the status page stores the owner.
   Chosen (Product Manager confirmed).
8. **Report nothing.** Silences strangers on every older instance until a page view.

The draft state of a commented pull request:

9. **The payload's `issue.draft` when it is a boolean, the draft lookup when it is absent.** No GitHub request when the
   payload carries it, and still correct if real deliveries do not. Chosen.
10. **The payload only.** If real deliveries lack the field, every pull request comment would be silenced.
11. **The draft lookup only.** A GitHub request for every pull request comment.

An undeterminable draft state (lookup failed, timed out, no usable `installation.id`):

12. **Drop the notification.** Keeps the guarantee and its two exceptions unchanged. Chosen (Product Manager
    confirmed).
13. **Report it marked _draft status unknown_, as for CI failures (0027).** A third exception to the guarantee.

Issue template comments in the body:

14. **Remove `<!-- … -->` before line 3 is built, an unterminated `<!--` with the rest.** Line 3 shows what GitHub
    shows. Chosen.
15. **Keep them.** A template comment can fill line 3 entirely.

Fixtures:

16. **Built from GitHub's webhook documentation, with a live check on a deployed copy before the pull request is
    ready.** Product Manager's decision, as in [0028](0028-security-alert-rules.md). Chosen.
17. **Captured deliveries.** None existed.

## Decision

Three rules `issue_opened`, `issue_comment` and `pull_request_comment` report `issues` `opened` and `issue_comment`
`created` unless the sender is the stored `User` owner or a bot; the processing reads the owner once per delivery and
passes it to every rule. An unknown owner counts as another account. A `sender.id` that is not a safe integer drops
the delivery: beyond 2^53 − 1 a number loses precision, so its equality with the owner's id would prove nothing. An
`issues` delivery that carries a `comment` key or an `issue.pull_request` is another event's payload (GitHub sends
neither under that header) and is not reported as a new issue. A comment on a pull request uses `issue.draft`,
falls back to the draft lookup, and drops the notification whenever the draft state stays unknown. Line 3 shows the
body without HTML comments and with white space collapsed. The behavior is in
[`areas/notifications.md`](../areas/notifications.md).

## Consequences

- Every delivery reads the owner; a D1 failure there answers 503 like a failing settings read.
- The body excerpt is built in one linear pass and capped at one code point more than line 3's limit, so a stranger's
  1 MiB body costs no more downstream than a short one.
- Residual risk, shapes: the fixtures follow GitHub's documentation, not captured deliveries — the field paths, the
  `pull_request` marker and `issue.draft`. Each deviation sends nothing. The Product Manager's live check on a deployed
  copy confirms an issue, a comment on an issue, and comments on a ready and a draft pull request (including whether
  `issue.draft` is present) before the pull request is marked ready.
- Residual risk, volume: anyone can open issues and comment on a selected public repository; each is a message, with
  no rate limit (0039).
- Revisit: a captured delivery without `issue.draft` makes the lookup the normal path; a rate limit or digest would
  need its own issue.
