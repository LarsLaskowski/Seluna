# Tasks: Bound the deliveries of pull requests and CI failures caused by strangers

Plan: [plan.md](plan.md) — Status: Draft

Each task names its criteria, the tasks it waits for and its group (steps 4–6 run per group, one agent per member
and mode; rows consecutive). A group has a "Skeleton" row for its API in *Signatures*, or says "no new API". Each
documentation edit is in one row, owned by the Dev (test documentation: the Tester), in the last group.

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G1 | Skeleton: `BOUNDED_EVENT_NAMES` with six events, `isOwnerAccount`, `src/rules/stranger.ts` (plan *Signatures*) | `src/store/meta.ts`, `src/rules/actor.ts`, `src/rules/stranger.ts` | AC1, AC2, AC3, AC4, AC5 | — | Dev | [ ] |
| 2 | G1 | Tests first: `isCountedDelivery`, `isOwnerAccount`, `BOUNDED_EVENT_NAMES`, separate counters | `src/rules/stranger.test.ts`, `src/rules/actor.test.ts`, `src/store/meta.test.ts` | AC1, AC2, AC3, AC4, AC5 | 1 | Tester | [ ] |
| 3 | G1 | Implement the counting decision and `isOwnerAccount` | `src/rules/stranger.ts`, `src/rules/actor.ts` | AC1, AC2, AC3, AC4, AC5 | 2 | Dev | [ ] |
| 4 | G2 | Skeleton: `withinBound(db, event, payload, owner, time)` and its call site | `src/webhook.ts` | AC1, AC2, AC3, AC4, AC5, AC6 | 3 | Dev | [ ] |
| 5 | G2 | Tests first: the `processWebhook` cases of *Tests per criterion*; extend `setAllCounters`/`countersAt` to six events and adapt affected PR/CI tests | `src/webhook.test.ts` | AC1, AC2, AC3, AC4, AC5, AC6 | 4 | Tester | [ ] |
| 6 | G2 | Implement `withinBound` with `isCountedDelivery` | `src/webhook.ts` | AC1, AC2, AC3, AC4, AC5, AC6 | 5 | Dev | [ ] |
| 7 | G3 | Docs: notifications area (step 5, *Pull request rules*, *CI failure rules*, *Log entries*, *Related decisions*) | `docs/areas/notifications.md` | AC1, AC2, AC3, AC4, AC5, AC6 | 6 | Dev | [ ] |
| 8 | G3 | Docs: the `delivery_count:` rows | `docs/areas/storage.md` | AC5 | 6 | Dev | [ ] |
| 9 | G3 | Docs: the `POST /webhook` row | `docs/areas/http-routes.md` | AC1, AC4 | 6 | Dev | [ ] |
| 10 | G3 | Docs: *Webhook processing* row and the bounded-events enumeration | `docs/ARCHITECTURE.md` | AC1, AC4 | 6 | Dev | [ ] |
| 11 | G3 | Docs: *Bound on deliveries of other senders* security area | `.squad/project.md` | AC1, AC2, AC3, AC4 | 6 | Dev | [ ] |

G3 has no new API.
