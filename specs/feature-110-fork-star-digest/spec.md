# Spec: Fork and star rules with a digest

Source: Issue #110
Status: Draft

## Problem

Seluna tells the owner nothing about new forks and stars: since #108 the app receives `fork` and `star`, which are
recorded but send no message (`docs/areas/notifications.md`, *The sender*). A
popular repository can get dozens of stars in an hour, so one message per star would flood the chat. The owner
wants to hear about them either at once or collected into one digest per hour or per day.

Checked at `1094ce3`: `isOwnAction`/`isBotSender` exist (`src/rules/actor.ts`). The owner is kept in `meta`
`github_app_owner` (decision 0039) and read once per delivery. The manifest has `fork` and `star`. `runScheduled`
runs cleanup and retry every 10 minutes (`src/scheduled.ts`). Decision 0025 is accepted. A notification holds a
title and two lines (`src/rules/rule.ts`). The next free migration is `0002`: #69 added none (decision 0038).
Refuted: the fork and star fixtures are reference-built, not real, and `star/deleted.json` does not exist.

## Scenarios

Texts are English, with the German in brackets. Line 1 is the title in bold, then `·` and the repository, as for
every message.

- S1: The default, daily digest. Given *Stars and forks* is *Daily at 18:00*, the time zone is `Europe/Berlin` and
  the switch *New star* is on, when another user stars `example-owner/example-repo` at 10:12, then no message is sent
  at 10:12. At the first cron run at or after 18:00 Berlin time, one digest arrives:
  **New stars and forks** (**Neue Sterne und Forks**), followed by the line
  `example-owner/example-repo: +1 ⭐ (now 1,234) · example-other-user` (`(jetzt 1.234)`).
- S2: Immediate star. Given *Stars and forks* is *Immediately* and *New star* is on, when another user stars a
  repository, then one message arrives within seconds: **New star** · `owner/repo` (**Neuer Stern**), line 2
  `by <login>` (`von <login>`), line 3 `1,234 stars now` (`jetzt 1.234 Sterne`; `1 star now`, `jetzt 1 Stern`).
  Its button _Open on GitHub_ opens the repository.
- S3: Immediate fork. Given *Immediately* and *New fork* on, when another user forks a repository, then one message
  arrives: **New fork** · `owner/repo` (**Neuer Fork**), line 2 the fork's full name (`forkee.full_name`), line 3
  `by <forkee.owner.login>` (`von …`). The button opens the fork (`forkee.html_url`).
- S4: Hourly digest under load. Given *Hourly*, when 50 accounts star `a/x` and 2 accounts fork it within one hour,
  then the first cron run after the next full hour sends exactly one message. Its line reads
  `a/x: +50 ⭐ (now 1,284), +2 forks · u1, u2, u3, u4, u5 and 47 more` (German `+2 Forks`, `und 47 weitere`;
  `+1 fork`, `+1 Fork`). Names are distinct accounts in the order they arrived, at most 5 per repository. The star
  count is the one GitHub sent with the newest collected star of that repository. A repository with only forks has
  no star part, and one with only stars has no fork part.
- S5: Several repositories. Given a digest covers stars or forks on more than one repository, then each repository
  has its own line, busiest first (new stars plus forks, ties by repository name). At most 10 lines are shown, then
  `and N more repositories` (`und N weitere Repositories`). With one repository the button opens it; with several
  there is no button.
- S6: Star and unstar. Given a digest interval, when an account stars a repository and removes the star before the
  digest is sent, then that star is in no digest. If it was the only collected event, no digest is sent.
- S7: Nothing collected. Given a digest interval, when its time comes and nothing was collected, then nothing is
  sent.
- S8: Own and bot activity. Given any value of *Stars and forks*, when the owner (a `User` owner, matched by account
  id) or a bot (`sender.type` `Bot`) stars or forks, then no message is sent and nothing is collected. This also
  holds for an unstar by them.
- S9: Changing the setting. Given events were collected under *Hourly* or *Daily*, when the owner saves
  *Immediately*, then the next cron run (within 10 minutes) sends them as one digest, and later events are sent one
  by one. When the owner switches between *Hourly* and *Daily*, or changes the time or the time zone, the collected
  events wait for the next digest time under the new value. When the owner turns a switch off, the events collected
  before stay in the next digest.
- S10: Settings form. Given the signed-in start page, then the settings form shows the switches *New star on a
  repository* and *New fork of a repository* (*Neuer Stern für ein Repository*, *Neuer Fork eines Repositorys*),
  both off on an instance that never saved them (*New star* and *New fork* above). It also shows the field *Stars and forks* (*Sterne und Forks*)
  with the choices *Immediately*, *Hourly* and *Daily at* plus a time (*Sofort*, *Stündlich*, *Täglich um*), set
  to *Daily at 18:00* until it is saved. Saving keeps every other setting as it was. With *Immediately* or *Hourly*
  the time is not stored, so the form shows 18:00 again the next time *Daily at* is chosen.
- S11: Quiet hours. Given quiet hours 17:00–08:00, when a digest is sent at 18:00, then it arrives without sound
  (decision 0025).

## Errors and edge cases

- E1: A payload of the wrong shape sends nothing and collects nothing: no `forkee` object, a missing string
  `forkee.full_name`, `forkee.html_url`, `forkee.owner.login` or `repository.full_name`, a `sender` without a safe
  integer `id` and a string `type` (as in decision 0040), or a `star` action other than `created` or `deleted`. A
  button URL that is not `https://github.com/…` gives a message without a button, as for every row.
- E2: A `repository.stargazers_count` that is not a whole number from 0 to 2^53 − 1 leaves out line 3 of S2, or
  ` (now …)` of a digest line. The star still counts.
- E3: Hostile text in a login or a repository name (markup, control or direction characters, very long text) is
  cleaned, escaped and cut like every message field (`docs/areas/notifications.md`, *Message format*). A digest line
  is cut at 256 code points and ends in `…`. The digest never exceeds title plus 11 lines.
- E4: An unstar that matches no collected star, an unstar under *Immediately*, and an unstar after the digest was
  sent all send nothing. There is no unstar message.
- E5: Collecting fails (D1 error): the delivery answers 503 and nothing is stored, as for every delivery. The owner
  can redeliver it from GitHub.
- E6: The digest run fails (D1 error while reading, writing or deleting): nothing is sent, the collected events are
  kept for the next run, and the cleanup and the retry of the same run still run. The log gets one fixed entry.
- E7: The digest cannot be delivered (Telegram down, no token or chat): it waits and is retried like every pending
  message, up to the fifth attempt. Its events are not collected again, so no second digest repeats them.
- E8: A late or skipped cron run: the digest is sent by the first run after its time. Each hour (*Hourly*) or day
  (*Daily*) of the configured time zone gets at most one digest, also after catching up.
- E9: Daylight saving time: on a day where the daily time does not exist, the digest is sent by the first run after
  the change. On a day where it occurs twice, it is sent once.
- E10: A redelivered `fork` or `star` delivery (same `X-GitHub-Delivery`) collects nothing and sends nothing.
- E11: Collected events older than 7 days are deleted by the cleanup without being sent, for example when the
  digest run kept failing.
- E12: The copy was deployed without its migrations, so the new table is missing: a fork or star that would be
  collected answers 503 and is lost unless redelivered. Every other delivery, *Immediately*, the retry and the
  cleanup work as before, and the digest run logs its fixed failure. The switches are off by default, so an
  instance is affected only once the owner turns one on.
- E13: A stored *Stars and forks* value that is not `immediate`, `hourly` or `daily@HH:MM` (`00:00`–`23:59`) reads as
  *Daily at 18:00*. A form with a missing or repeated field, an unknown choice, or *Daily at* without a valid time
  answers 400 with the *settings invalid* notice, which names the digest time too, and stores nothing.
- E14: An organization owner or an owner not stored yet: everyone's stars and forks count as foreign, as for issues
  (decision 0040).
- E15: Two cron runs at the same moment may send the same digest twice, but never lose an event. This is the
  retry's accepted risk (`docs/areas/scheduled-jobs.md`).
- E16: Very many events (for example 10,000 stars between two digests): the counts are complete and the digest is
  still one message. The cron run stays within the platform's per-invocation limits.

## Non-functional requirements

- Configuration: the settings row `activity_digest` holds `immediate`, `hourly` or `daily@HH:MM`, with the default
  `daily@18:00`. Two new switches, `repository_forked` and `repository_starred`, default to off. Existing rows keep
  their values.
- Storage: a new D1 table, created by migration `0002` and listed in `SCHEMA_TABLES`. An event is collected in the
  same transaction as its `deliveries` row, and a digest enters the outbox in the transaction that deletes its
  events.
- Time and limits: a digest is sent at most 10 minutes after its time, by the existing 10-minute cron with no new
  expression. A run stays within 50 subrequests and 15 minutes.
- Security: logins, repository names and URLs come from strangers. They are cleaned and length-limited before they
  are stored and again when rendered (*Parsing of external input*). No new permission or event is needed.
- Logs: a collected delivery has its own request-log decision, distinct from `reported`. The digest job logs only
  fixed results. No entry holds a login, a repository name or other payload text.
- Language: the digest text uses the notification language when it is built. The button label and quiet hours
  follow the moment of sending (decision 0025).

## Acceptance criteria

- [ ] AC1: Under *Immediately*, a star (`created`) or a fork by another account sends one message with the title,
  lines and button of S2 and S3, in English and German. By the owner or a bot it sends nothing, and an unknown or
  organization owner counts as another account (S2, S3, S8, E14).
- [ ] AC2: A payload of the wrong shape or with an unusable star count behaves as E1 and E2. Hostile text is
  cleaned and escaped as in E3 (E1, E2, E3).
- [ ] AC3: Under *Hourly* or *Daily*, a star or fork by another account sends no message and is collected in the
  same transaction as its delivery. A redelivery collects nothing, and a failed write answers 503 with nothing
  stored (S1, E5, E10).
- [ ] AC4: With *Hourly*, 50 stars and 2 forks within one hour give exactly one message at the next full hour, with
  the line of S4. With *Immediately*, 50 stars give 50 messages (S4).
- [ ] AC5: The digest has the layout of S4 and S5: title, at most 10 repository lines in the stated order, the
  "more repositories" line, at most 5 names and "and N more", lines cut at 256 code points, the button only for a
  single repository, and English and German texts (S1, S4, S5, E3, E16).
- [ ] AC6: An unstar removes the not yet sent star of the same account on the same repository. Star and unstar
  before the digest sends nothing, and an unstar never sends a message (S6, E4).
- [ ] AC7: With an injected clock, the cron sends at most one digest per hour or per day of the configured time zone,
  at the first run at or after its time, including late runs and daylight saving days. It sends none when nothing was
  collected, and the digest is sent with the quiet hours of its sending (S1, S7, S11, E8, E9).
- [ ] AC8: Changing the interval, the time, the time zone or a switch loses no collected event. A change to
  *Immediately* sends the collected events as one digest at the next run (S9).
- [ ] AC9: A failing digest run sends nothing, keeps the events and lets cleanup and retry run. A digest that cannot
  be delivered is retried as an outbox row and never rebuilt. The cleanup deletes collected events older than 7 days
  (E6, E7, E11, E15).
- [ ] AC10: The settings form shows and saves the two switches (default off) and *Stars and forks* (default
  *Daily at 18:00*) as in S10. Invalid stored values and invalid forms behave as in E13. Settings stored before the
  update keep their values (S10, E13).
- [ ] AC11: Migration `0002` creates the new table, `SCHEMA_TABLES` lists it, and without it the instance behaves as
  in E12 (E12).
- [ ] AC12: A decision record explains the digest instead of a rate limit. `docs/ARCHITECTURE.md` (cron, D1 tables),
  the area documents below, `docs/setup.md`, the README event and settings tables and `CHANGELOG.md` describe the
  behavior.

## Out of scope

- Digests for other rules (issues, comments, pull requests, alerts).
- `watch` events, unstar messages, and star counts per period beyond the digest.
- A schema check on the start page for a missing migration (E12). The _migrations missing_ notice still appears
  only after a failed sign-in (decision 0021).
- Preventing a duplicate digest from two overlapping cron runs (E15).

## Open questions

- Does *Hourly* mean the clock hour or one hour after the last digest? Answered: the clock hour in the configured
  time zone, like *Daily at HH:MM*, which gives the owner a predictable time.
- Does an empty due time move the next one? Answered: no. Nothing is sent, and later events wait for the next time
  (S7, "Nothing collected → nothing sent").
- Are events collected while a switch was on still sent after it is turned off? Answered: yes (S9). A rule decides
  when a delivery is processed, as with a pending outbox row today.
- Which fixtures? Answered: decided in the plan (*Fixtures from real deliveries*, `.squad/project.md`), as in
  decision 0040. The answer does not change this spec.

## Area documents

- `notifications.md`: a *Fork and star rules* section (events, conditions, titles, lines, button, shape). *The
  sender* no longer says that forks and stars send nothing. A *Digest* section covers collecting, the unstar, the
  layout and bounds, the extended message format and the new log decision.
- `scheduled-jobs.md`: the digest job (when it is due, time zone, daylight saving, catching up, failures, log), the
  7-day cleanup of collected events and the per-run limits.
- `storage.md`: the new table, migration `0002`, and the three new settings rows with formats and defaults.
- `setup-wizard.md`: the new form fields, their validation and the *settings invalid* notice.
