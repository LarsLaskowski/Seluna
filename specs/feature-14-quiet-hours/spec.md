# Spec: Quiet hours

Status: Approved by Lead

Source: [Issue #14](https://github.com/LarsLaskowski/Seluna/issues/14) "[Telegram] Quiet hours"

## Problem / motivation

The owner can already switch on quiet hours on the setup page ("Quiet hours: notifications arrive without sound",
start and end, in the configured time zone), but they have no effect: every Telegram message is sent with sound,
also at night. The goal of the issue: messages arrive without sound during the configured hours, and still arrive.

## Behavior

What the user or the system does differently. No implementation details.

- **B1** Quiet hours off (the default): every message is sent with sound, at any time.
- **B2** Quiet hours on: a message sent at a moment whose wall-clock time in the configured time zone lies within
  the quiet hours is sent without sound (`disable_notification`); it is sent at once, nothing is held back or
  delayed. A message sent outside them is sent with sound.
- **B3** Quiet hours whose start is later than their end span midnight (22:00–07:00 covers the evening and the
  early morning).
- **B4** The start minute is quiet, the end minute is not, by the minute (22:00–07:00 is quiet from 22:00:00 up to and
  including 06:59:59).
- **B5** Daylight saving time is followed: the times are wall-clock times of the configured zone on every day,
  including the two changeover days (Europe/Berlin: 29 March and 25 October 2026); on the spring day a time inside
  the skipped hour never occurs, on the autumn day the repeated hour counts both times.
- **B6** The moment that counts is the moment each message is sent, so a message sent again later (after a failed
  send) is silent or not by the time it is sent then, not by the time GitHub delivered the event.
- **B7** A message already marked to be sent without sound stays silent at any time.
- **B8** A time zone the runtime cannot use is read as UTC; deciding about the sound never stops a message from
  being sent.

## Acceptance criteria

- [ ] AC1: Quiet hours off → never silent (B1).
- [ ] AC2: The boundary minutes: start inclusive, end exclusive (B4), for a same-day range, a range across midnight
  and ranges starting or ending at 00:00 (B3).
- [ ] AC3: Both daylight saving changeover days in Europe/Berlin, 29 March and 25 October 2026 (B5).
- [ ] AC4: A message sent inside the quiet hours is sent with `disable_notification` true, one outside with false,
  each row by its own time of sending (B2, B6, B7).
- [ ] AC5: The webhook's messages follow the stored quiet hours and time zone (B2).
- [ ] AC6: An unusable time zone, an invalid time or malformed quiet hours never fail; they read as UTC or as not
  quiet (B8).

The plan holds the testable form of each criterion and its tests.

## Out of scope

- Holding messages back until the quiet hours end, or a digest.
- Quiet hours per rule or per weekday.
- The cron retry itself (issue #18); it reuses the sending code of this change.
- Any change to the settings form, the stored format of the quiet hours or the time zone list (issue #11, done).

## Open questions

None.
