# Spec: Fork and star rules with a digest

Source: Issue #110
Status: Approved by Product Manager

## Problem

Seluna tells the owner nothing about new forks and stars. Since #108 the app receives `fork` and `star`, which are
recorded but send no message (`docs/areas/notifications.md`, *The sender*). A popular repository can get dozens of
stars in an hour, so one message per star would flood the chat. The owner wants them either at once or collected
into one digest per hour or per day.

Checked at `1094ce3`: `isOwnAction`/`isBotSender` exist (`src/rules/actor.ts`). The owner is kept in `meta`
`github_app_owner` (decision 0039) and read once per delivery. The manifest has `fork` and `star`. `runScheduled`
runs cleanup and retry every 10 minutes (`src/scheduled.ts`). Decision 0025 is accepted. A notification holds a
title and two lines (`src/rules/rule.ts`). The next free migration is `0002`: #69 added none (decision 0038).
Refuted: the fork and star fixtures are reference-built, not real, and `star/deleted.json` does not exist.

## Scenarios

Texts are English, with the German in brackets. *New star* and *New fork* are the two new switches. An *account*
is identified by `sender.id`, and a repository by `repository.id`.

- S1: Daily digest (the default). Given *Daily at 18:00*, time zone `Europe/Berlin` and *New star* on, when another
  account stars `example-owner/example-repo` at 10:12, then nothing is sent at 10:12. The first cron run at or after
  18:00 Berlin time sends one digest. Line 1 is the bold title **New stars and forks** (**Neue Sterne und Forks**)
  alone, with no repository and no number. It is followed by
  `example-owner/example-repo: +1 ⭐ (now 1,234) · example-other-user` (`(jetzt 1.234)`).
- S2: Immediate star. Given *Immediately* and *New star* on, when another account stars a repository, then one
  message arrives: **New star** · `owner/repo` (**Neuer Stern**), line 2 `by <sender.login>` (`von …`), line 3
  `1,234 stars now` (`jetzt 1.234 Sterne`; `1 star now`, `jetzt 1 Stern`). The button opens the repository.
- S3: Immediate fork. Given *Immediately* and *New fork* on, when another account forks a repository, then one
  message arrives: **New fork** · `owner/repo` (**Neuer Fork**), line 2 `forkee.full_name`, line 3
  `by <sender.login>`. The button opens `forkee.html_url`.
- S4: Hourly digest under load. Given *Hourly*, when 50 accounts star `a/x` and 2 fork it within one hour, then the
  first run after the next full hour sends exactly one message, with the line
  `a/x: +50 ⭐ (now 1,284), +2 forks · u1, u2, u3, u4, u5 and 46 more` (German `+2 Forks`, `und 46 weitere`;
  `+1 fork`, `+1 Fork`). The counts are events. Names are the distinct accounts (`sender.login`, for forks too),
  in order of their first event, at most 5. `N` counts the remaining distinct accounts, so an account that starred
  and forked counts once (here one did). The count is that of the newest collected star of that repository. An
  empty star or fork part is left out.
- S5: Several repositories. Each repository gets its own line, busiest first (stars plus forks, ties by name), at
  most 10 lines, then `and N more repositories` (`und N weitere Repositories`). One repository: the button opens it.
  Several: no button.
- S6: Star and unstar. Given *New star* on, when an account unstars a repository, then its earlier collected, unsent
  stars on that repository are removed, under any interval. A digest left empty is not sent. An unstar never sends
  a message. A star that arrives after its unstar is collected.
- S7: Nothing collected. When a digest time comes and nothing is collected, nothing is sent. An event that arrives
  afterwards waits for the next digest time.
- S8: Own and bot activity. A star, fork or unstar by the owner (a `User` owner, matched by id) or a bot
  (`sender.type` `Bot`) sends and collects nothing.
- S9: Changing the setting. Under *Immediately* every run sends what is still collected as one digest. When the
  owner switches between *Hourly* and *Daily*, or changes the time or time zone, collected events wait for the
  next digest time under the new value. Turning a switch off removes nothing: collected events are sent once a
  switch is on, unless the cleanup removes them first (E11).
- S10: Settings form. The form shows *New star on a repository* and *New fork of a repository* (*Neuer Stern für
  ein Repository*, *Neuer Fork eines Repositorys*), both off until saved. It also shows *Stars and forks* (*Sterne
  und Forks*) with *Immediately*, *Hourly*, *Daily at* plus a time (*Sofort*, *Stündlich*, *Täglich um*), set to
  *Daily at 18:00* until saved. Saving keeps every other setting. With *Immediately* or *Hourly* the time is not
  stored, and *Daily at* shows 18:00 again.
- S11: Quiet hours. A digest sent at 18:00 inside quiet hours 17:00–08:00 arrives without sound (decision 0025).
- S12: Switch off. Under any interval, a star or fork whose switch is off sends and collects nothing, and the
  request log shows `disabled`.

## Errors and edge cases

- E1: A wrong shape sends and collects nothing (`no-match`). That covers a missing `forkee` object, a missing string
  `forkee.full_name` or `forkee.html_url`, `repository.full_name`, `sender.login`, an `id` (sender, repository)
  that is not a safe integer, a non-string `sender.type`, or another `star` action. A button URL that is not
  `https://github.com/…` gives no button.
- E2: A `stargazers_count` that is not a whole number from 0 to 2^53 − 1 leaves out line 3 of S2 or ` (now …)`.
- E3: Hostile logins or names are cleaned, escaped and cut like every field (*Message format*). Each digest line is
  cut at 256 code points with `…`. A digest has at most a title and 11 lines.
- E4: An event collected while a digest is being built is not lost. The digest removes exactly the events it
  counted, and later ones wait for the next digest.
- E5: A failed write while collecting or unstarring answers 503 and stores nothing. The delivery can be redelivered
  from GitHub.
- E6: A failing digest job (D1) sends nothing and keeps the events. Cleanup and retry still run, and the job logs
  one fixed entry.
- E7: An undeliverable digest (channel down, no token or chat) is retried like any pending row, and its events are
  never put into a second digest.
- E8: Digest times. *Hourly* is every instant at which the wall clock of the configured time zone shows minute 00.
  The hour repeated on the fall-back day gives two digest times, and the skipped spring hour adds none. *Daily at
  HH:MM* is the first instant of each local day at or after HH:MM. When the time is skipped, that is the first
  instant after it. When it repeats, only the first occurrence counts. A digest is due at a run when a digest time
  lies after the previous run of the job and at or before this run. A late or skipped run therefore catches up
  once. The first run after the update counts nothing as due.
- E9: A redelivered delivery (same `X-GitHub-Delivery`) collects and sends nothing.
- E10: Very many events (10,000 stars): the counts are exact, and still only one message is sent.
- E11: While a switch is on, collected events older than 7 days are deleted by the digest job, unsent.
- E12: Missing migration (`npm run deploy` not used). With both switches off nothing touches the new table. With a
  switch on, fork and star deliveries under *Hourly* or *Daily* and every unstar answer 503 and are lost unless
  redelivered. The digest job also logs its failure every run, about 144 entries a day. Everything else works.
- E13: An invalid stored value reads as *Daily at 18:00*. A form with a missing or repeated field, an unknown choice,
  or *Daily at* without a valid `HH:MM` answers 400 with the *settings invalid* notice, which names the digest time
  too. Nothing is stored.
- E14: With an organization owner or an owner not stored yet, everyone counts as foreign (decision 0040).
- E15: Two runs at the same moment may send one digest twice and never lose an event. This is the retry's accepted
  risk.

## Non-functional requirements

- Configuration: `activity_digest` = `immediate` | `hourly` | `daily@HH:MM`, default `daily@18:00`. The switches
  `repository_forked` and `repository_starred` default to off. Existing rows keep their values.
- Storage: a new table, created by migration `0002` and listed in `SCHEMA_TABLES`, holds per event the kind,
  `sender.id`, `sender.login`, `repository.id`, the repository name, the URL, the star count and the time. An event
  is collected in its `deliveries` transaction. One transaction writes the digest's outbox row, deletes its events
  and stores the job's run time in `meta`. A run without a due digest stores only the run time.
- Cron: the digest job runs in the 10-minute run after cleanup and retry, with its own failure handling. It sends
  its row itself through the first-send path, as the release check does. The retry skips rows younger than 60 s,
  so the row is not sent twice. While both switches are off, the job only stores its run time. Its statements and
  requests are bounded (`plan.md`). If the run hits a platform limit, the digest waits for a later run and no event
  is lost. Counts are made in SQL, and at most 5 names are read for each of at most 10 repositories.
- Security: stranger text is cleaned and length-limited when it is stored and when it is rendered (*Parsing of
  external input*). No new permission is needed.
- Logs: a collected delivery gets its own decision, distinct from `reported`. The job logs only fixed results. No
  entry holds payload text.
- Language: the digest text uses the language at build time. The button and quiet hours follow the sending.

## Acceptance criteria

- [ ] AC1: Under *Immediately*, a star or fork by another account sends the message of S2 or S3 in English and
  German. One by the owner or a bot sends nothing, and an unknown or organization owner counts as foreign (S2, S3,
  S8, E14).
- [ ] AC2: Wrong shapes, unusable counts and hostile text behave as E1–E3 (E1, E2, E3).
- [ ] AC3: Under *Hourly* or *Daily*, a star or fork by another account is collected in its delivery's transaction
  and sends nothing. With its switch off, nothing is collected (`disabled`). A redelivery collects nothing, and a
  failed write answers 503 with nothing stored (S1, S12, E5, E9).
- [ ] AC4: With *Hourly*, 50 stars and 2 forks in one hour give exactly one message with the line of S4. With
  *Immediately*, 50 stars give 50 messages (S4).
- [ ] AC5: The digest has the line 1, lines, order, bounds, button and en/de texts of S1, S4 and S5, also for
  10,000 events (S1, S4, S5, E3, E10).
- [ ] AC6: An unstar removes the account's unsent stars on that repository under any interval and never sends.
  Star then unstar sends nothing, and unstar then star collects the star (S6).
- [ ] AC7: With an injected clock, digests follow E8 exactly for hourly and daily, late runs and both daylight
  saving days, and the first run after the update sends nothing. Nothing collected at a digest time sends nothing, and an
  event after it gives no digest before the next digest time. The digest uses the quiet hours of its sending (S1,
  S7, S11, E8).
- [ ] AC8: Changes of interval, time, time zone or switch lose no collected event and follow S9 (S9).
- [ ] AC9: An event inserted between the job's read and its transaction stays collected for the next digest (E4).
- [ ] AC10: A failing job keeps the events and lets cleanup and retry run. The digest row is sent by the job and
  retried as an outbox row, and its events are never counted again. While a switch is on, events older than 7
  days are deleted (E6, E7, E11).
- [ ] AC11: The form and stored values behave as in S10 and E13, and older settings keep their values (S10, E13).
- [ ] AC12: Migration `0002` creates the table, `SCHEMA_TABLES` lists it, and without it the instance behaves as in
  E12 (E12).
- [ ] AC13: A decision record (a digest instead of a rate limit) is written. `docs/ARCHITECTURE.md`, the area
  documents below, `docs/setup.md`, the README and `CHANGELOG.md` describe the behavior.

## Out of scope

- Digests for other rules; `watch` events, unstar messages, star counts per period.
- A start-page check for a missing migration (E12). Decision 0021's notice covers a failed sign-in only.
- Preventing a duplicate digest from overlapping runs (E15).

## Open questions

- Which fixtures? Answered: by the Product Manager, reference-built from GitHub's webhook documentation, including
  a new `test/fixtures/star/deleted.json`, with the READMEs updated and a live check on a deployed copy before the
  pull request is marked ready, as in decision 0040.

## Area documents

- `notifications.md`: *Fork and star rules* and a *Digest* section (collecting, unstar, layout, bounds, message
  format, log decision). *The sender* is updated.
- `scheduled-jobs.md`: the digest job (digest times, catching up, failures, budget) and the cleanup of events.
- `storage.md`: the new table, migration `0002`, the three settings rows.
- `setup-wizard.md`: the form fields, the validation and the notice.

## Challenge

- M1: Accepted. E8 now defines the digest times for *Hourly* and *Daily* in the time zone. A digest is due when a
  time passed since the job's previous run, and `meta` stores that run time on every run, whether or not anything
  was sent. A first run sends nothing. Interval, time and time-zone changes fall out of the same rule. AC7 adds the
  empty-time and first-run cases.
- M2: Accepted. E4 and AC9 are added: the digest deletes exactly the events it counted, and the test inserts an
  event between the read and the transaction.
- m1: Accepted as an escalation (*Open questions*).
- m2: Accepted. Events store `sender.id` and `repository.id`. An unstar matches on both, under any interval while
  *New star* is on. Unstar before star is in S6. The count comes from the newest star.
- m3: Accepted. `N` counts distinct accounts. Fork names and S3 line 3 use `sender.login`, the person who forked:
  for a fork into an organization, line 2 already shows that organization.
- m4: Accepted. Line 1 of the digest is the title alone (S1).
- m5: Accepted. S12 is added and AC3 extended.
- m6: Accepted. The order, the sending through the first-send path and the 60 s grace are under *Non-functional
  requirements*, *Cron*.
- m7: Accepted: 8 D1 statements and 2 Telegram requests, counts in SQL, names bounded.
- m8: Accepted, both. With both switches off nothing touches the table, and E12 states the remaining log noise.
- m9: Accepted. E8 covers both daylight saving days for *Hourly*.
