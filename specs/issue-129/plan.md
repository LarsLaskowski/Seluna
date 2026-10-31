# Plan: Saved time zones break when the runtime renames a zone

Source: Issue #129
Status: Draft
Tier: standard — the reading and the form validation of the time zone change behavior (an alias now resolves to its zone instead of UTC or a 400); no security control is created, changed or removed.
Security areas touched: Setup login (`src/setup/` — only `parseSettingsForm` in `src/setup/settings-form.ts`, which runs after the login and the CSRF check; neither changes)

## Problem / root cause

`isTimeZone` (`src/settings.ts:108-111`) accepts only an exact member of `timeZones()` (`Intl.supportedValuesOf("timeZone")` plus `UTC`, `src/settings.ts:98-106`). `settingsFromStored` (`src/settings.ts:145`) reads any other stored `time_zone` as `UTC`, and `parseSettingsForm` (`src/setup/settings-form.ts:62`) rejects it. The runtime lists CLDR names (`Asia/Calcutta`), so a stored IANA name (`Asia/Kolkata`) reads as UTC today, and a runtime whose list switched spelling would read every saved zone of the other spelling as UTC — quiet hours (`src/quiet-hours.ts:23`) and the digest schedule (`src/digest-schedule.ts:139`) then run on UTC, and the select (`src/setup/pages.ts:517`) marks no option as selected.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | `isTimeZone` accepts only exact members of `Intl.supportedValuesOf("timeZone")` (plus `UTC`) | `src/settings.ts:98-111` | confirmed |
| 2 | In the test runtime `Asia/Calcutta`, `Europe/Kiev`, `Asia/Saigon` are listed; `Asia/Kolkata`, `Europe/Kyiv`, `Asia/Ho_Chi_Minh` are not, and each of the latter resolves (`resolvedOptions().timeZone`) to the listed one | scratch `workerd serve` of `@cloudflare/vitest-plugin`'s workerd 1.20261019.1, a Worker printing list membership and `new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone`; Node 22 gives the same | confirmed |
| 3 | A stored `Asia/Kolkata` reads as UTC today | follows from 1, 2 and `src/settings.ts:145` | confirmed |
| 4 | Every listed name resolves to itself; the list has 418 names and no `UTC` (Seluna prepends it) | same scratch Worker: `listed-not-self-resolving=[]`, `count=418 UTC listed=false` | confirmed |
| 5 | Resolution in the test runtime: `UTC`, `Etc/UTC`, `GMT` → `UTC`; `europe/berlin` → `Europe/Berlin`; `US/Eastern` → `America/New_York`; `EST` → `America/Panama`; `+01:00` → `+01:00` and `Etc/GMT+5` → `Etc/GMT+5` (both unlisted); `""`, `" Europe/Berlin"` and `"Europe/Berlin\u0000"` throw `RangeError` | same scratch Worker | confirmed |
| 6 | What the deployed Workers runtime lists and resolves for these names | to verify: on a deployed instance, the same two calls for `Asia/Kolkata` and `Asia/Calcutta`; owner Product Manager, optional, after step 11 — the tests below hold whichever spelling a runtime lists | unverified |
| 7 | A future runtime keeps its list and its resolution consistent (an old name resolves to the newly listed one) | to verify: not measurable before such a runtime exists; owner none — residual risk recorded in decision 0042, the behavior then is today's (UTC) | unverified |
| 8 | Every consumer gets the zone through `settingsFromStored` (no raw `time_zone` read) | `grep` of `src/`: `TIME_ZONE_KEY` used only in `src/settings.ts`; `readNotificationSettings` (`src/store/settings.ts:43`) feeds delivery, digest and status | confirmed |
| 9 | The select marks an option selected only when `settings.timeZone` equals a listed name; the status page prints `settings.timeZone` | `src/setup/pages.ts:517`, `src/setup/pages.ts:436`, `src/setup/status.ts:355-368` | confirmed |
| 10 | Decision 0018 (which rejected accepting any `Intl.DateTimeFormat` value) is released | `git tag --contains fed8e4a` → v0.2.0 … v0.7.0 | confirmed |

Issue claims: the cause (1), the CLDR spelling (2) and the UTC fallback (3) are confirmed; the deployed-runtime values (6) stay unverified, as the issue says. Related defect found: a settings page loaded before a runtime update and posted after it would be refused with 400 for a zone that is still valid — fixed by the same change (AC2).

## Acceptance criteria

- [ ] AC1: `settingsFromStored` reads a stored `time_zone` that the runtime lists only under another name (`Asia/Kolkata` / `Asia/Calcutta`, `Europe/Kyiv` / `Europe/Kiev`, `Asia/Ho_Chi_Minh` / `Asia/Saigon` — whichever of each pair is unlisted) as the listed name of the pair, not `UTC`; the listed spelling reads as itself.
- [ ] AC2: `parseSettingsForm` accepts a posted alias of AC1's pairs and returns the listed name as `timeZone`, so `settingsToStored` stores the listed name.
- [ ] AC3: every name of `timeZones()` (`UTC` included) is accepted unchanged by `canonicalTimeZone`.
- [ ] AC4: a value the runtime rejects or resolves to no listed name stays invalid — `canonicalTimeZone` returns `undefined`, `settingsFromStored` reads `UTC`, `parseSettingsForm` returns `undefined`: `Mars/Base`, `+01:00`, `-05:00`, `Etc/GMT+5`, the empty text, a leading and a trailing space, and `Europe/Berlin` followed by a NUL (`\u0000`; the guard is the existing length assertion of 14, which fails when the backslash was lost).
- [ ] AC5: a letter-case variant (`europe/berlin`, `EUROPE/BERLIN`) is the listed name `Europe/Berlin` (changed from rejected).
- [ ] AC6: with the unlisted spelling of `Asia/Kolkata` / `Asia/Calcutta` stored and `meta` `last_delivery` `1792240440000`, `GET /setup` marks the listed spelling `selected` in the `time_zone` select and shows the last delivery as `2026-10-17 18:04 (<listed spelling>)`.

## Tests per criterion

Every test with a pair finds the listed spelling at run time: it asserts first that `timeZones()` lists exactly one of the two (message: "the runtime lists exactly one spelling"), then uses that one as expected and the other as input — so the tests hold in a runtime that lists either spelling.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `settingsFromStored reads either spelling of $pair as the listed one` (the three pairs) | `src/settings.test.ts` |
| AC1 | `canonicalTimeZone gives the listed name for both spellings of $pair` (the three pairs) | `src/settings.test.ts` |
| AC2 | `parseSettingsForm returns the listed name for a posted alias of $pair` (the three pairs) | `src/setup/settings-form.test.ts` |
| AC3 | `canonicalTimeZone returns every listed name unchanged` (replaces the `timeZones` test's "only names isTimeZone accepts" assertion and the `isTimeZone accepts $zone` rows) | `src/settings.test.ts` |
| AC4 | `canonicalTimeZone rejects $case` and `canonicalTimeZone rejects a name followed by a NUL character` (the moved `isTimeZone rejects` rows minus the two case rows, plus `Etc/GMT+5`) | `src/settings.test.ts` |
| AC4 | the existing row `the unknown time zone Mars/Base` stays; new row `the offset +01:00` in `parseSettingsForm rejects …` | `src/setup/settings-form.test.ts` |
| AC5 | `canonicalTimeZone gives Europe/Berlin for the letter-case variant $zone` | `src/settings.test.ts` |
| AC6 | `GET /setup selects and shows the listed name of a stored time zone alias` | `src/setup/handler.test.ts` |

## Approach

1. `src/settings.ts`: add `canonicalTimeZone(value)` — `const zones = timeZones()`; `value` when `zones.includes(value)`; otherwise, inside `try`, `new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone`, returned when `zones` includes it; `undefined` when the constructor throws (any exception) or the resolved name is not listed. The listed check comes first, so every option of the select round-trips without a formatter.
2. `settingsFromStored` (`src/settings.ts:145`): `timeZone` is `canonicalTimeZone(stored)` when the row exists, else (and when that is `undefined`) `DEFAULT_SETTINGS.timeZone`.
3. `parseSettingsForm` (`src/setup/settings-form.ts:55-79`): the single posted `time_zone` goes through `canonicalTimeZone`; `undefined` (absent, repeated or invalid) makes the form invalid; the returned settings carry the canonical name.
4. Remove `isTimeZone` once no caller is left (step 6). `src/setup/pages.ts`, `src/setup/status.ts`, `src/wall-clock.ts` are unchanged: they receive the canonical name.
5. The stored row is not rewritten on read; it becomes the listed name at the owner's next save.

No new user-visible output: the select and the status line keep their layout and show the listed name.

## Options considered

- Chosen: listed name as is, otherwise the runtime's resolved name when listed (decision 0042, option 1).
- Any value `Intl.DateTimeFormat` accepts, stored as given — keeps offsets and names the select cannot select.
- A fixed alias table — follows no runtime update.
- Matching by resolving every listed name (418 formatters per read) — only helps a runtime whose list and resolution disagree, which was not observed (fact 4).
- Aliases accepted but letter case kept strict — no case-sensitive check exists, and a variant is stored canonical anyway.
- Showing the stored text instead of the listed name on the status page — two names for one zone, and the select could still mark nothing.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/settings.ts` | add `canonicalTimeZone`, use it in `settingsFromStored`, remove `isTimeZone` |
| Worker | `src/setup/settings-form.ts` | validate and normalize `time_zone` with `canonicalTimeZone` |

## Signatures (for the Dev's skeleton)

```ts
/**
 * The listed name of the zone `value` names: `value` when `timeZones()` lists it, else the name the runtime
 * resolves it to (`Intl.DateTimeFormat#resolvedOptions().timeZone`) when that is listed, else `undefined`.
 */
export function canonicalTimeZone(value: string): string | undefined;
```

Skeleton: `canonicalTimeZone` added (stub returning `undefined`); `isTimeZone(value: string): boolean` stays until step 6, where the Dev removes it after the Tester moved its tests. Files the skeleton rewrites: `src/settings.ts` only.

## Test files

`src/settings.test.ts`, `src/setup/settings-form.test.ts`, `src/setup/handler.test.ts`.

Existing test code affected: in `src/settings.test.ts` the `isTimeZone` import, the `describe("isTimeZone")` block and the `timeZones` test's `isTimeZone` assertion move to `canonicalTimeZone` (Tester, step 5 — old and new signature coexist); the row `{ key: "time_zone", value: "europe/berlin", … timeZone: "UTC" }` of `settingsFromStored falls back per key` gets the value `Mars/Base` (Tester, step 5: AC5 changes its expectation). In `src/setup/settings-form.test.ts` the row `a time zone in lower case` leaves the invalid list (Tester, step 5: AC5). Every other test that stores or posts `Europe/Berlin`, `America/New_York` or `UTC` keeps its expectation (listed names, AC3).

Files no unit test can cover: none.

## Areas

- Setup wizard (`docs/areas/setup-wizard.md`): validation accepts an alias and stores the listed name; the status line shows the listed name.
- Storage (`docs/areas/storage.md`): the `time_zone` row's format and how an alias reads.

## Documentation updates

Sweep: `grep -n -i zone` over `docs/areas/`, `docs/ARCHITECTURE.md`, `README.md`. All by the Dev, once the code is green:

- `docs/areas/storage.md` line 65, `time_zone` row: a listed name or `UTC`; a value the runtime accepts as an alias or letter-case variant of a listed name reads as that listed name; anything else (an offset such as `+01:00`, an unknown name) reads as `UTC`. Link decision 0042.
- `docs/areas/setup-wizard.md` lines 200-201 (validation): "the time zone exactly a listed name" becomes a listed name or a name the runtime resolves to one, stored as the listed name; line 151 (status, _Last delivery_): `(<time zone>)` is the listed name of the configured zone.
- No change, still true: `docs/areas/setup-wizard.md` line 192 (the options are the listed names plus `UTC`), `docs/areas/notifications.md` line 518 and `docs/areas/scheduled-jobs.md` line 69 (an unusable zone reads as UTC), `README.md` line 77 (default `UTC`); `docs/ARCHITECTURE.md` mentions no time zone.

## Architecture check

No guarantee of `docs/ARCHITECTURE.md` or `.squad/project.md` is touched: settings are still read per request without a cache, a damaged row still costs only its own setting, and the status page still never fails on the zone (`formatDeliveryTime` keeps its UTC fallback).

## Security considerations

- [ ] No limits: the posted value is already bounded by the 1 MiB body limit; `Intl.DateTimeFormat` gets the raw string, its `RangeError` is caught.
- [ ] Exceptions reaching a user: none — a throwing constructor yields `undefined` (form: the existing _settings invalid_ notice; read: `UTC`). Only listed names are ever stored or rendered, and rendering stays escaped.

## Decision records

- `docs/decisions/0042-time-zone-aliases-read-as-the-listed-name.md` (Proposed) — amends the released 0018 (options 3 and 4).

## Out of scope / follow-ups

- Rewriting stored aliases to the listed name on read (a write on a read path; the next save does it).
