# Plan: Quiet hours

Source: Issue #14 | [spec.md](spec.md)
Status: Draft
Tier: standard — a behavior change in Telegram delivery (the value of `disable_notification`, which `sendMessage`
already carries) that adds no Bot API method, reads nothing new from Telegram, adds no setting, column or dependency,
and so touches none of the security areas in `.squad/project.md`.

## Problem / root cause

Summary of [spec.md](spec.md): quiet hours can be configured on the setup page but have no effect; during them every
message must be sent at once with `disable_notification` true, in the configured time zone including daylight saving
time, start inclusive and end exclusive, across midnight, off by default, with an injected clock.

Why nothing is silent today: `processWebhook` writes every row with `silent: false` (`src/webhook.ts:126`) and passes
only `settings.language` to `deliverMessages` (`src/webhook.ts:140`); `deliverMessages` / `deliverOne`
(`src/delivery.ts:63-90`, `:120-127`) forward the row's `silent` unchanged as `disable_notification`
(`src/telegram.ts:290`) and have no clock (`DeliveryDeps`, `src/delivery.ts:23-29`).

Claims of the issue, checked against the code:

| Claim | Result |
| ----- | ------ |
| `settings` hold start, end and an IANA time zone | Confirmed: `NotificationSettings.quietHours` (`QuietHours` `{ start, end }` as `HH:MM`, `start !== end`) and `timeZone` (a name the runtime lists, or `UTC`), `src/settings.ts:18-29`, `:93-101`, `:113-125`; read through `readNotificationSettings` as decision 0018 requires (`src/store/settings.ts`). |
| Daylight saving time can be handled through `Intl.DateTimeFormat` | Confirmed: the status page already formats in the zone with `Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", … }).formatToParts` (`src/setup/status.ts:100-118`). Checked once with Node's ICU: on 29 March 2026 Berlin goes from 01:59 CET (00:59Z) to 03:00 CEST (01:00Z); on 25 October 2026 02:00–02:59 occurs at 00:00Z–00:59Z (CEST) and again at 01:00Z–01:59Z (CET), 03:00 CET at 02:00Z; an unknown zone throws `RangeError`. The Workers runtime is the same V8/ICU family; the tests of this plan run in it and settle it there. |
| During quiet hours every message is sent with `disable_notification: true`, nothing is held back | Partly in place: `sendMessage` already carries `disable_notification` from the row (`src/telegram.ts:290`), and delivery never delays a row; the decision itself is missing (above). |
| Ranges across midnight work | Possible: the settings accept any two different times, so `start > end` is stored (`src/settings.ts:100`); no consumer evaluates them yet. |
| Off by default | Confirmed: `DEFAULT_SETTINGS.quietHours` is `undefined` (`src/settings.ts:35`), stored default `off`. |
| The clock is injected | `WebhookDeps.now` exists (`src/webhook.ts:41`, `src/index.ts:29`); `DeliveryDeps` has none — added here. |
| 29 March and 25 October 2026 are the Europe/Berlin changeover days | Confirmed (the last Sundays of March and October 2026; Intl check above). |
| Dependency #12 | Closed; its pipeline is what this change extends. |

Related defect found on the way: none. Note for issue #18 (open): its cron resend goes through `deliverMessages`, so
the changed signature makes it pass the settings and its clock; no extra work is planned there by this change.

## Acceptance criteria

All tests use an injected clock (fixed `Date` values below); none reads the real clock. Times are UTC instants;
the local time in brackets is the wall-clock time the test pins.

- [ ] **AC1 — off is never silent.** `isQuietTime(undefined, zone, at)` is `false` for every minute of the 25-hour
  Berlin day 25 October 2026 (from `2026-10-24T22:00:00Z` up to `2026-10-25T23:59:00Z`, step one minute, zone
  `Europe/Berlin`) and for `UTC` at `2026-10-17T03:00:00Z`.
  Test: `src/quiet-hours.test.ts` › "isQuietTime is never quiet when quiet hours are off".
  End to end: AC4c and AC5b.
- [ ] **AC2 — boundary minutes, start inclusive, end exclusive, across midnight.** Zone `UTC`, `it.each`:

  | Quiet hours | Instant (UTC) | Quiet |
  | ----------- | ------------- | ----- |
  | 22:00–07:00 | 2026-10-17T21:59:59.999Z | false |
  | 22:00–07:00 | 2026-10-17T22:00:00.000Z | true |
  | 22:00–07:00 | 2026-10-17T23:30:00.000Z | true |
  | 22:00–07:00 | 2026-10-18T00:00:00.000Z | true |
  | 22:00–07:00 | 2026-10-18T06:59:59.999Z | true |
  | 22:00–07:00 | 2026-10-18T07:00:00.000Z | false |
  | 22:00–07:00 | 2026-10-18T12:00:00.000Z | false |
  | 09:00–17:00 | 2026-10-17T08:59:59.999Z | false |
  | 09:00–17:00 | 2026-10-17T09:00:00.000Z | true |
  | 09:00–17:00 | 2026-10-17T16:59:59.999Z | true |
  | 09:00–17:00 | 2026-10-17T17:00:00.000Z | false |
  | 09:00–17:00 | 2026-10-17T03:00:00.000Z | false |
  | 00:00–06:00 | 2026-10-17T23:59:59.999Z | false |
  | 00:00–06:00 | 2026-10-18T00:00:00.000Z | true |
  | 00:00–06:00 | 2026-10-18T05:59:59.999Z | true |
  | 00:00–06:00 | 2026-10-18T06:00:00.000Z | false |
  | 22:00–00:00 | 2026-10-17T21:59:59.999Z | false |
  | 22:00–00:00 | 2026-10-17T22:00:00.000Z | true |
  | 22:00–00:00 | 2026-10-17T23:59:59.999Z | true |
  | 22:00–00:00 | 2026-10-18T00:00:00.000Z | false |

  Test: `src/quiet-hours.test.ts` › "isQuietTime is $expected at $instant for quiet hours $start–$end in UTC".
- [ ] **AC3 — the configured zone and both Berlin changeover days.** Zone `Europe/Berlin`, `it.each`:

  | Quiet hours | Instant (UTC) | Wall clock | Quiet |
  | ----------- | ------------- | ---------- | ----- |
  | 22:00–07:00 | 2026-01-15T20:59:00Z | 21:59 CET | false |
  | 22:00–07:00 | 2026-01-15T21:00:00Z | 22:00 CET | true |
  | 22:00–07:00 | 2026-07-15T19:59:00Z | 21:59 CEST | false |
  | 22:00–07:00 | 2026-07-15T20:00:00Z | 22:00 CEST | true |
  | 22:00–07:00 | 2026-03-28T20:59:00Z | 21:59 CET | false |
  | 22:00–07:00 | 2026-03-28T21:00:00Z | 22:00 CET | true |
  | 22:00–07:00 | 2026-03-29T04:59:00Z | 06:59 CEST | true |
  | 22:00–07:00 | 2026-03-29T05:00:00Z | 07:00 CEST | false |
  | 22:00–07:00 | 2026-03-29T05:30:00Z | 07:30 CEST (06:30 if the offset were not followed) | false |
  | 01:00–03:00 | 2026-03-29T00:00:00Z | 01:00 CET | true |
  | 01:00–03:00 | 2026-03-29T00:59:00Z | 01:59 CET | true |
  | 01:00–03:00 | 2026-03-29T01:00:00Z | 03:00 CEST | false |
  | 02:00–03:00 | 2026-03-29T00:59:00Z | 01:59 CET | false |
  | 02:00–03:00 | 2026-03-29T01:00:00Z | 03:00 CEST (02:00 does not occur) | false |
  | 22:00–07:00 | 2026-10-24T19:59:00Z | 21:59 CEST | false |
  | 22:00–07:00 | 2026-10-24T20:00:00Z | 22:00 CEST | true |
  | 22:00–07:00 | 2026-10-25T05:30:00Z | 06:30 CET (07:30 if the offset were not followed) | true |
  | 22:00–07:00 | 2026-10-25T05:59:00Z | 06:59 CET | true |
  | 22:00–07:00 | 2026-10-25T06:00:00Z | 07:00 CET | false |
  | 02:00–03:00 | 2026-10-24T23:59:00Z | 01:59 CEST | false |
  | 02:00–03:00 | 2026-10-25T00:00:00Z | 02:00 CEST | true |
  | 02:00–03:00 | 2026-10-25T00:59:00Z | 02:59 CEST | true |
  | 02:00–03:00 | 2026-10-25T01:00:00Z | 02:00 CET (repeated hour) | true |
  | 02:00–03:00 | 2026-10-25T01:59:00Z | 02:59 CET | true |
  | 02:00–03:00 | 2026-10-25T02:00:00Z | 03:00 CET | false |

  Test: `src/quiet-hours.test.ts` › "isQuietTime is $expected at $instant ($wallClock) for quiet hours $start–$end in
  Europe/Berlin".
- [ ] **AC4 — each send decides by its own time.** With the Telegram double answering `sendMessage` successfully,
  the request body's `disable_notification` is (settings `{ language: "en", timeZone: "UTC", quietHours }`):
  - a. `true` for a row with `silent` 0, quiet hours 12:00–13:00, clock `2026-10-17T12:34:00Z`.
    Test: `src/delivery.test.ts` › "deliverMessages sends disable_notification true for a row sent during quiet hours".
  - b. `false` for the same row and quiet hours, clock `2026-10-17T13:00:00Z` (end exclusive).
    Test: "deliverMessages sends disable_notification false for a row sent outside quiet hours".
  - c. `false` for the same row, quiet hours off, clock `2026-10-17T12:34:00Z`.
    Test: "deliverMessages sends disable_notification false when quiet hours are off".
  - d. two rows sent in one call, quiet hours 12:00–13:00, a clock that returns `2026-10-17T12:59:59.999Z` on its
    first call and `2026-10-17T13:00:00.000Z` on every later call: first request `true`, second `false`.
    Test: "deliverMessages decides each row by a clock reading taken before its send".
  - e. one row, quiet hours 12:00–13:00, the same two-step clock, `sendMessage` answering the sequence
    `[retryAfter(1), jsonAnswer(200, FIXTURES.sendMessage)]` (the existing helper in `src/delivery.test.ts`): both
    requests carry `true` (the resend after a 429 is the same request; the clock is read once per row).
    Test: "deliverMessages keeps disable_notification for the resend after a 429".
  - f. a row with `silent` 1, quiet hours 12:00–13:00, clock `2026-10-17T15:00:00Z`: `true` (B7; the existing test
    "deliverMessages sets disable_notification for a silent row" covers it with quiet hours off and stays).
    Test: "deliverMessages sends a silent row without sound outside quiet hours".
- [ ] **AC5 — the webhook applies the stored settings.** With `testRule()` and the harness clock `NOW`
  (`2026-10-17T12:34:00Z`, 14:34 in Europe/Berlin):
  - a. stored `time_zone` `Europe/Berlin` and `quiet_hours` `14:00-15:00` (written with `writeSetting` or
    `writeNotificationSettings`): the `sendMessage` body has `disable_notification` `true` and the `outbox` row has
    `silent` 0 (in UTC 12:34 would lie outside 14:00–15:00, so the zone is pinned).
    Test: `src/webhook.test.ts` › "processWebhook sends without sound during the stored quiet hours and stores silent 0".
  - b. no stored settings: `disable_notification` `false`.
    Test: "processWebhook sends with sound when quiet hours are off".
- [ ] **AC6 — never fails, never guesses.** `isQuietTime` does not throw and returns:
  - `true` at `2026-10-17T22:00:00Z` and `false` at `2026-10-17T21:59:00Z` for 22:00–07:00 in the zone
    `Not/AZone` (read as UTC);
  - `false` for `new Date(Number.NaN)` with 00:00–23:59 in `UTC`;
  - `false` for the malformed quiet hours `7:00`–`22:00` at `2026-10-17T12:00:00Z`, `24:00`–`07:00` at
    `2026-10-17T00:30:00Z` and `22:00`–`07:00x` at `2026-10-17T23:00:00Z` (each would be quiet if parsed leniently);
  - `false` for `07:00`–`07:00` at `2026-10-17T07:00:00Z`.
  Tests: `src/quiet-hours.test.ts` › "isQuietTime reads a zone the runtime rejects as UTC", "isQuietTime is not quiet
  for an invalid time", "isQuietTime is not quiet for malformed quiet hours $start–$end", "isQuietTime is not quiet
  when start equals end".

No user-visible text changes (the setup page already says "Quiet hours: notifications arrive without sound").

## Behavior coverage

| spec.md *Behavior* | Covered by |
| ------------------ | ---------- |
| B1 off → with sound | AC1, AC4c, AC5b |
| B2 inside → without sound, sent at once; outside → with sound | AC4a, AC4b, AC5a (sent at once: AC4/AC5 assert the request in the same call) |
| B3 across midnight | AC2 (22:00–07:00, 22:00–00:00, 00:00–06:00 rows) |
| B4 start inclusive, end exclusive by the minute | AC2, AC4b |
| B5 daylight saving, both Berlin changeover days | AC3 |
| B6 the time of each send counts | AC4d, AC4e, AC5a (row stored with `silent` 0) |
| B7 a silent row stays silent | AC4f (plus the existing silent-row test) |
| B8 unusable zone → UTC, never fails a send | AC6 |

## Approach

1. New module `src/quiet-hours.ts` with one pure export `isQuietTime`. It parses `start` and `end` with the
   existing `isClockTime` check (`src/settings.ts`) into minutes of the day (`HH * 60 + MM`); malformed or equal
   times → `false`; `undefined` → `false`. The minute of the day of `at` comes from
   `new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(at)`
   (the `hour` and `minute` parts, as in `formatDeliveryTime`); when that throws (a zone the runtime rejects), it is
   computed from `getUTCHours()` / `getUTCMinutes()`; a result that is not a whole number from 0 to 1439 (an invalid
   `at`) → `false`. Then `start < end` → `start <= minute && minute < end`; `start > end` → `minute >= start ||
   minute < end`. No clock is read inside.
2. `src/delivery.ts`: `DeliveryDeps` gains `now: () => Date`; `deliverMessages` takes `DeliverySettings` instead of
   the language. The button label comes from `settings.language` as before. Just before a row's `sendNotification`
   (in `deliverOne`, only when the target is ready) the clock is read once and the send is silent when
   `message.silent || isQuietTime(settings.quietHours, settings.timeZone, now)`; that value goes into
   `OutgoingMessage.silent`, so the 429 resend reuses it. Private helper signatures are the Dev's choice.
3. `src/webhook.ts`: pass `settings` (the `NotificationSettings` already read) instead of `settings.language`, and
   `now: deps.now` into the delivery deps. Rows keep `silent: false`. No change to `WebhookDeps` or `src/index.ts`.
4. `CHANGELOG.md` entry (Dev).

## Options considered

Recorded in [decision 0025](../../docs/decisions/0025-quiet-hours-decided-at-sending.md):

1. **At each send (chosen)** vs **when the row is written, stored in `silent`** (lost: a cron retry of #18 follows the
   write time, so a row written at 21:00 and retried at 02:00 rings) vs **both** (lost: a row written at 06:59 and
   retried at 07:05 arrives silent outside the hours; no gain, since the first send follows the write within seconds).
2. **One clock reading per row (chosen)** vs **one per batch** (lost: a batch crossing the boundary minute sends later
   rows on the wrong side).
3. **`Intl.DateTimeFormat` wall clock (chosen)** vs **a fixed offset** (lost: wrong for half the year).

A further choice weighed for the API: pass the whole `NotificationSettings` to `deliverMessages` vs the `Pick` of the
three fields it reads (chosen: the cron of #18 and the tests build only what the sender reads; `NotificationSettings`
still satisfies it, so the webhook passes its value unchanged).

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/quiet-hours.ts` (new) | `isQuietTime` |
| Worker | `src/delivery.ts` | `DeliverySettings`, `DeliveryDeps.now`, `deliverMessages` signature, silent decision per row |
| Worker | `src/webhook.ts` | passes `settings` and `now` to `deliverMessages` (body only) |
| Docs | `CHANGELOG.md` | entry under `[Unreleased]` › `Added` |

## Signatures (for the Dev's skeleton)

`src/quiet-hours.ts` (new):

```ts
import type { QuietHours } from "./settings";

/**
 * Whether `at` lies in `quietHours` on the wall clock of `timeZone`, by the minute: the start minute is quiet, the
 * end minute is not, and a start later than the end spans midnight. Off (`undefined`), malformed or equal times and
 * an invalid `at` are never quiet; a zone `Intl.DateTimeFormat` rejects is read as UTC. Reads no clock; never throws.
 */
export function isQuietTime(quietHours: QuietHours | undefined, timeZone: string, at: Date): boolean;
```

`src/delivery.ts` (changed):

```ts
import type { NotificationSettings } from "./settings";

/** What sending reads from the settings: the button's language and the quiet hours with their time zone. */
export type DeliverySettings = Pick<NotificationSettings, "language" | "timeZone" | "quietHours">;

export interface DeliveryDeps {
  readonly env: object;
  readonly db: D1Database;
  readonly fetch: TelegramFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (entry: DeliveryLogEntry) => void;
  /** The clock read once per row, just before it is sent, for the quiet hours. */
  readonly now: () => Date;
}

/** Sends each row once, in order, silent per row by its flag or the quiet hours at its send; updates and logs it. Never rejects. */
export async function deliverMessages(
  messages: readonly PendingMessage[],
  settings: DeliverySettings,
  deps: DeliveryDeps,
): Promise<void>;
```

The `Language` import in `src/delivery.ts` goes away if nothing else uses it. In the skeleton `isQuietTime` throws
`new Error("Not implemented")` and `deliverOne` already calls it, so every delivery and webhook test that sends a row
fails until step 6 (expected per *Skeleton* in `.squad/stack.md`; the Dev lists them in the hand-back).

`src/webhook.ts`: no signature change.

## Test files

- `src/quiet-hours.test.ts` (new) — AC1, AC2, AC3, AC6.
- `src/delivery.test.ts` — AC4.
- `src/webhook.test.ts` — AC5.

Existing test code that calls a changed signature — the **Dev** adapts it in step 4 (the old signature goes away),
mechanically, no assertion touched:

- `src/delivery.test.ts` › `harness`: the `DeliveryDeps` literal gets `now: () => NOW` with
  `const NOW = new Date("2026-10-17T12:34:00Z")`.
- `src/delivery.test.ts`: the 14 calls `deliverMessages(x, "en" | "de" | language, deps)` take
  `settingsIn(<that language>)` instead, from a helper
  `function settingsIn(language: Language): DeliverySettings { return { language, timeZone: "UTC", quietHours: undefined }; }`.

`src/webhook.test.ts` and `src/index.ts` compile unchanged (`WebhookDeps` keeps its shape). The Tester builds the
deps of AC4 with its own clock (`{ ...harness().deps, now }`, or a `vi.fn<() => Date>()` for AC4d/e).

Files of the change no unit test can cover: none.

## Areas

- [Notifications](../../docs/areas/notifications.md): new subsection *Quiet hours*; *Message format* (a new row is
  written with `silent` 0, the sound is decided at sending), *Sending a row* (`disable_notification` true when the
  send is silent), *Scope*, *Related decisions* (0025). Written by the Lead with this plan.
- [Storage](../../docs/areas/storage.md): the meaning of `outbox.silent` (1 = without sound at any time, 0 = the quiet
  hours decide at sending). Written by the Lead with this plan.
- No new area.

## Documentation updates

Sweep done over `docs/areas/`, `docs/ARCHITECTURE.md`, `README.md`, `docs/setup.md`, `SECURITY.md` for quiet hours,
`silent` and `disable_notification`, and for enumerations of the sending step:

| File | Change | Owner |
| ---- | ------ | ----- |
| `docs/areas/notifications.md` | as under *Areas* | Lead (done in the plan commit) |
| `docs/areas/storage.md` | `outbox.silent` row | Lead (done in the plan commit) |
| `docs/ARCHITECTURE.md` | *Webhook to Telegram* step 4: a message sent during quiet hours is sent at once without sound, link to 0025 | Lead (done in the plan commit) |
| `docs/decisions/0025-quiet-hours-decided-at-sending.md`, index row | new record, `Proposed` | Lead (done) |
| `CHANGELOG.md` | under `## [Unreleased]` › `### Added`: "Quiet hours: during the hours set on the setup page, read in the configured time zone (daylight saving time included), notifications arrive without sound; they are still sent at once. Off by default." | Dev |

No change needed: `README.md` (its settings row already reads "Quiet hours (notifications arrive without sound) |
off"), `docs/setup.md` (lists quiet hours among the settings), `docs/areas/setup-wizard.md` (form, validation and
texts unchanged), `.squad/project.md` (no security area, guarantee or integration point changes; the *Outbound-only
Telegram* entry still holds — same method, same input).

## Architecture check

- *A matched event is written to the outbox before delivery is attempted, and unsent rows are retried* (0008):
  unchanged; the decision happens inside the existing send.
- *A delivery is processed once*, *a draft triggers nothing*, *an invalid signature has no effect*: untouched.
- *Each user's data stays in that user's account*: no new outbound call; the time zone data is the runtime's.
- Decision 0018's consequence that #14 reads quiet hours through the one reader: kept (`readNotificationSettings` in
  `processWebhook`).
- Decision 0023 (rows rendered when written, the button language at sending): consistent; the sound is decided at
  sending like the button label.

## Security considerations

- [x] Limits on parsed input: no limits — no new external input; `quietHours` and `timeZone` are already validated
  settings and are re-checked defensively (malformed → not quiet, unknown zone → UTC).
- [x] Exceptions reaching a user-visible failure reason or message: none — `isQuietTime` never throws (the `RangeError`
  of `Intl.DateTimeFormat` is caught), so a send cannot fail on it; no new log field.

## Decision records

- `docs/decisions/0025-quiet-hours-decided-at-sending.md` (Proposed) — new: quiet hours applied at each send, one clock
  reading per row, wall-clock times. A new record rather than an extension of 0023 (unreleased): a separate decision
  with its own alternatives, of its own issue.

## Out of scope / follow-ups

- The cron retry (#18) passes settings and its clock to `deliverMessages`; its plan will do so — no follow-up issue.
- Holding messages back, digests, per-rule or per-weekday quiet hours: not requested.
