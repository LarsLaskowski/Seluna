# Plan: Bound the D1 writes of reported deliveries from strangers

Source: Issue #134
Status: Draft
Tier: security — the change adds a rate limit against abuse (a bound on what strangers' deliveries may write), which `.squad/routing.md` (*Tiers*) counts as a guard.
Security areas touched: the new bound on strangers' deliveries (`src/webhook.ts` `BOUNDED_EVENTS`, `BOUNDED_DELIVERIES_PER_HOUR`; `src/store/meta.ts` `countBoundedDelivery`), added to `.squad/project.md` *Security areas* by this change; Logging of external data (a new fixed decision value `limited` in the `POST /webhook` log entry)

## Problem / root cause

Not a defect but an open budget (decision 0043, *Consequences*): `processWebhook` (`src/webhook.ts:171-180`) records
every delivery that has an `outbox` row or an `activity` change, with no bound on how many. The events `issues`,
`issue_comment`, `star` and `fork` are reported for any foreign sender (`src/rules/issue-opened.ts:9`,
`src/rules/issue-comment.ts:9`, `src/rules/pull-request-comment.ts:10`, `src/rules/repository-starred.ts:11` and `:50`,
`src/rules/repository-forked.ts:10`), so on a public repository strangers decide how many rows are written. Each
recorded delivery writes the batch of `src/store/deliveries.ts:55` (the `deliveries` row with its two indexes, the
`outbox` or `activity` row, `last_delivery`), later the send's update and the cleanup deletes — about 14 rows. Some
7,000 such deliveries a day spend the free plan's 100,000 rows written, after which alerts and CI failures answer 503
too.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | #121 stops deliveries without effect from writing D1 except one conditional `last_delivery` upsert | `src/webhook.ts:171-174`, `src/store/meta.ts:84-104` | confirmed |
| 2 | A stranger's issue or comment causes one recorded delivery and one message each | rules above return a notification for every foreign sender; `src/webhook.ts:175-209` records and sends it; `src/store/deliveries.ts:55` | confirmed |
| 3 | A star and an unstar are each one recorded delivery with the star switch on; under a digest each star is one `activity` row | `src/webhook.ts:155-169`; `starRemovalOf` (`src/rules/repository-starred.ts:44-58`) returns a removal whether or not a star is collected and in every interval, so an unstar always counts as an `activity` change | confirmed |
| 4 | Whether D1 still serves reads once the daily write budget is spent | to verify: on a deployed free-plan copy whose write budget is spent, whether `isKnownDelivery` and the status page still read; owner Product Manager, outside this change (not measurable in this session; stays a residual in decision 0043) | unverified |
| 5 | The four bounded events are disjoint from the pull request, CI and alert rules | `src/rules/pull-request.ts:47` (`pull_request`), `src/rules/workflow-run.ts:33` (`workflow_run`), `src/rules/security-alert.ts:31` (the three alert events); grep of `event !==` in `src/rules/` | confirmed |
| 6 | Free plan: 100,000 D1 rows written a day | decisions 0029 (line 18) and 0039 (line 129) cite Cloudflare's documentation; the page itself is refused by the session proxy (403), so confirmed by the records only | confirmed |
| 7 | About 14 rows written per recorded stranger delivery | to verify: not measurable on the real D1 from this session, owner none (residual in decision 0043); the estimate comes from the schema in `migrations/0001_initial_schema.sql` and `0002_activity.sql` (TEXT primary key plus `received_at` index on `deliveries`, one index on `outbox`, two on `activity`) and 0039's per-row figures | unverified |
| 8 | A conditional upsert whose `WHERE` is false reports `meta.changes` 0 and `rows_written` 0, a counted one `changes` 1 | to verify: Dev, step 6, in a scratch worktree, logs `meta.changes` and `meta.rows_written` of `countBoundedDelivery` for a first insert, an increment and a refusal at the bound; the Lead records the figures in 0043 in step 9 (measured so far for `refreshLastDelivery` only, 0043 *Consequences*) | unverified |
| 9 | Test storage is shared between the tests of a file | `src/webhook.test.ts:50-59` deletes the tables in `beforeEach`; `vitest.config.ts` sets no isolated storage | confirmed |
| 10 | Strangers' pull requests are reported too and are not covered by the issue | `docs/areas/notifications.md:100-103`; `pullRequestRule` reads no sender; a related gap, follow-up below | confirmed |

## Acceptance criteria

- [ ] AC1: A delivery of `issues`, `issue_comment`, `star` or `fork` that would be recorded (it has an `outbox` row
  or an `activity` change) is recorded only when `countBoundedDelivery` counts it, which happens while fewer than
  `BOUNDED_DELIVERIES_PER_HOUR` (20) deliveries of that event were counted in the same UTC hour. Otherwise the answer
  is 202 with decision `limited`: no `deliveries`, `outbox` or `activity` row is written or deleted, nothing is sent,
  and `last_delivery` is refreshed as for a delivery without effect. This holds for an issue, a comment on an issue, a
  comment on a pull request, a star under _Immediately_ and under a digest, a fork and an unstar.
- [ ] AC2: The count is per event and per UTC hour: while one bounded event is at its bound another is still
  recorded; in the next UTC hour the event is recorded again; a `limited` delivery redelivered in a later hour is
  reported once.
- [ ] AC3: Only a delivery that would be recorded is counted: a delivery without effect (the owner's own issue, a
  switch that is off, a ping) neither changes a counter nor is answered `limited`.
- [ ] AC4: Pull request, CI failure and security alert deliveries are never counted or limited: with all four
  counters at the bound, a non-draft opened pull request, a failed CI run in a pull request whose lookup answers not a
  draft, a Dependabot alert and a secret scanning alert are each recorded and sent, their redelivery answers 200
  `duplicate` with no second message, and the counter rows are unchanged.
- [ ] AC5: `countBoundedDelivery(db, event, time, limit)` keeps the `meta` row `delivery_count:<event>` as
  `<hour>:<count>` (`<hour>` = `Math.floor(time.getTime() / 3_600_000)` in decimal) in one statement: no row →
  `<hour>:1`, true; `<hour>:<n>` with `n` below `limit` → `<hour>:<n+1>`, true; `<hour>:<n>` with `n` at or above
  `limit` → unchanged, false; a value of another hour or of any other form (`x`, `<hour>:`, `<hour>:abc`,
  `<hour>:01`, `<hour>:-1`, a count over 16 digits) → `<hour>:1`, true. Concurrent calls never count more than
  `limit` in one hour, and no other `meta` row changes.
- [ ] AC6: When the counter statement fails, a bounded delivery answers 503 `unavailable` and stores nothing.

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `processWebhook records 20 issues of one hour and answers 202 limited for the 21st without a row or a message`; `it.each` over issue, comment on an issue, comment on a pull request (payload with `issue.draft` false), star under Immediately, star under hourly digest, fork, unstar with a collected star of the same sender: `processWebhook answers 202 limited for a $case when 20 deliveries of its event were counted this hour` (counter seeded `<hour>:20`; asserts unchanged `deliveries`, `outbox`, `activity` counts, the unstar's star still present, no Telegram request, no `waitUntil`); `processWebhook sets last_delivery for a limited delivery` | `src/webhook.test.ts` |
| AC2 | `processWebhook still records an issue comment while issues are at the bound`; `processWebhook records an issue in the next UTC hour after the bound was reached`; `processWebhook reports a limited issue once when it is redelivered in the next hour` | `src/webhook.test.ts` |
| AC3 | `it.each` over the owner's own issue, an issue with `issue_opened` off, a ping: `processWebhook neither counts nor limits $case` (counters seeded at the bound; decision `no-match`/`disabled`, counter value unchanged) and `processWebhook leaves the counter unchanged for $case below the bound` | `src/webhook.test.ts` |
| AC4 | `it.each` over the four cases: `processWebhook records and sends $case while every bounded event is at its bound and answers its redelivery 200 duplicate` (also asserts the four counter values unchanged) | `src/webhook.test.ts` |
| AC5 | `describe("countBoundedDelivery")`: `DELIVERY_COUNT_META_PREFIX names the rows delivery_count:`; `countBoundedDelivery stores <hour>:1 when no row is stored`; `countBoundedDelivery counts up to the limit and refuses the next call`; `countBoundedDelivery refuses and keeps a count above the limit`; `it.each` over the other-hour and malformed values: `countBoundedDelivery restarts at 1 for $value`; `countBoundedDelivery counts exactly two of five concurrent calls at 18 of 20`; `countBoundedDelivery counts each event in its own row and leaves last_delivery untouched`; `countBoundedDelivery starts a new count at the first millisecond of the next hour` (times `h·3,600,000 − 1` and `h·3,600,000`) | `src/store/meta.test.ts` |
| AC6 | `processWebhook answers 503 unavailable and stores nothing when the counter write fails for an issue` (a db whose `prepare` throws for the counter's `INSERT INTO meta` only) | `src/webhook.test.ts` |

## Approach

1. `src/store/meta.ts`: add `DELIVERY_COUNT_META_PREFIX`, `DELIVERY_COUNT_WINDOW_MS` and `countBoundedDelivery`,
   one `INSERT INTO meta … ON CONFLICT (key) DO UPDATE SET value = CASE … END WHERE NOT (<same hour and count ≥
   limit>)` bound with the key, the hour prefix `<hour>:` and the limit, in the style of `refreshLastDelivery` (GLOB
   and length checks on the count part, `CAST` only after them); it returns `result.meta.changes === 1`. The count part
   counts as a number only when it matches `^[1-9]\d{0,15}$`.
2. `src/webhook.ts`: add `BOUNDED_EVENTS`, `BOUNDED_DELIVERIES_PER_HOUR` and `"limited"` to `WebhookDecision`. In
   `processWebhook`, after the no-effect return (line 171-174) and before `recordDelivery`: when
   `BOUNDED_EVENTS.has(event)` and `countBoundedDelivery(deps.db, event, receivedAt, BOUNDED_DELIVERIES_PER_HOUR)`
   answers false, `await refreshLastDeliveryQuietly(deps.db, receivedAt)` and return `outcomeOf(202, "limited",
   fields)`. A throw of the counter falls into the existing `catch` (503). The counter is a statement of its own, not
   part of the batch, so the batch sizes stay as they are.
3. Order consequence, accepted: the draft lookup of a comment on a pull request runs before the count.

No new user-visible output: no message, page or text changes; the log entry's `decision` gains the value `limited`.

## Options considered

The bound's options are in decision 0043 (options 6–12): the chosen hourly counter per event in `meta` against a
count over `deliveries` (needs a migration and an index write on every delivery, or reads the whole window per check),
a per-sender bound (bounds no total, unbounded rows), a daily window (one burst silences a day), a setting (not
needed now), a notice to the owner when the bound is reached (follow-up), and bounding `pull_request` too (would drop
the owner's own pull requests; follow-up).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/store/meta.ts` | new constants and `countBoundedDelivery` |
| Worker | `src/webhook.ts` | `BOUNDED_EVENTS`, `BOUNDED_DELIVERIES_PER_HOUR`, decision `limited`, the check in `processWebhook` |
| Tests | `src/store/meta.test.ts`, `src/webhook.test.ts`, `src/activity-digest.test.ts` | new tests; `beforeEach` adaptations below |

## Signatures (for the Dev's skeleton)

`src/store/meta.ts`:

```ts
/** Prefix of the `meta` keys that count one bounded event's recorded deliveries in a UTC hour, as `<hour>:<count>`. */
export const DELIVERY_COUNT_META_PREFIX = "delivery_count:";
/** Length of a counting window, one UTC hour, in milliseconds. */
export const DELIVERY_COUNT_WINDOW_MS = 3_600_000;
/**
 * Counts one delivery of `event` in the UTC hour of `time` unless `limit` or more are counted there already, in one
 * conditional statement; true when it counted. D1 errors are not caught.
 */
export async function countBoundedDelivery(db: D1Database, event: string, time: Date, limit: number): Promise<boolean>;
```

`src/webhook.ts`:

```ts
export type WebhookDecision =
  "reported" | "collected" | "no-match" | "disabled" | "limited" | "duplicate" | "invalid" | "unavailable";
/** The events a stranger can cause on a public repository; their recorded deliveries are bounded per event and UTC hour. */
export const BOUNDED_EVENTS: ReadonlySet<string> = new Set(["issues", "issue_comment", "star", "fork"]);
/** At most this many deliveries of one bounded event are recorded per UTC hour. */
export const BOUNDED_DELIVERIES_PER_HOUR = 20;
```

`processWebhook` keeps its signature. The skeleton's `countBoundedDelivery` throws, so every existing test that
records a bounded event fails until step 6 (expected, `.squad/stack.md`, *Skeleton*).

## Test files

`src/store/meta.test.ts` and `src/webhook.test.ts` (*Tests per criterion*).

Existing test code affected, adapted by the **Tester** in step 5 (old and new behavior coexist, no signature goes
away):

- `beforeEach` of `src/webhook.test.ts` (line 50-59) and of `src/activity-digest.test.ts` (line 35): also delete the
  `meta` rows whose key starts with `delivery_count:`, since storage is shared between tests (fact 9) and the fixed
  clock puts every test in one hour.
- `src/webhook.test.ts:1244` (`… for each of 50 stars under Immediately`) and `:1360` (`… collects 50 stars as 50
  activity rows …`): 50 stars in one hour now hit the bound; use `BOUNDED_DELIVERIES_PER_HOUR` stars and rename.
- Any other existing test that records more than 20 deliveries of one bounded event in one clock hour: none found;
  the Tester confirms in its report.
- `src/router.test.ts` and the batch-size tests (`:1262`, `:1348`) need no change: the decision union only grows and
  the counter is not in the batch.

Files no unit test can cover: none.

## Areas

- `docs/areas/notifications.md` — the bound in *Processing a delivery*, *Issue and comment rules* (*Volume*), *Stars
  and forks* (*Collecting*, *Unstar*), *Log entries* and *Limits and errors*.
- `docs/areas/storage.md` — the `meta` rows `delivery_count:<event>`.
- `docs/areas/http-routes.md` — the 202 row of `POST /webhook`.

## Documentation updates

Written by the Dev once the code is green, against that code:

- `docs/areas/notifications.md`: *Processing a delivery* gets a step between today's 4 and 5 — a delivery of
  `issues`, `issue_comment`, `star` or `fork` that step 5 would record is first counted for its event in the current
  UTC hour, at most 20; past that it is not recorded (as step 6), answered 202, decision `limited` — renumbering the
  later steps and their references (step 2's "step 5", *Limits and errors* "step 6", "steps 2 to 5"); the counter's
  failure answers 503. *Volume* (line 233-235): "No rate limit exists" becomes the bound. *Collecting* and *Unstar*:
  past the bound a star or fork is not collected or sent and an unstar removes nothing. *Log entries* (line 528-534):
  `limited` with its meaning, and that it is never recorded. *Limits and errors* (line 545-548): a `limited` delivery
  is not recorded either and can report on a later redelivery. The 0043 reference line (593-594) names the bound.
  Line 103 (pull requests: "No rate limit exists") stays true and stays.
- `docs/areas/storage.md`: the `meta` list (line 110-112) names the counters; a new bullet after `last_delivery`
  (after line 119): `delivery_count:<event>` for the four events, value `<hour>:<count>` (form and reading of AC5),
  written only by the webhook processing by one conditional statement, overwritten each hour, never deleted, kept by
  the reset, at most four rows.
- `docs/areas/http-routes.md` line 17: "recorded only when it led to a message or an `activity` change and, for the
  events strangers can cause, within the hourly bound".
- `docs/ARCHITECTURE.md`: *Webhook to Telegram* step 4 — one sentence on the bound for `issues`, `issue_comment`,
  `star` and `fork` (20 per event and UTC hour, past it handled like a delivery without effect), linking decision
  0043; the *Components* row *Webhook processing* adds "the hourly bound on strangers' deliveries"; the *D1 tables*
  row `meta` adds "the hourly counts of strangers' deliveries".
- `.squad/project.md`, *Security areas*: a new entry **Bound on strangers' deliveries** — `processWebhook`
  (`src/webhook.ts`) records a delivery of `BOUNDED_EVENTS` only when `countBoundedDelivery` (`src/store/meta.ts`)
  counts it, at most `BOUNDED_DELIVERIES_PER_HOUR` per event and UTC hour in one conditional statement; pull request,
  CI and alert events are never counted; a counter failure answers 503.
- `CHANGELOG.md`, `## [Unreleased]`, *Changed*: at most 20 new issues, 20 comments, 20 stars or unstars and 20 forks
  an hour are recorded and reported; further ones in that hour send nothing, so strangers on a public repository can
  no longer use up the free plan's D1 write budget; pull requests, CI failures and security alerts are not limited.
- `README.md`: none (its guarantees sentence stays true).

## Architecture check

- "A delivery that led to a message or an `activity` change is processed once": unchanged — a `limited` delivery
  leads to neither and is not recorded, like a delivery without effect (0043).
- "A matched event is written to the outbox before delivery is attempted": unchanged — a `limited` delivery is not
  sent at all. The area's "never lose a message" covers `outbox` rows only (*Limits and errors*), now also stated for
  `limited`.
- "An invalid signature has no effect": the bound runs after the signature check; a forged request still has no effect.
- Draft and secret scanning guarantees: unaffected; only the four stranger events are bounded (fact 5). The bound is
  the behavior the Product Manager asked for in issue #134.

## Security considerations

- [ ] No limits on parsed input: the bound counts deliveries, the meta key is built only from the constant
  `BOUNDED_EVENTS`, and every value is bound as a parameter.
- [ ] Exceptions reaching a user-visible failure: none — a counter failure is the existing 503 with an empty body;
  the log carries only `unavailable` or `limited`.
- [ ] Fails closed: a counter failure records and sends nothing (503, AC6); a corrupt counter value restarts at 1,
  which admits at most `limit` more in that hour (AC5).
- [ ] Concurrency: decision and increment are one statement, so concurrent deliveries cannot pass the bound (AC5).

## Decision records

- `docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md` — extended in place (unreleased: added in
  `f2113040`, contained in no tag of `git ls-remote --tags origin`, latest `v0.7.0`), retitled, status `Proposed`,
  index row updated: the bound, options 6–12, consequences.

## Out of scope / follow-ups

Follow-up issues for the orchestrator to open:

1. **[Webhook] Bound the deliveries of pull requests opened by strangers** — "On a public repository anyone can open
   a pull request, and every non-draft one is reported and recorded (`docs/areas/notifications.md`, *Pull request
   rules*): the pull request rules do not read the sender. #134 bounds `issues`, `issue_comment`, `star` and `fork`
   only. Consider a bound for `pull_request` deliveries by foreign senders that leaves the owner's and collaborators'
   pull requests alone (decision 0043, option 12)."
2. **[Notifications] Tell the owner when the hourly bound drops strangers' deliveries** — "Since #134 a delivery of
   `issues`, `issue_comment`, `star` or `fork` past 20 per event and hour is dropped with only the log decision
   `limited`. Consider one notice per event and hour (or a line on the status page) so the owner knows that messages
   were left out (decision 0043, option 11)."

Not in scope: whether D1 serves reads once the budget is spent (fact 4, residual in 0043); the Worker request limit.

## Challenge notes

Devil's Advocate, 0 major, 3 minor (verbatim):

1. minor: "Any other existing test that records more than 20 deliveries of one bounded event in one clock hour: none found" is wrong. `src/activity-digest.test.ts:640-664` sends 50 stars and 2 forks through `processWebhook`, all at the same `received` time (12:30). It asserts 52 activity rows and the digest text "+50 ⭐ (now 1,284), +2 forks · user1, … and 46 more". Under the bound only 20 stars are collected, so this test fails. Instruction: the Tester adds this test to the adapted list. Use `BOUNDED_DELIVERIES_PER_HOUR` stars, expect `BOUNDED_DELIVERIES_PER_HOUR + 2` activity rows, and rewrite the expected digest text ("+20 ⭐ (now 1,254) … and 16 more"). The `delivery_count:` cleanup in that file's `beforeEach` (line 35) still applies.
2. minor: AC4 covers only a CI failure in a pull request. CI failures have a second rule, `src/rules/ci-failed-default-branch.ts` (also `workflow_run`), which AC4 never exercises. Instruction: the Tester adds "a failed CI run on the default branch" to the AC4 `it.each`. A code scanning alert row is optional.
3. minor: Decision 0043 option 6 and the CHANGELOG text call the bound one on "strangers", but the counter counts every reported delivery of those events, and the rules report every sender that is not the owner (`isForeignSender`, `src/rules/issue-comment.ts:14`), including collaborators; when the App owner is an organization, `isOwnAction` (`src/rules/actor.ts:17-19`) is false for everyone. Instruction: in step 9 the Lead adds to the 0043 *Consequences*: collaborators' and, for an organization-owned App, members' issues and comments share the hourly bound. The Dev words the CHANGELOG and `docs/areas/notifications.md` *Volume* text as "issues, comments, stars and forks by anyone other than the owner", not "strangers".

## Security notes

Security (plan review): APPROVED, no blocking findings. Non-blocking (verbatim in substance):

1. Key type: type the `event` parameter as a `BoundedEvent` union narrowed by a type guard (`isBoundedEvent`) instead of `Set.has` on a string, so the compiler enforces the bound on `meta` rows.
2. Prefix check: compare the hour prefix with `substr(value, 1, length(?2)) = ?2`, not with a GLOB pattern built from the bound prefix.
3. `workflow_run` failures in strangers' fork pull requests remain an unbounded path (`src/rules/workflow-run.ts:69`); name them in 0043 *Consequences* (the Lead, step 9) and include them in follow-up issue 1.

Measurement (fact 8): statement run locally — first insert changes 1 / rows_written 2; increment 1/1; refusal at the bound 0/0; next hour 1/1; five concurrent calls at 18 of 20 gave changes 1,1,0,0,0 and 20. Local pool, not real D1.
