# 0041: Fork and star rules with a digest

- **Status:** Proposed
- **Date:** 2026-10-31
- **Area:** Notifications
- **Source:** Issue #110
- **Supersedes:** — (amends [0038](0038-channel-neutral-outbox-and-active-delivery-channel.md): a stored
  notification may carry further lines after line 3. Settles what [0039](0039-issue-comment-fork-star-events-and-the-app-owner.md)
  left to #110: the rules for `fork` and `star`.)

## Context

#108 subscribed the app to `fork` and `star`. Anyone can star or fork a public repository, and a popular one gets
dozens of stars an hour, so one message per star would flood the chat (decision 0039, _Residual risk, volume_).
The Product Manager wants forks and stars either at once or collected into one digest per hour or per day, with a
daily digest at 18:00 as the default and both switches off.

The relevant constraints:

- A stored notification holds a title and two lines of at most 256 code points each (0038). A digest needs one line
  per repository.
- The cron runs every 10 minutes (0029). Many copies deploy without `npm run deploy`, so their migrations may be
  missing (0038, decision 0021).
- A webhook can collect an event at any moment, including while the cron builds a digest.

## Options considered

Against the flood:

1. **A digest per hour or day, chosen by the owner.** No event is lost and the counts stay exact; the owner
   decides how often. Chosen (Product Manager).
2. **A rate limit, for example one message per repository per hour.** The messages dropped beyond the limit are
   lost, and the owner never sees the count.

Where collected events wait:

3. **A table of their own (`activity`), written in the delivery's transaction.** The digest counts them in SQL,
   and an unstar removes a waiting star by account and repository id. Chosen.
4. **Held `outbox` rows.** This needs a new status and changes the retry and the cleanup. A digest would have to
   parse and merge rows that were written as finished messages.

When a digest is due:

5. **A digest time lies after the job's previous run (stored in `meta` on every run) and at or before this run.**
   An empty digest time moves on like a full one. Catching up, a first run with nothing stored, and a change of
   interval or time zone all follow from the one rule. Chosen.
6. **Remembering the last digest sent.** An empty digest time is never recorded, so an event after it is sent
   before the next digest time (the spec challenge, M1).
7. **Remembering the last digest time evaluated.** Under _Immediately_ no digest time exists, so switching back to
   a digest interval would catch up a past time at once.

How the digest fits the message model:

8. **Optional further `lines` in the stored notification, after line 3.** Every channel renders them in order, and
   a digest has the title alone on line 1. A row without `lines` is unchanged, and an older version decodes the
   row and leaves the lines out. Chosen.
9. **One message per repository.** This brings back the flood the digest is meant to prevent.
10. **Everything squeezed into lines 2 and 3.** 256 code points hold about two repositories.

What a digest deletes:

11. **Every event up to the largest id it read, in the transaction that writes its outbox row.** The table's ids
    come from `AUTOINCREMENT`, so they are never reused, and an event collected after the read stays. Chosen.
12. **The ids it read, listed.** That can be 10,000 bound parameters.
13. **Every event.** An event collected while the digest is built would be lost (the spec challenge, M2).

Where events older than 7 days are deleted:

14. **In the digest job, only while a switch is on.** A copy without migration `0002` keeps a working cleanup, and
    nothing touches the table while both switches are off. Chosen. A due digest also leaves stale events out of its
    reads, and its commit deletes them unsent, so _Immediately_ needs no extra statement.
15. **In the cleanup batch.** A missing table would make the whole batch fail, and then `deliveries`, `outbox`
    and `token_cache` would no longer be cleaned up.

How the digest fits the run's 50 subrequests. The run already budgets 18 D1 statements and 20 Telegram requests
for the retry, and a digest with its own send would add 13 and 2, which makes 53. A refused `markSent` after a
successful send would send the digest twice.

16. **The digest sends its row only when the retry handed fewer than 10 rows to the sender.** Otherwise the row waits
    `pending` for the next run's retry. The worst case is 50, with no headroom (48 if a D1 batch counted as one subrequest), at the price of a digest up to 20 minutes late during
    a backlog. Chosen.
17. **The digest row joins the retry's send.** This saves the channel and token reads, but the retry would have to
    build the digest inside its batch, which couples the two jobs.
18. **A retry batch one row smaller whenever a digest is due.** It costs retry throughput on every due run.

Length against Telegram's 4,096 characters, which Telegram measures after parsing the entities, so tags and escaping do not count: **`digestNotification` drops repository lines into `and N more
repositories` beyond 4,000 UTF-16 code units** (chosen). A bound on lines and code points alone allows up to about
5,760 units when the text has astral characters.

Who a fork is reported as from: **`sender.login`, the account that forked** (chosen), rather than
`forkee.owner.login`. For a fork into an organization, line 2 already names that organization.

Number formatting: **digits grouped by hand (`,` in English, `.` in German)** (chosen), rather than
`Intl.NumberFormat`, whose output depends on the runtime's locale data.

Fixtures: **reference-built from GitHub's webhook documentation, including `star/deleted.json`, with a live check
on a deployed copy before the pull request is marked ready**, as in [0040](0040-issue-and-comment-rules.md).
Product Manager's decision.

## Decision

Two rules, `repository_starred` and `repository_forked` (off by default), report a star or a fork by another
account. Under the setting `activity_digest` (`hourly` or `daily@HH:MM`, default `daily@18:00`), the delivery stores
the event in `activity` instead of the outbox, and an unstar removes that account's waiting stars. The 10-minute
cron sends one digest per digest time from what is collected, as a stored notification with further lines. The
rules are in [`areas/notifications.md`](../areas/notifications.md),
[`areas/scheduled-jobs.md`](../areas/scheduled-jobs.md) and [`areas/storage.md`](../areas/storage.md).

## Consequences

- Each star or fork costs a few more D1 rows written (the `activity` row and its indexes). Under a digest, a
  stranger's repeated star and unstar sends nothing.
- The digest job writes the `meta` run time every 10 minutes, about 144 writes a day.
- A digest arrives at most 10 minutes after its digest time, or 20 minutes when that run's retry sent a full
  batch.
- The due check builds one `Intl.DateTimeFormat` per call and makes at most 50 conversions. Gaps beyond 120
  minutes (hourly) or 1,500 minutes (daily) count as due without one, to stay inside the free plan's CPU time.
- Without migration `0002` and with a switch on, digest-mode forks and stars and every unstar answer 503, and the
  job logs `store-failed` every run.
- Two overlapping cron runs may send the same digest twice. The retry already accepts this risk.
- After a reverted update, an older version sends a digest as its title alone, because it leaves the lines out.
- Residual risk, shapes: the fixtures follow GitHub's documentation. The live check confirms a star, an unstar and
  a fork, and a digest on production D1 (window functions, `AUTOINCREMENT`).
- Revisit when other rules get a digest: the table and the job are specific to stars and forks.
