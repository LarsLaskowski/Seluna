# Tasks: Security alert rules

Plan: [plan.md](plan.md) — Status: Draft

Each task names the acceptance criteria of `spec.md` it delivers and the tasks it waits for; steps 4–6 run the task
groups in this order. Every documentation edit is in exactly one row. Step 5 of every group waits for task 1.

| # | Task | Files | Criteria | Depends on | Owner | Done |
| - | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | Turn the Product Manager's real deliveries into anonymized fixtures (secret value replaced by a fake, field kept) with a README per folder naming covered and missing variants; minimum one `created` per event | `test/fixtures/dependabot_alert/`, `test/fixtures/code_scanning_alert/`, `test/fixtures/secret_scanning_alert/` | AC1, AC2, AC3 | Product Manager's samples (spec Q9) | Orchestrator | [ ] |
| 2 | Skeleton of every new signature; texts and registry final | `src/rules/security-alert.ts`, `src/rules/dependabot-alert.ts`, `src/rules/code-scanning-alert.ts`, `src/rules/secret-scanning-alert.ts`, `src/rules/registry.ts`, `src/i18n/messages.ts`, `src/i18n/en.ts`, `src/i18n/de.ts` | AC4 | — | Dev | [ ] |
| 3 | Shared narrowing: tests first, then `securityAlert`, `stringAt`, `joinContext`; confirm the field paths of *Fields shown* against the fixtures and report any deviation to the Lead | `src/rules/security-alert.ts`, `src/rules/security-alert.test.ts` | AC8, AC10 | 1, 2 | Tester, Dev | [ ] |
| 4 | Dependabot rule: tests first, then implementation | `src/rules/dependabot-alert.ts`, `src/rules/dependabot-alert.test.ts` | AC1, AC4, AC6, AC8, AC10 | 3 | Tester, Dev | [ ] |
| 5 | Code scanning rule with the default-branch check: tests first, then implementation | `src/rules/code-scanning-alert.ts`, `src/rules/code-scanning-alert.test.ts` | AC2, AC4, AC6, AC8, AC9, AC10 | 3 | Tester, Dev | [ ] |
| 6 | Secret scanning rule with the field allow-list: tests first, then implementation | `src/rules/secret-scanning-alert.ts`, `src/rules/secret-scanning-alert.test.ts` | AC3, AC4, AC6, AC7, AC8, AC10, AC12 | 3 | Tester, Dev | [ ] |
| 7 | Registry, texts and processing end to end: adapt the registry test, the titles test, webhook tests for the disabled switch, the secret invariance of outbox text, button URL and log fields, and the escaped summary | `src/rules/registry.test.ts`, `src/i18n/messages.test.ts`, `src/webhook.test.ts` | AC4, AC5, AC7, AC11 | 4, 5, 6 | Tester, Dev | [ ] |
| 8 | Area document: *Security alert rules* subsection, *Languages*, *Draft lookup* wording, *Related decisions*, line 62 | `docs/areas/notifications.md` | AC1, AC2, AC3, AC9, AC12 | 3 | Dev | [ ] |
| 9 | Guarantee wording in the project file | `.squad/project.md` | AC12 | — | Dev | [ ] |
| 10 | README rule table, message paragraph, draft sentence, status sentence; CHANGELOG entry | `README.md`, `CHANGELOG.md` | AC1, AC2, AC3 | 7 | Dev | [ ] |
| 11 | Architecture: draft guarantee wording and security alert rules in *Webhook to Telegram* (done in the plan step) | `docs/ARCHITECTURE.md` | AC12 | — | Lead | [x] |
