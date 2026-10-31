# Spec: Do not record deliveries that no rule reads

Source: Issue #121
Status: Approved by Lead

## Problem

Every validly signed webhook delivery is recorded today, whether or not it leads to anything: `processWebhook`
(`src/webhook.ts`) calls `recordDelivery` (`src/store/deliveries.ts`) for each new delivery, which writes the
`deliveries` row (with its two indexes) and the `meta` `last_delivery` upsert in one batch, and the cleanup cron
deletes the row seven days later. Since #108 strangers can cause deliveries on a public repository the App is
installed on (issues, comments, stars, unstars), most of which no rule reports. Enough of them spend the free plan's
daily D1 write budget; from then on the batch fails, `isKnownDelivery` finds no row and the delivery is answered
**503** with nothing stored (confirmed in `src/webhook.ts` and `src/store/deliveries.ts`) — secret scanning alerts and
CI failures included, which GitHub does not redeliver on its own. The setup login's attempt counter cannot be written
either. The owner loses notifications to traffic that should have cost nothing.

## Scenarios

- S1: Given a delivery that yields no notification and no `activity` change — a `ping`, a comment the owner wrote, an
  event no rule reads, or a star while the star switch is off — when it arrives, then `POST /webhook` answers **202**,
  the log entry carries its decision (`no-match` or `disabled`), and no `deliveries`, `outbox` or `activity` row is
  written.
- S2: Given a delivery a rule reports (a CI failure, a security alert, an issue a stranger opened), when it arrives,
  then it is recorded, stored and sent exactly as today ([Notifications](../../docs/areas/notifications.md#processing-a-delivery)),
  and a redelivery of its id answers **200** with no second message.
- S3: Given an hourly or daily digest, when a star or fork is collected, or an unstar removes a collected star, then
  the delivery is recorded as today, and a redelivery of its id answers **200** and changes no `activity` row.
- S4: Given a delivery that was answered 202 without being recorded, when the owner redelivers it from the GitHub
  App's delivery list, then it is evaluated again against the settings and the pull request's draft state of now: it
  answers **202**, and when a rule reports it now (a switch was turned on, the pull request is no longer a draft), its
  message is sent once and the delivery is recorded.
- S5: Given deliveries arrive that are not recorded, when the owner opens the status page, then _Last delivery from
  GitHub:_ shows the time of the latest of them, at most one minute behind the latest delivery received.

## Errors and edge cases

- E1: Two copies of one unrecorded delivery arrive at once: both answer **202**, nothing is stored, no message is sent.
- E2: For an unrecorded delivery, writing `last_delivery` fails: the answer is still **202** with the delivery's
  decision; the status page keeps the earlier time.
- E3: The D1 write budget is spent: an unrecorded delivery still answers **202**; a delivery that would be recorded
  answers **503** with nothing stored, as today.
- E4: A stream of unrecorded deliveries (a stranger starring and unstarring with the star switch off): `last_delivery`
  is written at most once per 60 seconds, so the stream writes at most 1,440 times a day, also when deliveries arrive
  at once; a stored time less than 60 seconds after a delivery's time received is kept, so the time never moves back
  by a concurrent delivery.
- E5: An unstar while the star switch is on, also under an immediate digest: its removal is an `activity` change, so it
  is recorded as today.
- E6: A CI failure in a pull request the draft lookup reports as a draft is dropped (`no-match`) and not recorded.
- E7: A rule or the formatter throws: **503**, nothing stored, as today.

## Non-functional requirements

- D1 writes: an unrecorded delivery writes no row apart from the `last_delivery` upsert — and apart from the
  installation-token cache a draft lookup may refresh, which is unchanged — and the upsert changes the row only when
  the stored value is missing, does not fit its form ([Storage](../../docs/areas/storage.md)), or lies 60 seconds or
  more before or after the delivery's time received. The 60 seconds are fixed, not configurable. Reads are
  unchanged: the `deliveries` read, the settings and the owner.
- Recorded deliveries keep today's single transaction, its rollback and its duplicate detection; the 7-day retention of
  `deliveries` rows is unchanged.
- The guarantee "a delivery is processed once … a redelivery produces no second message" (`.squad/project.md`,
  `docs/ARCHITECTURE.md`) still holds, since a delivery that is not recorded produced no message; its wording changes
  to say that only a delivery that led to a message or an `activity` change is recorded.
- Log entries: unchanged fields and decision values; a `no-match` or `disabled` delivery is not recorded unless it
  removes a star (E5).
- Compatibility: no migration, no new setting; existing `deliveries` rows and `last_delivery` stay valid.

## Acceptance criteria

- [ ] AC1: A new delivery whose decision is `no-match` or `disabled` and that has no `activity` change answers 202,
  logs that decision, and adds no `deliveries`, `outbox` or `activity` row, also when two copies arrive at once
  (S1, E1, E6).
- [ ] AC2: A new delivery that is `reported` or `collected` or carries a star removal is stored in one transaction with
  its `deliveries` row, `outbox` rows, `activity` changes and `last_delivery`, as today; a redelivery of its id
  answers 200 with no further row and no message (S2, S3, E5).
- [ ] AC3: An unrecorded delivery, delivered again with the same id after a rule switch was turned on, is reported:
  202, one `outbox` row, a `deliveries` row (S4).
- [ ] AC4: An unrecorded delivery sets `last_delivery` to its time received when the stored value is missing, does not
  fit its form, or lies 60 seconds or more before or after that time, and leaves it unchanged otherwise, also for
  deliveries that arrive at once (S5, E4).
- [ ] AC5: An unrecorded delivery whose `last_delivery` write fails answers 202 with its decision (E2, E3).
- [ ] AC6: A delivery to be recorded whose transaction fails for another reason than a known id answers 503 and
  stores nothing, as today (E3, E7).

## Out of scope

- Limiting deliveries that are reported (a stranger opening many issues still causes one message and one recorded
  delivery each); a rate limit per event type or per sender would be its own issue.
- Keeping the setup login's writes or reported deliveries working once the D1 write budget is spent by other means.
- Recording a delivery's decision for later display.

## Open questions

- Is deduplication kept when unrecorded deliveries are not stored? Answered: yes for everything it protects. A
  delivery that yields no notification and no `activity` change has no effect to repeat; only recorded deliveries need
  the `deliveries` row (`src/webhook.ts`: the batch is the only write besides the sending). A redelivery of an
  unrecorded one is a first evaluation, not a second message (S4).
- Should a removal of a star (an unstar) be applied without recording? Answered: no. Running it again later could
  delete a star collected after it (star, unstar, star, redelivered unstar), so it stays recorded (E5); with the star
  switch off `starRemovalOf` (`src/rules/repository-starred.ts`) returns none and the unstar is unrecorded.
- Skip `meta` `last_delivery` entirely, as the issue proposes? Answered: no, it is throttled instead. The status page
  ([Setup wizard](../../docs/areas/setup-wizard.md), _Last delivery from GitHub:_) is how the owner sees that GitHub
  reaches the Worker, e.g. after the App's `ping`; dropping the write would show _None received yet_ until the first
  notification. One write per minute at most keeps the line accurate to its displayed minute at a bounded cost; the
  issue's criterion allows an alternative recorded in a decision record:
  [0043](../../docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md).
- Rate-limit per event type instead? Answered: not needed, since skipping keeps deduplication (the issue's own
  condition); see Out of scope.

## Area documents

- [`notifications.md`](../../docs/areas/notifications.md) — *Processing a delivery*: step 5 only for a delivery with a
  notification or an `activity` change; a new step for the others (202, nothing stored, the throttled `last_delivery`
  write whose failure is ignored); step 2 and *Limits and errors* say a redelivery of an unrecorded delivery is
  evaluated again; *Log entries* notes that a `no-match` or `disabled` delivery is not recorded unless it removes a
  star.
- [`storage.md`](../../docs/areas/storage.md) — `deliveries` holds only recorded deliveries; `last_delivery` is written in
  the transaction of a recorded delivery or, at most once per 60 seconds, by an unrecorded one.
- [`setup-wizard.md`](../../docs/areas/setup-wizard.md) — _Last delivery from GitHub:_ shows the last delivery received
  (up to one minute behind), _None received yet_ until the first one.
- [`scheduled-jobs.md`](../../docs/areas/scheduled-jobs.md) — the cleanup note on "processed once" names recorded
  deliveries.
- Besides the areas, the "processed once" wording in `README.md`, `docs/ARCHITECTURE.md` and `.squad/project.md`
  (*Guarantees*), and the decision record
  [0043](../../docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md), which amends 0023.

## Challenge

Minor objections of the spec challenge, folded in while planning.

1. Decision record missing — accepted: [0043](../../docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md)
   (Proposed) amends released 0023 and is linked from *Open questions* and *Area documents*.
2. `no-match` does not mean "not recorded" for an unstar with a removal — accepted: the *Log entries* requirement and
   the `notifications.md` outline now say "not recorded unless it removes a star"; no new decision value.
3. A draft lookup can write `token_cache` — accepted: the D1 writes requirement names that unchanged write; no test
   asserts zero `token_cache` writes.
4. A read-then-write throttle overruns under concurrency and can move the time back — accepted: one conditional
   upsert, no read. Its condition keeps a valid stored time that lies less than 60 seconds before or after the
   time received, so a concurrent later time is never replaced by an earlier one, and a far-off value (a damaged or
   future one) is still corrected; E2, E4, AC4, AC5 and the reads requirement changed accordingly.
5. `README.md` also says "processed once" — accepted: listed under *Area documents* beside `docs/ARCHITECTURE.md` and
   `.squad/project.md`.
