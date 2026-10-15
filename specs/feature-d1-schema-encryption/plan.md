# Plan: D1 schema and encryption of credentials

Source: Issue #7 | [spec.md](spec.md)
Status: Draft
Tier: security — the change creates the encrypted-credentials path (`.squad/project.md`, *Security areas*:
*Encrypted credentials*) and the D1 schema every later feature writes to.

## Problem / root cause

Summary of [spec.md](spec.md): the repository has no D1 migration (`migrations/` holds only `README.md`), no
encryption code and no `src/store/`. This feature adds the first migration with all six tables, `src/crypto.ts`
(AES-256-GCM, HKDF-SHA256 from `SELUNA_SECRET`) and `src/store/secrets.ts` (credentials and the key check value
in `meta`). No production caller is wired yet; #10, #11, #12 and #15 are the callers.

Claims of the issue, checked against the code and the documents:

- "Every user runs their own instance … stores its state in D1" — confirmed: `wrangler.jsonc` binds `DB` with
  `migrations_dir: "migrations"`; `package.json` `deploy` runs `wrangler d1 migrations apply DB --remote` first
  (decision 0013).
- "First migration with all tables" — confirmed that none exists: `migrations/README.md` says "The first migration
  follows with issue #7", decision 0013 option 7.
- `secrets` holds "GitHub App ID, private key, webhook secret" — confirmed against decision 0007 and 0013 (the
  Telegram bot token is a Worker secret, not in D1).
- `token_cache (installation_id, token, expires_at)` with a plain `token` — **refuted as compatible with the
  issue's own goal** ("someone who can only read D1 learns nothing") and with `.squad/project.md` ("Nothing secret
  is … kept in plain text in D1"). The plan stores `iv` and `ciphertext` instead (decision 0007, options 15/16).
- "fixed salt and info `seluna/secrets/v1`" — read as both salt and info being that string (decision 0007,
  option 4); not ambiguous enough to escalate, since nothing is stored yet and the choice is pinned by AC7.
- "A key check value in `meta` detects a changed `SELUNA_SECRET`; reading secrets then fails with a dedicated
  error" — designed as the `secret-changed` result (a typed result, not an exception: *Writing code* in
  `.squad/stack.md`, "Expected failures … are values or typed results").
- `meta` holds "last notified release, time of the last delivery, key check value" — `docs/ARCHITECTURE.md` said
  "Schema version and the result of the release check"; the schema version is Wrangler's `d1_migrations` table.
  `ARCHITECTURE.md` is corrected (done by the Lead).
- `SELUNA_SECRET` is not declared in `worker-configuration.d.ts` (only `DB`), confirmed: it is read by narrowing,
  as `src/webhook-secret.ts` reads `GITHUB_WEBHOOK_SECRET` (decision 0012, option 8).

Related defect found on the way: `docs/areas/deployment.md`, `migrations/README.md` and `CLAUDE.md` say a
migration is frozen "once released", but copies deploy `main`, so a migration is frozen once it is on `main`
(decision 0014, option 9). Fixed here in the area document (Lead) and `migrations/README.md` (Dev); `CLAUDE.md` is
a squad file and gets a follow-up (*Out of scope / follow-ups*).

## Acceptance criteria

Test files: `src/crypto.test.ts` (C), `src/store/secrets.test.ts` (S), `test/migrations.test.ts` (M). Each name
below is the exact test name. "Key A" is the key derived from a fixed 32-character secret, "key B" from another.

- [ ] AC1: Encrypted values are not readable in D1.
  - S `writeSecret stores neither the value nor its base64 in the row` — after writing `github_private_key` with a
    PEM-like value, the raw `secrets` row (read with SQL) has an `iv` of 16 characters, and neither `iv` nor
    `ciphertext` contains the value or `btoa` of the value; the decoded ciphertext bytes do not contain the UTF-8
    bytes of the value.
  - S `writeSecret stores a new IV and ciphertext when the same value is written again`.
  - C `encrypt returns a 12-byte IV as 16 base64 characters`.
  - C `encrypt returns different IVs and ciphertexts for the same plaintext`.
- [ ] AC2: Decrypting with a different `SELUNA_SECRET` fails and is reported as a changed secret.
  - S `readSecret reports secret-changed under a key derived from another SELUNA_SECRET` — written under key A,
    read under key B: `{ kind: "secret-changed" }`.
  - S `writeSecret reports secret-changed under another key and leaves the stored row unchanged` — the raw row and
    the `key_check` row are byte-identical before and after.
  - S `checkKey reports changed under a key derived from another SELUNA_SECRET`.
  - C `decrypt returns undefined under a key derived from another secret`.
- [ ] AC3: Migrations apply cleanly to an empty database.
  - M `migrations apply to an empty database` — arrange asserts that `MIGRATION_TEST_DB` has no table besides
    SQLite's and D1's internal ones (`sqlite_%`, `_cf_%`); act applies the migrations; assert `d1_migrations` lists
    exactly `0001_initial_schema.sql`.
  - M `migrations create exactly the tables settings, secrets, deliveries, outbox, token_cache and meta` (ignoring
    `sqlite_%`, `_cf_%`, `d1_migrations`).
  - M `<table> has the columns of the storage area` — one case per table (`it.each`), comparing
    `PRAGMA table_info` (`name`, `type`, `notnull`, `dflt_value`, `pk`) with the table in *Schema* below.
  - M `migrations create the indexes deliveries_received_at and outbox_status_created_at` (`PRAGMA index_list` /
    `index_info`: columns `received_at`; `status`, `created_at`).
  - M `secrets rejects an iv that is not 16 characters`, M `token_cache rejects an iv that is not 16 characters`,
    M `outbox rejects a status other than pending, sent or failed`, M `outbox rejects silent other than 0 or 1`,
    M `outbox rejects a negative attempts count`, M `outbox fills silent 0, attempts 0 and status pending by default`.
- [ ] AC4: Round trip and missing credential.
  - S `readSecret returns the value writeSecret stored` — value with non-ASCII text and newlines (a PEM with `ä`).
  - S `readSecret reports missing for a name that was never written`.
  - S `writeSecret replaces a stored value`.
  - C `decrypt returns the plaintext encrypt sealed under the same key and context`.
- [ ] AC5: Key check value.
  - S `checkKey reports unset on an empty database`.
  - S `writeSecret stores the key check value with the first credential` — `meta` row `key_check` has the form
    `<16 base64 chars>.<base64>`, and `checkKey` under the same key reports `match`.
  - S `readSecret reports corrupt when the key check value is absent` (row written, then the `key_check` row
    deleted with SQL).
  - S `readSecret reports corrupt when the key check value is malformed` (`key_check` set to `not-a-key-check`).
  - S `checkKey reports corrupt when the key check value decrypts to another text` (the test writes
    `encrypt(keyA, "other", "meta/key_check")` into `meta`).
  - S `writeSecret reports corrupt when the key check value is malformed and writes nothing`.
- [ ] AC6: Altered, malformed or moved ciphertext is reported as corrupt and never returned.
  - S `readSecret reports corrupt for a ciphertext copied from another secret's row` (the `github_webhook_secret`
    row's `iv` and `ciphertext` copied into the `github_app_id` row with SQL).
  - S `readSecret reports corrupt for an altered ciphertext` (one base64 character of `ciphertext` changed).
  - C `decrypt returns undefined for another context`.
  - C `decrypt returns undefined for an altered ciphertext`.
  - C `decrypt returns undefined for an IV that is not 12 bytes`.
  - C `decrypt returns undefined for text that is not base64`.
- [ ] AC7: Key derivation pinned.
  - C `decrypt opens the known vector produced with HKDF-SHA256, salt and info seluna/secrets/v1` — the Tester
    produces the vector once with Node 24's Web Crypto in a scratch script that does **not** import `src/`
    (`importKey("raw", utf8(secret), "HKDF")`, `deriveKey({ name: "HKDF", hash: "SHA-256", salt: utf8(label),
    info: utf8(label) }, …, { name: "AES-GCM", length: 256 })`, `encrypt({ name: "AES-GCM", iv, additionalData:
    utf8(context) })`), with secret `0123456789abcdef0123456789abcdef`, context `test/known-vector`, plaintext
    `seluna known vector`; the test holds `iv` and `ciphertext` as constants and a comment naming these
    parameters.
- [ ] AC8: `SELUNA_SECRET` acceptance.
  - C `selunaSecretFromEnv returns undefined when SELUNA_SECRET is absent`.
  - C `selunaSecretFromEnv returns undefined when SELUNA_SECRET is not a string`.
  - C `selunaSecretFromEnv returns undefined for 31 characters`.
  - C `selunaSecretFromEnv returns undefined for 31 characters that are 32 UTF-16 code units` (30 ASCII characters
    and one character outside the Basic Multilingual Plane, e.g. U+1F511; the test asserts the input's `length`
    is 32).
  - C `selunaSecretFromEnv returns a secret of 32 characters verbatim` (with a leading space, not trimmed).

No content is supplied verbatim by the issue (no fixture, image or configuration).

## Behavior coverage

| spec.md bullet | Covered by |
| -------------- | ---------- |
| B1 six tables, one migration, empty database | AC3 |
| B2 only base64 IV and ciphertext in the row | AC1 |
| B3 fresh IV per write | AC1 |
| B4 round trip | AC4 |
| B5 missing | AC4 |
| B6 key check stored with the first credential | AC5 |
| B7 secret changed on read and write | AC2 |
| B8 corrupt for altered, malformed, moved ciphertext and absent/malformed key check | AC5, AC6 |
| B9 HKDF parameters | AC7 |
| B10 32-character minimum | AC8 |
| B11 `token_cache` encrypted columns | AC3 (`token_cache has the columns of the storage area`, `token_cache rejects an iv …`) |
| B12 D1 only through `src/store/` | out of scope for tests: checked by the Reviewer (no `DB`/`D1Database` use outside `src/store/` in the diff); no other module touches D1 today |

## Approach

1. **Migration** `migrations/0001_initial_schema.sql` with exactly the SQL in *Schema*. Plain SQLite, no `STRICT`
   (decision 0014, option 8).
2. **`src/crypto.ts`** — Web Crypto only (`crypto.subtle`, `crypto.getRandomValues`, `TextEncoder`/`TextDecoder`,
   `btoa`/`atob`):
   - `selunaSecretFromEnv(env)` reads `SELUNA_SECRET` like `secretFromEnv` in `src/webhook-secret.ts` (`in` check,
     `unknown`, `typeof`), and returns it only when `[...value].length >= 32`.
   - `deriveKey(secret)`: `importKey("raw", utf8(secret), "HKDF", false, ["deriveKey"])`, then `deriveKey` with
     `{ name: "HKDF", hash: "SHA-256", salt: utf8(KEY_DERIVATION_LABEL), info: utf8(KEY_DERIVATION_LABEL) }` to a
     non-extractable `{ name: "AES-GCM", length: 256 }` key with usages `encrypt`, `decrypt`.
   - `encrypt`: 12 random bytes, AES-GCM with `additionalData: utf8(context)`, default 128-bit tag; returns base64.
   - `decrypt`: base64-decodes both parts (an `atob` error → `undefined`), rejects an IV that is not 12 bytes,
     decrypts; an `OperationError` from `crypto.subtle.decrypt` → `undefined`. It never throws for bad input.
   - Base64 conversion as private helpers (byte string through `String.fromCharCode` / `charCodeAt`, in chunks or
     per byte — no spread of a large array into one call).
3. **`src/store/secrets.ts`** — the only D1 code of this change:
   - `checkKey(db, key)`: `SELECT value FROM meta WHERE key = 'key_check'`; no row → `unset`; value not of the form
     `<iv>.<ciphertext>` (exactly one `.`) → `corrupt`; `decrypt(…, "meta/key_check")` `undefined` → `changed`;
     plaintext other than `KEY_CHECK_PLAINTEXT` → `corrupt`; else `match`.
   - `readSecret`: `SELECT iv, ciphertext FROM secrets WHERE key = ?1`; no row → `missing`; row not two strings →
     `corrupt`; then `checkKey`: `unset`/`corrupt` → `corrupt`, `changed` → `secret-changed`; then
     `decrypt(…, "secrets/" + name)`: `undefined` → `corrupt`, else `ok`.
   - `writeSecret`: `checkKey`; `changed` → `secret-changed`, `corrupt` → `corrupt` (nothing written); `match` →
     one upsert; `unset` → `db.batch([insert key_check ON CONFLICT (key) DO NOTHING, upsert])` (one transaction).
     Upsert: `INSERT INTO secrets (key, iv, ciphertext) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET iv =
     excluded.iv, ciphertext = excluded.ciphertext`.
   - Rows are narrowed from `first()`'s `Record<string, unknown>` with `typeof` checks; no generic `first<T>()`
     cast. D1 errors are not caught (storage area: they reach the caller).
4. **Test infrastructure** (Tester): `vitest.config.ts` reads the migrations with `readD1Migrations` from
   `@cloudflare/vitest-pool-workers` (async config) and passes them as the miniflare binding `TEST_MIGRATIONS`, and
   declares a second D1 database binding `MIGRATION_TEST_DB` used only by `test/migrations.test.ts`.
   `test/d1.ts` narrows `TEST_MIGRATIONS` from `env` with a type guard (no augmentation of `Cloudflare.Env`, which
   would type a test binding into production code) and exports `applyMigrations(db)`, which calls
   `applyD1Migrations` from `cloudflare:test`. `src/store/secrets.test.ts` calls `applyMigrations(env.DB)` and
   deletes all rows of `secrets` and `meta` in `beforeEach`, so no test relies on storage isolation between tests
   or files.

### Schema

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE secrets (
  key TEXT PRIMARY KEY NOT NULL,
  iv TEXT NOT NULL CHECK (length(iv) = 16),
  ciphertext TEXT NOT NULL
);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  event TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX deliveries_received_at ON deliveries (received_at);

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  button_url TEXT,
  silent INTEGER NOT NULL DEFAULT 0 CHECK (silent IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  created_at INTEGER NOT NULL
);

CREATE INDEX outbox_status_created_at ON outbox (status, created_at);

CREATE TABLE token_cache (
  installation_id INTEGER PRIMARY KEY NOT NULL,
  iv TEXT NOT NULL CHECK (length(iv) = 16),
  ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
```

Expected `PRAGMA table_info` per column follows from this SQL (`outbox.id` has `notnull` 0 and `pk` 1, as SQLite
reports an `INTEGER PRIMARY KEY` without `NOT NULL`; `dflt_value` is `0`, `0` and `'pending'` for `silent`,
`attempts`, `status`, `NULL` elsewhere). The Tester takes the exact expected rows from SQLite's documented
`table_info` behavior for this SQL, not from a run of the Dev's migration.

### Runtime details no one verified beforehand

- **U1** Whether the `miniflare.d1Databases` option of `cloudflareTest` (0.23.0) adds `MIGRATION_TEST_DB` to the
  wrangler configuration's `DB` or replaces the list. The Tester checks it when wiring the config (the existing
  tests and the secrets tests use `env.DB`); if it replaces, the option lists both bindings. Fail closed: AC3's
  first test asserts the database is empty before applying, so a shared database fails the test instead of passing
  silently.
- **U2** Whether D1 storage is shared between test files of one run — not relied on (cleanup in `beforeEach`, the
  emptiness assertion above).
- **U3** `readD1Migrations` (from `@cloudflare/vitest-pool-workers`) and `applyD1Migrations(db, migrations)` (from
  `cloudflare:test`) exist in 0.23.0 — **verified** by the Lead in the 0.23.0 package's type declarations.
- **U4** `db.batch` runs its statements as one transaction — Cloudflare's D1 documentation says so; not measured.
  Only the first write depends on it, and a partial batch would leave a credential without key check, which reads
  as `corrupt` (fail closed).
- **U5** Remote D1 accepts the migration (`CHECK`, `CREATE INDEX`, no `STRICT`) — plain SQLite that the local D1 of
  the test pool runs; the remote run happens at the first deploy after the merge, and a failing migration stops
  that deploy while the previous version keeps running (`docs/areas/deployment.md`).

## Options considered

Weighed in the decision records: key derivation (HKDF vs PBKDF2), the 32-character minimum in the crypto path, the
key check (encrypted constant vs HMAC vs none), row binding through additional data, base64 TEXT vs BLOB, encrypted
`token_cache` vs the issue's plain column (decision 0007); one migration vs per issue, access modules now vs with
their callers, milliseconds vs ISO text, constraints vs `STRICT`, frozen on `main` vs on release (decision 0014).
Additionally for the store's error shape:

1. **Typed result unions (`kind`)** — what `.squad/stack.md` asks for expected failures; the wizard switches over
   `secret-changed` exhaustively. Chosen.
2. **A dedicated `SecretChangedError` class thrown from `readSecret`** — the issue's wording ("fails with a
   dedicated error"), but exceptions for an expected outcome mix with D1's own errors, which must reach the caller
   unchanged.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `migrations/0001_initial_schema.sql` | new: the schema above (Dev) |
| Worker | `src/crypto.ts` | new: key derivation, AES-GCM, `SELUNA_SECRET` narrowing (Dev) |
| Worker | `src/store/secrets.ts` | new: credentials and key check (Dev) |
| Tests | `src/crypto.test.ts`, `src/store/secrets.test.ts`, `test/migrations.test.ts` | new (Tester) |
| Tests | `test/d1.ts`, `vitest.config.ts` | new helper; migrations binding and `MIGRATION_TEST_DB` (Tester) |
| Docs | see *Documentation updates* | |

No existing production file is rewritten: `src/index.ts`, `src/router.ts` and `src/webhook-secret.ts` stay as
they are (read and found final for this change).

## Signatures (for the Dev's skeleton)

`src/crypto.ts`:

```ts
/** Name of the Worker secret the encryption key is derived from. */
export const SELUNA_SECRET_NAME = "SELUNA_SECRET";
/** Fewest characters (Unicode code points) a usable `SELUNA_SECRET` has. */
export const MIN_SELUNA_SECRET_CHARACTERS = 32;
/** HKDF salt and info, and the version of the stored format. */
export const KEY_DERIVATION_LABEL = "seluna/secrets/v1";

/** An AES-256-GCM value as stored: base64 of the 12-byte IV and of the ciphertext with its 16-byte tag. */
export interface SealedValue {
  readonly iv: string;
  readonly ciphertext: string;
}

/** `SELUNA_SECRET` from the Worker environment when it is a string of at least 32 code points, else `undefined`. */
export function selunaSecretFromEnv(env: object): string | undefined;
/** The AES-256-GCM key derived from `SELUNA_SECRET` with HKDF-SHA256; non-extractable. */
export function deriveKey(selunaSecret: string): Promise<CryptoKey>;
/** Encrypts the UTF-8 bytes of `plaintext` under a fresh random IV, bound to `context` as additional data. */
export function encrypt(key: CryptoKey, plaintext: string, context: string): Promise<SealedValue>;
/** The plaintext, or `undefined` when the value is malformed, altered, bound to another context or under another key. */
export function decrypt(key: CryptoKey, sealed: SealedValue, context: string): Promise<string | undefined>;
```

`src/store/secrets.ts`:

```ts
/** The credentials kept in the `secrets` table. */
export type SecretName = "github_app_id" | "github_private_key" | "github_webhook_secret";

export type SecretReadResult =
  | { readonly kind: "ok"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "secret-changed" }
  | { readonly kind: "corrupt" };

export type SecretWriteResult =
  | { readonly kind: "ok" }
  | { readonly kind: "secret-changed" }
  | { readonly kind: "corrupt" };

export type KeyCheckResult = "unset" | "match" | "changed" | "corrupt";

/** `meta` key of the key check value. */
export const KEY_CHECK_META_KEY = "key_check";
/** The text the key check value encrypts. */
export const KEY_CHECK_PLAINTEXT = "seluna/key-check/v1";

/** Compares the stored key check value with `key`. */
export function checkKey(db: D1Database, key: CryptoKey): Promise<KeyCheckResult>;
/** Reads and decrypts one credential. D1 errors are not caught. */
export function readSecret(db: D1Database, key: CryptoKey, name: SecretName): Promise<SecretReadResult>;
/** Encrypts and stores one credential, storing the key check value with the first one. D1 errors are not caught. */
export function writeSecret(db: D1Database, key: CryptoKey, name: SecretName, value: string): Promise<SecretWriteResult>;
```

`test/d1.ts` (test helper, Tester):

```ts
/** Applies every migration under `migrations/` to `db` (idempotent). */
export function applyMigrations(db: D1Database): Promise<void>;
```

## Test files

- `src/crypto.test.ts` — tests of `src/crypto.ts`.
- `src/store/secrets.test.ts` — tests of `src/store/secrets.ts` against the real D1 binding `DB`.
- `test/migrations.test.ts` — tests of `migrations/` (no module in `src/`; `docs/UNIT_TESTS.md` allows `test/`
  mirroring the tested directory) against `MIGRATION_TEST_DB`.
- `test/d1.ts` — shared helper, not a test file.

Existing test code that calls a changed signature: none (no existing signature changes). `src/index.test.ts`
must keep passing with the changed `vitest.config.ts` (Tester checks).

Files of the change no unit test can cover: none. `migrations/0001_initial_schema.sql` is not counted by the
coverage measure (not under `src/`) and is exercised by `test/migrations.test.ts`.

## Areas

- **New area `Storage`** (`docs/areas/storage.md`, Lead decision): scope "the D1 tables and columns, data access
  through `src/store/`, the encryption of credentials and installation tokens, the key check for a changed
  `SELUNA_SECRET`"; not here: how migrations are applied (Deployment), what each setting means (setup wizard), row
  cleanup (cron). Written and indexed by the Lead in this step.
- **Deployment** (`docs/areas/deployment.md`): a migration is frozen once on `main`; link to Storage. Done by the
  Lead in this step.

## Documentation updates

| File | Change | Owner |
| ---- | ------ | ----- |
| `docs/areas/storage.md`, `docs/areas/README.md` | new area and index row | Lead (done) |
| `docs/areas/deployment.md` | frozen once on `main`; link to Storage | Lead (done) |
| `docs/ARCHITECTURE.md` | D1 component row, `token_cache` and `meta` rows, paragraph linking Storage, 0007, 0014 | Lead (done) |
| `docs/decisions/0007-…`, `0014-…`, `README.md` index | extended / new, `Proposed` | Lead (done) |
| `migrations/README.md` | replace "The first migration follows with issue #7" by the list of migrations (`0001_initial_schema.sql`: all six tables, see `docs/areas/storage.md`); "A released migration is never edited" → "A migration is never edited once it is on `main`" | Dev |
| `CHANGELOG.md` | under `## [Unreleased]` / `### Added`: "D1 schema: the first migration creates the tables for settings, encrypted credentials, deliveries, the outbox, installation tokens and instance metadata; credentials and installation tokens are stored only encrypted (AES-256-GCM, key derived from `SELUNA_SECRET`, which needs at least 32 characters)." | Dev |
| `.squad/project.md` | *Security areas*, *Encrypted credentials*: name `src/crypto.ts` and `src/store/secrets.ts`, add that `token_cache` holds installation tokens encrypted the same way, that each ciphertext is bound to its row and that the key check in `meta` reports a changed `SELUNA_SECRET`; *Integration surface*, "A new or changed D1 table or column": "the access module under `src/store/`" | Dev |

`README.md`, `.dev.vars.example` and `cloudflare.bindings` in `package.json` already say "at least 32
characters" for `SELUNA_SECRET`: no change.

## Architecture check

- "GitHub App credentials are only ever stored encrypted" (decision 0007) — implemented and widened to the
  installation tokens.
- "Each user's data stays in that user's own Cloudflare account" — unchanged; no outbound call.
- "A delivery is processed once", "stored before sent" — the `deliveries` primary key and the `outbox` table make
  them possible; enforced by #12.
- No guarantee is weakened. `docs/ARCHITECTURE.md` is updated (D1 tables) and links 0007, 0014 and the area.

## Security considerations

- [x] Byte or length limits: the only limit on input is the `SELUNA_SECRET` minimum of 32 **code points**,
  counted on the JavaScript string before UTF-8 encoding; no limit on a credential's size beyond D1's row limit.
  The `iv` CHECK counts base64 characters (16), the decoded IV is checked for 12 bytes.
- [x] Exceptions that can reach a user-visible message: none — no route uses the store yet. `decrypt` catches the
  `DOMException` of `atob` and the `OperationError` of `crypto.subtle.decrypt` and returns `undefined`; D1
  exceptions propagate unchanged to the caller, which (#10–#12) must answer without a body, as the webhook does
  today. Nothing in `src/crypto.ts` or `src/store/` logs.
- [x] Key handling: the derived key is non-extractable; `SELUNA_SECRET` and plaintexts are never stored or
  returned in a result other than `ok`.
- [x] IV: 96 bits from `crypto.getRandomValues` per write; with a handful of credentials and tokens per instance
  the GCM random-IV bound (2^32 messages per key) is not approached.
- [x] Offline guessing: HKDF is fast, so the strength rests on `SELUNA_SECRET`'s randomness; the 32-code-point
  minimum and the deploy form's advice are the mitigation (decision 0007, *Consequences*).

## Decision records

- `docs/decisions/0007-github-app-credentials-encrypted-in-d1.md` — extended in place (unreleased; no `v*` tag
  exists), status `Proposed`, area `Storage`.
- `docs/decisions/0014-d1-schema-and-data-access.md` (Proposed) — new.

## Out of scope / follow-ups

- Access modules for the other tables and the reset of a changed secret: #11, #12, #15, #18 (spec.md, *Out of
  scope*).
- **Follow-up issue (orchestrator, label `squad`, this repository — project block of `CLAUDE.md`):**
  title "[Squad] Migrations are frozen once on main, not once released"; body: "`CLAUDE.md` (*Architecture*,
  `migrations/` bullet) and its mirror in `.github/copilot-instructions.md` say D1 migrations are never edited
  'once released'. Every user's copy deploys its own `main` (decision 0013), so a migration that reached `main` can
  already be applied in a user's database before any release; decision 0014 and `docs/areas/deployment.md` now say
  'never edited once it is on `main`'. Change the bullet in both files to match and run
  `python3 .squad/tools/config-check.py`."
- Issue #8 should reuse `selunaSecretFromEnv` for its own 32-character refusal (a note for that issue, no action
  here).
