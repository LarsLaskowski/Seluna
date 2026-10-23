# Tasks: Visual redesign of the setup pages

Plan: [plan.md](plan.md) — Status: Draft

Each task names the criteria of `spec.md` it delivers (`plan-check.py` reports one no task covers), the
tasks it waits for and its group: one launch per member in steps 4–6, in table order, its rows
consecutive. Every documentation edit is in exactly one row.

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G1 | `ALL_PAGES`, `bodyText`, `formsSignature`; the AC4 snapshot tests, run once on the base code to write the snapshot file (fact 12, or the `BEFORE` fallback) | `src/setup/pages.test.ts`, `src/setup/__snapshots__/pages.test.ts.snap` | AC4 | — | Tester | [ ] |
| 2 | G1 | AC1–AC3 tests on `ALL_PAGES` and `STYLE` (replacing the tests over `PAGES` and `GITHUB_PAGES`) | `src/setup/pages.test.ts` | AC1, AC2, AC3 | 1 | Tester | [ ] |
| 3 | G1 | Markup tests: header and main, start page sections, fieldsets, button kinds, notice kinds; adapt the _reset needed_ test at `:417` | `src/setup/pages.test.ts` | AC5, AC6, AC7, AC8, AC9 | 1 | Tester | [ ] |
| 4 | G1 | `cssRules`, `colours`, WCAG ratio; the colour, focus, border, width and separation tests; the long-text and 100-chat render tests | `src/setup/pages.test.ts` | AC10, AC11, AC12, AC13 | 1 | Tester | [ ] |
| 5 | G2 | Markup of *Approach* in `layout` and the page renderers, texts and form controls untouched | `src/setup/pages.ts` | AC4, AC5, AC6, AC7, AC8, AC9 | 1, 2, 3 | Dev | [ ] |
| 6 | G2 | The new `STYLE` under the rules of *Approach* | `src/setup/pages.ts` | AC1, AC2, AC3, AC10, AC11, AC12, AC13 | 4, 5 | Dev | [ ] |
| 7 | G3 | Coverage pass: tests only for uncovered lines of the change | `src/setup/pages.test.ts` | AC1, AC4 | 5, 6 | Tester | [ ] |
| 8 | G4 | Area document: _Pages and response headers_ layout rules, the reworded page descriptions of the sweep, the link to decision 0034 | `docs/areas/setup-wizard.md` | AC14 | 5, 6 | Lead | [ ] |
