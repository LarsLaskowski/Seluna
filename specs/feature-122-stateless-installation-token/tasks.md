# Tasks: Accept GitHub's stateless installation token format

Plan: [plan.md](plan.md) — Status: Draft

One group, no new API: the checking function keeps its signature, so the skeleton row is empty.

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 0 | G1 | Skeleton: no new API | — | — | — | — | [x] |
| 1 | G1 | Add `STATELESS_TOKEN`, reference-built, to the GitHub test helpers | `test/github.ts` | AC1, AC3, AC4 | — | Tester | [x] |
| 2 | G1 | Write and adapt the tests of *Tests per criterion*, failing on today's code (AC5 cases green) | `src/github/token-text.test.ts`, `src/github/installation-token.test.ts`, `src/store/token-cache.test.ts`, `src/github/api-client.test.ts` | AC1, AC2, AC3, AC4, AC5 | 1 | Tester | [x] |
| 3 | G1 | Replace `TOKEN_TEXT` by `/^[A-Za-z0-9_.-]{1,4096}$/` and rewrite the doc comment | `src/github/token-text.ts` | AC1, AC2, AC3, AC4, AC5 | 2 | Dev | [x] |
| 4 | G1 | Name `STATELESS_TOKEN` in *Test doubles* | `.squad/project.md` | AC1 | 3 | Tester | [x] |
| 5 | G1 | Update the token form in the area document, the *Security areas* entry and the changelog | `docs/areas/github-api.md`, `.squad/project.md`, `CHANGELOG.md` | AC6 | 3 | Dev | [x] |
