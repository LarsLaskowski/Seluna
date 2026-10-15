# 0014: D1 schema and data access

- **Status:** Proposed
- **Date:** 2026-10-15
- **Area:** Storage
- **Source:** Issue #7
- **Supersedes:** —

## Context

Issue #7 asks for the first D1 migration with all six tables (`settings`, `secrets`, `deliveries`, `outbox`,
`token_cache`, `meta`) and for data access through `src/store/` only. The tables are used by later issues: the
webhook pipeline and the outbox (#12), the installation tokens (#15), the cron jobs (#18) and the setup wizard
(#8–#11). Every user's copy deploys its own `main` and applies the migrations before each deploy
([decision 0013](0013-deploy-to-cloudflare-and-workers-builds.md)), so a migration that reached `main` may already
be applied in a user's database before any release exists.

## Options considered

How the schema arrives:

1. **One migration with all six tables now** (issue #7) — the later issues build on a fixed schema and need no
   migration of their own unless they change it. Chosen.
2. **Each table with the issue that first uses it** — no table without code, but six migrations for one design
   and a schema no one sees as a whole.

What this change adds besides the schema:

3. **Only the access code the credentials need (`src/store/secrets.ts`, with the key check in `meta`)** — the other
   tables get their access module with the issue that first reads or writes them, so no module exists without a
   caller and its tests. Chosen.
4. **An access module per table now** — complete, but the modules would be shaped by guesses about #11, #12, #15
   and #18 and changed again there.

How times are stored:

5. **INTEGER milliseconds since the epoch, UTC** — what the injected clock (`() => Date`) yields with
   `getTime()`, sortable, and compared in SQL without parsing. Chosen.
6. **ISO 8601 text** — readable in a dump, but comparisons rely on one exact format everywhere.

How strict the tables are:

7. **Declared column types with `NOT NULL` and `CHECK` constraints on the closed value sets (`outbox.status`,
   `outbox.silent`, `outbox.attempts`, the IV length)** — a wrong write fails at the database instead of being read
   back later. Chosen.
8. **`STRICT` tables** — would also reject a value of the wrong type, but whether D1 accepts them on every path
   was not verified; a migration that fails stops every deploy.

When a migration is frozen:

9. **Once it is on `main`** — copies deploy `main`, so an edited migration would never run again in a database that
   already applied it, and the two schemas would differ silently. Chosen; the deployment area says so.
10. **Once it is released** (the earlier wording) — wrong for this project, where a copy can take `main` before a
    release.

## Decision

The first migration `migrations/0001_initial_schema.sql` creates all six tables with typed, constrained columns
and times in milliseconds; only modules under `src/store/` access D1, and this change adds the one for
credentials and the key check. A migration is never edited once it is on `main`. The tables are described in
[`areas/storage.md`](../areas/storage.md).

## Consequences

- Issues #11, #12, #15 and #18 each add the store module for the tables they use and test it against the real D1
  of the Workers test pool.
- Later issues need no migration of their own unless they change the schema: a column a later issue needs (for
  example a `sent_at` for the outbox) is a new migration, while `meta` and `settings` take new keys without one.
  The failed-attempt counter of the setup login (#8) is such a value and belongs in `meta`, not in a new table.
- `CLAUDE.md` still says a migration is frozen "once released"; it is corrected in a squad-maintenance change,
  not in this product change.
