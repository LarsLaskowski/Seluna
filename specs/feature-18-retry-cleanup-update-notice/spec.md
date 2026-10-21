# Spec: Retry, cleanup and update notice

Source: Issue #18
Status: Approved by Lead

## Problem

An owner relies on Seluna to tell them about every case that needs attention. Today a message whose first send
fails (Telegram down, a timeout, a 429 with a long wait, a rejected token) stays `pending` in the `outbox` for good:
the two cron triggers in `wrangler.jsonc` (`*/10 * * * *` and `17 5 * * *`) already call the Worker, but its
`scheduled` handler does nothing (`src/index.ts`, "no job runs yet"), so nothing resends the row, nothing ever marks
it `failed`, and the owner never gets the message. At the same time every webhook delivery adds a `deliveries` row
and every notification an `outbox` row, and expired `token_cache` rows stay (decision 0026), so the owner's D1
database grows without limit on the free plan. Finally, each owner runs their own copy (decision 0005) and learns
about a new Seluna release only by watching the upstream repository, although the settings already offer the switch
"Tell me when a new Seluna release is available" (`update_notice`, default on, decision 0018), which nothing reads
yet.

## Scenarios

The "run every 10 minutes" is the cron trigger `*/10 * * * *`, the "daily run" the trigger `17 5 * * *` (05:17 UTC).
"The current time" is the time the run starts.

- S1: Given a `pending` `outbox` row with fewer than 5 attempts, written more than one minute before the run, when the
  run every 10 minutes starts and Telegram accepts the message, then the owner receives the message (text, button,
  with or without sound by the quiet hours of the moment it is sent, exactly as a first send) and the row is `sent`
  with one more attempt.
- S2: Given Telegram was unreachable when a delivery's row was first sent (the row is `pending` with 1 attempt), when
  Telegram is reachable again at the next run every 10 minutes, then the message arrives in that run.
- S3: Given a `pending` row with 4 attempts, when the run every 10 minutes sends it and the send fails again (any
  result other than `sent` that counts an attempt), then the row is `failed` with 5 attempts, it is never sent again,
  and the run writes a log entry with the row's id saying it was marked failed.
- S4: Given several `pending` rows, when the run every 10 minutes starts, then it sends at most 10 of them, oldest
  first (by the time written, then by id), each once; the rest wait for the next run.
- S5: Given `deliveries` rows received more than 7 days before the current time, `outbox` rows that are `sent` or
  `failed` and were written more than 30 days before it, and `token_cache` rows whose token expired before it, when
  the run every 10 minutes starts, then these rows are deleted; every other row stays, `pending` rows in particular,
  whatever their age.
- S6: Given the update notice is on, the instance runs version 0.4.0 and the latest release of LarsLaskowski/Seluna
  is `v0.5.0`, which has not been reported, when the daily run starts, then the owner receives one message in the
  notification language and the run remembers 0.5.0 as reported. In English:
  - line 1: **New Seluna release** · LarsLaskowski/Seluna
  - line 2: Version 0.5.0 is available; this instance runs 0.4.0.
  - the button _Open on GitHub_, linking to `https://github.com/LarsLaskowski/Seluna/releases/tag/v0.5.0`.

  In German line 1 reads **Neue Seluna-Version** and line 2 "Version 0.5.0 ist verfügbar; diese Instanz läuft mit
  0.4.0.", the button _Auf GitHub öffnen_. The message is an `outbox` row like any other: sent at once in the daily
  run, without sound inside the quiet hours, and resent by the run every 10 minutes when that send fails.
- S7: Given 0.5.0 was reported and the owner has not updated, when the next daily runs find `v0.5.0` still the latest
  release, then nothing is sent.
- S8: Given 0.5.0 was reported, when a later daily run finds `v0.6.0` as the latest release and the instance runs a
  version older than 0.6.0, then the owner receives the message for 0.6.0 once, and 0.6.0 is remembered.
- S9: Given the instance runs the latest release (or a newer version), when the daily run starts, then nothing is
  sent and nothing is remembered.
- S10: Given the update notice is off, when the daily run starts, then no request is made to GitHub, nothing is sent
  and nothing is remembered; once the owner switches it on again, the next daily run reports the latest release if it
  is newer than both the running version and the remembered one.
- S11: Given the Worker is called by a cron expression it does not know (the owner changed `triggers.crons`), when the
  `scheduled` handler runs, then it does nothing but write one log entry saying the schedule is unknown.

## Errors and edge cases

- E1: Telegram is still unreachable (network error, timeout, 5xx), answers 429, or rejects the token in a run every 10
  minutes: each row tried counts one attempt and stays `pending` (or becomes `failed` at its fifth attempt, S3); the
  other rows of the run are still tried. An outage longer than the time 5 attempts take (the first send plus four runs,
  about 40 minutes) leaves the rows of that time `failed`: the owner does not receive them.
- E2: No usable bot token or no chat configured: Telegram is not called, the rows tried stay `pending` with their
  attempts unchanged and are never marked `failed` for it, and each writes the log entry `no-token` or `no-chat`, as a
  first send does; they are delivered by the first run after the setup is finished.
- E3: A row written less than one minute before the run every 10 minutes starts is left to its first send (which may
  still be running in the webhook's `waitUntil`), so the owner does not get it twice from these two sends.
- E4: A `pending` row that already has 5 or more attempts (for example because marking it `failed` failed in an
  earlier run) is marked `failed` without another send, with the same log entry as S3.
- E5: Telegram accepted a message but recording the row as `sent` failed: the row stays `pending` and the owner may get
  the message again in the next run (at least once, decision 0008/0023), with the log entry `store-failed`.
- E6: A database failure in the run every 10 minutes (marking exhausted rows, reading the rows or the settings, or the
  cleanup's deletes) sends or deletes nothing further in that job, writes one log entry naming the job and a fixed
  failure result (never the error text), and does not stop the other job of the same run: retry and cleanup fail
  independently. The next run tries again. A failed read of the chat happens inside the sending path, as for a first
  send: each row tried logs `store-failed`, Telegram is not called and no attempt is counted.
- E7: A large backlog (hundreds of `pending` rows after a long outage, or many rows written before the chat was set):
  each run sends at most 10, oldest first, so a backlog of n rows takes about n / 10 runs.
- E8: A run deletes at most 1,000 rows of each table, oldest first, so the first cleanup on an instance that has run
  for months removes a large backlog over several runs (D1 asks for large deletes in chunks of about 1,000 rows, and
  every deleted row counts against the free plan's 100,000 rows written per day); a later
  redelivery (by the owner, from the GitHub App's delivery list) of a delivery whose row was deleted is processed as a
  new delivery and may produce a message again. GitHub offers redelivery only for recent deliveries (3 days, by its
  documentation), so 7 days covers it.
- E9: The release request fails — a network error, a timeout (10 seconds), a redirect, a non-2xx status (a 403 or 429
  of GitHub's limit for unauthenticated requests, a 5xx), a body over 1 MiB, a body that is not a JSON object, or no
  `tag_name` string: nothing is sent, nothing is remembered, one log entry with a fixed failure result is written,
  and the next daily run tries again.
- E10: The repository has no release yet (404): nothing is sent or remembered; the log entry says there is none.
- E11: Hostile or malformed `tag_name` (anything but `v<major>.<minor>.<patch>` with each part a whole number without
  leading zeros and at most 9 digits — for example `v0.5`, `v0.5.0-rc.1`, `0.5.0`, `v01.5.0`, `v0.5.0<b>`, a tag of
  1 MiB, a string with control characters): treated like E9, nothing reaches a message, a URL or a log entry. No other
  field of the answer (`name`, `body`, `html_url`) is used: the message holds only the parsed version and a URL built
  from it.
- E12: The running version (from `package.json`, fixed at build time) is not `<major>.<minor>.<patch>` in the same
  form (an owner edited their copy): no comparison is made, nothing is sent or remembered, and the log entry says so.
- E13: Versions are compared part by part as numbers: `0.10.0` is newer than `0.9.0`; a remembered value that is not a
  valid version counts as nothing remembered.
- E14: The latest release is older than the remembered one (a release was deleted): nothing is sent; the remembered
  value is not lowered.
- E15: The settings cannot be read, or writing the message and the remembered version fails: nothing is sent and
  nothing is remembered (the two are written together or not at all), one log entry with a fixed failure result is
  written, and the next daily run tries again, so the release is still reported exactly once.
- E16: Two daily runs at the same time (a trigger delivered twice) report a release once: only the run that records
  the new version writes the message.
- E17: No chat or bot token yet when a release is found: the message is written to the `outbox` and the version
  remembered; the message stays `pending` (E2) and arrives once the setup is finished.
- E18: The owner switches the notification language between writing and sending the release message: the text keeps
  the language it was written in, the button follows the language at sending (as for every row, decision 0023).
- E19: The trigger every 10 minutes is delivered twice at the same time (or two runs overlap): both runs may pick the
  same `pending` row and the owner may get that message twice. Rows are not claimed before they are sent; this is
  accepted under the at-least-once delivery of decisions 0008 and 0023. A run normally ends within about 4 minutes
  (10 rows of at most two 10-second requests and a 5-second wait), so two runs of the schedule do not overlap.
- E20: The bot token or the chat goes missing for a long time (a deleted secret, a removed chat): new rows stay
  `pending` and are never deleted, each run logs `no-token` or `no-chat` for its 10 oldest rows (about 1,440 entries a
  day), and once the setup is fixed the backlog arrives oldest first, possibly days late (E7). Accepted residual
  risk: "nothing is lost" outranks "the database does not grow", and the rows grow only by the owner's own
  notifications, as they did before this feature.

## Non-functional requirements

- Free plan: a run every 10 minutes sends at most 10 rows, so its Telegram requests (at most two per row, after a
  429) and D1 queries stay within the per-invocation limits of the Workers free plan; the plan verifies these limits
  and the cron wall-clock limit against Cloudflare's documentation and fixes the number of statements per run.
- Retention, fixed and not configurable: `deliveries` 7 days (by the time received), `sent` and `failed` `outbox`
  rows 30 days (by the time written; the table has no time of sending), `token_cache` rows until their expiry. `pending`
  rows are never deleted. The times are compared against the run's injected clock, never a database clock. A run
  deletes at most 1,000 rows per table, oldest first (E8).
- Per-run budget on the free plan (50 subrequests per invocation, D1 and `fetch` alike; 10 ms CPU and 15 minutes wall
  time per cron invocation): the run every 10 minutes makes at most 17 D1 statements and 20 Telegram requests, the
  daily run at most 6 D1 statements, one GitHub request and 2 Telegram requests.
- The retry sends through the same sending path as the first send (decision 0025: quiet hours at the time of each
  send, the button language at sending; the 429 wait of 1 to 5 seconds), so the per-row log entry is unchanged.
- The release check makes exactly one request, `GET https://api.github.com/repos/LarsLaskowski/Seluna/releases/latest`,
  without any credential (no installation token, no JWT, no `Authorization` header), with the GitHub API headers the
  client already sends (`Accept`, `X-GitHub-Api-Version`, `User-Agent: seluna/<version>`), redirects not followed, a
  10-second timeout and the answer read bounded (1 MiB) and narrowed to `tag_name`. The repository is fixed in the
  code; an owner's copy always asks the upstream repository. It is the second unauthenticated GitHub call of the
  Worker besides the manifest conversion, which the security model and the *GitHub App authentication* security area
  must say.
- GitHub limits unauthenticated requests per IP address, and a Worker's outgoing address is shared; a refused check
  is retried only by the next daily run, so a notice may come a day or more late. Accepted residual risk.
- No configuration is added: the existing `update_notice` setting (default `on`) is the switch; no new Worker secret,
  binding, table or migration. The remembered version is a new `meta` key.
- Logs: per sent row the existing entry (row id and result); per row marked failed one entry with its id; per job and
  run at most one entry with a fixed result or counts; for an unknown schedule one entry. No entry holds a message
  text, a chat id, a token, a release text or a GitHub or Telegram answer, and none the cron expression of an unknown
  schedule.
- Compatibility: existing `pending` rows (written since 0.3.0) are retried with the attempts they have; rows written
  before the update are cleaned up by the same rules. The webhook's first send and its log are unchanged.

## Acceptance criteria

- [ ] AC1: The run every 10 minutes sends each `pending` row with fewer than 5 attempts written more than one minute
  before it starts, at most 10 rows, oldest first (by the time written, then by id), through the first send's path; a
  row Telegram accepts becomes `sent`. Rows with 5 or more attempts are not among these 10 (S1, S2, S4, E3, E7).
- [ ] AC2: A row whose fifth attempt fails becomes `failed` in the same database update that counts that attempt, a
  `pending` row with 5 or more attempts becomes `failed` without a send (at most 10 such rows per run, oldest first,
  before the rows to send are chosen), and each writes a log entry with the row id saying it was marked failed (S3,
  E4).
- [ ] AC3: In a simulated Telegram outage a row stays `pending` with one more attempt per run, and the first run after
  the outage delivers it; without a bot token or chat no attempt is counted and no row is marked failed (E1, E2, E5).
- [ ] AC4: The run every 10 minutes deletes `deliveries` rows received more than 7 days, `sent` and `failed` `outbox`
  rows written more than 30 days, and `token_cache` rows expired before the current time, at most 1,000 per table and
  run, oldest first, and keeps every `pending` row and every row on or inside these bounds (S5, E8).
- [ ] AC5: A database failure in the retry or the cleanup writes one log entry with a fixed result for that job and
  does not stop the other job of the run (E6).
- [ ] AC6: With the update notice on, a latest release newer than the running version and the remembered one writes
  one `outbox` row with the message of S6 in the notification language and remembers its version in the same
  transaction, then sends it; the next daily runs send nothing for it, and a newer release is reported again (S6, S7,
  S8, E14, E16, E17, E18).
- [ ] AC7: Nothing is sent or remembered when the running version is the latest release or newer, and with the update
  notice off no GitHub request is made at all (S9, S10).
- [ ] AC8: The release request carries no credential and the GitHub API headers, follows no redirect, times out after
  10 seconds and reads at most 1 MiB; every failed, refused, oversized, malformed or missing answer, every `tag_name`
  outside `v<major>.<minor>.<patch>` and an invalid running version send and remember nothing and write one log entry
  with a fixed result (E9, E10, E11, E12, E15).
- [ ] AC9: Versions compare part by part as numbers (`0.10.0` newer than `0.9.0`), and an invalid remembered value
  counts as none (E13).
- [ ] AC10: The `scheduled` handler runs retry and cleanup for `*/10 * * * *`, the release check for `17 5 * * *`,
  and for any other expression nothing but one log entry (S11).

## Out of scope

- Updating the owner's copy (issue #19, one-click updates); the notice only links the release.
- A channel-neutral outbox and other delivery channels (issue #69, planned after this one).
- Showing `failed` rows, the backlog or the last release check on the status page; resending `failed` rows by hand.
- Stopping a run at the first failed send to save the attempts of the rows behind it, or spacing the retries out
  (exponential backoff): the issue fixes 5 attempts at the 10-minute rhythm.
- Retrying a failed release check before the next daily run, and authenticating it.
- Configurable retention periods, retry counts or schedules.
- Claiming rows so that two retry runs at the same time cannot send one row twice (E19), and an age limit for
  `pending` rows that wait for a bot token or chat (E20): both accepted as residual risks.
- Removing `meta` values other than the remembered release, `settings` rows or `secrets`.

## Open questions

- Q1: What counts as an attempt toward the 5? Answered: the code already counts one attempt per send that reaches
  Telegram or fails on the way (`markAttempted`/`markSent` in `src/store/outbox.ts`, `src/delivery.ts`), including the
  first send in the webhook, and none when the bot token or chat is missing (decision 0023, *Consequences*). So the
  fifth attempt is the first send plus four cron runs, and a row waiting for the setup never fails.
- Q2: Are `failed` `outbox` rows deleted? Answered: yes, after 30 days like `sent` rows. The issue's scope names only
  `sent` rows, but its goal is that "the database does not grow", and a `failed` row is read by nothing (no page shows
  it, nothing resends it); 30 days leave time to look at one in the D1 console. `pending` rows are never deleted,
  because "nothing is lost".
- Q3: Are `token_cache` rows cleaned up? Answered: yes. Decision 0026 (*Consequences*), `docs/areas/github-api.md`
  (*Not here*) and the cron table of `docs/ARCHITECTURE.md` already assign removing expired and orphaned rows to this
  cron. A token lives about an hour, so a row of an earlier app's installation is expired soon after the app changed;
  deleting expired rows removes both kinds.
- Q4: Which version is "running", and what does a release look like? Answered: the version of `package.json`, fixed
  at build time (`src/index.ts` imports it; decision 0011); releases are tagged exactly `vA.B.C` on `main`, and the
  release workflow turns a pre-release into the latest full release only once it is verified, which is what
  `releases/latest` returns (decision 0009, `docs/CONTRIBUTING.md`). A release the maintainer publishes by hand
  without *Set as a pre-release* is the latest release before its checks run (the workflow only warns,
  `docs/CONTRIBUTING.md`), so such an unverified release can be reported; accepted residual risk, since the notice
  only links the release and updates nothing. `package.json` stays at the last released version until the release pull request, so a
  copy deployed from `main` between releases is not told about the release it already contains — it reads the same
  version only after that release.
- Q5: What happens to the remembered version while the update notice is off? Answered: nothing is read or written
  (S10). The switch's label promises a notice "when a new Seluna release is available"; switching it on later reports
  the latest release once if it is still newer than what runs, which is the notice the owner asked for.
- Q6: Does the release message go through the `outbox`? Answered: yes. The issue's goal "nothing is lost when Telegram
  is down" and the guarantee "a matched event is written to the outbox before delivery is attempted" (decision 0008)
  apply to it; writing the row and the remembered version together makes "reported exactly once" survive a failed
  send.
- Q7: Is an unauthenticated GitHub call allowed? Answered: the issue asks for it explicitly; the GitHub App is not
  installed on the upstream repository, so no app token could read it, and the release of a public repository needs
  none. It adds a second exception to "every GitHub call is made as the app" (`.squad/project.md`, *GitHub App
  authentication*), which the plan records and Security reviews; no credential is sent, so none can leak.

## Area documents

- New area `docs/areas/scheduled-jobs.md` (*Scheduled jobs*), added to the index in `docs/areas/README.md`: the two
  schedules and the dispatch by expression; the retry (which rows, at most 10, oldest first, the one-minute grace,
  5 attempts, marking `failed`, its log entry); the cleanup (the three tables and their retention, `pending` kept);
  the release check (request, accepted tag form, comparison, the remembered version, the message text in both
  languages, the switch); failure isolation between jobs; the log entries; the residual risks (GitHub's
  unauthenticated limit, an outage over about 40 minutes, a row sent twice by overlapping runs (E19), `pending` rows
  and log entries piling up without a bot token or chat (E20), an unverified release published by hand (Q4)).
- `docs/areas/http-routes.md`: the release answer joins the list of external answers read with the 1 MiB bound.
- `docs/areas/notifications.md`: the cron retry sends through the same sending rules (link to the new area instead of
  `ARCHITECTURE.md`); the release message as a second kind of row besides the rules' notifications, in the message
  format and language tables; the log entry of a row marked failed.
- `docs/areas/storage.md`: the `meta` key of the remembered release and its format; `outbox` `failed` reached after 5
  attempts; *Not here* points to the new area for row cleanup.
- `docs/areas/github-api.md`: the unauthenticated release request as the one call outside the app authentication
  besides the manifest conversion (or a pointer to the new area), and *Not here* pointing to it for `token_cache`
  cleanup.
- `docs/areas/deployment.md`: the cron triggers section no longer says the handler does nothing; *Not here* points to
  the new area.
- `docs/ARCHITECTURE.md`: the cron table (link to the new area; the daily job sends the notice), the security model's
  unauthenticated GitHub calls, the guarantee "unsent rows are retried" bounded at 5 attempts.

## Challenge

The six minor objections of the spec challenge (originally *Challenge notes*), each with its answer:

1. **minor — E6 contradicts the sending path for a failed read of the chat.** Accepted — E6 no longer names the
   chat: the chat is read inside the sending path (`resolveTarget` in `src/delivery.ts`), so a failed read logs
   `store-failed` once per row tried, calls no Telegram and counts no attempt, exactly as a first send; the job-level
   entry covers marking exhausted rows, reading the rows and the settings, and the deletes. The Tester asserts the
   per-row entries for this case.
2. **minor — Q4 overstates that only a verified release becomes the latest.** Accepted — Q4 now says that a release
   published by hand without *Set as a pre-release* is the latest before its checks run and can be reported; the
   new area document lists it as an accepted residual risk.
3. **minor — two retry runs at the same time can send a row twice.** Accepted — new edge case E19 states it and
   accepts it under the at-least-once delivery of decisions 0008 and 0023; claiming rows is out of scope (it would
   need a column or a second meaning of `attempts`, and a run ends in about 4 minutes, well inside the 10-minute
   rhythm). Listed among the residual risks of the area document.
4. **minor — the switch to `failed` and the 10-row bound need to be precise.** Accepted — AC2 now says the fifth
   failed attempt is counted and marks the row `failed` in one database update, so no failure can leave a row
   between the two; rows already at 5 or more attempts (E4) are marked `failed` by a separate statement before the
   rows to send are chosen, at most 10 per run, oldest first, and AC1 says they are not among the 10 rows sent. The
   statement count per run is in the non-functional requirements and fixed in `plan.md`.
5. **minor — no real sample of the release answer.** Accepted — the answer of
   `GET /repos/LarsLaskowski/Seluna/releases/latest` (HTTP 200, `v0.4.0`, captured 2026-10-21) is saved anonymized
   as `release-latest.json` in this work folder; the Tester moves it to `test/fixtures/github/release-latest.json`
   and the reader's tests read it. No 404 sample is needed: an answer outside 2xx is never read (its body is
   cancelled unread), so E10 is decided by the status alone; the session also cannot make an unauthenticated
   request (its proxy authenticates every GitHub request).
6. **minor — `pending` rows without a chat or token grow without limit.** Accepted as a residual risk — new edge
   case E20 states the growth, the log volume and the late backlog, and the area document lists it. An age limit
   for never-attempted rows would break "nothing is lost" for an owner who fixes the setup late; the rows grow only
   with the owner's own notifications, as they already do in 0.4.0.

While planning, the Lead also fixed E8, the retention requirement and AC4: a run deletes at most 1,000 rows per
table, oldest first, because Cloudflare's D1 documentation asks for large deletes in chunks of about 1,000 rows and
counts every deleted row (and its index entry) against the free plan's 100,000 rows written per day.
