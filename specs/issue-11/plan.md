# Plan: Wizard settings and status page

Source: Issue #11
Status: Draft
Tier: security — the change adds signed-in forms behind the setup login (CSRF, body reading), deletes and reads the
encrypted credentials and changes the key check's result (security areas *Setup login* and *Encrypted credentials*
in `.squad/project.md`).

## Problem / root cause

Feature. After #9 and #10 the signed-in start page `GET /setup` (`renderStartPage`, `src/setup/pages.ts:82`) shows
only "You are signed in", two step links and the sign-out form. The issue asks for:

1. **Settings** stored in D1 and changeable without a deployment: notification language (`en` default, `de`), IANA
   time zone, quiet hours (off by default; start and end), one switch per rule (8 rules, all on), update notice (on).
2. **Status**: running version, Telegram chat, GitHub App name with link, time of the last received delivery.
3. **Reset**: when the key check reports a changed `SELUNA_SECRET`, the wizard explains it and offers a reset that
   clears `secrets` and leads through setup again.
4. The same page is the entry point after setup.

Claims checked against the code and the other issues:

- *"the key check from #7"* — **confirmed**: `checkKey` and `readSecret` in `src/store/secrets.ts` report
  `changed`/`secret-changed` and `corrupt`; released decision 0007 already says the reset clears `secrets`, the key
  check value **and `token_cache`** and never restores old credentials (0007, *Consequences*). The plan follows 0007,
  so `token_cache` is cleared too (the issue names only `secrets`).
- *"8 rules"* — **confirmed** by #13 (3 pull request cases), #16 (2 CI cases), #17 (3 alert cases); the rule ids
  below follow their tables.
- *"The list of installations is added in #15"* — **confirmed** (#15 scope and AC).
- *"The same page is the entry point after setup"* — **confirmed** as far as routing goes: a successful login answers
  303 to `/setup` (`signIn`, `src/setup/handler.ts:211`); this change makes that page the status page.
- *"time of the last received delivery"* — **nothing writes it today**: `POST /webhook` verifies the signature and
  answers 202 without touching D1 (`verifyWebhook`, `src/router.ts:52`). #12 owns "Update `meta` with the time of the
  last delivery". This change reads `meta` `last_delivery` and defines its format as the contract for #12; the line
  says _none received yet_ until then (decision 0018, option 10).
- *"GitHub App name with link"* — **nothing stores a name or slug today**: `storeApp` (`src/setup/github-step.ts:206`)
  stores App ID, key and webhook secret only; the slug is shown once on the created page and dropped. This change keeps
  the slug (already allow-listed by `src/github/conversion.ts:81`) in `meta`, tied to its App ID.
- *"A changed `SELUNA_SECRET` leads to … an error page"* (AC 2) — partly: after the change the owner signs in with the
  new secret (sessions end, decision 0015), the start page renders fine, and the GitHub step shows the _reset needed_
  text that tells the owner to delete D1 rows in the Cloudflare dashboard by hand (`githubResetNeeded`,
  `src/setup/texts.ts`). There is no wizard reset; this change adds it.

**Related defect found on the way:** `checkKey` (`src/store/secrets.ts:94`) returns `unset` when the key check row is
absent although `secrets` holds a credential. The storage area's table calls that state **corrupt**, and every write
then fails (`INSERT_KEY_CHECK` is guarded by `NOT EXISTS (SELECT 1 FROM secrets)`, so `writeEntries` ends in
`corrupt`). `startGitHubApp` and `finishGitHubApp` use `checkKey` to refuse early, so in that state the wizard lets the
owner create an app on GitHub and only then answers _store failed_, leaving an orphaned app. Fixed here (AC 7):
`checkKey` returns `corrupt` in that state, and the reset clears it.

## Acceptance criteria

Test names are the Tester's step-5 tests; files per *Test files*.

- [ ] **AC1 — Settings model and defaults.** With no `settings` rows, `readNotificationSettings` returns language
  `en`, time zone `UTC`, quiet hours off (`undefined`), all eight rules `true`, update notice `true`. Each stored row
  that is absent or invalid reads as its own default without affecting the others.
  - `src/settings.test.ts`: "settingsFromStored returns the defaults for an empty map";
    "settingsFromStored reads each stored value" ; "settingsFromStored falls back per key for an invalid value"
    (table: `notification_language` `fr`, `time_zone` `europe/berlin`, `quiet_hours` `25:00-07:00`, `quiet_hours`
    `07:00-07:00`, `rule_dependabot_alert` `yes`, `update_notice` `` → each only that key at its default).
  - `src/store/settings.test.ts`: "readNotificationSettings returns the defaults on an empty table".
- [ ] **AC2 — Changed settings take effect without a new deployment** (issue AC 1). Settings are written in one
  batch and every read goes to D1; nothing caches them across calls.
  - `src/store/settings.test.ts`: "writeNotificationSettings then readNotificationSettings round-trips every field";
    "readNotificationSettings returns a value written after an earlier read".
  - `src/setup/handler.test.ts`: "POST /setup/settings stores the settings and answers 303 to /setup"
    (afterwards `readNotificationSettings(env.DB)` equals the submitted values, same `deps.env`);
    "GET /setup shows the saved settings as selected" (after a write: `<option value="de" selected>`, the time zone
    option `selected`, the rule checkbox without `checked` for a disabled rule, the quiet hours times as `value`).
- [ ] **AC3 — Settings form validation.** `parseSettingsForm` returns settings only when: `notification_language`
  occurs once and is `en` or `de`; `time_zone` occurs once and `isTimeZone`; each checkbox field (`quiet_hours`,
  `update_notice`, the eight `rule_<id>`) is absent (off) or occurs once with the value `on`; with `quiet_hours` on,
  `quiet_start` and `quiet_end` occur once each, match `^([01]\d|2[0-3]):[0-5]\d$` and differ; with it off they are
  ignored. Anything else returns `undefined`. `POST /setup/settings` then answers **400** with the status page and the
  _settings invalid_ notice and stores nothing.
  - `src/setup/settings-form.test.ts`: "parseSettingsForm accepts a complete form"; "parseSettingsForm reads an absent
    checkbox as off"; "parseSettingsForm ignores the times while quiet hours are off"; "parseSettingsForm rejects
    $case" (table: missing language, `language=fr`, repeated `time_zone`, `time_zone=Mars/Base`, checkbox value `1`,
    repeated `rule_ci_failed_pull_request=on`, quiet on with `quiet_start` missing, `24:00`, `7:00`, `07:00:00`,
    start equal to end).
  - `src/setup/handler.test.ts`: "POST /setup/settings answers 400 with the settings invalid notice and stores nothing".
- [ ] **AC4 — Time zone guard.** `isTimeZone(value)` is true exactly for a member of `timeZones()`, which is the list
  of `Intl.supportedValuesOf("timeZone")` with `UTC` added when missing (and `["UTC"]` alone when that function is
  absent or throws). Forms the runtime's `Intl.DateTimeFormat` would accept but the guard must reject: letter-case
  variants, UTC offsets, surrounding whitespace, a trailing NUL, the empty string.
  - `src/settings.test.ts`: "isTimeZone accepts $zone" (`UTC`, `Europe/Berlin`, `America/New_York`);
    "isTimeZone rejects $case" (`europe/berlin`, `EUROPE/BERLIN`, `+01:00`, `-05:00`, ` Europe/Berlin`,
    `Europe/Berlin `, `Europe/Berlin` followed by U+0000, ``, `Mars/Base`). The NUL case is the TypeScript literal
    `"Europe/Berlin\\u0000"` written in the test source with **one** backslash (doubled here only for this file), so
    the string holds a real NUL; the test first asserts that the input's length is 14, which fails if the backslash
    was lost (the text would then be 19 characters and rejected for the wrong reason); "timeZones lists UTC once and only names isTimeZone accepts".
  Aliases (`US/Pacific`, `Asia/Calcutta`) are accepted or rejected exactly as the runtime's list says; no test pins
  them, since the list follows the runtime version (see *Runtime behavior (measured)*).
- [ ] **AC5 — Status page.** `GET /setup` (signed in) answers **200** with, in this order: the heading and the
  status section — _Version:_ and `deps.version`; _Telegram chat:_ with the saved chat id, or _set by the Worker
  secret TELEGRAM_CHAT_ID_ when that secret is a non-empty string (no value shown), or _none saved yet_; _GitHub App:_
  with a link `https://github.com/apps/<slug>` whose text is the slug and `(App ID <id>)` when the `meta` slug row
  belongs to the saved App ID, the App ID alone when it does not, the _Worker secrets_ / _partial Worker secrets_
  text when those are set (no value shown), _none saved yet_ when nothing is stored, or _cannot be read_ when the
  saved App ID cannot be read with the current `SELUNA_SECRET` (a reset can also be needed while the App ID is still
  shown, when another saved credential does not decrypt); _Last delivery from GitHub:_ with `formatDeliveryTime(last, settings.timeZone)` or _none received yet_ —
  then the reset section when needed (AC6), the step links, the settings form and the sign-out form. A D1 failure
  answers **503** with the notice-only start page and _unavailable_.
  - `src/setup/status.test.ts`: "statusView reports $case" (table: empty database; saved chat; `TELEGRAM_CHAT_ID`
    set; saved app with matching slug; slug of another App ID; all three GitHub Worker secrets; one GitHub Worker
    secret; key check under another secret → `resetNeeded` true; key matches, `github_private_key` altered → app
    `saved` with its App ID and `resetNeeded` true; `last_delivery` stored);
    "formatDeliveryTime writes $case" (`2026-10-17T12:34:00Z` in `Europe/Berlin` → `2026-10-17 14:34 (Europe/Berlin)`;
    `2026-10-24T22:00:00Z` in `Europe/Berlin` → `2026-10-25 00:00 (Europe/Berlin)`; `2026-10-25T01:30:00Z` in
    `Europe/Berlin` → `2026-10-25 02:30 (Europe/Berlin)` (after the change to CET); `2026-10-17T12:34:00Z` in `UTC` →
    `2026-10-17 12:34 (UTC)`); "formatDeliveryTime falls back to UTC when the runtime rejects the zone"
    (`2026-10-17T12:34:00Z` in `Mars/Base` → `2026-10-17 12:34 (UTC)`, no exception); "formatDeliveryTime writes the
    latest valid time without throwing" (`new Date(8640000000000000)` in `UTC` and in `Europe/Berlin`: returns a
    string ending in `)`; the digits of a six-digit year are not pinned).
  - `src/store/meta.test.ts`: "readLastDelivery returns $case" (absent → `undefined`; `1792240440000` → that time;
    `8640000000000000` → that time; `abc`, `-1`, `01`, `1e3`, `8640000000000001`, `9007199254740991`,
    `9007199254740993` → `undefined`; every returned `Date` has a finite `getTime()`); "readAppSlug returns the slug only for its App ID";
    "writeAppSlug replaces an earlier slug".
  - `src/setup/pages.test.ts`: "renderStartPage shows the status lines in $language"; "renderStartPage escapes and
    links the app slug"; "renderStartPage notice-only view carries the notice, the step links and the sign-out form".
  - `src/setup/handler.test.ts`: "GET /setup shows version, chat, app and last delivery"; "GET /setup answers 503
    with the unavailable notice when D1 fails".
- [ ] **AC6 — Reset after a changed `SELUNA_SECRET`** (issue AC 2). When `needsReset` is true — `checkKey` is
  `changed` or `corrupt`, or a stored `secrets` row does not decrypt — `GET /setup` answers **200** (never an error
  status) with the reset section: the _reset heading_, the _reset text_ and a form `POST /setup/reset` with the
  session-bound CSRF field and the _reset button_. `POST /setup/reset`: body (413/400) → CSRF (**403**, notice-only
  start page, _form expired_) → `resetCredentials`: `reset` deletes every `secrets` and `token_cache` row and the
  `meta` row `key_check` in one batch and answers **303** `Location: /setup/github`; `not-needed` answers **409** with
  the status page and _reset not needed_ and deletes nothing; a D1 failure **503** _unavailable_. The settings, the
  Telegram chat, `login_attempts` and `last_delivery` stay. Afterwards `GET /setup/github` shows the form.
  - `src/store/secrets.test.ts`: "needsReset reports $case" (empty → false; matching key → false; key check under
    another secret → true; key check absent with a `secrets` row → true; key matches but `github_private_key` altered →
    true); "resetCredentials deletes secrets, token_cache and key_check and keeps settings and other meta rows"
    (seeds all three `secrets` rows, at least one `token_cache` row, `key_check` under another secret, a `settings`
    row and another `meta` row; asserts `secrets`, `token_cache` and `key_check` are all empty afterwards — this is
    the test that fails on the old order, where the shared guard made the `token_cache` and `key_check` deletes
    no-ops — and the `settings` and other `meta` rows remain);
    "resetCredentials returns not-needed and deletes nothing when the key matches"; "resetCredentials deletes nothing
    when the key check changed after its check" (a D1 wrapper whose `batch` first replaces `key_check` and then
    delegates — afterwards the `secrets` rows, the `token_cache` rows and the replaced `key_check` all remain);
    "resetCredentials deletes nothing when a credential was rewritten
    after its check" (key matches, `github_private_key` altered so `needsReset` is true; a D1 wrapper whose `batch`
    first runs `writeSecrets` with the same key — which keeps the `key_check` row — and then delegates; afterwards
    all three `secrets` rows remain and `readSecret` of each is `ok`, and the test asserts explicitly that the
    `token_cache` rows and the `key_check` row remain);
    "resetCredentials deletes when the stored key check value is not text" (a `key_check` row holding a blob, inserted with a
    `Uint8Array` bind: the reset deletes it and the `secrets` rows).
  - `src/setup/handler.test.ts`: "GET /setup shows the reset form when the key check was sealed under another
    SELUNA_SECRET"; "POST /setup/reset clears the credentials and answers 303 to /setup/github";
    "GET /setup/github shows the form after a reset"; "POST /setup/reset answers 409 and deletes nothing when no reset
    is needed"; "POST /setup/reset answers 403 with a token of another session".
- [ ] **AC7 — `checkKey` reports corrupt for a missing key check beside stored credentials** (related defect).
  - `src/store/secrets.test.ts`: "checkKey reports corrupt when the key check is absent but secrets holds a row".
  - `src/setup/handler.test.ts`: "POST /setup/github answers 409 reset needed when secrets holds a row but no key
    check" (GitHub not called).
- [ ] **AC8 — The created app's slug is kept.** After the three credentials are stored, `finishGitHubApp` writes
  `meta` `github_app_slug` = `<appId>:<slug>` when the answer has an allow-listed slug; a failure of that write still
  answers _created_; without a slug nothing is written.
  - `src/setup/github-step.test.ts`: "finishGitHubApp keeps the slug with the App ID"; "finishGitHubApp answers
    created when writing the slug fails" (a D1 wrapper failing only the slug statement).
- [ ] **AC9 — Routes and protection.** `POST /setup/settings` and `POST /setup/reset` exist only with a session
  (without one: the login page, nothing stored or deleted); `GET` on either path answers **404** signed in; both read
  the body with the 1 MiB limit; both need the session-bound CSRF token (a login-form token, a token of another
  session, a missing or repeated `csrf` field → **403**).
  - `src/setup/handler.test.ts`: "POST $path without a session answers the login page and changes nothing" (both
    paths); "GET $path answers 404 when signed in"; "POST $path rejects $token with 403" (table);
    "POST $path answers 413 for a body over 1 MiB".
- [ ] **AC10 — Texts.** Every new text exists in English and German; the English texts are exactly those under
  *Texts* below.
  - `src/setup/texts.test.ts`: the existing exact-text test extended with the new keys (Tester adapts it, including
    the changed `githubResetNeeded`).
  - `src/setup/pages.test.ts`: "renderGitHubPage reset-needed view links to the start page in $language" (the
    _reset needed_ text followed by `<a href="/setup">` with _to the start page_); the existing
    "its own links only" table entry `github reset-needed` lists `/setup` among its links (Lead decision, below).

## Approach

1. **Model** (`src/settings.ts`, pure): rule ids, defaults, the stored keys and formats, `isTimeZone`, `timeZones`,
   `isClockTime`, conversion from and to stored rows.
2. **Storage**: `src/store/settings.ts` reads all `settings` rows in one query (`SELECT key, value FROM settings`) and
   writes the twelve setting rows in one `db.batch` of upserts (the existing upsert statement). New
   `src/store/meta.ts` for `last_delivery` (read) and `github_app_slug` (read/write). `src/store/secrets.ts`:
   `checkKey` reads the key check and `EXISTS (SELECT 1 FROM secrets)` in one batch; new `needsReset` and
   `resetCredentials`.
3. **Reset guard.** `resetCredentials` reads, in one batch: the key check row as `SELECT value, quote(value) AS
   pinned FROM meta WHERE key = ?1`, every `secrets` row, and the secrets fingerprint `SELECT <fingerprint> AS
   fingerprint`, where `<fingerprint>` is `(SELECT group_concat(quote(key) || ':' || quote(iv), ',') FROM (SELECT
   key, iv FROM secrets ORDER BY key))`. It decides `needsReset` from the rows read, and when needed runs one batch
   of three deletes in exactly this order:
   (1) `DELETE FROM token_cache WHERE <guard>`;
   (2) `DELETE FROM secrets WHERE <guard>`;
   (3) `DELETE FROM meta WHERE key = 'key_check' AND (SELECT quote(value) FROM meta WHERE key = 'key_check') IS ?1
   AND NOT EXISTS (SELECT 1 FROM secrets)`,
   where `<guard>` is `(SELECT quote(value) FROM meta WHERE key = 'key_check') IS ?1 AND <fingerprint> IS ?2`, `?1`
   the `pinned` text read (`NULL` when the row was absent) and `?2` the fingerprint read (`NULL` for an empty table).
   Each statement evaluates its guard against the state the earlier statements of the batch left, so the shared
   guard can stand only on statements that run before `secrets` is emptied: `token_cache` first, then `secrets`.
   Statement (3) cannot reuse `<guard>` (after (2) the fingerprint is `NULL`, not `?2`) and instead pins the key
   check value and requires `secrets` to be empty. That is equivalent to the shared guard: the batch is one
   transaction and the reset is the only code that deletes `secrets` rows, so `secrets` is empty at (3) exactly when
   (2) deleted the rows the reset checked (guard held) or the table was empty at the read and still is; a concurrent
   write between the read and the batch changes the fingerprint, so (1) and (2) delete nothing, its rows remain, and
   `NOT EXISTS` blocks (3). Both pins are
   values SQLite computed, bound back as text, so the TypeScript side never rebuilds them; `quote()` makes a `NULL`,
   blob or number `key_check` or `iv` comparable as text, so the earlier `typeof` variant is gone. Every credential
   write draws a fresh random 12-byte IV (`encrypt`, `src/crypto.ts:94`), so any `writeSecret`/`writeSecrets`
   between the read and the delete — including one that keeps the matching `key_check` row — changes the
   fingerprint and the guarded batch deletes nothing. The fingerprint's order comes from the inner `ORDER BY` on
   the primary key; read and guard use the identical expression. The result is `reset` regardless of how many rows
   the guarded batch deleted (a concurrent reset already did it, or a concurrent write made the reset moot; the
   next `GET /setup` shows the true state).
4. **Wizard**: `src/setup/status.ts` builds the status view; `src/setup/settings-form.ts` parses the form;
   `src/setup/pages.ts` renders the start page from a view; `src/setup/handler.ts` adds the two POST routes and builds
   the start page from `statusView` (D1 failure → 503 notice-only). The 403 answers of sign-out, settings and reset
   render the notice-only start page (no D1), so a form-expired answer never fails on D1.
5. **GitHub step**: `storeApp` writes the slug after `writeSecrets` returned `ok`, in its own `try`, dropping the
   error. `githubResetNeeded` changes to point to the reset on the start page, with a link to `/setup`.
6. **Style**: `STYLE` gets `select` laid out like a text input and `input[type=checkbox]` laid out like the radio
   inputs; the CSP hash follows from `STYLE` as today.

### Stored formats (`settings` keys; anything else in a row reads as the default)

| Key | Value | Default |
| --- | ----- | ------- |
| `notification_language` | `en` or `de` | `en` |
| `time_zone` | a name `isTimeZone` accepts | `UTC` |
| `quiet_hours` | `off`, or `<start>-<end>` with two different `HH:MM` (24-hour, `^([01]\d|2[0-3]):[0-5]\d$`) | `off` |
| `rule_<id>` for each of `pull_request_opened`, `pull_request_ready_for_review`, `pull_request_review_requested`, `ci_failed_default_branch`, `ci_failed_pull_request`, `dependabot_alert`, `code_scanning_alert`, `secret_scanning_alert` | `on` or `off` | `on` |
| `update_notice` | `on` or `off` | `on` |

`meta` rows: `last_delivery` — decimal milliseconds since 1970-01-01 UTC matching `^(0|[1-9]\d{0,15})$` with a value
of at most `8640000000000000` (the largest time a JavaScript `Date` holds; written by #12); `github_app_slug` — `<appId>:<slug>`, `<appId>` the decimal App ID, `<slug>` matching
`^[a-z0-9-]{1,100}$`; any other value reads as absent. No migration: both tables are key/value.

### Form (`POST /setup/settings`, on the start page)

`<select name="notification_language">` (`en` English, `de` Deutsch); `<select name="time_zone">` with one option per
`timeZones()` entry; `<input type="checkbox" name="quiet_hours" value="on">`; `<input type="time" name="quiet_start">`
and `quiet_end` (not `required`; values `22:00` and `07:00` while quiet hours are off); one
`<input type="checkbox" name="rule_<id>" value="on">` per rule; `<input type="checkbox" name="update_notice"
value="on">`; the session-bound `csrf` field; the _save button_. Option and value texts are escaped.

### Texts (English; German translations by the Dev in `src/setup/texts.ts`)

- _status heading_ "Status"; _Version:_; _Telegram chat:_ with _none saved yet_ "None saved yet." and _chat secret_
  "Set by the Worker secret TELEGRAM_CHAT_ID."; _GitHub App:_ with _none saved yet_, _app secrets_ "Set by the Worker
  secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET.", _app partial_ "Only some of the Worker
  secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are set.", _App ID_ "App ID" and
  _cannot be read_ "Cannot be read with the current SELUNA_SECRET."; _Last delivery from GitHub:_ with _none received
  yet_ "None received yet.".
- _reset heading_ "The saved credentials cannot be read"; _reset text_ "The saved GitHub credentials cannot be read
  with the current SELUNA_SECRET: it was changed, or the saved values are damaged. If you still know the earlier
  SELUNA_SECRET, set it again instead. Otherwise reset: Seluna deletes the saved GitHub credentials and installation
  tokens, and you create the GitHub App again. Delete the old app on GitHub afterwards: in the settings of your
  account or organization, under Developer settings, then GitHub Apps. The Telegram chat and the settings are
  kept."; _reset button_ "Reset and create the GitHub App again".
- _githubResetNeeded_ (changed) "The saved GitHub credentials cannot be read with the current SELUNA_SECRET: it was
  changed, or the saved values are damaged. Set the earlier SELUNA_SECRET again, or reset the saved credentials on
  the start page and create the app again." followed by the link _to the start page_ "Open the start page" to `/setup`.
- _settings heading_ "Settings"; _notification language_ "Language of the notifications"; _time zone_ "Time zone";
  _quiet hours_ "Quiet hours: notifications arrive without sound"; _start_ "Start"; _end_ "End"; _rules_ "Notify me
  about"; rule labels "New pull request", "Pull request ready for review", "Review requested", "CI failed on the
  default branch", "CI failed in a pull request", "Dependabot alert", "Code scanning alert", "Secret scanning alert";
  _update notice_ "Tell me when a new Seluna release is available"; _save button_ "Save settings".
- Notices: _settings invalid_ "The settings were not saved. Check the values: quiet hours need a start and an end in
  the form 22:00, and the two must differ."; _reset not needed_ "The saved credentials can be read with the current
  SELUNA_SECRET, so nothing was reset."

`startHeading` and `startBody` stay unchanged.

## Options considered

The weighed options are recorded in [decision 0018](../../docs/decisions/0018-settings-and-status-page.md): one row
per setting vs one JSON row; the runtime's time zone list vs anything `Intl` accepts; the stored slug vs narrowing
`name` vs `GET /app`; a reset only when needed (guarded) vs always; reading `last_delivery` only vs writing it now;
a fixed time format vs the locale's style. One more, not in the record: **settings on their own page
`/setup/settings`** — lost because the issue makes the status page the entry point and a separate GET page adds a
route without adding protection.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/settings.ts` | new: settings model, defaults, stored format, time zone and clock-time guards |
| Worker | `src/store/settings.ts` | add `readSettings`, `readNotificationSettings`, `writeNotificationSettings` |
| Worker | `src/store/meta.ts` | new: `last_delivery` read, `github_app_slug` read/write |
| Worker | `src/store/secrets.ts` | `checkKey` corrupt for absent key check beside credentials; add `needsReset`, `resetCredentials` |
| Worker | `src/setup/status.ts` | new: `statusView`, `formatDeliveryTime` |
| Worker | `src/setup/settings-form.ts` | new: field names, paths, `parseSettingsForm` |
| Worker | `src/setup/pages.ts` | `renderStartPage` takes a view; reset section, settings form, status lines; `STYLE`; GitHub reset-needed link |
| Worker | `src/setup/texts.ts` | new texts and notices; `githubResetNeeded` changed |
| Worker | `src/setup/handler.ts` | `start` form carries its view; routes `POST /setup/settings`, `POST /setup/reset`; status view on `GET /setup` |
| Worker | `src/setup/github-step.ts` | `storeApp` writes the slug after a stored write |

## Signatures (for the Dev's skeleton)

```ts
// src/settings.ts (new)
import type { Language } from "./setup/language";
export const RULE_IDS: readonly [
  "pull_request_opened", "pull_request_ready_for_review", "pull_request_review_requested",
  "ci_failed_default_branch", "ci_failed_pull_request",
  "dependabot_alert", "code_scanning_alert", "secret_scanning_alert",
]; // declared `as const`
export type RuleId = (typeof RULE_IDS)[number];
export interface QuietHours { readonly start: string; readonly end: string } // "HH:MM", start !== end
export interface NotificationSettings {
  readonly language: Language;
  readonly timeZone: string;
  readonly quietHours: QuietHours | undefined;
  readonly rules: Readonly<Record<RuleId, boolean>>;
  readonly updateNotice: boolean;
}
export const DEFAULT_SETTINGS: NotificationSettings;
/** The `settings` keys of this module, in a fixed order. */
export const SETTING_KEYS: readonly string[];
export function timeZones(): readonly string[];
export function isTimeZone(value: string): boolean;
export function isClockTime(value: string): boolean;
export function settingsFromStored(stored: ReadonlyMap<string, string>): NotificationSettings;
export function settingsToStored(settings: NotificationSettings): readonly (readonly [key: string, value: string])[];

// src/store/settings.ts (added)
export async function readSettings(db: D1Database): Promise<ReadonlyMap<string, string>>;
export async function readNotificationSettings(db: D1Database): Promise<NotificationSettings>;
export async function writeNotificationSettings(db: D1Database, settings: NotificationSettings): Promise<void>;

// src/store/meta.ts (new)
export const LAST_DELIVERY_META_KEY = "last_delivery";
export const GITHUB_APP_SLUG_META_KEY = "github_app_slug";
export async function readLastDelivery(db: D1Database): Promise<Date | undefined>;
export async function readAppSlug(db: D1Database, appId: number): Promise<string | undefined>;
export async function writeAppSlug(db: D1Database, appId: number, slug: string): Promise<void>;

// src/store/secrets.ts (changed / added)
export async function checkKey(db: D1Database, key: CryptoKey): Promise<KeyCheckResult>; // same signature, new result for absent + rows
export async function needsReset(db: D1Database, key: CryptoKey): Promise<boolean>;
export type ResetResult = "reset" | "not-needed";
export async function resetCredentials(db: D1Database, key: CryptoKey): Promise<ResetResult>;

// src/setup/settings-form.ts (new)
export const SETTINGS_PATH = "/setup/settings";
export const RESET_PATH = "/setup/reset";
export function parseSettingsForm(fields: URLSearchParams): NotificationSettings | undefined;

// src/setup/status.ts (new)
export type ChatStatus = { readonly kind: "secret" } | { readonly kind: "saved"; readonly chatId: number } | { readonly kind: "none" };
export type AppStatus =
  | { readonly kind: "worker-secrets" }
  | { readonly kind: "partial-worker-secrets" }
  | { readonly kind: "saved"; readonly appId: number; readonly slug: string | undefined }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable" };
export interface StatusView {
  readonly version: string;
  readonly chat: ChatStatus;
  readonly app: AppStatus;
  readonly lastDelivery: Date | undefined;
  readonly resetNeeded: boolean;
  readonly settings: NotificationSettings;
}
/** D1 errors are not caught. */
export async function statusView(env: object, db: D1Database, storageKey: CryptoKey, version: string): Promise<StatusView>;
/**
 * `YYYY-MM-DD HH:MM (<timeZone>)`, 24-hour, in `timeZone`; when `Intl` throws for the zone or the time, the same
 * format in UTC built from the `getUTC*` fields, `(UTC)`. Never throws.
 */
export function formatDeliveryTime(time: Date, timeZone: string): string;

// src/setup/pages.ts (changed)
export type StartPageView = { readonly kind: "status"; readonly status: StatusView } | { readonly kind: "notice-only" };
export function renderStartPage(language: Language, csrfToken: string, view: StartPageView, notice?: Notice): string;

// src/setup/texts.ts (changed)
// Notice gains "settings-invalid" | "reset-not-needed"; SetupTexts gains the keys of *Texts* above
// (rule labels as `ruleLabels: Readonly<Record<RuleId, string>>`).
```

`handler.ts` keeps `handleSetup`'s signature; its internal `SetupForm` variant `start` gains `view: StartPageView`.
`github-step.ts` keeps its exported signatures.

## Test files

New: `src/settings.test.ts`, `src/store/meta.test.ts`, `src/setup/status.test.ts`, `src/setup/settings-form.test.ts`.
Extended: `src/store/settings.test.ts`, `src/store/secrets.test.ts`, `src/setup/pages.test.ts`,
`src/setup/texts.test.ts`, `src/setup/handler.test.ts`, `src/setup/github-step.test.ts`.

Existing test call sites of a changed signature:

- `renderStartPage(language, CSRF_TOKEN)` in `src/setup/pages.test.ts` (lines 55, 192, and the GitHub-link test
  near 252): the old signature goes away, so the **Dev** adapts them in step 4 to
  `renderStartPage(language, CSRF_TOKEN, { kind: "notice-only" })` — mechanically, no assertion touched (the
  notice-only view keeps both step links).
- `checkKey`: signature unchanged; no existing test pins `unset` beside a stored credential (`src/store/secrets.test.ts`
  324–341 cover empty, changed and other text).
- `TEXTS.en.githubResetNeeded` in `src/setup/handler.test.ts` (1786, 1950, 2377) compares against the constant and
  follows the new text by itself; the exact-text pin in `src/setup/texts.test.ts` (around 165) is the **Tester's** in
  step 5 (AC10).
- `handler.test.ts` `beforeEach` clears `settings`, `secrets` and `key_check`; the Tester also clears `token_cache`
  and the `meta` rows `last_delivery` and `github_app_slug` for the new tests.

Files no unit test can cover: none.

## Runtime behavior (measured)

Measured by Security in workerd (the Workers test pool) during the plan review; the Dev need not measure again, and
the area documents may state these as fact for the runtime version of `package-lock.json`:

- `Intl.supportedValuesOf` is a function; `Intl.supportedValuesOf("timeZone")` returns 418 names. `UTC` is **not**
  among them (so `timeZones()` adds it); `Europe/Berlin` and `Asia/Calcutta` are; `US/Pacific`, `Asia/Kolkata` and
  `Etc/UTC` are not.
- `Intl.DateTimeFormat` accepts `europe/berlin` and `+01:00` as `timeZone` and rejects ` Europe/Berlin` — so the
  list guard, not `Intl`, is what rejects the first two.
- `formatToParts` with `hourCycle: "h23"` gives hour `00` for `2026-10-24T22:00:00Z` in `Europe/Berlin`.
- The guard form `(SELECT value FROM meta WHERE key = 'key_check') IS ?1` behaves as planned in D1 (bound `null`
  and row absent → deletes; row present → 0 changes). The revised guard (`quote(value)`, plus the fingerprint) uses
  the same `IS` semantics; the AC6 race tests run against D1 in the pool and verify it, Security re-reads them in the
  diff review.
- The statements of one `db.batch` see the changes of the earlier statements. Security measured the previous order
  (`secrets`, `token_cache`, `meta`, all with the shared guard) on a seeded reset: the changes were **3, 0, 0** — the
  `secrets` delete emptied the table, the fingerprint became `NULL`, and the `token_cache` and `key_check` deletes
  were no-ops. Hence the ordered batch of *Approach* step 3 (`token_cache` and `secrets` under the shared guard,
  then `key_check` under the key check pin plus `NOT EXISTS (SELECT 1 FROM secrets)`). The new order is verified by
  the AC6 tests in the D1 pool ("resetCredentials deletes secrets, token_cache and key_check …" for the full delete,
  the two race tests for the no-op), not by a separate measurement.

Design fails closed either way: a missing list leaves only `UTC`; an alias the list lacks is rejected; a zone or time
`Intl` rejects at render falls back to UTC text instead of an error page.

## Areas

- `docs/areas/setup-wizard.md` (**Dev**): *Paths* step 5 gains `POST /setup/settings` and `POST /setup/reset`; the
  start-page bullet becomes the status page (status lines, reset section, step links, settings form, sign-out); new
  sections *Status and settings* (form fields and validation, statuses 303/400/403/503, the time format) and *Reset*
  (precondition, what is deleted and kept, 303/409/403/503, the guard: the key check value and the fingerprint of
  the `secrets` rows read, so a credential write between the check and the delete leaves everything; the three
  deletes in their order, as in storage.md); *Status and
  settings* also states that quiet hours are stored as one value, so switching them off drops the times and the form
  shows 22:00 and 07:00 again when they are next switched on, and that the delivery time falls back to UTC text when
  the runtime rejects the zone; *CSRF protection* lists the settings and reset
  forms among the signed-in forms; *GitHub App* step page: _reset needed_ links to the start page; *Created page*:
  the slug is kept; *Texts* gains the English texts above; *Limits and errors* notes that the old app stays on
  GitHub after a reset.
- `docs/areas/storage.md` (**Dev**): the `settings` keys and formats table (from *Stored formats*); the `meta` rows
  `last_delivery` (written by #12) and `github_app_slug`; *Key check*: `checkKey` reports corrupt for an absent key
  check beside a credential; the reset bullet states exactly what is deleted and the per-statement guard in its
  order: `token_cache`, then `secrets`, each only while the key check value and the secrets fingerprint are the ones
  read, then the key check row only while its value is the one read and `secrets` is empty; `token_cache` cleared by the reset; `last_delivery` bounded by `8640000000000000`;
  `quiet_hours` is one row (`off` or `<start>-<end>`), read only through `settingsFromStored`.

## Documentation updates

- `docs/ARCHITECTURE.md` — **Lead**, done in this plan commit (component row, `meta` row, configuration sentence,
  links to 0018).
- `CHANGELOG.md` (**Dev**): under `## [Unreleased]` / `### Added`: the start page shows the status and the settings
  (notification language, time zone, quiet hours, one switch per notification kind, update notice), effective
  without a deployment; a reset after a changed `SELUNA_SECRET`.
- `docs/setup.md` (**Dev**): *Next steps* — a paragraph on the start page (status, settings) and the reset after
  a changed `SELUNA_SECRET`; the *Before you deploy* sentence "changing it later means running the setup again"
  stays true.
- `README.md` (**Dev**): a short *Settings* section listing the settings with their defaults (the integration
  surface's setting table; README has none yet).
- `.squad/project.md` (**Dev**): *Encrypted credentials* gains one sentence — the reset (`resetCredentials` in
  `src/store/secrets.ts`) deletes `secrets`, `token_cache` and the key check value only while the credentials cannot
  be read, behind the session and its CSRF token, in one batch that deletes `token_cache` and then `secrets` only
  while the key check value and the `secrets` rows are the ones checked, and then the key check value only while it
  is the one checked and no `secrets` row is left (a credential written in between leaves everything). *Setup login* needs no
  change (every form already carries the token).

## Architecture check

- *Each user's data stays in that user's account* — unchanged; no new outbound call.
- *GitHub App credentials are only ever stored encrypted* — unchanged; the slug and App ID shown are not secrets
  (the App ID is already shown on the GitHub step); the slug lives in plain `meta`, which storage.md already declares
  plain text.
- *An invalid signature has no effect*, *a delivery is processed once*, *outbox before delivery* — untouched
  (`POST /webhook` unchanged).
- Decision 0007 (released): the reset clears exactly what 0007's *Consequences* name and never restores old values.
  Decisions 0015/0017: the new forms are signed-in forms with the session-bound token; no page gets a new
  `form-action`.

## Security considerations

- [x] Limits: both new POST bodies are read with the existing 1 MiB limit **before** decoding; parsed field values
  are bounded by it. No other limit. The time zone select has a few hundred options (page size, no input bound).
- [x] Exceptions reaching the user: every D1 error in `statusView`, `writeNotificationSettings` and
  `resetCredentials` is caught in the handler and answered with the fixed _unavailable_ notice (503); the slug write's
  error is dropped. `formatDeliveryTime` runs at render, outside that `try`, and therefore never throws: it falls back
  to UTC text built without `Intl`, and `readLastDelivery` returns only times a `Date` holds (at most
  `8640000000000000`), so the start page — the only page with the reset and settings forms — cannot be broken by a
  stored `last_delivery` or by ICU dropping a zone. No runtime text reaches a page or the log.
- Guard enumeration — **time zone**: the runtime's `Intl` accepts letter-case variants (`europe/berlin`), aliases
  (`US/Pacific`), `UTC`/`GMT`/`Etc/*` names, and, in recent V8, offsets (`+01:00`); the guard accepts only exact
  members of the list (case-sensitive string equality), so case variants, offsets, whitespace and control
  characters are rejected and only canonical list names are stored. **Clock time**: an `<input type="time">` posts
  `HH:MM` and, with a `step` below 60, `HH:MM:SS`; the page sets no `step`, and the guard accepts only `HH:MM`
  00:00–23:59, so seconds, `24:00`, one-digit hours and full-width digits are rejected. **Checkboxes**: browsers post
  the `value` (`on`) only when checked; anything else is rejected rather than read as on.
- Output: the slug (allow-listed `[a-z0-9-]`), time zone (list member), chat id and App ID (numbers) are escaped
  as every page text; the link `https://github.com/apps/<slug>` is built only from an allow-listed slug.
- Reset: destructive, therefore session + session-bound CSRF + precondition + a guard pinning both the key check
  value and the `secrets` rows read (every `needsReset` branch: changed or corrupt key check, and a credential that
  does not decrypt under a matching key check); it calls nothing outside D1.

## Decision records

- `docs/decisions/0018-settings-and-status-page.md` (Proposed, indexed).

## Out of scope / follow-ups

- Writing `meta` `last_delivery` — #12 (format fixed here and in storage.md).
- Consuming the settings — #12 (language), #13/#16/#17 (rule switches), #14 (quiet hours, start inclusive, end
  exclusive; read as `NotificationSettings.quietHours` through `readNotificationSettings`/`settingsFromStored` from
  the one `quiet_hours` row, never as separate start/end rows), #18 (update notice).
- The list of installations on the status page — #15.
- Deleting the old app on GitHub during the reset — not possible without app authentication; the text tells the owner.

## Challenge

Devil's Advocate, 0 major, 3 minor:

1. *Measure `Intl.supportedValuesOf("timeZone")` in workerd first.* — **Accepted, settled.** Security measured it
   (function present, 418 names, `Europe/Berlin` listed, `UTC` not). The facts are in *Runtime behavior (measured)*,
   which replaces the Dev's measuring step; the design (list plus `UTC`) stands unchanged.
2. *Quiet hours as one `off` / `<start>-<end>` value lose the times when switched off; #14 could read the issue's
   wording as three rows.* — **Accepted.** The loss is intended (one row, one validity rule, no orphan times) and is
   now stated: *Areas* has the Dev write it in `docs/areas/setup-wizard.md` (*Status and settings*) and
   `docs/areas/storage.md`; *Out of scope* says #14 reads `quietHours` only through
   `readNotificationSettings`/`settingsFromStored`; decision 0018's *Consequences* says the same (Lead, done).
3. *The reset guard covers only `key_check`; document the window as accepted.* — **Rejected in favour of the code
   fix** of Security finding 1: the guard now also pins the `secrets` rows read, so the window is closed rather than
   documented. The area documents describe the closed guard; there is no "accepted window" line.

## Product Manager decision

After Security's second plan rejection (the reset batch order) the Lead escalated. The Product Manager chose option
(a): one more plan revision with exactly that fix (*Approach* step 3, AC6 tests, *Runtime behavior (measured)*,
the area documents, `.squad/project.md` and 0018 option 8), then one Security delta confirmation; a further
rejection goes back to the Product Manager.

## Security review

Plan review, CHANGES_REQUIRED:

- **Blocking 1 — the guard misses the "key matches, a credential does not decrypt" branch.** — **Accepted.** The
  guard is now `quote(key_check) IS ?1 AND <secrets fingerprint> IS ?2` (*Approach* step 3), the fingerprint being
  `quote(key) || ':' || quote(iv)` of every `secrets` row in key order, computed by SQLite at read time and bound back.
  Every write draws a fresh IV, so a `writeSecrets` in between — which keeps the `key_check` row — makes the delete a
  no-op. Re-check of the whole precondition list against the guard: key check changed (pinned by value), key check
  corrupt incl. non-text (pinned by `quote`, the old `typeof` branch removed), key check absent beside rows (pinned
  `NULL` plus fingerprint; a first write cannot insert a key check while rows exist), a row that does not decrypt
  under a matching key check (fingerprint), a row added or removed (the fingerprint lists keys). New test in AC6:
  "resetCredentials deletes nothing when a credential was rewritten after its check", plus the blob key-check case.
  Decision 0018 option 8 now names both pins.
- **Blocking 2 — `last_delivery` above `8.64e15` yields an Invalid Date and a `RangeError` on the start page.** —
  **Accepted.** The stored format is bounded by `8640000000000000` (*Stored formats*, storage.md by the Dev);
  `readLastDelivery` returns `undefined` above it; AC5 adds `8640000000000001` and `9007199254740991` as absent and
  `8640000000000000` as read.
- **Non-blocking — `formatDeliveryTime` runs outside the handler's D1 `try`.** — **Accepted.** It now never throws:
  on any `Intl` error it writes the same format in UTC from the `getUTC*` fields (signature comment, AC5 tests
  "falls back to UTC when the runtime rejects the zone" and "writes the latest valid time without throwing").
- *Drop the Dev's measuring step.* — **Accepted**; see *Runtime behavior (measured)*.

Plan delta review, CHANGES_REQUIRED:

- **Blocking (delta round) — reset batch order.** The shared fingerprint guard on all three deletes makes the
  `token_cache` and `key_check` deletes no-ops once `secrets` is emptied (measured changes 3, 0, 0), so a reset
  leaves the old `token_cache` rows and the old key check, and the GitHub step would keep reporting a changed key. —
  **Accepted.** *Approach* step 3 now deletes (1) `token_cache` and (2) `secrets` under the shared guard, then (3)
  `key_check` under the key check pin and `NOT EXISTS (SELECT 1 FROM secrets)`, with the reason why (3) is
  equivalent; the "meta delete last because the guard reads it" sentence is gone. AC6: the full-delete test seeds
  several `secrets` rows and at least one `token_cache` row and asserts all three empty; both race tests assert that
  `secrets`, `token_cache` and `key_check` remain. *Runtime behavior (measured)* records the old order's
  measurement as the reason. Re-check of the precondition list against the new statements: key check changed or
  corrupt (pin `?1` on all three), key check absent beside rows (`?1` `NULL` plus fingerprint; (3) has no row to
  delete), a credential that does not decrypt under a matching key check and a concurrent rewrite (fingerprint
  blocks (1) and (2); the remaining rows block (3)), a row added or removed (fingerprint; rows block (3)), a
  concurrent first write into an empty table after the read (fingerprint no longer `NULL`; rows block (3)).
  Decision 0018 option 8, `docs/areas/storage.md`, `docs/areas/setup-wizard.md` and `.squad/project.md` describe the
  per-statement guard and order.

## Lead decisions

Decide, after the implementation (b72c715):

1. **The _reset needed_ link to the start page stays (option a).** The plan (*Approach* step 5, *Texts*, *Affected
   projects*, *Areas*) asks for it, and the text sends the owner to "the start page", so the page should lead there;
   the language links that also reach `/setup` are a language switch, not that step. The failing assertion was the
   `github reset-needed` entry of the "its own links only" table in `src/setup/pages.test.ts`, written before the
   link was planned into it — a test defect, not a plan defect. Dropping the link would leave `startPageLink`, a text
   added only for it, unused. Owners:
   - **Tester** (`src/setup/pages.test.ts`): the `github reset-needed` table entry gets
     `links: [GITHUB_LINK, "/setup"]`; new test "renderGitHubPage reset-needed view links to the start page in
     $language" asserting `<p><a href="/setup">${escapeHtml(TEXTS[language].startPageLink)}</a></p>` after the
     _reset needed_ text (AC10). Written first, so it fails before the Dev's fix.
   - **Dev** (`src/setup/pages.ts`): the `reset-needed` case renders the text followed by
     `<p><a href="/setup">` _to the start page_ `</a></p>`.
   - **Dev** (`docs/areas/setup-wizard.md`): *The step page* — the _reset needed_ view has no form and a link to the
     start page (`/setup`); *Texts* — the _reset needed_ text is followed by _to the start page_ "Open the start
     page"; and the *Reset* bullet of the start-page texts loses "the link "Open the start page"", which belongs to
     the GitHub step page, not to the reset section (the start page renders no such link).
   - Then *Format* by each member on its files, the Code Officer's analyzer gate and a Reviewer round over the delta.
2. **`needsReset` reusing the read of `resetCredentials` is accepted.** `needsReset` and `resetCredentials` now
   decide from the same function (`readCredentialState`, `src/store/secrets.ts`), so the status page's
   "reset needed" and the reset's precondition cannot drift apart; the extra cost is the fingerprint and the
   `secrets` rows read on `GET /setup`, a handful of rows in one batch. Behavior is the planned one; AC6's tests
   cover it unchanged. No record change: decision 0018 is about the guard, not about how the check is shared.
3. **The status page's _GitHub App:_ line keeps describing the App ID (option a, documentation only).** Reviewer round
   1, finding 2: the area document and AC5 said _cannot be read_ appears "when a reset is needed", but `appStatus`
   (`src/setup/status.ts`) shows `unreadable` only when `readSecret(db, storageKey, "github_app_id")` gives
   `secret-changed` or `corrupt`, while `needsReset` (`readCredentialState`, `src/store/secrets.ts`) is also true when
   the key check matches and another row (e.g. `github_private_key`) does not decrypt. The code is kept and the
   documents are corrected, because the line's text is "Cannot be read with the current SELUNA_SECRET" and the App ID
   in that case *can* be read: option (b) would show a false statement about the App ID. It also keeps the status
   line on the same condition as the GitHub step page, whose _reset needed_ view is defined by the stored
   `github_app_id` as well (*The step page*); option (b) would make the two pages disagree in this case. The reset
   section directly below already says the saved credentials cannot be read, which is true. AC5 is reworded above.
   Owners:
   - **Dev** (`docs/areas/setup-wizard.md`, *Status and settings*, first bullet): replace "_none saved yet_, or
     _cannot be read_ when a reset is needed;" with "_none saved yet_, or _cannot be read_ when the saved App ID
     cannot be read with the current `SELUNA_SECRET` (a reset can also be needed while the App ID is still shown,
     when another saved credential does not decrypt);". No production code changes.
   - **Tester** (`src/setup/status.test.ts`): add the "statusView reports $case" table case "key matches,
     github_private_key altered" — the key check written under the current key, `github_app_id` saved and readable,
     the `github_private_key` row altered so it does not decrypt — expecting `app` `{ kind: "saved", appId, slug }`
     and `resetNeeded` true. It pins documented behavior that exists already, so it passes on first run; that is
     expected and not a test-first violation.
   - Then *Format* by each member on its files, the Code Officer's analyzer gate and a Reviewer delta round.
