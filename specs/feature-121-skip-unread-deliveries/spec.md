# Spec: Do not record deliveries that no rule reads

Source: Issue #121
Status: Draft

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
- E2: For an unrecorded delivery, reading or writing `last_delivery` fails: the answer is still **202** with the
  delivery's decision; the status page keeps the earlier time.
- E3: The D1 write budget is spent: an unrecorded delivery still answers **202**; a delivery that would be recorded
  answers **503** with nothing stored, as today.
- E4: A stream of unrecorded deliveries (a stranger starring and unstarring with the star switch off): `last_delivery`
  is written at most once per 60 seconds, so the stream writes at most 1,440 times a day.
- E5: An unstar while the star switch is on, also under an immediate digest: its removal is an `activity` change, so it
  is recorded as today.
- E6: A CI failure in a pull request the draft lookup reports as a draft is dropped (`no-match`) and not recorded.
- E7: A rule or the formatter throws: **503**, nothing stored, as today.

## Non-functional requirements

- D1 writes: an unrecorded delivery writes no row apart from the `last_delivery` upsert, and that only when the stored
  time is missing, does not fit its form, or is not within the 60 seconds up to the delivery's time received. The
  60 seconds are fixed, not configurable. Reads are unchanged in kind: the `deliveries` read, the settings and the
  owner, plus one `meta` read for an unrecorded delivery.
- Recorded deliveries keep today's single transaction, its rollback and its duplicate detection; the 7-day retention of
  `deliveries` rows is unchanged.
- The guarantee "a delivery is processed once … a redelivery produces no second message" (`.squad/project.md`,
  `docs/ARCHITECTURE.md`) still holds, since a delivery that is not recorded produced no message; its wording changes
  to say that only a delivery that led to a message or an `activity` change is recorded.
- Log entries: unchanged fields and decision values; `no-match` and `disabled` now also mean "not recorded".
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
  fit its form, or is not within the 60 seconds up to that time, and writes nothing otherwise (S5, E4).
- [ ] AC5: An unrecorded delivery whose `last_delivery` read or write fails answers 202 with its decision (E2, E3).
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
  issue's criterion allows an alternative recorded in a decision record.
- Rate-limit per event type instead? Answered: not needed, since skipping keeps deduplication (the issue's own
  condition); see Out of scope.

## Area documents

- [`notifications.md`](../../docs/areas/notifications.md) — *Processing a delivery*: step 5 only for a delivery with a
  notification or an `activity` change; a new step for the others (202, nothing stored, the throttled `last_delivery`
  write whose failure is ignored); step 2 and *Limits and errors* say a redelivery of an unrecorded delivery is
  evaluated again; *Log entries* notes that `no-match` and `disabled` are not recorded.
- [`storage.md`](../../docs/areas/storage.md) — `deliveries` holds only recorded deliveries; `last_delivery` is written in
  the transaction of a recorded delivery or, at most once per 60 seconds, by an unrecorded one.
- [`setup-wizard.md`](../../docs/areas/setup-wizard.md) — _Last delivery from GitHub:_ shows the last delivery received
  (up to one minute behind), _None received yet_ until the first one.
- [`scheduled-jobs.md`](../../docs/areas/scheduled-jobs.md) — the cleanup note on "processed once" names recorded
  deliveries.

## Challenge notes

Minor objections of the Devil's Advocate (spec challenge, one round), appended verbatim; the Lead answers them while planning.

1. **minor — a decision record is missing.** The issue's first acceptance criterion requires the chosen alternative (throttled `last_delivery`) to be written down in a decision record. The spec's *Area documents* section and its acceptance criteria name none. The decision being changed is decision 0023, `docs/decisions/0023-webhook-processing-and-delivery-through-the-outbox.md`, option 3 (lines 34-37): every delivery is recorded in one batch together with `last_delivery`. Its commit is in tag v0.3.0, so 0023 is released and append-only. Instruction: in the plan, add a new decision record that supersedes or amends 0023 for "only deliveries with a message or an `activity` change are recorded; `last_delivery` throttled to 60 s otherwise", and link it from the spec. Why minor: the Lead writes decision records while planning, so the behaviour to build does not change.
2. **minor — the claim that `no-match` now means "not recorded" is wrong for E5.** An unstar with the star switch on is recorded (E5). For that delivery `runRules` returns `no-match`, because the star rule ignores `deleted` (`src/rules/repository-starred.ts` line 11, `src/rules/rule.ts` line 93). The decision stays `no-match` in `src/webhook.ts` line 153. Instruction: reword the *Log entries* requirement and the *Log entries* change for `notifications.md` to "`no-match` and `disabled` are not recorded unless the delivery removes a star". Do not add a new decision value. Why minor: only the wording of the docs and the log notes changes.
3. **minor — the "writes no row apart from `last_delivery`" requirement is not true for E6.** A CI failure needs the draft lookup, which gets an installation token. On a cold or expired cache that writes `token_cache`: `src/github/installation-token.ts` line 90 calls `writeCachedToken`, an upsert (`src/store/token-cache.ts` line 55). So an unrecorded E6 delivery can write a row besides `last_delivery`. Instruction: add to the D1 writes requirement "apart from the installation-token cache a draft lookup may refresh, which is unchanged", and do not assert zero `token_cache` writes in tests. Why minor: the write is bounded by the token's lifetime and already happens today.
4. **minor — E4's bound only holds when deliveries arrive one at a time.** The requirement and AC4 read `last_delivery` and then write it. Two concurrent unrecorded deliveries can both see a stale value and both write. The later write can also carry the earlier time, so the stored time moves back. Today's upsert (`src/store/meta.ts` lines 74-78) writes no matter what is stored. Instruction: either reword E4 as "about once per 60 seconds; concurrent deliveries may each write", or have the Dev use a single conditional upsert. That upsert's `ON CONFLICT … DO UPDATE … WHERE` must reproduce the requirement's three conditions in SQL: the stored value missing, not in its form (`/^(?:0|[1-9]\d{0,15})$/`, `src/store/meta.ts` line 14), or not within the 60 s up to the time received. That makes the bound exact, keeps the stored time from going back, and removes the extra `meta` read. Then align the "plus one `meta` read" requirement with whichever is chosen. Why minor: the overrun is bounded by how many deliveries run at once, and S5's one-minute accuracy is barely affected.
5. **minor — one copy of the "processed once" wording is missed.** The spec rewords the guarantee only in `.squad/project.md` (line 99) and `docs/ARCHITECTURE.md` (line 74), plus `docs/areas/scheduled-jobs.md` line 193. `README.md` line 59 also says "A delivery is processed once". Instruction: update the README sentence in the same pull request to match the new wording ("a delivery that led to a message or an `activity` change is processed once"). Why minor: documentation only.
