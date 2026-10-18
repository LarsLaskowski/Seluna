# 0025: Quiet hours decided at sending

- **Status:** Proposed
- **Date:** 2026-10-18
- **Area:** Notifications
- **Source:** Issue #14
- **Supersedes:** —

## Context

Issue #14 asks that messages arrive without sound during the owner's quiet hours: every message is still sent, with
the Bot API's `disable_notification` set, nothing is held back; ranges across midnight work, daylight saving time is
handled through `Intl.DateTimeFormat`, quiet hours are off by default, and the time comes from an injected clock. The
settings already hold the quiet hours (`off` or `<start>-<end>`) and the IANA time zone
([decision 0018](0018-settings-and-status-page.md)); the `outbox` table has had a `silent` column since the first
migration ([decision 0014](0014-d1-schema-and-data-access.md)), which the sender already turns into
`disable_notification`, but every row is written with `silent` 0. A row is sent right after it is written, and a row
whose send failed stays pending for the cron retry of issue #18, which may send it minutes or hours later through the
same sending code ([decision 0023](0023-webhook-processing-and-delivery-through-the-outbox.md)).

## Options considered

When the quiet hours are applied:

1. **At each send, from the settings and a clock reading taken just before that row is sent; a row whose `silent` is
   1 is sent without sound whatever the time** — a message arrives without sound exactly when it arrives inside the
   quiet hours, also when the cron sends it later; the sender needs the settings and a clock, which the cron needs
   anyway for the button's language. Chosen.
2. **When the row is written, stored in `silent`** — uses the column as it was laid out and keeps the sender
   unchanged, but a retry follows the time the delivery came in, not the time the message arrives: a row written at
   21:00 whose send failed rings when the cron sends it at 02:00, which is the one thing quiet hours are for.
3. **Both: silent when written or when sent inside the quiet hours** — no wake-up at night either, but a message
   written at 06:59 and retried at 07:05 arrives without sound outside the configured hours, and the first send
   follows the write within seconds, so nothing is gained over option 1.

How often the clock is read:

4. **Once per row, before its send** — "at the time of sending" holds for every row; a delivery's rows go out within
   the `waitUntil` window, so the readings differ by seconds. Chosen.
5. **Once per batch of rows** — one reading fewer, but a batch that crosses the boundary minute sends its later rows
   on the wrong side of it.

How the local time is found:

6. **The hour and minute of `Intl.DateTimeFormat` in the configured zone (24-hour cycle), compared as minutes of the
   day** — the runtime's time zone data handles daylight saving time; quiet hours are wall-clock times. Chosen.
7. **A fixed UTC offset per zone** — wrong for half the year in any zone with daylight saving time.

## Decision

Whether a message is sent without sound is decided for each row just before it is sent: it is silent when its row is
marked `silent` or when the wall-clock time of that moment in the configured time zone lies in the quiet hours (start
inclusive, end exclusive, by the minute). The webhook keeps writing rows with `silent` 0. The rules are in
[`areas/notifications.md`](../areas/notifications.md#quiet-hours).

## Consequences

- The cron retry of issue #18 passes the settings and its clock to the same sending code, so a retried row follows the
  quiet hours of the moment it is sent.
- The `silent` column keeps its meaning (send without sound) but no writer sets it to 1 yet; quiet hours do not use it.
- On the day daylight saving time starts, quiet hours that lie inside the skipped hour do not occur; on the day it
  ends, the repeated hour is quiet both times. This follows from wall-clock times and is accepted.
- A time zone the runtime cannot use reads as UTC, as on the status page; the settings accept only zones the runtime
  lists, so this needs a runtime whose list changed.
- The local time comes from the runtime's time zone data, which a runtime update can change for a zone whose rules
  change; nothing in Seluna has to change with it.
