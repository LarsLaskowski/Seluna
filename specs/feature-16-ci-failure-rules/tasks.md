# Tasks: CI failure rules

Plan: [plan.md](plan.md) — Status: Draft

Each task names the acceptance criteria of `spec.md` it delivers (`plan-check.py` reports a criterion no task
covers) and the tasks it waits for; steps 4–6 run the task groups in this order. Every documentation edit is
in exactly one row.

| # | Task | Files | Criteria | Depends on | Owner | Done |
| - | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | Skeleton: `DraftCheck` and `Notification.draftCheck`, the three `MessageTexts` keys with their English and German texts, stubs of `src/rules/workflow-run.ts`, both rules, `src/draft-lookup.ts`, `WebhookDeps.lookUpDraft` with the wiring in `src/index.ts`, and the `lookUpDraft` default in the `harness` of `src/webhook.test.ts` | `src/rules/rule.ts`, `src/i18n/messages.ts`, `src/i18n/en.ts`, `src/i18n/de.ts`, `src/rules/workflow-run.ts`, `src/rules/ci-failed-default-branch.ts`, `src/rules/ci-failed-pull-request.ts`, `src/draft-lookup.ts`, `src/webhook.ts`, `src/index.ts`, `src/webhook.test.ts` | AC13 | — | Dev | [x] |
| 2 | Tests of the narrowing and the two rules from the real fixtures and their variants | `src/rules/workflow-run.test.ts`, `src/rules/ci-failed-default-branch.test.ts`, `src/rules/ci-failed-pull-request.test.ts`, `src/rules/registry.test.ts`, `src/i18n/messages.test.ts` | AC1, AC2, AC5, AC6, AC7, AC8, AC9, AC10, AC13, AC15 | 1 | Tester | [x] |
| 3 | Tests of the draft lookup, the processing and the wiring | `src/draft-lookup.test.ts`, `src/webhook.test.ts`, `src/index.test.ts` | AC2, AC3, AC4, AC5, AC7, AC11, AC12, AC14 | 1 | Tester | [ ] |
| 4 | Narrowing and rules, registered in `RULES` | `src/rules/workflow-run.ts`, `src/rules/ci-failed-default-branch.ts`, `src/rules/ci-failed-pull-request.ts`, `src/rules/registry.ts` | AC1, AC2, AC5, AC6, AC7, AC8, AC9, AC10, AC13, AC15 | 2 | Dev | [ ] |
| 5 | Draft lookup, its bound and the processing step before the transaction | `src/draft-lookup.ts`, `src/webhook.ts`, `src/index.ts` | AC2, AC3, AC4, AC11, AC12, AC14 | 3, 4 | Dev | [ ] |
| 6 | Guarantee line in `.squad/project.md`, `README.md` and `CHANGELOG.md` with the exact texts of the plan | `.squad/project.md`, `README.md`, `CHANGELOG.md` | AC3, AC4 | 5 | Dev | [ ] |
| 7 | Area documents, `docs/ARCHITECTURE.md` and decision 0027 with its index row (written in step 2; adjusted if the build deviates) | `docs/areas/notifications.md`, `docs/areas/github-api.md`, `docs/ARCHITECTURE.md`, `docs/decisions/0027-ci-failure-rules-and-the-draft-lookup.md`, `docs/decisions/README.md` | AC1, AC2, AC3, AC4 | — | Lead | [x] |
