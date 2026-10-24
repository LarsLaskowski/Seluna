# Tasks: Redirect the Worker root URL to /setup

Plan: [plan.md](plan.md) — Status: Draft

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G1 | Tests first: the root cases of *Tests per criterion* (302, headers, log entry, `POST /` bodies, no dependency called) and the changed 404 table; they fail on the current code where they assert the redirect | `src/router.test.ts` | AC1, AC2, AC3, AC4, AC5, AC6 | — | Tester | [ ] |
| 2 | G2 | The `GET /` / `HEAD /` branch in `route()` with `emptyResponse(302, [], SETUP_PATH)` as in *Approach* | `src/router.ts` | AC1, AC2, AC3, AC4, AC5, AC6 | 1 | Dev | [ ] |
| 3 | G2 | Guides and changelog as in *Documentation updates* (CONTRIBUTING.md line 25 with its existing `/setup` omission, setup.md *Next steps*, README.md line 64, CHANGELOG.md `[Unreleased]` *Added*) | `docs/CONTRIBUTING.md`, `docs/setup.md`, `README.md`, `CHANGELOG.md` | AC1 | 2 | Dev | [ ] |
| 4 | G3 | Area documents and architecture as in *Documentation updates*, checked against the final code | `docs/areas/http-routes.md`, `docs/areas/setup-wizard.md`, `docs/ARCHITECTURE.md` | AC1, AC2, AC3, AC4, AC5, AC6 | 2 | Lead | [ ] |
