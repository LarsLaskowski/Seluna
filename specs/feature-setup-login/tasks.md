# Tasks: Setup wizard login and protection

Plan: [plan.md](plan.md) — Status: Draft

Every documentation edit appears in exactly one row; the Lead's approval only touches status, index rows and bookkeeping.

| # | Task | Files | Tests (AC) | Owner | Done |
| - | ---- | ----- | ---------- | ----- | ---- |
| 1 | Area document *Setup wizard* and its index row; edits to *HTTP routes*, *Storage*, *Deployment*; `ARCHITECTURE.md`; decision 0015 and its index row; 0011 *Decision* text | `docs/areas/setup-wizard.md`, `docs/areas/README.md`, `docs/areas/http-routes.md`, `docs/areas/storage.md`, `docs/areas/deployment.md`, `docs/ARCHITECTURE.md`, `docs/decisions/0015-setup-login.md`, `docs/decisions/0011-public-http-surface.md`, `docs/decisions/README.md` | — | Lead | [x] |
| 2 | Skeleton: every signature of *Signatures* with TSDoc and `throw new Error("Not implemented")` bodies (constants with their values); `RouteDeps.setup`; `index.ts` passes `SetupDeps`; `makeDeps` in `src/router.test.ts` gets a `setup` value (mechanical); *Build* and `typecheck` pass | `src/base64url.ts`, `src/crypto.ts`, `src/store/login-attempts.ts`, `src/setup/*.ts`, `src/router.ts`, `src/index.ts`, `src/router.test.ts` | — | Dev | [ ] |
| 3 | Tests first for AC1–AC14 (the named tests only, the AC14 ratio tests by *Linear-time tests* in the plan; the crypto export pin updated); throwaway `SELUNA_SECRET` binding in `vitest.config.ts` for the `src/index.test.ts` case | `src/base64url.test.ts`, `src/crypto.test.ts`, `src/store/login-attempts.test.ts`, `src/setup/{cookies,session,csrf,language,texts,pages,handler}.test.ts`, `src/router.test.ts`, `src/index.test.ts`, `vitest.config.ts` | AC1–AC14 | Tester | [ ] |
| 4 | `base64url.ts` and the three `crypto.ts` additions | `src/base64url.ts` (canonical form only), `src/crypto.ts` | AC4, AC5 | Dev | [ ] |
| 5 | Login-attempt store (atomic upsert, fail-closed narrowing); run the AC2 store tests before the review (U1) | `src/store/login-attempts.ts` | AC2 | Dev | [ ] |
| 6 | Cookies, session, CSRF | `src/setup/cookies.ts`, `src/setup/session.ts`, `src/setup/csrf.ts` | AC3, AC5, AC13, AC14 | Dev | [ ] |
| 7 | Language, texts (English from the area document, German translation), pages with CSP and headers | `src/setup/language.ts`, `src/setup/texts.ts`, `src/setup/pages.ts` | AC8, AC9, AC14 | Dev | [ ] |
| 8 | Handler and router dispatch | `src/setup/handler.ts`, `src/router.ts`, `src/index.ts` | AC1–AC4, AC6, AC7, AC10–AC12 | Dev | [ ] |
| 9 | Coverage pass: tests only for lines the *Coverage gate* reports uncovered | test files of the change | — | Tester | [ ] |
| 10 | `CHANGELOG.md` entry (text in plan) | `CHANGELOG.md` | — | Dev | [ ] |
| 11 | *Next steps* in the setup guide (text in plan) | `docs/setup.md` | — | Dev | [ ] |
| 12 | *Setup login* security area bullet (text in plan) | `.squad/project.md` | — | Dev | [ ] |
