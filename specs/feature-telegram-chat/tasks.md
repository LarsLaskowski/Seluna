# Tasks: Wizard step: Telegram chat

Plan: [plan.md](plan.md) — Status: Draft

Every documentation edit appears in exactly one row; the Lead's approval only touches status, index rows and bookkeeping.

| # | Task | Files | Tests (AC) | Owner | Done |
| - | ---- | ----- | ---------- | ----- | ---- |
| 0 | Bot API fixtures written from the Bot API reference (no real sample, Product Manager's decision), with the variants of plan.md *Test files*, invented ids and names, and a `README.md` marking them as reference-built | `test/fixtures/telegram/get-updates.json`, `get-updates-unauthorized.json`, `get-updates-conflict.json`, `send-message.json`, `README.md` | AC1, AC2, AC4, AC7, AC9 | Tester (with task 2) | [ ] |
| 1 | Skeleton: new modules with full signatures and TSDoc, bodies `throw new Error("Not implemented")`; `SetupDeps.fetch`; `readBodyWithLimit(message: Request \| Response, …)` final; `SigningPurpose` `setup-telegram` final; texts final; `src/index.ts` passes `fetch`; mechanical adaptation of the `SetupDeps` call sites (`src/setup/handler.test.ts` `depsAt`, `src/router.test.ts` `SETUP_DEPS` and `makeDeps`, each with a rejecting `fetch`); *Build* and *Type check* pass | `src/telegram.ts`, `src/store/settings.ts`, `src/setup/telegram-step.ts`, `src/setup/chat-proof.ts`, `src/crypto.ts`, `src/setup/pages.ts`, `src/setup/texts.ts`, `src/setup/handler.ts`, `src/body.ts`, `src/index.ts`, `src/setup/handler.test.ts`, `src/router.test.ts` | — | Dev | [x] |
| 2 | Telegram Bot API double | `test/telegram.ts` | AC4, AC6–AC10 | Tester | [ ] |
| 3 | Tests first for the client: token and chat-id guards, `parseChats`, `findChats`, `sendMessage`, `isChatIdSecretSet` | `src/telegram.test.ts` | AC1–AC5, AC7, AC8, AC10 | Tester | [ ] |
| 4 | Tests first for the settings store | `src/store/settings.test.ts` | AC11 | Tester | [ ] |
| 4a | Tests first for the chat proof and the new signing key purpose | `src/setup/chat-proof.test.ts`, `src/crypto.test.ts` | AC17, AC18 | Tester | [ ] |
| 5 | Tests first for the step through `handleSetup` (list, confirm with code, verify), the pages and the texts (incl. the notice-count and wording assertions in `texts.test.ts`) | `src/setup/handler.test.ts`, `src/setup/pages.test.ts`, `src/setup/texts.test.ts` | AC3, AC6–AC12, AC14–AC16 | Tester | [ ] |
| 6 | Test for the bounded reader on a `Response` | `src/body.test.ts` | AC13 | Tester | [ ] |
| 7 | Implementation: client, settings store, chat proof, step logic, pages, handler routes and form kind | `src/telegram.ts`, `src/store/settings.ts`, `src/setup/chat-proof.ts`, `src/setup/telegram-step.ts`, `src/setup/pages.ts`, `src/setup/handler.ts` | AC1–AC18 | Dev | [ ] |
| 8 | Area documents: Setup wizard (paths, new section *Telegram chat* with *Chat proof*, CSRF, texts, limits incl. strangers in the list and the crowded update window), Storage (`telegram_chat_id`, key label `seluna/setup-telegram/v1`), Deployment (`TELEGRAM_CHAT_ID` row, bot token and Workers traces), HTTP routes (body readers under `/setup`) | `docs/areas/setup-wizard.md`, `docs/areas/storage.md`, `docs/areas/deployment.md`, `docs/areas/http-routes.md` | — | Dev | [ ] |
| 9 | Project knowledge: *Outbound-only Telegram* security area and *Telegram Bot API double* | `.squad/project.md` | — | Dev | [ ] |
| 10 | User docs and changelog | `docs/setup.md`, `CHANGELOG.md` | — | Dev | [ ] |
| 11 | Coverage pass: lines the *Coverage gate* reports uncovered (`src/setup/telegram-step.test.ts` only for what the handler tests do not reach); confirm "no file a unit test cannot cover" | `src/setup/telegram-step.test.ts`, others as needed | — | Tester | [ ] |
| 12 | Decision record 0016 and its index row; `docs/ARCHITECTURE.md` (Telegram guarantee wording, security model, configuration) | `docs/decisions/0016-telegram-chat-in-the-setup-wizard.md`, `docs/decisions/README.md`, `docs/ARCHITECTURE.md` | — | Lead | [x] |
| 13 | Live check on a deployed copy (private chat and group listed, test message with its code arrives in both and the code saves the chat, wrong token and a bot with a webhook explained) before the PR is marked ready; it is the only check of the reference-built fixtures against the real API | — | issue criteria | Product Manager (requested in the PR's *Next steps*) | [ ] |
