# 0043: Only deliveries with an effect are recorded, and deliveries of other senders are bounded per hour

- **Status:** Accepted
- **Date:** 2026-11-02
- **Area:** Notifications
- **Source:** Issues #121, #134 and #140
- **Supersedes:** 0023 — amends its option 3: a new delivery is recorded only when it stores a message or an
  `activity` change, and `last_delivery` is otherwise kept by a bounded write

## Context

[Decision 0023](0023-webhook-processing-and-delivery-through-the-outbox.md) records every new delivery in one D1
batch with its `outbox` rows and `meta` `last_delivery`. Since the events of
[decision 0039](0039-issue-comment-fork-star-events-and-the-app-owner.md), strangers can cause many deliveries on a
public repository, most of which no rule reports. Each one writes a `deliveries` row with two indexes, the `meta`
upsert and, a week later, the cleanup delete; enough of them spend the free plan's daily D1 write budget (100,000
rows written, decision 0039), after which every delivery, alerts and CI failures included, is answered 503 and GitHub
does not redeliver it on its own. The guarantee "a delivery is processed once" (`.squad/project.md`, _Guarantees_)
exists so a redelivery produces no second message, and the status page's _Last delivery from GitHub:_ is how the
owner sees that GitHub reaches the Worker.

Issue #134: the deliveries a rule does report still write their rows. A stranger who opens issues, comments, stars,
unstars or forks on a public repository causes one recorded delivery each, about 14 rows written over its life (the
`deliveries` row and its indexes, the `outbox` or `activity` row and its index, the send's update, `last_delivery`,
both cleanup deletes; an estimate from the schema, not measured on the real D1), so roughly 7,000 of them a day still
spend the budget.

Issue #140: on a public repository anyone can open a pull request, and a stranger's fork pull request, comment or
issue can start a workflow in the repository's own context (`pull_request_target`, `issue_comment`, `issues`), whose
failure the CI rules report as a default-branch failure (decision 0027). Neither event was bounded, but both carry
the owner's, members' and collaborators' work, which the bound must not drop. A fork's own `pull_request` run is not
reported today (its `pull_requests` is empty, decision 0027), so it was not the path the issue named.

## Options considered

For deliveries without an effect (issue #121):

1. **Record only a delivery that stores an `outbox` row or an `activity` change; for any other, one conditional
   `last_delivery` upsert that changes the row only when the stored time is missing, unusable or 60 seconds or more
   away** — a delivery without effect has nothing a redelivery could repeat, so deduplication loses nothing; the status
   line stays accurate to its minute at no more than 1,440 writes a day, and one statement leaves no read-then-write
   race. Chosen.
2. **Skip `last_delivery` too, as the issue proposes** — no write at all, but the status page shows _None received
   yet_ after the App's `ping` and until the first notification, which hides a working setup.
3. **Keep the unconditional `last_delivery` upsert for every delivery** — simplest, but still one or two rows per
   delivery, so the budget can still be spent, only later.
4. **A read of `last_delivery`, then a write when it is older than 60 seconds** — concurrent deliveries all see the
   stale value and write, and an earlier time can overwrite a later one.
5. **Leave an unstar that removes a collected star unrecorded as well** — saves its row, but a redelivered unstar
   after a new star would delete that newer star.

For reported deliveries of other senders (issue #134):

6. **A bound per event, counted in fixed UTC hours by one conditional `meta` upsert per event, for the four events
   a stranger can cause (`issues`, `issue_comment`, `star`, `fork`), at 20 recorded deliveries per event and hour,
   whoever the sender is** —
   the events are disjoint from those of the pull request, CI and alert rules, so those are never counted or
   dropped; 4 × 24 × 20 = 1,920 recorded deliveries a day at about 14 rows each is about 27,000 rows, a little over a
   quarter of the budget, and a delivery past the bound costs one read and a write that changes nothing. One
   statement decides and counts, so concurrent deliveries cannot exceed the bound. 20 an hour is well above what a
   personal repository sees from senders other than its owner. Chosen.
7. **Count the event's `deliveries` rows of the window instead of a counter** — no extra write, but without a new
   index on `(event, received_at)` (a migration and one more row written for every delivery, alerts included) each
   check reads every delivery of the window, and a flood of deliveries past the bound would then spend the daily
   read budget instead.
8. **A bound per sender** — GitHub accounts cost nothing, so it bounds no total, and it needs one counter row per
   sender, which a flood of accounts makes unbounded.
9. **One bound per day instead of per hour** — the same daily total, but one burst in the morning silences the
   event until midnight; an hourly window recovers within the hour.
10. **The bound as a setting** — a new setting with its wizard field, storage and documentation for a number few
    owners would change; the constant can become one later.
11. **A notice to the owner when the bound is reached** — the owner would learn that messages were dropped, at the
    cost of a recorded row and new texts per event and hour; left to a follow-up issue.
12. **Bound `pull_request` and `workflow_run` as well, whoever the sender is** — strangers can open pull requests and
    start failing runs too, but this bound would also drop the owner's and collaborators' pull requests and CI
    failures. Rejected for #134 and in this form for #140.

For pull requests and CI failures caused by strangers (issue #140):

13. **The same hourly bound with its own counter per event for `pull_request` and `workflow_run`, applied only to a
    delivery a stranger can have caused: a pull request whose author GitHub marks as neither owner, member nor
    collaborator and that the owner did not send; a run whose `event` is not one only an account the owner admitted
    can cause and that the owner did not start** — decided from fields of the payload alone (`author_association`,
    `workflow_run.event`, `triggering_actor`), with no read or call beyond today's; admitted authors' pull requests,
    the runs of admitted-only events and the owner's runs are never counted; unknown values fall to the counted side,
    which protects the budget. `workflow_dispatch` and `repository_dispatch` are not admitted-only: a workflow a
    stranger starts can raise them with its `GITHUB_TOKEN`. Chosen.
14. **The sender alone (`isForeignSender`), as for issues** — simplest, but collaborators' and members' pull requests
    and every run of a collaborator's push would share the bound, which the issue rules out.
15. **Ask GitHub whether the account is a collaborator** — exact for comment-triggered runs too, but one API call
    and possibly a token refresh per delivery, inside the 10-second answer budget, and a flood of deliveries would
    then spend GitHub's rate limit and the Worker's time instead.
16. **Count only a list of stranger-capable run events** (`pull_request_target`, `issue_comment`, …) — exempts more,
    but any event GitHub adds, or one that an app raises in reaction to a stranger (`status`, `deployment_status`,
    `check_run`, `dynamic`), would pass unbounded; the list of admitted-only events fails closed instead.
17. **Exempt pull requests authored by a bot (`user.type` `Bot`), alone or together with a branch of the repository
    itself** — would spare Dependabot and Renovate, but it rests on the unverified claim that no stranger's app can
    author a pull request here; their pull requests share the bound instead, which fails closed.
18. **One counter shared by `pull_request` and `workflow_run`** — fewer rows, but a flood of either would hide the
    other's messages.
19. **Exempt a pull request, or a `pull_request` run, whose head repository is the repository itself** — taken at
    first on the belief that only a writer can push such a branch, but anyone with read access can open a pull
    request between two existing branches and reopen it to start CI, so a stranger could send unbounded messages.
    Rejected: collaborators' `pull_request` CI failures share the bound instead.

## Decision

`processWebhook` records a delivery in the transaction of decision 0023 only when it has `outbox` rows or `activity`
changes; otherwise it answers 202 after one conditional `last_delivery` upsert whose failure is ignored. A delivery of
`issues`, `issue_comment`, `star` or `fork` that would be recorded is recorded only when one conditional `meta` upsert
counts it as one of at most 20 of its event in the current UTC hour; otherwise it is handled like a delivery without
effect. A `pull_request` or `workflow_run` delivery is counted the same way, with its own counter, only when a
stranger can have caused it (option 13). The rules are in [`areas/notifications.md`](../areas/notifications.md) and
[`areas/storage.md`](../areas/storage.md).

## Consequences

- A delivery that produced nothing is evaluated again when it is redelivered, against the settings and draft state of
  then; it can report then, once. The guarantee keeps its substance — no second message — and its wording names the
  recorded deliveries.
- A stream of deliveries without effect costs at most one `meta` write a minute.
- Reported deliveries of the six bounded events cost at most about 2,880 recorded deliveries, about 40,000 rows
  written a day; the rest of the budget stays for the uncounted pull requests and CI failures, the alert rules, the
  cron and the setup wizard. The row counts per delivery are an
  estimate from the schema. The counter statement, measured in the local workerd test pool only (not the real D1),
  `meta.changes` / `rows_written`: first insert 1 / 2, increment 1 / 1, refusal at the bound 0 / 0, next hour 1 / 1,
  an empty stored value restarting 1 / 1, a stored 16-digit count above the limit 0 / 0 and unchanged; five
  concurrent calls at 18 of 20 gave `changes` 1, 1, 0, 0, 0 and a final count of 20.
- The bound counts every sender the rules report, not only strangers: the rules report anyone other than the owner
  (`isForeignSender`), so collaborators' issues and comments share the hourly bound, and for an organization-owned App,
  whose owner never acts itself (`isOwnAction`), its members' do too.
- Past the bound an issue or comment sends no message, a star or fork is not collected, and an unstar is
  not applied (a star collected before stays in the digest). The owner learns of it only from the log entry
  (`limited`) and GitHub's own notifications; one stranger can fill an event's bound for an hour and hide the others'
  issues or comments of that hour. A dropped delivery is not recorded, so its redelivery in a later hour can report it.
- Around the turn of an hour up to twice the bound can be recorded in a short time. A counted delivery whose batch
  then fails, or finds the id recorded meanwhile, still counts.
- A comment on a pull request or a CI failure in a pull request past the bound still makes its draft lookup (a GitHub
  call, possibly a token refresh), which runs before the bound is checked.
- A collaborator's comment or issue that starts a failing workflow, and a chained `workflow_run`, are counted: a run
  carries no author association and a chained run does not name the event before it (option 15 declined). For an
  organization-owned App the owner exemptions never apply (`isOwnAction`), so an admin's review request on a
  stranger's pull request or re-run of a stranger's run is counted; members' and collaborators' pull requests and the
  admitted-only runs stay uncounted. A member whose organization membership is private is marked `CONTRIBUTOR` or
  `NONE` and counted. Dependabot's and Renovate's pull requests and collaborators' `pull_request` CI failures share
  the bound (options 17 and 19).
- Residual: a token with write access (a personal access token, an App token) that the owner places in a workflow a
  stranger can start can raise an admitted-only event, whose runs are then not counted; `GITHUB_TOKEN` can raise only
  the two dispatch events, which are counted.
- Which run events only an admitted account can cause, that `GITHUB_TOKEN` starts runs only through the dispatch
  events, and that `triggering_actor` is the account that re-ran a run are taken
  from GitHub's documentation, not observed. A wrong `triggering_actor` only counts a run that need not be; an event
  wrongly taken as admitted-only would let a stranger's runs of that event pass unbounded.
- The free plan's daily Worker request limit is a separate budget no D1 bound protects.
- The status page time can lag the latest delivery by up to a minute, and a write failure leaves the earlier time.
- A draft lookup may still refresh the installation-token cache for a delivery that is then dropped, as before.
- That a no-op upsert counts no row written in D1's billing is taken from SQLite's change count, not measured on the
  real D1. Measured in the local workerd test pool only: the first insert gave `meta.changes` 1 and
  `rows_written` 2, the no-op (30 s and 59,999 ms away) 0 and 0, and exactly 60 s away 1 and 1.
- Residual: whether D1 still serves reads once the daily write budget is spent is not verified. If it rejects all
  queries then, the known-id read already fails and every delivery answers 503; the documentation promises only that a
  failed `last_delivery` write is ignored and the answer stays 202.
