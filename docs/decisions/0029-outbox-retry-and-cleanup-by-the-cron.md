# 0029: Outbox retry and cleanup by the cron

- **Status:** Accepted
- **Date:** 2026-10-21
- **Area:** Scheduled jobs
- **Source:** Issue #18
- **Supersedes:** — (amends [0008](0008-delivery-through-a-d1-outbox.md): the cron retries an unsent row until its fifth
  attempt in all and then marks it `failed`, instead of retrying it without end)

## Context

Since 0.3.0 a message whose first send fails stays `pending` in the `outbox` for good: both cron triggers call the
Worker, but its `scheduled` handler does nothing. Every delivery adds a `deliveries` row and every notification an
`outbox` row, and expired `token_cache` rows stay ([0026](0026-github-app-authentication-and-installation-tokens.md)),
so the database grows without limit. Issue #18 asks the 10-minute run to resend pending rows, mark a row `failed`
after 5 attempts and delete `deliveries` older than 7 days and sent rows older than 30 days. The Worker runs on the
free plan: 50 subrequests (D1 statements and `fetch` alike), 10 ms CPU and 15 minutes wall time per cron invocation,
100,000 rows written per day, and D1 asks for large deletes in chunks of about 1,000 rows (Cloudflare's
documentation). The first send already counts one attempt per request that reaches Telegram or fails on the way, and
none without a bot token or chat ([0023](0023-webhook-processing-and-delivery-through-the-outbox.md)).

## Options considered

How a row is resent:

1. **Through the first send's path (`deliverMessages`), with the settings read by the run** — quiet hours, button
   language, the 429 wait and the per-row log stay one implementation
   ([0025](0025-quiet-hours-decided-at-sending.md)); issue #69 moves this one path behind the channel interface.
   Chosen.
2. **A sender of its own for the cron** — a second copy of the sending rules to keep in step.

How the fifth failed attempt becomes `failed`:

3. **The update that counts an attempt also sets `failed` when it is the fifth, in one statement** — no failure can
   leave a counted fifth attempt `pending`; it holds for the first send too, which cannot reach 5. Chosen.
4. **A second update after the count** — a failure between the two leaves a row with 5 attempts for the next run to
   mark without a send.

Rows already at 5 or more attempts (an earlier state, a hand edit):

5. **One statement before the selection marks at most 10 of them `failed`, oldest first, and they do not count
   toward the 10 rows sent** — no Telegram request, bounded log. Chosen.
6. **Pick them in the same query as the rows to send** — each would take the place of a row that can still be
   delivered.

Two runs sending one row twice:

7. **No claim; accepted under at-least-once** — a run of 10 rows ends in about 4 minutes, well inside the 10-minute
   rhythm, so only a trigger delivered twice overlaps. Chosen.
8. **Claim rows before sending (a column, or `attempts` counted before the send)** — a migration, or an attempt
   counted for a send that never happened when the run is cut off.

How many rows a run touches:

9. **At most 10 rows sent, rows written more than one minute ago, oldest first; at most 1,000 rows deleted per table,
   oldest first** — at most 17 D1 statements and 20 Telegram requests per run, a backlog drains over the next runs,
   and the one-minute grace leaves a row to its first send, which `waitUntil` ends within about 30 seconds. Chosen.
10. **Everything due at once** — a long outage or a first cleanup could pass the subrequest, query-duration or
    daily-write limits and fail the whole run.

What the cleanup deletes:

11. **`deliveries` received more than 7 days ago, `sent` and `failed` rows written more than 30 days ago, expired
    `token_cache` rows; never a `pending` row** — the issue names `sent` rows only, but a `failed` row is read by
    nothing; GitHub offers redelivery for 3 days, so 7 days of `deliveries` keep deduplication intact; a token row of
    an earlier app's installation is expired an hour after the app changed. Chosen.
12. **Only what the issue names** — `failed` rows and token rows would grow without limit.

## Decision

The 10-minute run marks rows already at 5 attempts `failed`, then resends at most 10 due `pending` rows through the
first send's path, the attempt that is a row's fifth marking it `failed` in the same update, and deletes old
`deliveries`, finished `outbox` rows and expired `token_cache` rows in one batch of at most 1,000 rows per table;
retry and cleanup fail and log independently. The rules are in [`areas/scheduled-jobs.md`](../areas/scheduled-jobs.md).

## Consequences

- "Unsent rows are retried" now has a bound: a Telegram outage longer than about 40 minutes (the first send and four
  runs) leaves its rows `failed`, and the owner does not get them. Resending `failed` rows by hand is out of scope.
- A row may arrive twice when two runs overlap or when marking it `sent` fails after Telegram accepted it
  (at-least-once, [0008](0008-delivery-through-a-d1-outbox.md)).
- Without a bot token or chat, `pending` rows are never deleted and each run logs `no-token` or `no-chat` for its 10
  oldest rows; the backlog arrives once the setup is fixed. Accepted: nothing is lost.
- A redelivery of a delivery older than 7 days is processed as new; GitHub offers none that old, but a captured,
  validly signed delivery replayed later (the signature carries no time) gives one duplicate message. Accepted: the
  guarantee "a delivery is processed once" now holds within the 7 days, and nothing but a message is written.
- Each run's deletes count against the daily row writes; in steady state they equal the rows written 7 or 30 days
  earlier.
- The per-run statement budget rests on Cloudflare's documented limits, not on a measurement; the CPU time of a run
  is read once on a deployed copy (the plan's live check).
