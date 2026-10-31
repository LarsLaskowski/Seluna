# Tasks: Do not record deliveries that no rule reads

Plan: [plan.md](plan.md) — Status: Draft

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G1 | Skeleton: `LAST_DELIVERY_REFRESH_MS`, `refreshLastDelivery` | `src/store/meta.ts` | AC4 | — | Dev | [x] |
| 2 | G1 | Tests of `refreshLastDelivery` per case of *Tests per criterion* | `src/store/meta.test.ts` | AC4 | 1 | Tester | [x] |
| 3 | G1 | The conditional upsert; measure `meta.changes` / `rows_written` of the no-op (fact 7) | `src/store/meta.ts` | AC4 | 2 | Dev | [ ] |
| 4 | G2 | New and adapted `processWebhook` tests (no new API: `processWebhook` keeps its signature) | `src/webhook.test.ts` | AC1, AC2, AC3, AC4, AC5, AC6 | 3 | Tester | [ ] |
| 5 | G2 | The branch before `recordDelivery` | `src/webhook.ts` | AC1, AC2, AC3, AC4, AC5, AC6 | 4 | Dev | [ ] |
| 6 | G3 | Area documents: notifications, storage, setup-wizard, scheduled-jobs | `docs/areas/notifications.md`, `docs/areas/storage.md`, `docs/areas/setup-wizard.md`, `docs/areas/scheduled-jobs.md` | AC1, AC4 | 5 | Dev | [ ] |
| 7 | G3 | Guarantee wording and flow | `docs/ARCHITECTURE.md`, `.squad/project.md`, `README.md` | AC1 | 5 | Dev | [ ] |
