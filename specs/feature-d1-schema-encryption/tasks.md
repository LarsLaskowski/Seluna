# Tasks: D1 schema and encryption of credentials

Plan: [plan.md](plan.md) — Status: Draft

Every documentation edit appears in exactly one row; the Lead's approval only touches status, index rows and bookkeeping.

| # | Task | Files | Tests (AC) | Owner | Done |
| - | ---- | ----- | ---------- | ----- | ---- |
| 1 | Skeleton: exports of *Signatures* with TSDoc, bodies `throw new Error("Not implemented");`; *Build* and *Type check* pass | `src/crypto.ts`, `src/store/secrets.ts` | — | Dev | [ ] |
| 2 | Test infrastructure: `TEST_MIGRATIONS` from `readD1Migrations`, `MIGRATION_TEST_DB` binding (plan U1), `applyMigrations` helper with a type guard; `src/index.test.ts` still green | `vitest.config.ts`, `test/d1.ts` | — | Tester | [ ] |
| 3 | Known vector for AC7, produced once by a scratch script with Node Web Crypto that imports nothing from `src/` | (scratch only; constants go into task 4) | AC7 | Tester | [ ] |
| 4 | Tests first for `src/crypto.ts` | `src/crypto.test.ts` | AC1, AC2, AC4, AC6, AC7, AC8 | Tester | [ ] |
| 5 | Tests first for `src/store/secrets.ts` (cleanup of `secrets` and `meta` in `beforeEach`) | `src/store/secrets.test.ts` | AC1, AC2, AC4, AC5, AC6 | Tester | [ ] |
| 6 | Tests first for the migration (empty-database assertion first) | `test/migrations.test.ts` | AC3 | Tester | [ ] |
| 7 | Migration exactly as in plan *Schema* | `migrations/0001_initial_schema.sql` | AC3 | Dev | [ ] |
| 8 | Implement `src/crypto.ts` (plan *Approach* 2) | `src/crypto.ts` | AC1, AC2, AC4, AC6, AC7, AC8 | Dev | [ ] |
| 9 | Implement `src/store/secrets.ts` (plan *Approach* 3) | `src/store/secrets.ts` | AC1, AC2, AC4, AC5, AC6 | Dev | [ ] |
| 10 | Coverage pass: only lines the *Coverage gate* reports uncovered | `src/crypto.test.ts`, `src/store/secrets.test.ts` | — | Tester | [ ] |
| 11 | `migrations/README.md`: list of migrations, frozen once on `main` | `migrations/README.md` | — | Dev | [ ] |
| 12 | `CHANGELOG.md` entry under `[Unreleased]` / `Added` (text in plan) | `CHANGELOG.md` | — | Dev | [ ] |
| 13 | `.squad/project.md`: *Encrypted credentials* and *Integration surface* (text in plan) | `.squad/project.md` | — | Dev | [ ] |
| 14 | Area Storage (new) and index row; Deployment (frozen on `main`, link); `ARCHITECTURE.md` D1 sections; decisions 0007 (extended) and 0014 (new) with index rows | `docs/areas/storage.md`, `docs/areas/README.md`, `docs/areas/deployment.md`, `docs/ARCHITECTURE.md`, `docs/decisions/0007-github-app-credentials-encrypted-in-d1.md`, `docs/decisions/0014-d1-schema-and-data-access.md`, `docs/decisions/README.md` | — | Lead | [x] |
