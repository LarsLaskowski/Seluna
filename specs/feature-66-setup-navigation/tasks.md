# Tasks: Navigation between the setup pages

Plan: [plan.md](plan.md) — Status: Draft

Each task names the criteria of `spec.md` it delivers, the tasks it waits for and its group: one launch per member in
steps 4–6, in table order, its rows consecutive. Every documentation edit is in exactly one row.

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G1 | Skeleton: `SetupTexts.stepsLabel` after `languageLabel`, `startPageLink` moved after it with "Start page"/"Startseite", both tables in the same order (plan, *Signatures*); `typecheck` passes | `src/setup/texts.ts` | AC5 | — | Dev | [x] |
| 2 | G2 | Tests first in `pages.test.ts`: `current` field and extended `links` in `ALL_PAGES`, frame test rewritten, reset-needed test replaced, `bodyText` without the step navigation, the new navigation and style tests of *Tests per criterion*; they fail on the skeleton | `src/setup/pages.test.ts` | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC10, AC11 | 1 | Tester | [ ] |
| 3 | G2 | Tests first in `texts.test.ts`: navigation texts, same key order, `startPageLink` value | `src/setup/texts.test.ts` | AC5 | 1 | Tester | [ ] |
| 4 | G2 | Tests first in `handler.test.ts`: signed-out callback pages with the navigation, signed-out `GET /setup` and `/setup/telegram` without it | `src/setup/handler.test.ts` | AC9 | 1 | Tester | [ ] |
| 5 | G3 | `NavigationItem`, `stepNavigationHtml`, `layout()` with the current item and the language `aria-label`, every render function passes its item, `reset-needed` without its link, the `STYLE` rule (plan, *Approach*); *Format*; tests green | `src/setup/pages.ts` | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10 | 2, 3, 4 | Dev | [ ] |
| 6 | G4 | Snapshot update with `npx vitest run src/setup/pages.test.ts -u`; `git diff` shows only the two `github reset-needed` body-text entries; coverage pass | `src/setup/__snapshots__/pages.test.ts.snap` | AC11 | 5 | Tester | [ ] |
| 7 | G5 | Area document: Frame, Colours, Style limits, GitHub step page, Language, Texts (plan, *Documentation updates*), checked against the final code; `decision-check.py` | `docs/areas/setup-wizard.md` | AC12 | 5 | Lead | [ ] |
