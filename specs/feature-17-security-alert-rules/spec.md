# Spec: Security alert rules

Source: Issue #17
Status: Approved by Product Manager

## Problem

The owner runs Seluna to hear about what in their GitHub repositories needs attention. Today a new security alert —
a vulnerable dependency found by Dependabot, a code scanning finding, a leaked secret found by secret scanning — sends
nothing: the GitHub App already subscribes to the three events and the settings page already shows a switch for each
(`dependabot_alert`, `code_scanning_alert`, `secret_scanning_alert`, all on by default), but no rule reads them, so the
README lists the case as "planned for 0.4.0". The owner notices an alert only when they happen to open GitHub, while
a leaked secret or a critical vulnerability is exactly what should reach them at once. At the same time a message
about a leaked secret must not become a second leak: the Telegram chat, its history and the D1 outbox must never hold
the secret.

## Scenarios

The messages below show the three lines and the button in the existing message format (`notifications.md`, *Message
format*): line 1 is the bold title, `·`, the repository and ` #` with the alert number. "Line 2 and line 3 are the same
in both languages" holds for every scenario.

- S1: Given the switch "Dependabot alert" is on and the notification language is English, when GitHub delivers
  `dependabot_alert` with `action` `created` for alert 7 in `octo/shop` whose advisory summary is "Prototype
  Pollution in lodash", whose severity is `high` and whose package is `lodash`, then Telegram shows
  **Dependabot alert** · octo/shop #7 / Prototype Pollution in lodash / high · lodash, with the button "Open on GitHub"
  leading to the alert's page (`alert.html_url`).
- S2: Given the same, when the delivery's `action` is `reopened` (someone reopened a dismissed alert), then the same
  message is sent: one title per case, whether new or reopened.
- S3: Given the switch "Code scanning alert" is on, when GitHub delivers `code_scanning_alert` `created` for alert 12 in
  `octo/shop` on the default branch (`ref` is `refs/heads/` followed by `repository.default_branch`) whose rule is
  `js/sql-injection` with the description "Database query built from user-controlled sources" and the security
  severity `high`, then Telegram shows **Code scanning alert** · octo/shop #12 / Database query built from
  user-controlled sources / high · js/sql-injection, with the button to the alert's page (Q1: the default branch
  only).
- S4: Given the same, when the delivery's `action` is `reopened` (GitHub reopened a fixed alert because the finding is
  back) on the default branch, then the same message is sent.
- S5: Given the switch "Secret scanning alert" is on, when GitHub delivers `secret_scanning_alert` `created` for alert 3
  in `octo/shop` whose secret type is `github_personal_access_token` with the display name "GitHub Personal Access
  Token", then Telegram shows **Secret scanning alert** · octo/shop #3 / GitHub Personal Access Token /
  github_personal_access_token, with the button to the alert's page — and nothing of the secret itself.
- S6: Given the same, when the delivery's `action` is `reopened` (someone reopened a resolved alert), then the same
  message is sent.
- S11: Given the switch "Secret scanning alert" is on, when a secret pushed to the branch of a draft pull request, or
  written into a draft pull request's title, description or comment, makes GitHub deliver `secret_scanning_alert`
  `created`, then the message of S5 is sent like for any other secret: a pushed secret is exposed whether or not the
  pull request is a draft, and the delivery names no branch or pull request to filter on (Q10). Such an alert is the
  second named exception to the guarantee "a draft pull request triggers no notification", beside the CI failure
  marked _draft status unknown_.
- S7: Given the notification language is German, when any delivery of S1 to S6 arrives, then the titles read
  **Dependabot-Warnung**, **Code-Scanning-Warnung** and **Secret-Scanning-Warnung** (the labels of the switches on the
  German settings page), the button reads "Auf GitHub öffnen", and lines 2 and 3 are the same as in English (GitHub's
  own words, as with branch names and commit lines).
- S8: Given the switch of the case is off, when a delivery of S1 to S6 arrives, then nothing is sent and the request's
  log entry has the decision `disabled`.
- S9: Given any switch state, when a delivery of one of the three events arrives with another `action` — for
  `dependabot_alert` `dismissed`, `fixed`, `auto_dismissed`, `auto_reopened`, `reintroduced` or an assignment change;
  for `code_scanning_alert` `fixed`, `closed_by_user`, `reopened_by_user` or an assignment change; for
  `secret_scanning_alert` `resolved`, `validated`, `publicly_leaked`, `assigned`, `unassigned` or `revoked`; or any
  action GitHub adds later — then nothing is sent and the decision is `no-match`. (For `code_scanning_alert`
  `appeared_in_branch` see S10.)
- S10: Given the switch "Code scanning alert" is on, when GitHub delivers `code_scanning_alert` `appeared_in_branch` with
  the default branch as `ref` (an alert first found on another branch reached the default branch, for example by a
  merge), then the message of S3 is sent: each code scanning alert is reported once, when it reaches the default
  branch (Q1).

## Errors and edge cases

- E1: A delivery whose identifying fields are missing or of another type — `alert` not an object, `alert.number` not a
  whole number from 1 to 2^53 − 1, `alert.html_url` or `repository.full_name` not a string — sends nothing
  (`no-match`), as the pull request and CI rules do on an unexpected shape.
- E2: A delivery whose payload does not have the shape of its event header — for example a `code_scanning_alert`
  payload sent with the header `dependabot_alert` — sends nothing: a Dependabot alert needs `alert.security_advisory`
  as an object, a code scanning alert `alert.rule` as an object and `ref` and `repository.default_branch` as strings, a
  secret scanning alert `alert.secret_type` as a string. (The signature does not cover the event header,
  `notifications.md`, *Limits and errors*.)
- E3: A field shown in line 2 or 3 (the fields are named in *Fields shown*, below) is missing, `null`, not a string or
  blank:
  the line keeps what is there and an empty line is left out — a Dependabot alert without a severity shows the package alone in line 3, one without a package the
  severity alone, one without a summary has no line 2; a code scanning alert whose rule has no security severity (a
  quality rule) shows the rule's `severity` (`error`, `warning`, `note`) instead, and without either the rule id
  alone; a secret scanning alert without a display name has no line 2. The alert is still reported.
- E4: A severity value Seluna does not know (GitHub adds one) is shown as GitHub sent it; nothing is dropped for it.
- E5: A secret scanning delivery whose payload carries the secret or a part of it — in `alert.secret` or in any field
  Seluna does not show (`resolution_comment`, a location field) — produces exactly what the same delivery produces
  without it: the stored outbox text, the button URL and the log fields are byte-identical, and the secret appears in
  none of them as a substring; the same holds when every text field of the delivery outside `action` and the five fields
  the secret scanning rule reads holds the secret. (Single characters of the secret may of course occur in the title or the type name;
  what is excluded is the secret or any run of it taken from the payload.)
- E6: An advisory summary, rule description, package name or custom secret pattern name holding `<`, `>`, `&`, line
  breaks, control or direction characters, or more than 256 characters is shown cleaned, escaped and cut with `…` like
  every other line (`notifications.md`, *Message format*); the layout keeps its three lines.
- E7: Many alerts at once — Dependabot alerts switched on for a repository with 40 vulnerable dependencies, code
  scanning set up for the first time on a repository with many existing findings on its default branch, one new
  advisory hitting every repository of the installation — give one message per alert, without grouping; a Telegram
  rate limit is handled by the existing sending rules (one wait after a 429, otherwise the row stays pending).
- E8: The same delivery received twice gives one message (the existing deduplication by `X-GitHub-Delivery`).
- E9: A `code_scanning_alert` `created` or `reopened` whose `ref` is not the default branch — a pull request ref
  (`refs/pull/<n>/merge`), another branch, a tag, an empty `ref` — sends nothing. Pull request refs include those of
  draft pull requests, so the guarantee "a draft pull request triggers no notification" stays without a new exception.
- E10: A `code_scanning_alert` `appeared_in_branch` whose `ref` is not the default branch sends nothing (Q1).
- E11: The alert's `state` and the `sender` are not read: a `created` delivery is reported whoever caused it and
  whatever state the alert has meanwhile reached (a delivery that arrives late after a quick dismissal is still
  reported).
- E12: A secret scanning alert carries no branch, ref or pull request of its own (where the secret was found is listed
  behind `alert.locations_url`, which Seluna does not call): it cannot be told whether the secret came from a draft
  pull request (S11, Q10).

### Fields shown

The fields each line is read from; where GitHub's documentation names a value in two places, the first is read and the
second is the fallback when the first is missing, `null`, not a string or blank (empty or only spaces). The plan checks every one against the real
deliveries (Q9) and writes the confirmed list into the area document; a field the deliveries lack changes this list
in the plan, named in its result.

| Event | Line 2 | Line 3 |
| ----- | ------ | ------ |
| `dependabot_alert` | `alert.security_advisory.summary` | severity `alert.security_advisory.severity` (fallback `alert.security_vulnerability.severity`), `·`, package `alert.dependency.package.name` (fallback `alert.security_vulnerability.package.name`) |
| `code_scanning_alert` | `alert.rule.description` | severity `alert.rule.security_severity_level` (fallback `alert.rule.severity`; the documentation does not promise the first in webhooks, so the fallback may be the usual case), `·`, rule `alert.rule.id` |
| `secret_scanning_alert` | `alert.secret_type_display_name` | `alert.secret_type` |

Line 1: `repository.full_name` and `alert.number`; the button: `alert.html_url`. No other field is shown.

## Non-functional requirements

- Security and privacy: no message, outbox row or log entry holds a secret found by secret scanning or any part of it;
  the three rules read only the fields named in the scenarios and edge cases. Logs stay as they are: delivery id,
  event, action, repository and decision, never an alert text.
- Limits: the existing text limits and cleaning of the message format apply (title 64, repository 140, line 2 and
  line 3 256 code points).
- Compatibility: no new GitHub App permission or event — the manifest has requested read access to Dependabot, code
  scanning and secret scanning alerts and subscribed to the three events since 0.2.0, so apps created earlier report
  alerts after the update without a change on GitHub. No new setting, no migration: the three switches exist (default
  on) and only take effect now.
- Time: the rules call nothing (no GitHub API request), so a security alert delivery is answered as fast as a pull
  request delivery.
- Availability of alerts depends on GitHub: code scanning and secret scanning on private repositories need GitHub's
  paid security products; where GitHub sends no event, Seluna sends nothing.

## Acceptance criteria

- [ ] AC1: `dependabot_alert` `created` and `reopened` each produce one notification with the title "Dependabot
  alert", the repository, the alert number, the advisory summary as line 2, `severity · package` as line 3 and the
  alert's `html_url` as the button (S1, S2).
- [ ] AC2: `code_scanning_alert` `created` and `reopened` on the default branch each produce one notification with the
  title "Code scanning alert", the alert number, the rule description as line 2, `security severity · rule id` as line
  3 and the alert's `html_url` (S3, S4).
- [ ] AC3: `secret_scanning_alert` `created` and `reopened` each produce one notification with the title "Secret
  scanning alert", the alert number, the secret type's display name as line 2, the secret type as line 3 and the
  alert's `html_url` (S5, S6).
- [ ] AC4: with the notification language German the titles are "Dependabot-Warnung", "Code-Scanning-Warnung" and
  "Secret-Scanning-Warnung", lines 2 and 3 unchanged; the English and German tables have the same keys (S7).
- [ ] AC5: for each event, a reported action with the switch off produces no row and the decision `disabled` (S8).
- [ ] AC6: `dependabot_alert` `dismissed` and `fixed`, `code_scanning_alert` `fixed` and `closed_by_user`, and
  `secret_scanning_alert` `resolved` each produce no notification (decision `no-match`), as does every action not
  named in AC1 to AC3 and AC9 (S9).
- [ ] AC7: for a secret scanning delivery with a distinctive random 40-character secret placed in `alert.secret`,
  `alert.resolution_comment` and a location field, the stored outbox text, the button URL and the log fields are
  byte-identical to those of the same delivery without it, and the secret is a substring of none of them; and the
  notification of the real `created` delivery stays the same when every string outside `action`, `alert.number`,
  `alert.html_url`, `alert.secret_type`, `alert.secret_type_display_name` and `repository.full_name` is replaced by the
  secret (E5).
- [ ] AC8: a delivery with a missing or mistyped identifying field, or with the payload shape of another event than its
  header, produces no notification (E1, E2).
- [ ] AC9: a `code_scanning_alert` `created`, `reopened` or `appeared_in_branch` reports only when
  `ref` is `refs/heads/<repository.default_branch>`; any other `ref` produces nothing (S10, E9, E10).
- [ ] AC12: a secret scanning alert whose secret came from a draft pull request is reported like any other: the rule
  reads no ref, branch or pull request field, so a delivery that carries one gives the same notification (S11, E12).
- [ ] AC10: a missing optional field shortens its line as E3 describes (security severity falls back to the rule's
  `severity`), an unknown severity is shown as sent, and the alert is still reported (E3, E4).
- [ ] AC11: an advisory summary with `<`, `&` and a line break is rendered escaped on one line (E6).

## Out of scope

- E7: grouping or rate-limiting many alerts into one message; the existing sending rules handle the volume.
- E8: deduplication is the existing processing of `X-GitHub-Delivery` and is not changed.
- E11: filtering by sender or by the alert's current state.
- Reporting the Dependabot actions `reintroduced` and `auto_reopened` and the code scanning action `reopened_by_user`:
  the issue reports `created` and `reopened` only and says "all other actions are not reported" (Q4); the Product
  Manager's answer to Q1 adds only code scanning's `appeared_in_branch` into the default branch.
- Code scanning alerts found only in a pull request or on another branch than the default branch (Q1, E9, E10);
  they are reported when they reach the default branch (S10).
- A separate title or marking for a reopened alert (Q8).
- Showing where a secret or finding is (file, line, commit): the payloads either lack it or it is attacker-chosen text;
  the button leads to the alert, where GitHub shows it.
- Repository- or organization-level filters (only some repositories, only some severities).

## Open questions

- Q1: Which code scanning deliveries count as a new alert — also those found in a pull request or on another branch?
  GitHub's documentation describes a top-level `ref` on every `code_scanning_alert` delivery and alerts that exist
  only on a pull request's merge ref; an alert first found in a pull request reaches the default branch later as
  `appeared_in_branch`, not as `created`. Reporting every `created` would let a draft pull request trigger a message,
  against the guarantee in `.squad/project.md`. Options: (a) every `created`/`reopened`, whatever the ref — a second
  exception to the draft guarantee; (b) `created`/`reopened` only on a ref that is not a pull request — guarantee
  kept, but an alert introduced through a pull request is never reported; (c) only the default branch: `created`/
  `reopened` on it plus `appeared_in_branch` into it — each alert reported once when it reaches the default branch,
  guarantee kept, but one action beyond the issue's list. Answered: (c), by the Product Manager (2026-10-20) — code
  scanning is reported only on the default branch: `created`/`reopened` with `ref` `refs/heads/<default branch>` and
  `appeared_in_branch` into it (S3, S4, S10, E9, E10, AC2, AC9). This extends the issue's action list by
  `appeared_in_branch` for code scanning and keeps the draft guarantee without a new exception.
- Q2: Does the Dependabot title itself carry the severity (the issue's table says "Dependabot alert (with
  severity)")? Answered: no — Lead decision. The issue's line-3 rule and issue #12 put the severity in line 3 for
  Dependabot and code scanning alike; repeating it in the title would show it twice and make the Dependabot title the
  only one that varies. The title is the switch label "Dependabot alert". This deviates from the issue's table: the
  orchestrator reports it to the Product Manager with the fixture request (Q9); the plan cites the answer and the
  decision record holds it. Confirmed by the Product Manager (2026-10-20): the title stays "Dependabot alert", the
  severity is in line 3.
- Q3: What is line 2 ("alert name", issue #12) for each event? Answered: the advisory summary
  (`alert.security_advisory.summary`) for Dependabot, the rule description (`alert.rule.description`) for code
  scanning, the display name of the secret type (`alert.secret_type_display_name`) for secret scanning — each is what
  GitHub's alert page shows as the alert's name.
- Q4: Which actions are reported? Answered: from the issue — `created` and `reopened` only, "all other actions are not
  reported"; so Dependabot's `reintroduced` and `auto_reopened` and code scanning's `reopened_by_user` stay silent
  (the Product Manager was told so with the escalation of Q1). The one addition is code scanning's
  `appeared_in_branch` into the default branch (Q1).
- Q5: Are severities translated in German messages? Answered: no — shown as GitHub sends them, the same in both
  languages, like branch names and commit lines (`notifications.md`, *CI failure rules*: line 3 is the same in both
  languages); the GitHub page the button opens uses the same words.
- Q6: Does a secret scanning webhook payload carry the secret? Answered: it does not matter for the behavior — the rule
  shows only the display name and the type, and AC7 holds whether or not GitHub includes it. Whether real deliveries
  carry `alert.secret` is checked against the real deliveries the plan uses.
- Q7: Does the feature need a new permission, event, setting or migration? Answered: no — `APP_PERMISSIONS` and
  `APP_EVENTS` in `src/github/manifest.ts` already hold `vulnerability_alerts`, `security_events`,
  `secret_scanning_alerts` and the three events; `RULE_IDS` and `DEFAULT_SETTINGS` in `src/settings.ts` already hold
  the three switches (on), and the settings page shows them (`docs/areas/setup-wizard.md`).
- Q8: Should a reopened alert be titled differently? Answered: no — the issue gives one title per case for both
  actions.
- Q9: Which real deliveries are the rules built and tested from? Answered: none exists yet in `test/fixtures/` or on
  the issue; per `.squad/project.md` (*Fixtures from real deliveries*) the Product Manager supplies them before the
  plan (requested together with the escalation of Q1), and the plan names the variants they cover.

- Q10: Does a secret scanning alert fall under "a draft pull request triggers no notification"? Secret scanning scans
  pushes to every branch and pull request titles, descriptions and comments, so a secret in a draft pull request
  raises `created` too, and the delivery names no branch or pull request (E12). Answered: by the Product Manager
  (2026-10-20), option (a) — every secret scanning alert is reported whatever its source (S11, AC12), and the guarantee
  names it as its second exception: "A draft pull request triggers no notification; the exceptions are the CI failure
  marked draft status unknown (0027) and a secret scanning alert, which is reported whatever its source (0028)"
  (`.squad/project.md`, `docs/ARCHITECTURE.md` and decision record 0028, named in the plan).

## Area documents

- `docs/areas/notifications.md`: a new subsection *Security alert rules* under *Rules* (replacing "the rules for
  security alerts (#17) follow"): the table of the three switch ids with event, reported actions and English and
  German titles; line 2 and line 3 per event with their fallbacks; the fields each rule requires and the shape check
  against the event header; the code scanning default-branch rule (Q1: `created`/`reopened` on it, `appeared_in_branch`
  into it, nothing on any other ref); the statement that no part of a secret
  reaches a message, row or log and which fields the secret scanning rule reads; the variants not verified against
  real deliveries; that a secret scanning alert is reported whatever its source, a draft pull request included (the
  second exception to the draft guarantee). *Languages* gains the three titles. *Log entries* already names alert texts as never logged.
- No other area document changes: `setup-wizard.md` and `storage.md` already describe the switches, the permissions
  and the events. (`README.md`'s rule list moves the case to "available"; `CHANGELOG.md` gets an entry — named in the
  plan, not area documents.)

## Challenge

Spec challenge by the Devil's Advocate, one round.

1. Major — the draft guarantee is checked only for code scanning, not for secret scanning. Accepted in substance: it
   is true that a secret pushed to a draft pull request's branch, or written into its text, raises a
   `secret_scanning_alert` `created`, and that the delivery has no ref or pull request to filter on (E12 says so). Added
   S11, E12, AC12 and Q10. Whether such an alert lies outside the guarantee changes the wording of a guarantee in
   `.squad/project.md`, which the Lead may not do alone, so it was escalated (Q10); the Product Manager chose (a):
   report it, and reword the guarantee. Recommendation: report it — unlike a
   code scanning finding in unmerged work, a pushed secret is exposed the moment it is pushed and must be revoked
   whether or not the pull request is ever merged; staying silent would hide exactly the case the feature exists for.
2. Minor — name the exact payload field of every value. Accepted: new subsection *Fields shown* with each field and its
   fallback (Dependabot severity and package, code scanning security severity with `alert.rule.severity` as a fallback
   that may be the usual case); E3 refers to it, and the plan confirms the list against the real deliveries (Q9).
3. Minor — "no character of the secret" cannot be met literally. Accepted: E5 and AC7 reworded to byte-identical outbox
   text, button URL and log fields with and without the secret (in `alert.secret`, `alert.resolution_comment` and a
   location field), plus a distinctive random 40-character secret that is a substring of none of them.
4. Minor — Q2 deviates from the issue's title "Dependabot alert (with severity)". Accepted: Q2 keeps the Lead's
   decision and now states that the orchestrator reports the deviation to the Product Manager with the fixture
   request; the plan cites the answer and the decision record holds it. The Product Manager confirmed the title.
5. Note — E7 should name the burst when code scanning is first set up. Accepted: E7 names it.
