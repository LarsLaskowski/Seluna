# 0043: Only deliveries with an effect are recorded

- **Status:** Accepted
- **Date:** 2026-10-31
- **Area:** Notifications
- **Source:** Issue #121
- **Supersedes:** 0023 — amends its option 3: a new delivery is recorded only when it stores a message or an
  `activity` change, and `last_delivery` is otherwise kept by a bounded write

## Context

[Decision 0023](0023-webhook-processing-and-delivery-through-the-outbox.md) records every new delivery in one D1
batch with its `outbox` rows and `meta` `last_delivery`. Since the events of
[decision 0039](0039-issue-comment-fork-star-events-and-the-app-owner.md), strangers can cause many deliveries on a
public repository, most of which no rule reports. Each one writes a `deliveries` row with two indexes, the `meta`
upsert and, a week later, the cleanup delete; enough of them spend the free plan's daily D1 write budget, after which
every delivery, alerts and CI failures included, is answered 503 and GitHub does not redeliver it on its own. The
guarantee "a delivery is processed once" (`.squad/project.md`, _Guarantees_) exists so a redelivery produces no second
message, and the status page's _Last delivery from GitHub:_ is how the owner sees that GitHub reaches the Worker.

## Options considered

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
5. **A rate limit per event type** — needs counter writes of its own and drops deliveries a rule would report;
   deduplication, the issue's reason for it, is kept by option 1 without one.
6. **Leave an unstar that removes a collected star unrecorded as well** — saves its row, but a redelivered unstar
   after a new star would delete that newer star.

## Decision

`processWebhook` records a delivery in the transaction of decision 0023 only when it has `outbox` rows or `activity`
changes; otherwise it answers 202 after one conditional `last_delivery` upsert whose failure is ignored. The rules are
in [`areas/notifications.md`](../areas/notifications.md) and [`areas/storage.md`](../areas/storage.md).

## Consequences

- A delivery that produced nothing is evaluated again when it is redelivered, against the settings and draft state of
  then; it can report then, once. The guarantee keeps its substance — no second message — and its wording names the
  recorded deliveries.
- A stream of deliveries without effect costs at most one `meta` write a minute; deliveries a rule reports still write
  their rows, so a stranger who opens many issues can still spend the budget (a separate issue). A stranger starring
  and unstarring with the star switch on still causes one recorded delivery per star and per unstar (and one
  `activity` row per star under a digest).
- The status page time can lag the latest delivery by up to a minute, and a write failure leaves the earlier time.
- A draft lookup may still refresh the installation-token cache for a delivery that is then dropped, as before.
- That a no-op upsert counts no row written in D1's billing is taken from SQLite's change count, not measured on the
  real D1. Measured in the local workerd test pool only: the first insert gave `meta.changes` 1 and
  `rows_written` 2, the no-op (30 s and 59,999 ms away) 0 and 0, and exactly 60 s away 1 and 1.
- Residual: whether D1 still serves reads once the daily write budget is spent is not verified. If it rejects all
  queries then, the known-id read already fails and every delivery answers 503; the documentation promises only that a
  failed `last_delivery` write is ignored and the answer stays 202.
