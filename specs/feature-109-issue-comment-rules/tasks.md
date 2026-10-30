# Tasks: Issue and comment rules

Plan: [plan.md](plan.md) — Status: Draft

One group: the rules, the owner and the settings are one API change that compiles only together.

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G1 | Skeleton: the signatures of plan *Signatures* with their placeholders; adapt the existing call sites of plan *Test files* (Dev's list) | all files of plan *Affected projects and types* except the fixtures; the listed test call sites | AC1–AC11 | — | Dev | [ ] |
| 2 | G1 | Fixtures `created-pull-request.json` and `created-draft-pull-request.json`, both fixture READMEs | `test/fixtures/issue_comment/`, `test/fixtures/issues/README.md` | AC13 | 1 | Tester | [ ] |
| 3 | G1 | Tests first per plan *Tests per criterion*; adapt the rule-list expectations (Tester's list) | the test files of plan *Test files* | AC1–AC11 | 1, 2 | Tester | [ ] |
| 4 | G1 | Implementation until green and the *Coverage gate* passes | as task 1 | AC1–AC11 | 3 | Dev | [ ] |
| 5 | G1 | Coverage pass | test files | AC1–AC11 | 4 | Tester | [ ] |
| 6 | G1 | Documentation updates of plan *Documentation updates* | `docs/areas/notifications.md`, `docs/areas/setup-wizard.md`, `docs/areas/storage.md`, `docs/areas/github-api.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `README.md`, `docs/setup.md`, `CHANGELOG.md`, `.squad/project.md` | AC12 | 4 | Dev | [ ] |
| 7 | G1 | Live check on a deployed copy (fact 7 of the plan), recorded before the PR is marked ready | — | AC13 | PR open (step 11) | Product Manager | [ ] |
