# Plan: Do not record deliveries that no rule reads

Source: Issue #121 | [spec.md](spec.md)
Status: Draft
Tier: security — the change narrows which deliveries the deduplication records and adds a write bound against abuse of the D1 write budget, a guard in the sense of *Tiers*.
Security areas touched: webhook deduplication and the D1 write bound behind `POST /webhook` (`processWebhook` in `src/webhook.ts`, `recordDelivery` in `src/store/deliveries.ts`, `refreshLastDelivery` in `src/store/meta.ts`), the *Guarantees* entry on deliveries in `.squad/project.md`; no control of a listed area (signature, parsing, logging) changes

## Problem / root cause

See [spec.md](spec.md), *Problem*: `processWebhook` records every new delivery, also one without any effect.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | Every new delivery runs `recordDelivery`, whose one batch inserts the `deliveries` row and upserts `last_delivery`, whatever the decision | `src/webhook.ts` (`processWebhook`, the `recordDelivery` call after `rows`/`changes`); `src/store/deliveries.ts` `recordDelivery` (`db.batch([insertDelivery, …, lastDeliveryUpsert(…)])`) | confirmed |
| 2 | A failed batch with an unknown id rethrows and becomes 503 `unavailable` | `src/store/deliveries.ts` (`catch` → `isKnownDelivery` → `throw error`); `src/webhook.ts` final `catch` | confirmed |
| 3 | `rows` is empty and no `activity` change exists exactly when the decision is `no-match` or `disabled` without a star removal; `reported` always leaves rows or collected events | `src/webhook.ts`: `notificationsOf` turns an all-dropped `reported` into `no-match`; `collected` only with `collected.length > 0`; `touchesActivity` from `changes` | confirmed |
| 4 | An unstar is decided `no-match` and carries a removal only with the star switch on and a foreign actor | `src/rules/repository-starred.ts` `starRemovalOf`; `src/webhook.test.ts` "with an unstar" tests | confirmed |
| 5 | A draft lookup can write `token_cache` for a delivery later dropped | `src/github/installation-token.ts` (`writeCachedToken`), `src/store/token-cache.ts` (upsert) | confirmed |
| 6 | The status page reads `last_delivery` only through `readLastDelivery`, which accepts `0` or 1 to 16 digits without a leading zero, at most `8640000000000000` | `src/store/meta.ts` (`LAST_DELIVERY_FORM`, `MAX_TIME`, `timeOf`); `src/setup/status.ts` | confirmed |
| 7 | An `ON CONFLICT … DO UPDATE … WHERE` whose condition is false changes no row (`meta.changes` 0) and so counts no row written in D1 | to verify: the Dev reads `meta.changes` and `meta.rows_written` of the no-op upsert in the Workers test pool in step 5 and reports them (basis: SQLite's upsert documentation, D1 billing by rows written); real D1 billing is not reachable from the session (residual named in decision 0043) | unverified |
| 8 | About 7 rows written per delivery and about 14,000 deliveries a day exhaust the free plan | to verify: not needed by any criterion, so no measurement is planned (source: issue #121 and Cloudflare's D1 pricing of 100,000 rows written a day) | unverified |
| 9 | `README.md` line 59, `docs/ARCHITECTURE.md` lines 46, 62–65, 74 and 114, `.squad/project.md` line 99 and `docs/areas/scheduled-jobs.md` line 193 state that every delivery is recorded or processed once | sweep: `grep -rn "processed once\|deliveries" README.md docs .squad/project.md` | confirmed |

## Acceptance criteria

The feature's criteria are AC1–AC6 of [spec.md](spec.md).

## Tests per criterion

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | new: "processWebhook answers 202 no-match for the real ping and writes no deliveries, outbox or activity row"; "processWebhook answers 202 disabled for a star with its switch off and runs no batch" (`batchRecordingDb` records no batch); "processWebhook answers 202 to two concurrent copies of an unrecorded ping and stores nothing"; adapted to `deliveries` 0: the CI failure of a draft pull request, the comment on a draft pull request, the owner's own issue and comment, the malformed issue cases, the `fork`/`star` with switch off of issue 108 | `src/webhook.test.ts` |
| AC2 | kept: "answers 200 to a second delivery with the same id and sends one message", "stores one outbox row for two concurrent deliveries with the same id", the star batch of three under Immediately, the digest batch of three, "collects nothing for a redelivery", the unstar removal under each interval (`deliveries` 1), "applies no removal for a redelivered unstar" | `src/webhook.test.ts` |
| AC3 | new: "processWebhook reports an unrecorded delivery redelivered after its switch was turned on, with one outbox row and one deliveries row" | `src/webhook.test.ts` |
| AC4 | new, per case of `refreshLastDelivery`: no row → set; stored 59,999 ms before → kept; exactly 60,000 ms before → set; 59,999 ms after → kept; 60,000 ms after → set; unfit stored values `""`, `"abc"`, `"01"`, `"-5"`, `"1.5"`, `" 5"`, a 17-digit value, `"8640000000000001"` → set; `"0"` far before → set; the `github_app_slug` row untouched. In `src/webhook.test.ts`: "processWebhook sets last_delivery for an unrecorded ping and keeps it for a second one 30 seconds later" and "two concurrent unrecorded deliveries leave last_delivery at one of their times" | `src/store/meta.test.ts`, `src/webhook.test.ts` |
| AC5 | new: "processWebhook answers 202 no-match when the last_delivery write fails" (the existing double `writeFailingDb` of `test/d1.ts`, whose writes fail as with a spent budget) | `src/webhook.test.ts` |
| AC6 | kept: "answers 503 … when the database has no tables", "… when a rule throws", "answers 503 and stores nothing when the batch fails for a collected star"; new: "processWebhook answers 503 unavailable and stores nothing when the batch of a reported ping fails" (`failingBatchDb`) | `src/webhook.test.ts` |

## Approach

- `src/store/meta.ts`: `refreshLastDelivery(db, time)` runs one statement:
  `INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE NOT (<fits> AND CAST(meta.value AS INTEGER) > ?3 AND CAST(meta.value AS INTEGER) < ?4)`,
  with `?3 = time − LAST_DELIVERY_REFRESH_MS`, `?4 = time + LAST_DELIVERY_REFRESH_MS`, and `<fits>` the SQL form of
  `LAST_DELIVERY_FORM` and `MAX_TIME`: `(meta.value = '0' OR (meta.value GLOB '[1-9]*' AND meta.value NOT GLOB '*[^0-9]*' AND length(meta.value) <= 16)) AND CAST(meta.value AS INTEGER) <= 8640000000000000`.
  The tests of AC4 pin each branch of `<fits>` against `readLastDelivery`'s reading of the same value.
- `src/webhook.ts`, inside the existing `try` after `rows` and `touchesActivity` are known: when `rows.length === 0 &&
  !touchesActivity`, call `refreshLastDelivery(deps.db, receivedAt)` in its own `try`/`catch` that drops the error,
  and return `outcomeOf(202, decision, fields)`; otherwise the existing `recordDelivery` path, unchanged. The clock is
  read once (`deps.now()`) before the branch and used for both paths. No log field or decision value changes.
- No new user-visible output.

## Options considered

The options of [decision 0043](../../docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md): skip the
record and bound `last_delivery` with one conditional upsert (chosen); skip `last_delivery` entirely; keep it
unconditional; read then write (concurrency moves the time back); a rate limit per event type; leave a star-removing
unstar unrecorded (reordering hazard). Placement: the branch in `processWebhook` rather than inside `recordDelivery`,
so the store function keeps its one meaning (record a delivery) and its tests stay unchanged.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/store/meta.ts` | new `LAST_DELIVERY_REFRESH_MS`, new `refreshLastDelivery` |
| Worker | `src/webhook.ts` | `processWebhook` branches before `recordDelivery` |
| Tests | `src/store/meta.test.ts`, `src/webhook.test.ts` | new and adapted tests |

## Signatures (for the Dev's skeleton)

```ts
// src/store/meta.ts
/** How far a stored last delivery time may lie from a new one before an unrecorded delivery replaces it: 60 s. */
export const LAST_DELIVERY_REFRESH_MS = 60_000;
/** Sets the last delivery time unless it holds a valid time less than the refresh interval away; one statement. D1 errors are not caught. */
export async function refreshLastDelivery(db: D1Database, time: Date): Promise<void>;
```

The webhook processing function in `src/webhook.ts` keeps its signature.

## Test files

- `src/store/meta.test.ts`, `src/webhook.test.ts`; the existing doubles `writeFailingDb` (`test/d1.ts`), `failingBatchDb` and `batchRecordingDb` (`test/activity.ts`).

Existing test code affected (Tester adapts, assertions only, no signature change): in `src/webhook.test.ts` the tests
that expect a `deliveries` row for an unrecorded delivery — "records the real ping delivery with event ping"
(becomes the AC1 ping test), "stores no outbox row and decides no-match when the pull request is a draft", "accepts
and records $event with its switch off" (issue 108), "stores nothing and makes no lookup for a comment on a draft pull
request", "stores nothing … when the lookup fails", "answers 202 no-match and records the delivery for the owner's own
issue" and its `$event` variant, "answers 202 no-match for malformed $case and records the delivery" — each to
`deliveries` 0 and a name without "records". "stores the clock time as last_delivery for a new delivery" and the
`last_delivery` assertion of the issue-108 test stay valid (no stored row, so the upsert sets it). Every other test is
kept unchanged: its delivery has rows or an `activity` change, or it answers before the branch.

Files no unit test can cover: none.

## Areas

- `docs/areas/notifications.md`, `docs/areas/storage.md`, `docs/areas/setup-wizard.md`, `docs/areas/scheduled-jobs.md`
  — as the spec's *Area documents* outline.

## Documentation updates

Dev, once the code is green:

- `docs/areas/notifications.md` — *Processing a delivery*: step 5 only for a delivery with `outbox` rows or `activity`
  changes; a new step for the others (202, nothing recorded, `last_delivery` set as `storage.md` says, a failure of
  that write ignored); step 2: only recorded ids answer 200; *Log entries*: a `no-match` or `disabled` delivery is
  not recorded unless it removes a star; *Limits and errors*: a redelivery of an unrecorded delivery is evaluated
  again; *Related decisions*: 0043.
- `docs/areas/storage.md` — the `deliveries` row and the `last_delivery` paragraph: written in the transaction of a
  recorded delivery, or by an unrecorded one when the stored value is missing, does not fit or lies 60 seconds or more
  away.
- `docs/areas/setup-wizard.md` (status section): _none received yet_ until the first delivery is received (not
  "recorded"); the time may lag by up to a minute.
- `docs/areas/scheduled-jobs.md` line 193 — "a recorded delivery is processed once".
- `docs/ARCHITECTURE.md` — step 2 and step 4 of the webhook flow (only a delivery with a message or an `activity`
  change is recorded; otherwise only the bounded `last_delivery` write), the guarantee sentence of line 74 and the
  `deliveries` table row of line 114, with a link to decision 0043.
- `.squad/project.md` *Guarantees* line 99 and `README.md` line 59 — "a delivery that led to a message or an
  `activity` change is processed once"; the substance (no second message) unchanged.

## Architecture check

The guarantee "a redelivery produces no second message" holds: a delivery that is not recorded stored no message and
no `activity` change, so evaluating its redelivery cannot repeat anything; "a matched event is stored before it is
sent" is untouched (the recorded path is unchanged). The wording of the guarantee narrows "processed once" to the
recorded deliveries, which the Product Manager's own issue proposes; no guarantee loses substance.

## Security considerations

- [x] No limits on parsed input change.
- [x] No exception reaches a user: the `refreshLastDelivery` failure is dropped, every other path keeps its fixed
  decision and empty body.
- Replay: a captured signed body of an unrecorded delivery replayed with any id is evaluated again and still yields
  nothing unless the settings changed — then one message, as for a new delivery; this matches the residual risk of a
  new delivery id already documented in `notifications.md`.

## Decision records

- `docs/decisions/0043-only-deliveries-with-an-effect-are-recorded.md` (Proposed) — amends released 0023 (unedited).

## Out of scope / follow-ups

As in the spec. Proposed follow-up issue — title: "[Webhook] Bound the D1 writes of reported deliveries from
strangers"; body: "#121 stops deliveries without effect from writing D1. A stranger who opens issues or comments on a
public repository still causes one recorded delivery and one message each; consider a per-sender or per-event bound
so these cannot spend the D1 write budget either. See decision 0043."

## Challenge notes

Minor objections of the Devil's Advocate (plan challenge, one round), appended verbatim.

1. **minor — star churn with the star switch on is still fully recorded, and the follow-up issue does not name it.** Why: the issue's own abuse example ("starring and unstarring repeatedly") still writes a `deliveries` row per delivery whenever `repository_starred` is on.
   - Evidence: a star is `reported` under Immediately or `collected` under a digest (`src/webhook.ts:146-152`). `activityInsert` (`src/store/activity.ts`) inserts a fresh row per star, with no per-sender dedupe. Every unstar with the switch on carries a removal and is recorded (E5), even under Immediately when its `DELETE` usually matches nothing.
   - Instruction: the Lead extends the proposed follow-up issue's body to say "a stranger starring and unstarring with the star switch on still causes one recorded delivery per star and per unstar (and one `activity` row per star under a digest)". The decision record 0043 *Consequences* bullet on reported deliveries names the same. No code change in this plan.
2. **minor — E3 and AC5 assume D1 still serves reads once the daily write budget is spent; nothing verifies that.** Why: if Cloudflare rejects all queries at the limit, `isKnownDelivery` (`src/webhook.ts:129`) already fails and answers 503, and the documentation would promise more than the code delivers.
   - Evidence: the AC5 double `writeFailingDb` (`test/d1.ts:75-85`) fails only non-SELECT statements. Fact 8 and decision 0043 note that real D1 billing is out of reach from the session.
   - Instruction: in the `notifications.md` / `storage.md` updates, the Dev writes only that a failed `last_delivery` write is ignored and the answer stays 202. Do not write that unrecorded deliveries keep working once the D1 budget is spent. Name the unverified read behaviour as a residual in 0043's *Consequences*.
3. **minor — fact 7 and `tasks.md` disagree on when the no-op upsert is measured.** Why: the Dev could skip the measurement.
   - Evidence: plan.md fact 7 says "in step 5"; `tasks.md` row 3 puts it in task 3 (the conditional upsert in `src/store/meta.ts`).
   - Instruction: the Dev measures `meta.changes` and `meta.rows_written` of the no-op upsert while doing task 3. The result is reported in the hand-back and noted in 0043.
