# Tasks: HTTP routes: health, webhook, not found, payload too large

Plan: [plan.md](plan.md) — Status: Draft

Every documentation edit appears in exactly one row; the Lead's approval only touches status, index rows and bookkeeping.

| # | Task | Files | Tests (AC) | Owner | Done |
| - | ---- | ----- | ---------- | ----- | ---- |
| 1 | Area document, its index row, `ARCHITECTURE.md` endpoint rules, decision 0011 and its index row | `docs/areas/http-routes.md`, `docs/areas/README.md`, `docs/ARCHITECTURE.md`, `docs/decisions/0011-public-http-surface.md`, `docs/decisions/README.md` | AC8 | Lead | [x] |
| 2 | Skeleton: `resolveJsonModule`, `src/body.ts` and `src/router.ts` with the plan's signatures, `src/index.ts` delegating to `handleRequest`; *Build* passes | `tsconfig.json`, `src/body.ts`, `src/router.ts`, `src/index.ts` | — | Dev | [x] |
| 3 | Tests first: the named tests of AC1, AC3–AC7, failing on the skeleton; replace the existing test in `src/index.test.ts` | `src/body.test.ts`, `src/router.test.ts`, `src/index.test.ts` | AC1, AC3, AC4, AC5, AC6, AC7 | Tester | [x] |
| 4 | Implement `parseContentLength` and `readBodyWithLimit` | `src/body.ts` | AC5, AC6 | Dev | [x] |
| 5 | Implement `handleRequest` (routes, 202/404/413/400, one log entry) and the default export wiring | `src/router.ts`, `src/index.ts` | AC1, AC3, AC4, AC5, AC6, AC7 | Dev | [x] |
| 6 | Bundle check: *Build*, then `grep -c 'var version = "' dist/index.js` is `1` and `grep -c devDependencies dist/index.js` is `0`, outputs in the report | `dist/index.js` (not committed) | AC2 | Dev | [x] |
| 7 | `.squad/project.md` security area bullets, exactly as in the plan's *Documentation updates* | `.squad/project.md` | AC8 | Dev | [x] |
| 8 | `docs/CONTRIBUTING.md` line 25, exactly as in the plan | `docs/CONTRIBUTING.md` | AC8 | Dev | [x] |
| 9 | `CHANGELOG.md` *Unreleased / Added* entries, exactly as in the plan | `CHANGELOG.md` | AC8 | Dev | [x] |
| 10 | Coverage pass: *Test with coverage* and *Coverage gate*; tests only for lines the gate reports uncovered | `src/*.test.ts` | — | Tester | [ ] |
