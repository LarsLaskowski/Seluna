# Plan: Saved time zones break when the runtime renames a zone

Source: Issue #129
Status: Draft
Tier: standard — the reading and the form validation of the time zone change behavior (an alias or an unlisted zone name now keeps its zone instead of UTC or a 400); no security control is created, changed or removed.
Security areas touched: Setup login (`src/setup/` — only `parseSettingsForm` in `src/setup/settings-form.ts` and the time zone select in `src/setup/pages.ts`, both behind the login and the CSRF check; neither changes)

## Problem / root cause

`isTimeZone` (`src/settings.ts:108-111`) accepts only an exact member of `timeZones()` (`Intl.supportedValuesOf("timeZone")` plus `UTC`, `src/settings.ts:98-106`). `settingsFromStored` (`src/settings.ts:145`) reads any other stored `time_zone` as `UTC`, `parseSettingsForm` (`src/setup/settings-form.ts:62`) rejects it, and the select (`src/setup/pages.ts:517`) offers only listed names. Since only listed names can be saved today, no existing instance holds an unlisted zone; today's visible effect is that a posted alias or letter-case variant (`Asia/Kolkata`, `europe/berlin`) is refused with 400. The real exposure is a runtime update that changes the list: every saved zone it no longer lists would read as UTC — quiet hours (`src/quiet-hours.ts:23`) and the digest schedule (`src/digest-schedule.ts:139`) then run on UTC, and the select marks nothing, so the next save posts its first option. The update ECMA-402 is expected to bring (fact 7) is exactly that case, and in it the runtime no longer resolves the old name to the new one.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | `isTimeZone` accepts only exact members of `Intl.supportedValuesOf("timeZone")` (plus `UTC`) | `src/settings.ts:98-111` | confirmed |
| 2 | In the test runtime `Asia/Calcutta`, `Europe/Kiev`, `Asia/Saigon` are listed; `Asia/Kolkata`, `Europe/Kyiv`, `Asia/Ho_Chi_Minh` are not, and each of the latter resolves (`resolvedOptions().timeZone`) to the listed one | scratch `workerd serve` of `@cloudflare/vitest-plugin`'s workerd 1.20261019.1, a Worker printing list membership and `new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone`; Node 22 gives the same | confirmed |
| 3 | No path stores an unlisted zone today; a posted alias or case variant is refused | `parseSettingsForm` (`src/setup/settings-form.ts:62`) is the only writer of `time_zone` (`settingsToStored`), after `isTimeZone` | confirmed |
| 4 | Every listed name resolves to itself; the list has 418 names, none starting with `+` or `-`, and no `UTC` (Seluna prepends it) | same scratch Worker: `listed-not-self-resolving=[]`, `count=418 UTC listed=false`, `listed +/-: []` | confirmed |
| 5 | Resolution in the test runtime: `UTC`, `Etc/UTC`, `GMT` → `UTC`; `europe/berlin` → `Europe/Berlin`; `US/Eastern` → `America/New_York`; `EST` → `America/Panama`; offsets `+01:00`, `+0100`, `+01` → `+01:00`, `-05:00` → `-05:00`, `\u221201:00` (minus sign) → `-01:00`; `Etc/GMT+5`, `Etc/GMT-14`, `SystemV/EST5`, `Factory` → themselves, unlisted; `""`, `" Europe/Berlin"`, `"Europe/Berlin\u0000"`, `+01:00:00`, `UTC+1`, `Etc/Unknown` throw `RangeError` | same scratch Worker, rerun in this revision | confirmed |
| 6 | Every offset form the runtime accepts resolves to `+HH:MM` or `-HH:MM` with an ASCII sign, and no zone name starts with `+` or `-`, so a resolved name that starts with `+` or `-` is an offset and every other accepted value is a named zone | facts 4 and 5; ECMA-402 accepts offset time zones only as `±HH`, `±HHMM`, `±HH:MM` and returns them as `±HH:MM`; `src/wall-clock.ts` already uses `/^[+-]/` for the same distinction | confirmed |
| 7 | ECMA-402 is expected to stop canonicalizing (TC39 proposal-canonical-tz, folded into Temporal): `resolvedOptions().timeZone` returns the case-normalized name given (`Asia/Calcutta` stays `Asia/Calcutta`) and the list moves to IANA primary names (`Asia/Kolkata`) — source: the Devil's Advocate, from the proposal; `typeof Temporal` is `"undefined"` in workerd 1.20261019.1 and Node 22, so no runtime here shows it | to verify: on the first workerd that ships it, `Asia/Calcutta` is unlisted and resolves to itself; owner Dev of that dependency update, when AC1's precondition assertion fails. The plan does not rest on it: AC7 covers that runtime | unverified |
| 8 | What the deployed Workers runtime lists and resolves for these names | to verify: on a deployed instance, the same two calls for `Asia/Kolkata` and `Asia/Calcutta`; owner Product Manager, optional, after step 11 — AC1 and AC7 together cover either answer | unverified |
| 9 | Every consumer gets the zone through `settingsFromStored` (no raw `time_zone` read), and `wallClockReader` and `formatDeliveryTime` take any named zone the runtime accepts | `grep` of `src/`: `TIME_ZONE_KEY` used only in `src/settings.ts`; `readNotificationSettings` (`src/store/settings.ts:43`) feeds delivery, digest and status; `src/wall-clock.ts` | confirmed |
| 10 | The select marks an option selected only when `settings.timeZone` equals a listed name; the status page prints `settings.timeZone` | `src/setup/pages.ts:517`, `src/setup/pages.ts:436`, `src/setup/status.ts:355-368` | confirmed |
| 11 | Decision 0018 (which rejected accepting any `Intl.DateTimeFormat` value, and says a zone the runtime stops listing reads as `UTC`) is released | `git tag --contains fed8e4a` → v0.2.0 … v0.7.0; `docs/decisions/0018-settings-and-status-page.md:34-35,99` | confirmed |

Issue claims: the cause (1) and the CLDR spelling (2) are confirmed; "a stored `Asia/Kolkata` is read as UTC today" holds for the read path but no instance can hold that value (3); the deployed-runtime values (8) stay unverified, as the issue says. Related defect found: a settings page loaded before a runtime update and posted after it would be refused with 400 for a zone that is still valid — fixed by the same change (AC2, AC7).

## Acceptance criteria

- [ ] AC1: in a runtime that resolves an alias to its listed name, `settingsFromStored` reads a stored `time_zone` that the runtime lists only under another name (`Asia/Kolkata` / `Asia/Calcutta`, `Europe/Kyiv` / `Europe/Kiev`, `Asia/Ho_Chi_Minh` / `Asia/Saigon` — whichever of each pair is unlisted) as the listed name of the pair, not `UTC`; the listed spelling reads as itself.
- [ ] AC2: `parseSettingsForm` accepts a posted alias of AC1's pairs and returns the listed name as `timeZone`, so `settingsToStored` stores the listed name.
- [ ] AC3: every name of `timeZones()` (`UTC` included) is accepted unchanged by `canonicalTimeZone`.
- [ ] AC4: a value the runtime rejects or resolves to an offset stays invalid — `canonicalTimeZone` returns `undefined`, `settingsFromStored` reads `UTC`, `parseSettingsForm` returns `undefined`: `Mars/Base`, `+01:00`, `+0100`, `-05:00`, `\u221201:00` (guard: the resolved `-01:00`; the test asserts the input's first code unit is `0x2212`, which fails when the backslash was lost), the empty text, a leading and a trailing space, and `Europe/Berlin` followed by a NUL (`\u0000`; the guard is the existing length assertion of 14, which fails when the backslash was lost).
- [ ] AC5: a letter-case variant (`europe/berlin`, `EUROPE/BERLIN`) is the listed name `Europe/Berlin` (changed from rejected).
- [ ] AC6: with the unlisted spelling of `Asia/Kolkata` / `Asia/Calcutta` stored and `meta` `last_delivery` `1792240440000`, `GET /setup` marks the listed spelling `selected` in the `time_zone` select, adds no other option, and shows the last delivery as `2026-10-17 18:04 (<listed spelling>)`.
- [ ] AC7: a named zone the runtime accepts but neither lists nor resolves to a listed name (`Etc/GMT+5`, `Etc/GMT-14` — the stand-in for a renamed zone in a runtime that stops canonicalizing, fact 7) is kept as the runtime's name of it: `canonicalTimeZone` returns it, `settingsFromStored` reads it, `parseSettingsForm` accepts it posted and returns it; with `Etc/GMT+5` stored and `last_delivery` `1792240440000`, `GET /setup` shows `2026-10-17 07:34 (Etc/GMT+5)` and the select's first option is `Etc/GMT+5`, `selected`, before `UTC`, with no listed option selected.

## Tests per criterion

Every test with a pair finds the listed spelling at run time: it asserts first that `timeZones()` lists exactly one of the two (message: "the runtime lists exactly one spelling") and that the runtime resolves the other to it (message: "the runtime resolves the alias to the listed name — if not, AC7's path applies"), then uses the listed one as expected and the other as input. AC7's tests assert first that the zone is unlisted and resolves to itself (message: "the runtime keeps the zone unlisted and by its own name").

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `settingsFromStored reads either spelling of $pair as the listed one` (the three pairs) | `src/settings.test.ts` |
| AC1 | `canonicalTimeZone gives the listed name for both spellings of $pair` (the three pairs) | `src/settings.test.ts` |
| AC2 | `parseSettingsForm returns the listed name for a posted alias of $pair` (the three pairs) | `src/setup/settings-form.test.ts` |
| AC3 | `canonicalTimeZone returns every listed name unchanged` (replaces the `timeZones` test's "only names isTimeZone accepts" assertion and the `isTimeZone accepts $zone` rows) | `src/settings.test.ts` |
| AC4 | `canonicalTimeZone rejects $case` (the moved `isTimeZone rejects` rows minus the two case rows, plus `+0100`), `canonicalTimeZone rejects the offset written with a minus sign` and `canonicalTimeZone rejects a name followed by a NUL character` | `src/settings.test.ts` |
| AC4 | the existing row `the unknown time zone Mars/Base` stays; new row `the offset +01:00` in `parseSettingsForm rejects …` | `src/setup/settings-form.test.ts` |
| AC5 | `canonicalTimeZone gives Europe/Berlin for the letter-case variant $zone` | `src/settings.test.ts` |
| AC6 | `GET /setup selects and shows the listed name of a stored time zone alias` | `src/setup/handler.test.ts` |
| AC7 | `canonicalTimeZone keeps the unlisted zone $zone` and `settingsFromStored reads the unlisted zone $zone as itself` | `src/settings.test.ts` |
| AC7 | `parseSettingsForm accepts the posted unlisted zone $zone` | `src/setup/settings-form.test.ts` |
| AC7 | `renderStartPage offers an unlisted configured time zone as the first, selected option` | `src/setup/pages.test.ts` |
| AC7 | `GET /setup selects and shows a stored unlisted time zone` | `src/setup/handler.test.ts` |

## Approach

1. `src/wall-clock.ts`: export the existing `OFFSET_FORM` (`/^[+-]/`) with a doc comment; its use there is unchanged.
2. `src/settings.ts`: add `canonicalTimeZone(value)` — `const zones = timeZones()`; `value` when `zones.includes(value)`; otherwise, inside `try`, `resolved = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone`; `undefined` when the constructor throws (any exception) or `OFFSET_FORM.test(resolved)`; else `resolved` (listed or not). The listed check comes first, so every option of the select round-trips without a formatter. The returned value is always a listed name or the runtime's own output, never the raw input.
3. `settingsFromStored` (`src/settings.ts:145`): `timeZone` is `canonicalTimeZone(stored)` when the row exists, else (and when that is `undefined`) `DEFAULT_SETTINGS.timeZone`.
4. `parseSettingsForm` (`src/setup/settings-form.ts:55-79`): the single posted `time_zone` goes through `canonicalTimeZone`; `undefined` (absent, repeated or invalid) makes the form invalid; the returned settings carry its result.
5. `settingsFormHtml` (`src/setup/pages.ts:517`): when `timeZones()` does not include `settings.timeZone`, one extra option `optionHtml(settings.timeZone, settings.timeZone, true)` comes first, before the listed options; otherwise the select is unchanged.
6. Remove `isTimeZone` once no caller is left (step 6). `src/setup/status.ts` and `src/wall-clock.ts`'s readers are unchanged: they receive the zone's name.
7. The stored row is not rewritten on read; it takes the result of `canonicalTimeZone` at the owner's next save.

New user-visible output: only the extra first option of step 5 (value and label the zone's name, `selected`, no other text). The status line keeps its layout.

## Options considered

- Chosen: listed name as is; otherwise the runtime's resolved name, unless it is an offset (decision 0042, option 1).
- Only listed resolved names (the first plan) — breaks in the runtime fact 7 expects: a saved `Asia/Calcutta` resolves to itself, unlisted, and reads as UTC.
- Identify equal zones with `Temporal.ZonedDateTime#equals` — `Temporal` is absent in the test runtime and Node 22, so the path is untestable here, and it needs a scan of the 418 listed names per read; it would also only pick a listed spelling, which the chosen option does not need.
- Comparing offsets of the two zones at sample instants (Temporal-less equality) — a guess: distinct zones share their current rules.
- Any value `Intl.DateTimeFormat` accepts, stored as given — keeps offsets and raw, unnormalized input.
- A fixed alias table — follows no runtime update.
- Aliases accepted but letter case kept strict — no case-sensitive check exists, and a variant is stored canonical anyway.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/settings.ts` | add `canonicalTimeZone`, use it in `settingsFromStored`, remove `isTimeZone` |
| Worker | `src/setup/settings-form.ts` | validate and normalize `time_zone` with `canonicalTimeZone` |
| Worker | `src/setup/pages.ts` | extra first option for an unlisted configured zone |
| Worker | `src/wall-clock.ts` | export `OFFSET_FORM` |

## Signatures (for the Dev's skeleton)

```ts
/**
 * The runtime's name of the zone `value` names: `value` when `timeZones()` lists it, else the name the runtime
 * resolves it to (`Intl.DateTimeFormat#resolvedOptions().timeZone`), listed or not; `undefined` when the runtime
 * rejects `value` or resolves it to a fixed offset.
 */
export function canonicalTimeZone(value: string): string | undefined;

/** A resolved time zone in this form (`+01:00`, `-05:00`) is a fixed offset, not a zone name. */
export const OFFSET_FORM: RegExp;
```

Skeleton: `canonicalTimeZone` added (stub returning `undefined`); `OFFSET_FORM` exported; `isTimeZone(value: string): boolean` stays until step 6, where the Dev removes it after the Tester moved its tests. Files the skeleton rewrites: `src/settings.ts`, `src/wall-clock.ts`.

## Test files

`src/settings.test.ts`, `src/setup/settings-form.test.ts`, `src/setup/pages.test.ts`, `src/setup/handler.test.ts`.

Existing test code affected: in `src/settings.test.ts` the `isTimeZone` import, the `describe("isTimeZone")` block and the `timeZones` test's `isTimeZone` assertion move to `canonicalTimeZone` (Tester, step 5 — old and new signature coexist); the row `{ key: "time_zone", value: "europe/berlin", … timeZone: "UTC" }` of `settingsFromStored falls back per key` gets the value `Mars/Base` (Tester, step 5: AC5 changes its expectation). In `src/setup/settings-form.test.ts` the row `a time zone in lower case` leaves the invalid list (Tester, step 5: AC5). Every other test that stores, posts or renders `Europe/Berlin`, `America/New_York` or `UTC` keeps its expectation (listed names, AC3; the select is unchanged for them); `bodyText` and `formsSignature` in `src/setup/pages.test.ts` see no extra option for them.

Files no unit test can cover: none.

## Areas

- Setup wizard (`docs/areas/setup-wizard.md`): validation accepts an alias or an unlisted zone name; the select shows an unlisted configured zone; the status line shows the zone's name.
- Storage (`docs/areas/storage.md`): the `time_zone` row's format and how an alias reads.

## Documentation updates

Sweep: `grep -n -i zone` over `docs/areas/`, `docs/ARCHITECTURE.md`, `README.md`. All by the Dev, once the code is green:

- `docs/areas/storage.md` line 65, `time_zone` row: a listed name, `UTC`, or another zone name the runtime accepts, stored as the runtime's name of it; an alias or letter-case variant reads as the name the runtime resolves it to; an offset such as `+01:00` or a name the runtime rejects reads as `UTC`. Link decision 0042.
- `docs/areas/setup-wizard.md` line 192 (the options): the listed names plus `UTC`, preceded by the configured zone as a selected option when the runtime does not list it; lines 200-201 (validation): "the time zone exactly a listed name" becomes a zone name the runtime accepts (no offset), stored as the runtime's name of it; line 151 (status, _Last delivery_): `(<time zone>)` is that name.
- No change, still true: `docs/areas/notifications.md` line 518 and `docs/areas/scheduled-jobs.md` line 69 (an unusable zone reads as UTC), `README.md` line 77 (default `UTC`); `docs/ARCHITECTURE.md` mentions no time zone.

## Architecture check

No guarantee of `docs/ARCHITECTURE.md` or `.squad/project.md` is touched: settings are still read per request without a cache, a damaged row still costs only its own setting, and the status page still never fails on the zone (`formatDeliveryTime` keeps its UTC fallback).

## Security considerations

- [ ] No limits: the posted value is already bounded by the 1 MiB body limit; `Intl.DateTimeFormat` gets the raw string, its `RangeError` is caught. What is stored is a listed name or the runtime's resolved name, never the raw input, so its length is bounded by the runtime's zone names.
- [ ] Exceptions reaching a user: none — a throwing constructor yields `undefined` (form: the existing _settings invalid_ notice; read: `UTC`). The extra select option and the status line render the name through `escapeHtml`.

## Decision records

- `docs/decisions/0042-time-zone-aliases-read-as-the-listed-name.md` (Proposed) — amends the released 0018 (options 3 and 4, and its consequence that a zone the runtime stops listing reads as `UTC`).

## Challenge

1. MAJOR — the fix relies on the runtime canonicalizing. Accepted. Measured in workerd 1.20261019.1 and Node 22: a resolved offset always starts with `+` or `-` (also for `\u221201:00` input) and no zone name does (facts 4–6), so an unlisted named zone is distinguishable without Temporal; `Temporal` is absent in both, and Temporal-less equality is only an offset guess (both rejected under *Options considered*). `canonicalTimeZone` now keeps an unlisted named zone as the runtime's name of it (Approach 2), the select shows it as a first, selected option (Approach 5), and AC7 tests that path with `Etc/GMT+5` / `Etc/GMT-14`, which behave in every runtime as a renamed zone does in the runtime fact 7 expects. AC1's tests assert the canonicalizing precondition, so a runtime update that drops it fails with a message naming AC7's path instead of passing wrongly. Fact 7 and 0042 now name the expected ECMA-402 change. No escalation: the issue's *Expected* asks that the settings list and the status page show the saved zone even when the runtime lists its alias, which is this behavior.
2. MINOR — fact 3 overstated today's impact. Accepted: fact 3 and the problem paragraph now say no instance can hold an unlisted zone today; today's effect is the refused alias and case variant (AC2, AC5), the read path guards a runtime update.
3. MINOR — 0042's Supersedes omitted 0018's consequence. Accepted: the Supersedes line names it (`0018-settings-and-status-page.md:99`).

## Out of scope / follow-ups

- Rewriting stored aliases on read (a write on a read path; the next save does it).
- Folding two spellings of one zone into one select entry once `Temporal` ships in the runtime.
