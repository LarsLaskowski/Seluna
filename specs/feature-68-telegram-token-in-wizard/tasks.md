# Tasks: Enter the Telegram bot token in the setup wizard

Plan: [plan.md](plan.md) — Status: Draft

Each task names its criteria, the tasks it waits for and its group (one launch per member in steps 4–6; rows
consecutive). A group has a "Skeleton" row for its API in *Signatures*, or says "no new API". Each
documentation edit is in one row.

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G1 | Skeleton: `BotTokenSource`, `ResolvedBotToken`, `resolveBotToken` (new module); `isBotToken`, `BotTokenCheck`, `verifyBotToken`; `GitHubSecretName`, `SecretName`, `writeSecrets`, `deleteSecret`; `TELEGRAM_TOKEN_PATH`, `TELEGRAM_TOKEN_REMOVE_PATH`, `TOKEN_FIELD`, `TokenState`, `TelegramProblem`, `ChatPart`, `TelegramStepView`, `telegramStepView`, `ConfirmChatResult`, `confirmTelegramChat`, `SaveTokenResult`, `saveBotToken`, `RemoveTokenResult`, `removeBotToken`; `BotTokenStatus`, `StatusView.botToken`; the new `SetupTexts` keys and `Notice` values (English final, German placeholders); bodies throw | `src/bot-token.ts`, `src/telegram.ts`, `src/store/secrets.ts`, `src/setup/telegram-step.ts`, `src/setup/status.ts`, `src/setup/texts.ts`, `src/setup/pages.ts`, `src/setup/handler.ts` | AC1, AC2, AC3, AC7, AC10, AC12 | — | Dev | [x] |
| 2 | G1 | Adapt the Telegram view literals of `pages.test.ts` mechanically to the new view shape (plan, *Test files*); *Build* and *Type check* pass | `src/setup/pages.test.ts` | AC1 | 1 | Dev | [x] |
| 3 | G2 | Telegram double answers `getMe` (`ALLOWED_METHODS`, `TelegramAnswers.getMe`, default `get-me.json`); reference-built fixture and its README row — no new API | `test/telegram.ts`, `test/fixtures/telegram/get-me.json`, `test/fixtures/telegram/README.md` | AC2, AC6 | 2 | Tester | [x] |
| 4 | G2 | Tests of the resolver — no new API | `src/bot-token.test.ts` | AC3, AC7, AC10, AC11 | 3 | Tester | [x] |
| 5 | G2 | Tests of `isBotToken` and `verifyBotToken` | `src/telegram.test.ts` | AC2, AC5, AC6 | 3 | Tester | [x] |
| 6 | G2 | Tests of the store: round trip, `deleteSecret`, reset, concurrent writes | `src/store/secrets.test.ts` | AC2, AC8, AC9, AC14 | 3 | Tester | [x] |
| 7 | G2 | Handler tests of the step, the two forms, confirm, precedence, `TELEGRAM_CHAT_ID`, D1 failures and token secrecy; adapt the token-missing test (line 1135) | `src/setup/handler.test.ts` | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC10, AC11, AC13, AC16 | 3 | Tester | [x] |
| 8 | G2 | Pages tests of the token card and the status line | `src/setup/pages.test.ts` | AC1, AC12 | 3 | Tester | [x] |
| 9 | G2 | Status tests of `botToken`; adapt the expected views | `src/setup/status.test.ts` | AC12 | 3 | Tester | [x] |
| 10 | G2 | Texts tests: the new texts, `telegram-token-missing`, `resetText` | `src/setup/texts.test.ts` | AC9 | 3 | Tester | [x] |
| 11 | G2 | Delivery tests with the saved token, precedence, unreadable token, D1 failure | `src/delivery.test.ts` | AC3, AC7, AC10, AC11 | 3 | Tester | [x] |
| 12 | G3 | Implement the resolver, the client's `getMe`, the store, the step, the handler routes, the pages, the status, the texts (German included) and delivery until every test passes and the *Coverage gate* passes — no new API | `src/bot-token.ts`, `src/telegram.ts`, `src/store/secrets.ts`, `src/setup/telegram-step.ts`, `src/setup/handler.ts`, `src/setup/pages.ts`, `src/setup/status.ts`, `src/setup/texts.ts`, `src/delivery.ts` | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC16 | 11 | Dev | [x] |
| 13 | G3 | Deploy form and local secrets example: only `SELUNA_SECRET` required — no new API | `package.json`, `.dev.vars.example` | AC15 | 12 | Dev | [x] |
| 14 | G3 | Setup guide and README: the token is entered in the Telegram chat step | `docs/setup.md`, `README.md` | AC15 | 12 | Dev | [x] |
| 15 | G3 | `CHANGELOG.md` entry under `## [Unreleased]` | `CHANGELOG.md` | AC15 | 12 | Dev | [x] |
| 16 | G3 | `.squad/project.md`: *Encrypted credentials*, *Outbound-only Telegram*, *Test doubles* | `.squad/project.md` | AC2, AC6 | 12 | Dev | [x] |
| 17 | G3 | Coverage pass and snapshot update of `pages.test.ts` against the plan's layout — no new API | `src/setup/__snapshots__/pages.test.ts.snap`, test files of G2 | AC1, AC12 | 12 | Tester | [x] |
| 18 | G4 | `docs/areas/setup-wizard.md` | `docs/areas/setup-wizard.md` | AC1, AC2, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC12, AC16 | 17 | Lead | [x] |
| 19 | G4 | `docs/areas/storage.md` | `docs/areas/storage.md` | AC2, AC9 | 17 | Lead | [x] |
| 20 | G4 | `docs/areas/deployment.md` | `docs/areas/deployment.md` | AC15 | 17 | Lead | [x] |
| 21 | G4 | `docs/areas/notifications.md` | `docs/areas/notifications.md` | AC3, AC11 | 17 | Lead | [x] |
| 22 | G4 | `docs/areas/http-routes.md` | `docs/areas/http-routes.md` | AC13 | 17 | Lead | [x] |
| 23 | G4 | `docs/ARCHITECTURE.md` | `docs/ARCHITECTURE.md` | AC2, AC15 | 17 | Lead | [x] |
| 24 | G4 | `docs/areas/scheduled-jobs.md`: a failed read of the saved bot token logs `store-failed` in the retry, as for the chat (found by the documentation sweep) | `docs/areas/scheduled-jobs.md` | AC11 | 17 | Lead | [x] |
| 25 | G5 | Live check on a deployed copy before the pull request is marked ready for review (gates *ready for review*; plan *Verified facts* row 17, decision 0036 *Consequences*, Security note 3) — no new API: save a valid token (expected 303 to `/setup/telegram`), a revoked token (502 *token not accepted*), a mistyped token of the bot token form (502 *token not accepted*) and the token of a bot with a webhook (303, then the step shows the *conflict* notice); observe whether the browser fills the *Bot token* field with the saved `SELUNA_SECRET` or offers to replace the saved login with the token, and report both with what was seen | — (deployed copy) | AC2, AC6, AC1 | 23 | Product Manager (via orchestrator) | [ ] |
