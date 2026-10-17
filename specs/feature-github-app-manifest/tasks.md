# Tasks: Setup wizard step: create the GitHub App through the manifest flow

Plan: [plan.md](plan.md) — Status: Draft

Every documentation edit appears in exactly one row; the Lead's approval only touches status, index rows and bookkeeping.

| # | Task | Files | Tests (AC) | Owner | Done |
| - | ---- | ----- | ---------- | ----- | ---- |
| 1 | Skeleton: every signature of *Signatures*, bodies `throw new Error("Not implemented")`; adapt the `SetupDeps` call sites in the tests mechanically (`githubFetch`, `version`) | `src/github/{manifest,conversion,private-key,worker-secrets}.ts`, `src/setup/{github-state,github-step}.ts`, `src/setup/{handler,pages,texts}.ts`, `src/crypto.ts`, `src/body.ts`, `src/store/secrets.ts`, `src/webhook-secret.ts`, `src/index.ts`, `src/setup/handler.test.ts`, `src/router.test.ts` (call sites only) | — | Dev | [ ] |
| 2 | Test data: the documented conversion answer verbatim, the 404 and 422 answers, the expected PKCS#8 PEM (`openssl pkcs8 -topk8 -nocrypt`), the fixtures `README.md`; the GitHub API double | `test/fixtures/github/*`, `test/github.ts` | AC7, AC8, AC9 | Tester | [ ] |
| 3 | Tests first: the tests named in AC1–AC15 that can fail on the skeleton | the test files of *Test files* | AC1–AC15 | Tester | [ ] |
| 4 | Manifest, account allow-list, form action | `src/github/manifest.ts` | AC1, AC2 | Dev | [ ] |
| 5 | Signing key `setup-github`; state create and check | `src/crypto.ts`, `src/setup/github-state.ts` | AC3 | Dev | [ ] |
| 6 | Worker-secret state; webhook secret source (Worker secret, else D1) and wiring | `src/github/worker-secrets.ts`, `src/webhook-secret.ts`, `src/index.ts` | AC4, AC11 | Dev | [ ] |
| 7 | Bounded JSON reader moved to `body.ts`; conversion client | `src/body.ts`, `src/telegram.ts`, `src/github/conversion.ts` | AC7, AC13 | Dev | [ ] |
| 8 | PEM to PKCS#8 with import check | `src/github/private-key.ts` | AC8 | Dev | [ ] |
| 9 | `writeSecrets` in one guarded batch | `src/store/secrets.ts` | AC10 | Dev | [ ] |
| 10 | Step logic: view, start, return fields, finish | `src/setup/github-step.ts` | AC4, AC5, AC6, AC9 | Dev | [ ] |
| 11 | Pages, CSP form target, texts (en, de), routes and request order | `src/setup/{pages,texts,handler}.ts` | AC4, AC5, AC6, AC9, AC12, AC14, AC15 | Dev | [ ] |
| 12 | Area document Setup wizard | `docs/areas/setup-wizard.md` | AC12 (texts test) | Dev | [ ] |
| 13 | Area document HTTP routes | `docs/areas/http-routes.md` | — | Dev | [ ] |
| 14 | Area document Storage | `docs/areas/storage.md` | — | Dev | [ ] |
| 15 | Area document Deployment | `docs/areas/deployment.md` | — | Dev | [ ] |
| 16 | Architecture | `docs/ARCHITECTURE.md` | — | Dev | [ ] |
| 17 | Project knowledge: permissions, setup login CSRF exception, manifest-flow security area, encrypted credentials, GitHub API double | `.squad/project.md` | — | Dev | [ ] |
| 18 | Setup guide | `docs/setup.md` | — | Dev | [ ] |
| 19 | Changelog entry under `[Unreleased]` | `CHANGELOG.md` | — | Dev | [ ] |
| 20 | Coverage pass: tests only for lines the *Coverage gate* reports uncovered | test files of *Test files* | — | Tester | [ ] |
| 21 | Decision record 0017 and its index row | `docs/decisions/0017-github-app-manifest-flow.md`, `docs/decisions/README.md` | — | Lead | [x] |
| 22 | Live check on a deployed copy: personal account and organization, install with All repositories, a delivery answered 202 (issue AC-a to AC-c; *Runtime details only a live run can verify* 1–5) | — | — | Product Manager | [ ] |
