# Tasks: Retry, cleanup and update notice

Plan: [plan.md](plan.md) — Status: Draft

Each group is one launch per member in steps 4–6, in table order. The skeleton (step 4) covers every signature of
`plan.md` at once, before G1; the groups then run tests first (Tester) and implementation (Dev) one after the other.

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G0 | Skeleton of every signature in *Signatures* (bodies throw), the i18n keys with their real texts; *Build* and *Type check* pass | `src/version.ts`, `src/github/http.ts`, `src/github/release.ts`, `src/store/outbox.ts`, `src/store/deliveries.ts`, `src/store/token-cache.ts`, `src/store/notified-release.ts`, `src/delivery.ts`, `src/i18n/messages.ts`, `src/i18n/en.ts`, `src/i18n/de.ts`, `src/cleanup.ts`, `src/outbox-retry.ts`, `src/release-check.ts`, `src/scheduled.ts`, `src/index.ts` | AC1–AC10 | — | Dev | [x] |
| 2 | G1 | Fixture `release-latest.json` copied unchanged, its README row, the double's route `latestRelease`; failing tests of the version parser and comparison, the public request and the release reader | `test/fixtures/github/release-latest.json`, `test/fixtures/github/README.md`, `test/github.ts`, `src/version.test.ts`, `src/github/http.test.ts`, `src/github/release.test.ts` | AC8, AC9 | 1 | Tester | [x] |
| 3 | G1 | Implement `src/version.ts`, `publicGitHubRequest`, `src/github/release.ts` | `src/version.ts`, `src/github/http.ts`, `src/github/release.ts` | AC8, AC9 | 2 | Dev | [x] |
| 4 | G2 | Failing tests of the outbox statements (fifth attempt, exhausted rows, due rows), the marked-failed log entry and the cleanup | `src/store/outbox.test.ts`, `src/delivery.test.ts`, `src/cleanup.test.ts` | AC1, AC2, AC4 | 3 | Tester | [x] |
| 5 | G2 | Implement the outbox statements, the two delete statements, `src/delivery.ts` and `src/cleanup.ts` | `src/store/outbox.ts`, `src/store/deliveries.ts`, `src/store/token-cache.ts`, `src/delivery.ts`, `src/cleanup.ts` | AC1, AC2, AC4 | 4 | Dev | [x] |
| 6 | G3 | Failing tests of the retry job | `src/outbox-retry.test.ts` | AC1, AC2, AC3 | 5 | Tester | [x] |
| 7 | G3 | Implement `src/outbox-retry.ts` | `src/outbox-retry.ts` | AC1, AC2, AC3 | 6 | Dev | [x] |
| 8 | G4 | Failing tests of the remembered release, the release message and the release check | `src/store/notified-release.test.ts`, `src/release-check.test.ts` | AC6, AC7, AC8, AC9 | 7 | Tester | [x] |
| 9 | G4 | Implement `src/store/notified-release.ts` and `src/release-check.ts` | `src/store/notified-release.ts`, `src/release-check.ts` | AC6, AC7, AC8, AC9 | 8 | Dev | [ ] |
| 10 | G5 | Failing tests of the dispatch and the Worker wiring (replaces `src/index.test.ts:203-218`) | `src/scheduled.test.ts`, `src/index.test.ts` | AC5, AC10 | 9 | Tester | [ ] |
| 11 | G5 | Implement `src/scheduled.ts` and the `scheduled` handler; update `.squad/project.md`, `README.md`, `CHANGELOG.md` as *Documentation updates* says; coverage gate | `src/scheduled.ts`, `src/index.ts`, `.squad/project.md`, `README.md`, `CHANGELOG.md` | AC5, AC10 | 10 | Dev | [ ] |
| 12 | G6 | Documentation against the final code: re-check `docs/areas/scheduled-jobs.md`; edit `docs/areas/README.md`, `notifications.md`, `storage.md`, `github-api.md`, `deployment.md`, `http-routes.md` and `docs/ARCHITECTURE.md` as *Documentation updates* says; `decision-check.py` | `docs/areas/*.md`, `docs/ARCHITECTURE.md` | AC1–AC10 | 11 | Lead | [ ] |
