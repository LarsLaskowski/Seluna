# Plan: Say on /setup that the database migrations have not run instead of "unavailable"

Source: Issue #51
Status: Draft
Tier: security — the change is in the setup login path (`signIn` in `src/setup/handler.ts`, a *Security areas*
entry of `.squad/project.md`) and changes what an unauthenticated visitor's login answer says.

## Before the Dev starts (orchestrator)

The work branch `fix-issue-51-setup-missing-tables` was cut from `c7bd429` and does not contain PR #52
(`origin/main` `8c248ba`): decision 0020, the `docs/setup.md` deploy step and the `docs/areas/deployment.md`
deploy-command rules this plan edits are missing on the branch. Merge `origin/main` into the branch first (a merge,
not a rebase: the branch is published). The merge conflicts in `docs/decisions/README.md` at the end of the index:
keep both rows, 0020 before 0021. Until then `decision-check.py` reports the link from 0021 to the missing 0020.
After the merge the Lead edits 0020 (unreleased, `v0.1.0` is `daba023`) in its next launch, see *Decision records*.

## Problem / root cause

`signIn` (`src/setup/handler.ts:211-230`) counts the attempt with `reserveLoginAttempt` (line 219; an upsert into
`meta`, `src/store/login-attempts.ts:16-29`) before the secret is checked. On a database without tables that
statement throws, and the `catch` at line 225 answers every D1 error alike: 503, login page, _unavailable_
(`src/setup/texts.ts:230`). Nothing distinguishes a missing table from a transient failure.

Claims of the issue:

- "shows only ... after signing in on `/setup`" — **refuted in detail**: the notice is the answer to the sign-in
  submission itself, and it comes before the secret is checked, so it appears for a wrong secret as well (line
  219 runs before line 224). No session exists on such an instance.
- "the `meta` table does not exist" — **confirmed**: the first D1 access of the login is the `meta` upsert; all six
  tables come from the single migration `migrations/0001_initial_schema.sql`, so with the migrations skipped none
  exists.
- "reads like a transient error" — **confirmed**: _unavailable_ says "Please try again in a moment."
- "needs a way to tell a missing table from other D1 failures without leaking error text" — **confirmed** as a
  constraint: every `catch` in the handler drops the error unread (comment at line 226); this plan keeps it so.
- "a change to `docs/areas/setup-wizard.md`" — **confirmed** (line 53 and *Texts*); `docs/setup.md` step 3 (from
  PR #52) quotes the _unavailable_ text for this case and `docs/areas/deployment.md` *Limits and errors* names the
  _unavailable_ notice too; both become stale and are updated.

Related findings on the way:

- `test/d1.ts` (`migrationTestDb`, TSDoc "which only `test/migrations.test.ts` uses") and the comment above the
  first test of `test/migrations.test.ts` are stale: `src/setup/handler.test.ts` already uses that binding as a
  database without tables (lines 735, 1118, ... 2823), which works because the test pool isolates storage per test
  file. The Tester corrects the TSDoc in `test/d1.ts` (it relies on that contract); the comment in
  `test/migrations.test.ts` stays true for that file and is left.
- 0020's *Consequences* ("A clearer notice on `/setup` for a database without tables is a separate follow-up")
  becomes stale with this change; Lead edits it after the merge.

## Acceptance criteria

- [ ] AC1: `schemaStateOf(names)` is `"complete"` exactly when every name in `SCHEMA_TABLES` (`settings`, `secrets`,
  `deliveries`, `outbox`, `token_cache`, `meta`) occurs among the string values of `names`; other names
  (`d1_migrations`, `sqlite_sequence`, `_cf_KV`) do not matter and values that are not strings are ignored.
  Tests (`src/store/schema.test.ts`):
  - `schemaStateOf returns complete when every schema table is listed`
  - `schemaStateOf returns complete when other tables are listed beside the schema tables`
  - `schemaStateOf returns tables-missing without %s` (`it.each` over the six tables, each left out once)
  - `schemaStateOf returns tables-missing for no tables`
  - `schemaStateOf ignores names that are not strings` (the six names wrapped as `{ name }` objects, numbers,
    `null` → `tables-missing`)
- [ ] AC2: `readSchemaState(db)` reads the table names from `sqlite_master` and returns their state; D1 errors are
  not caught. `SCHEMA_TABLES` lists exactly the tables the migrations create. Tests (`src/store/schema.test.ts`):
  - `readSchemaState returns complete for a migrated database` (`env.DB` after `applyMigrations`)
  - `readSchemaState returns tables-missing for a database without tables` (`migrationTestDb()`, never migrated in
    this file)
  - `readSchemaState rejects when D1 fails` (`unusedDb()`)
  - `SCHEMA_TABLES lists exactly the tables the migrations create` (user tables of the migrated `env.DB` from
    `sqlite_master`, without `sqlite_%`, `_cf_%` and `d1_migrations`, sorted, equal to `SCHEMA_TABLES` sorted)
- [ ] AC3: `POST /setup/login` with a valid CSRF token on a database without tables answers **503** with the login
  page and the _migrations missing_ notice, not the _unavailable_ notice, sets no session cookie and carries no
  error text (lowercased body contains neither `no such table`, `d1_error` nor `sqlite`). This holds for the
  correct and for a wrong secret alike (the secret is not checked). Tests (`src/setup/handler.test.ts`, describe
  `handleSetup bodies and failures`):
  - `handleSetup answers a login with 503 and the migrations-missing notice when the database has no tables`
    (replaces the existing test `handleSetup answers a login with 503 and the unavailable notice when D1 fails`,
    line 734, which uses `migrationTestDb()` and now gets the new notice)
  - `handleSetup answers a wrong secret with the migrations-missing notice when the database has no tables`
  - `handleSetup shows the migrations-missing notice in German` (`?lang=de` or `Accept-Language: de`, German text)
- [ ] AC4: a login D1 failure while every schema table exists, or while the `sqlite_master` read fails too, still
  answers **503** with the login page and _unavailable_ and no session cookie. Tests (same describe):
  - `handleSetup answers a login with 503 and the unavailable notice when D1 fails with every table present` (a
    `D1Database` whose `prepare` passes `sqlite_master` reads to the migrated `env.DB` and throws for every other
    statement, helper `schemaOnlyDb` in `test/d1.ts`)
  - `handleSetup answers a login with 503 and the unavailable notice when the schema check fails too` (`unusedDb()`)
- [ ] AC5: the _migrations missing_ notice exists in English and German; the English text is exactly
  "The database of this instance is missing its tables: the database migrations have not run. In the Cloudflare
  dashboard open Workers & Pages, this Worker, Settings and Build, set the Deploy command to npm run deploy and
  retry the latest build, as the setup guide describes."
  and the German text exactly
  "Der Datenbank dieser Instanz fehlen ihre Tabellen: Die Datenbank-Migrationen wurden nicht ausgeführt. Öffne im
  Cloudflare-Dashboard Workers & Pages, diesen Worker, Settings und Build, setze den Deploy command auf npm run
  deploy und wiederhole den letzten Build, wie es die Einrichtungsanleitung beschreibt."
  (each one line in code; the line breaks here are only wrapping). Tests: `src/setup/texts.test.ts`
  `texts define a non-empty text for every key in English and German` (count 23 → 24) and `texts word the English
  notices as the area document does` (new entry); `src/setup/pages.test.ts` `renderLoginPage shows the $notice
  notice in $language` (add `"migrations-missing"` to `NOTICES`).
- [ ] AC6: the other D1 failure sites (status page, settings, reset, Telegram and GitHub steps) are unchanged and
  keep answering _unavailable_ on a database without tables: the existing tests at `src/setup/handler.test.ts`
  lines 1118, 1608, 1796, 1960, 2575, 2694, 2738 and 2823 stay as they are and pass.

## Approach

1. `src/store/schema.ts` (new; only `src/store/` touches D1, decision 0014): `SCHEMA_TABLES`, `schemaStateOf`
   (pure) and `readSchemaState`, which runs `SELECT name FROM sqlite_master WHERE type = 'table'` (no bound
   values) with `.all()` and passes `results.map((row) => row.name)` to `schemaStateOf`.
2. `src/setup/texts.ts`: add `"migrations-missing"` to `Notice` (after `"unavailable"`) and the two texts of AC5.
3. `src/setup/handler.ts`: a private `d1FailureNotice(db)` that calls `readSchemaState` inside its own
   `try`/`catch` (the error dropped unread, as everywhere) and maps `tables-missing` → `"migrations-missing"`,
   `complete` or a throw → `"unavailable"`. The `catch` of `signIn` (line 225) answers
   `formPage(context, LOGIN_FORM, 503, await d1FailureNotice(db))`. The `try` block, the order count → secret
   check → clear, and every other `catch` stay as they are.

The check runs only after the login's D1 access failed, so a healthy instance makes no extra query, and it reads
no row data — only table names.

## Options considered

See [decision 0021](../../docs/decisions/0021-missing-tables-notice-on-the-setup-login.md), *Options considered*:
(1) a `sqlite_master` read after the failure — chosen; (2) matching the error message `no such table` — rejected:
undocumented, uncaptured message format, and it would read the error that must stay unread; (3) Wrangler's
`d1_migrations` — rejected: a Wrangler-owned table no Seluna code reads, coupled to file names; (4) checking before
every login — rejected: a query per attempt for nothing; (5) the notice only after a verified secret — rejected: an
unthrottled secret oracle that breaks the five-attempt rule; (6) every signed-in D1 failure site too — rejected for
now: no table can be missing behind a valid session with today's single migration; (7) the notice on the signed-out
page itself — rejected: a D1 read on every signed-out view.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/store/schema.ts` | new: `SCHEMA_TABLES`, `SchemaState`, `schemaStateOf`, `readSchemaState` |
| Worker | `src/setup/texts.ts` | `Notice` gains `"migrations-missing"`; English and German text |
| Worker | `src/setup/handler.ts` | `d1FailureNotice`; the `catch` of `signIn` uses it |
| Tests | `src/store/schema.test.ts` | new (AC1, AC2) |
| Tests | `src/setup/handler.test.ts` | AC3, AC4 (one existing test replaced) |
| Tests | `src/setup/texts.test.ts`, `src/setup/pages.test.ts` | AC5 |
| Tests | `test/d1.ts` | `schemaOnlyDb` helper; `migrationTestDb` TSDoc corrected |

## Signatures (for the Dev's skeleton)

`src/store/schema.ts`:

```ts
/** The tables the migrations under `migrations/` create; the store modules read and write only these. */
export const SCHEMA_TABLES: readonly string[] = ["settings", "secrets", "deliveries", "outbox", "token_cache", "meta"];

/** Whether the database has the schema's tables: `complete` when every table of `SCHEMA_TABLES` exists. */
export type SchemaState = "complete" | "tables-missing";

/** The state for the `name` values of the `sqlite_master` table rows; a value that is not a string is ignored. */
export function schemaStateOf(tableNames: readonly unknown[]): SchemaState;

/** Reads the table names from `sqlite_master` and returns their state. D1 errors are not caught. */
export async function readSchemaState(db: D1Database): Promise<SchemaState>;
```

(`SCHEMA_TABLES` is data, not a stub: the skeleton writes it in full.)

`src/setup/texts.ts`: `Notice` gains the member `"migrations-missing"`; `TEXTS.en.notices` and `TEXTS.de.notices`
gain the key (skeleton: the final texts of AC5, they are data).

`src/setup/handler.ts` (module-private):

```ts
/** The notice of a D1 failure on the login: _migrations missing_ when a schema table is absent, otherwise — also when that check fails — _unavailable_. No error is read. */
async function d1FailureNotice(db: D1Database): Promise<Extract<Notice, "unavailable" | "migrations-missing">>;
```

`test/d1.ts` (Tester):

```ts
/** A `D1Database` whose `prepare` passes statements that read `sqlite_master` to `db` and throws for every other statement; every other member throws. */
export function schemaOnlyDb(db: D1Database): D1Database;
```

Files the skeleton rewrites: `src/setup/handler.ts`, `src/setup/texts.ts` (read; the edits are as above, nothing
else in them changes); new `src/store/schema.ts`.

## Test files

- `src/store/schema.test.ts` (new), `src/setup/handler.test.ts`, `src/setup/texts.test.ts`,
  `src/setup/pages.test.ts`, helper in `test/d1.ts` — all Tester.

Existing test code that calls a changed signature: none (no exported signature changes; `Notice` only widens). The
test `handleSetup answers a login with 503 and the unavailable notice when D1 fails` (`handler.test.ts:734`) changes
its expectation and is replaced by the Tester (AC3). The count assertion `toBe(23)` and the English notice map in
`texts.test.ts`, and `NOTICES` in `pages.test.ts`, are extended by the Tester (AC5).

Files of the change no unit test can cover: none.

## Areas

- `docs/areas/setup-wizard.md` (Dev):
  - *Login*, the bullet "A D1 failure while counting or resetting ..." (line 53): a D1 failure answers **503** with
    the login page and no session; the notice is _migrations missing_ when the database lacks a table of the schema
    (the table names are read after the failure; reading them fails → _unavailable_), _unavailable_ otherwise. The
    secret is not checked when counting failed, so the answer is the same for a wrong secret.
  - *Texts*: the _migrations missing_ entry with the English text of AC5, after _unavailable_.
  - *Limits and errors*: the _migrations missing_ notice is shown to anyone who submits the login form with a valid
    CSRF token, before the secret is checked; it tells them only that the database has no tables. A database with
    every table but an outdated column still shows _unavailable_; the signed-in pages show _unavailable_ for every
    D1 failure.
  - *Related decisions*: add 0021.
- `docs/areas/deployment.md` (Dev, after the merge): *Limits and errors*, the bullet that starts "With any other
  deploy command": `/setup` answers the sign-in with the _migrations missing_ notice ([Setup
  wizard](setup-wizard.md#login)) instead of _unavailable_.
- `docs/areas/storage.md` (Dev): after the `d1_migrations` bullet, one bullet: the setup login reads the table
  names from `sqlite_master` after a failed D1 access to tell a database without its tables from another failure
  ([Setup wizard](setup-wizard.md#login)); the list of the schema's tables sits beside the store modules and a test
  pins it to the migrations.

## Documentation updates

- `docs/setup.md` step 3 (Dev, after the merge): "signing in on `/setup` then only shows _The setup is unavailable
  right now_" → "signing in on `/setup` then shows _The database of this instance is missing its tables_".
- `CHANGELOG.md` (Dev): under `## [Unreleased]`, a `### Changed` section (before `### Fixed`) with: "Setup wizard:
  on an instance whose deploy skipped the database migrations, signing in shows that the database is missing its
  tables and names the deploy command `npm run deploy`, instead of _The setup is unavailable right now_."
- `.squad/project.md` (Dev): *Integration surface*, "A new or changed D1 table or column" gains "`SCHEMA_TABLES` in
  `src/store/schema.ts`"; *Security areas*, Setup login, after the attempt-count clause: "a D1 failure there answers
  a fixed notice — _migrations missing_ when `sqlite_master` lacks a schema table (`src/store/schema.ts`, decision
  0021), else _unavailable_ — and never the error".
- `docs/ARCHITECTURE.md`: none (no table, flow or guarantee changes).
- Decision records: Lead (below).

## Architecture check

Guarantees of `.squad/project.md` / `docs/ARCHITECTURE.md`: none is touched. Nothing secret is returned or logged
(the error stays unread; the notice is a fixed text; the table names are not shown). The login lock is unchanged:
the secret is still never checked without a successful count. No new route, binding, permission, dependency or
migration; data access stays in `src/store/` (decision 0014).

## Security considerations

- [x] Byte or length limits: no limits (no new parsed input; the `sqlite_master` answer is narrowed by
  `typeof name === "string"` and only compared).
- [x] Exceptions that can reach a user-visible message: the D1 error of the login and the D1 error of the
  `sqlite_master` read — both caught unread; the user sees only _migrations missing_ or _unavailable_ (AC3, AC4).
- Pre-authentication disclosure: anyone with a valid login CSRF token (from `GET /setup`) learns whether the
  instance's database lacks its tables. Accepted in decision 0021 (no data exists, the login cannot succeed, the
  _unavailable_ answer already disclosed a failing D1).
- Cost: on a failing D1, a login submission makes one more query; on a healthy one none.
- *Unverified*: that production D1 answers `SELECT name FROM sqlite_master WHERE type = 'table'` with the tables
  as the Workers test pool does. The session cannot reach Cloudflare, so the Dev cannot measure it; the design
  fails closed on an error (_unavailable_, as today). The claim is not stated as fact in the area documents or
  `.squad/project.md` beyond "the table names are read"; the live check (owner, on a deployed copy:
  `npx wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type = 'table'"`) is named in
  decision 0021 and in the PR description as open.

## Decision records

- `docs/decisions/0021-missing-tables-notice-on-the-setup-login.md` (Proposed, index row added) — Lead.
- `docs/decisions/0020-deploy-command-checked-in-the-setup-guide.md` (unreleased, on the branch after the merge) —
  Lead edits in place: in *Consequences*, "A clearer notice on `/setup` for a database without tables is a separate
  follow-up." → "The setup login names a database without tables ([decision
  0021](0021-missing-tables-notice-on-the-setup-login.md))."
- 0015 (released) is not edited; 0021 does not amend it (the notice is area behavior 0015 never decided).

## Out of scope / follow-ups

- The missing-tables check on the signed-in pages (option 6), to revisit with the first migration that adds a table.
- Detecting an outdated column.
