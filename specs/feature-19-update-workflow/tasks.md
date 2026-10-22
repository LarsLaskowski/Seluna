# Tasks: Update workflow for users' copies

Plan: [plan.md](plan.md) — Status: Draft

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G1 | Add `@types/node` (dev), split `vitest.config.ts` into the `workers` and `node` projects; confirm facts 11 and 12 (fallback of decision 0032 if 11 fails) | `package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig.json` (fallback only) | AC1–AC13 | — | Dev | [x] |
| 1a | G1 | Fact 6 from the Product Manager's Workers Builds log of `LarsLaskowski/selunatest` and a clone of that public copy (done; result in plan facts 6 and 17, steps 9, 10b, 14 revised) | none (answer in `log.md`) | AC10, AC11, AC12 | — | Orchestrator with the Product Manager | [x] |
| 2 | G1 | Workflow skeleton: the full YAML of *Approach*, `run` block failing with `Not implemented` | `.github/workflows/update.yml` | AC1–AC12 | — | Dev | [x] |
| 3 | G2 | Harness with the signatures of the plan | `test/update-workflow.ts` | AC1–AC13 | 1, 2 | Tester | [x] |
| 4 | G2 | Tests of *Tests per criterion*, failing against the skeleton (AC13's tests fail until task 8) | `test/update-workflow.test.ts` | AC1–AC13 | 3 | Tester | [x] |
| 5 | G3 | Implement the script, steps 1–14 of *Approach* (step 9 as revised after task 1a, if needed), until every test passes and actionlint and shellcheck are clean | `.github/workflows/update.yml` | AC1–AC12 | 1a, 4 | Dev | [x] |
| 6 | G4 | Write `docs/update.md` with the eight sections of *Documentation updates* | `docs/update.md` | AC13 | 5 | Dev | [ ] |
| 7 | G4 | Link the guide from *Updates*; changelog entry | `docs/setup.md`, `CHANGELOG.md` | AC13 | 6 | Dev | [ ] |
| 8 | G4 | Release-notes rule and `update.yml` rules; Node project in the test layout; security area *Update workflow* | `docs/CONTRIBUTING.md`, `.squad/stack.md`, `docs/UNIT_TESTS.md`, `.squad/project.md` | AC13 | 5 | Dev | [ ] |
| 9 | G5 | Section *Update*, *Scope*, *Limits and errors*; index row | `docs/areas/deployment.md`, `docs/areas/README.md` | AC1–AC13 | 5 | Lead | [ ] |
| 10 | G5 | *Not here* entry for applying a release | `docs/areas/scheduled-jobs.md` | AC13 | 5 | Lead | [ ] |
| 11 | G5 | *Deployment*: the update path, linking decision 0031 | `docs/ARCHITECTURE.md` | AC13 | 9 | Lead | [ ] |
| 12 | G5 | Check decisions 0031 and 0032 against the built workflow and tests; `decision-check.py` | `docs/decisions/0031-update-workflow-for-copies.md`, `docs/decisions/0032-node-test-project-for-workflow-scripts.md` | AC1–AC13 | 5 | Lead | [ ] |
| 13 | G6 | Live check before the PR is marked ready, on `LarsLaskowski/selunatest` (or another button copy): add `update.yml` by hand and run it; record facts 4 and 5 (push accepted, Workers Build deploys, `/health` version) and the run time; fact 6 is settled for this copy, so fact 17 remains: read the root diff of any further button copy (`git diff --stat <matched upstream commit> <root>`) | none (results in `log.md`) | AC1, AC10, AC11 | 5 | Orchestrator with the Product Manager | [ ] |
