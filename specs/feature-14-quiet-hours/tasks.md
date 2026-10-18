# Tasks: Quiet hours

Plan: [plan.md](plan.md) — Status: Draft

Every documentation edit appears in exactly one row; the Lead's approval only touches status, index rows and bookkeeping.

| # | Task | Files | Tests (AC) | Owner | Done |
| - | ---- | ----- | ---------- | ----- | ---- |
| 1 | Decision record 0025 (Proposed) and its index row | `docs/decisions/0025-quiet-hours-decided-at-sending.md`, `docs/decisions/README.md` | — | Lead | [x] |
| 2 | Area documents: *Quiet hours* subsection and related edits; `outbox.silent` meaning | `docs/areas/notifications.md`, `docs/areas/storage.md` | — | Lead | [x] |
| 3 | Architecture: step 4 of *Webhook to Telegram* | `docs/ARCHITECTURE.md` | — | Lead | [x] |
| 4 | Skeleton: `isQuietTime` (throws), `DeliverySettings`, `DeliveryDeps.now`, new `deliverMessages` signature calling `isQuietTime` per row, `processWebhook` passing `settings` and `now`; adapt the `src/delivery.test.ts` harness (`now`) and its 14 `deliverMessages` calls (`settingsIn(...)`) mechanically | `src/quiet-hours.ts`, `src/delivery.ts`, `src/webhook.ts`, `src/delivery.test.ts` (call sites only) | — | Dev | [x] |
| 5 | Tests first for `isQuietTime` | `src/quiet-hours.test.ts` | AC1, AC2, AC3, AC6 | Tester | [ ] |
| 6 | Tests first for the per-row decision in delivery | `src/delivery.test.ts` | AC4a–f | Tester | [ ] |
| 7 | Tests first for the webhook applying the stored settings | `src/webhook.test.ts` | AC5a, AC5b | Tester | [ ] |
| 8 | Implement `isQuietTime` and the per-row decision until all tests and the *Coverage gate* pass | `src/quiet-hours.ts`, `src/delivery.ts`, `src/webhook.ts` | AC1–AC6 | Dev | [ ] |
| 9 | Changelog entry under `[Unreleased]` › `Added` (text in plan, *Documentation updates*) | `CHANGELOG.md` | — | Dev | [ ] |
