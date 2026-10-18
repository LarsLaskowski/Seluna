# Tasks: Pull request rules

Plan: [plan.md](plan.md) — Status: Draft

Every documentation edit appears in exactly one row; the Lead's approval only touches status, index rows and bookkeeping.

| # | Task | Files | Tests (AC) | Owner | Done |
| - | ---- | ----- | ---------- | ----- | ---- |
| 1 | Skeleton: `PullRequestAction`, `PullRequestFields`, `nonDraftPullRequest`, `pullRequestRule` (stubs), the three rule constants, `RULES` with the three, four `MessageTexts` keys with their `EN`/`DE` values | `src/rules/pull-request.ts`, `src/rules/pull-request-opened.ts`, `src/rules/pull-request-ready-for-review.ts`, `src/rules/pull-request-review-requested.ts`, `src/rules/registry.ts`, `src/i18n/messages.ts`, `src/i18n/en.ts`, `src/i18n/de.ts` | — | Dev | [ ] |
| 2 | Fixtures README: origin, anonymization, the five files, the missing variants | `test/fixtures/pull_request/README.md` | B10 | Tester | [ ] |
| 3 | Failing tests for the narrowing | `src/rules/pull-request.test.ts` | AC1-AC6 | Tester | [ ] |
| 4 | Failing tests for the three rules and the registry | `src/rules/pull-request-opened.test.ts`, `src/rules/pull-request-ready-for-review.test.ts`, `src/rules/pull-request-review-requested.test.ts`, `src/rules/registry.test.ts` | AC7-AC11 | Tester | [ ] |
| 5 | Tests for the texts | `src/i18n/messages.test.ts` | AC12 | Tester | [ ] |
| 6 | Failing end-to-end tests through `processWebhook` with `RULES` | `src/webhook.test.ts` | AC13-AC15 | Tester | [ ] |
| 7 | Reword the stale comment above the registry mock | `src/index.test.ts` | — | Tester | [ ] |
| 8 | Implement the narrowing and the rule factory until the tests and the *Coverage gate* pass | `src/rules/pull-request.ts` | AC1-AC15 | Dev | [ ] |
| 9 | Update the registry comment | `src/rules/registry.ts` | — | Dev | [ ] |
| 10 | Area document: *Pull request rules* subsection, *Languages*, *Related decisions* | `docs/areas/notifications.md` | — | Dev | [ ] |
| 11 | Analyzer gate on the changed files | all changed `.ts` files | — | Code Officer | [ ] |
| 12 | At approval: decision 0024 and its index row to `Accepted`; link 0024 from step 3 of the flow | `docs/decisions/0024-pull-request-rules.md`, `docs/decisions/README.md`, `docs/ARCHITECTURE.md` | — | Lead | [ ] |
