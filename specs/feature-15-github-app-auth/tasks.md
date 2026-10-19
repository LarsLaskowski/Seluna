# Tasks: GitHub App authentication

Plan: [plan.md](plan.md) — Status: Draft (revised 1)

Each task names the acceptance criteria of `spec.md` it delivers and the tasks it waits for; steps 4–6 run the task
groups in this order. Every documentation edit is in exactly one row.

| # | Task | Files | Criteria | Depends on | Owner | Done |
| - | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | Area document GitHub API, its index row, the storage rules for `token_cache`, `ARCHITECTURE.md`, decision 0026 | `docs/areas/github-api.md`, `docs/areas/README.md`, `docs/areas/storage.md`, `docs/ARCHITECTURE.md`, `docs/decisions/0026-…`, `docs/decisions/README.md` | AC1, AC2, AC4, AC8 | — | Lead | [x] |
| 2 | Fixtures: `pull-request.json` (captured answer of pull request 77, anonymized per `.squad/project.md` *Fixtures from real deliveries*, leak grep), `installation-token.json` and `installations.json` (OpenAPI examples verbatim), README rows | `test/fixtures/github/` | AC10, AC11 | — | Tester | [x] |
| 3 | GitHub API double: `githubApiDouble(routes)` with the four routes, sequences and request functions, `Authorization` recorded, optional answer `headers`; `githubDouble` kept as a wrapper | `test/github.ts` | AC1, AC5, AC12 | 2 | Tester | [x] |
| 4 | Skeleton of every signature in *Signatures*; make `status.test.ts` (`EMPTY`, two `statusView` calls) and `pages.test.ts` (`statusViewWith`) compile, expected values untouched | `src/github/*.ts`, `src/store/token-cache.ts`, `src/setup/status.ts`, `src/setup/texts.ts`, `src/setup/handler.ts`, the two test files | AC1–AC15 | 3 | Dev | [x] |
| 5 | Tests first: the tests of *Tests per criterion*; set the expected `installations` of every existing `statusView` case and affected `handler.test.ts` page assertion, listed in the report (plan, *Test files*) | the test files of *Test files* | AC1–AC15 | 4 | Tester | [x] |
| 6 | Key import, app JWT, request builder and sender, credential resolution (with `parseAppId` used by `status.ts`); key size bound of 4096 bits | `src/github/private-key.ts`, `app-jwt.ts`, `http.ts`, `app-credentials.ts` | AC3, AC5, AC6, AC14 | 5 | Dev | [x] |
| 7 | Token cache store | `src/store/token-cache.ts` | AC4, AC8, AC9 | 5 | Dev | [x] |
| 8 | Installation token and API client | `src/github/installation-token.ts`, `src/github/api-client.ts` | AC1, AC2, AC6, AC7, AC8, AC9, AC10 | 6, 7 | Dev | [x] |
| 9 | Installations list, status view, page rendering, texts, `startPage` wiring | `src/github/installations.ts`, `src/setup/status.ts`, `src/setup/pages.ts`, `src/setup/texts.ts`, `src/setup/handler.ts` | AC11, AC12, AC13, AC15 | 6 | Dev | [x] |
| 10 | Documentation: setup wizard area, HTTP routes area, `.squad/project.md` (security area, test double), `CHANGELOG.md` | `docs/areas/setup-wizard.md`, `docs/areas/http-routes.md`, `.squad/project.md`, `CHANGELOG.md` | AC11, AC12, AC13, AC15 | 9 | Dev | [x] |
| 11 | Coverage pass; any `handler.test.ts` start page test still affected after task 5 (listed in the report) | test files | AC13 | 8, 9 | Tester | [x] |
| 12 | Live check on a deployed copy before the PR is marked ready (plan, *Security considerations*) | — | AC1, AC2, AC11 | 11 | Product Manager | [ ] |
