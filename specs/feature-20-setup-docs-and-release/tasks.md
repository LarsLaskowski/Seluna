# Tasks: Setup documentation, troubleshooting and the path to 1.0.0

Plan: [plan.md](plan.md) — Status: Draft

| # | Group | Task | Files | Criteria | Depends on | Owner | Done |
| - | ----- | ---- | ----- | -------- | ---------- | ----- | ---- |
| 1 | G1 | Screenshots, no new API: render and capture the 11 pages per language with made-up values (plan, *Approach*) | `docs/assets/setup/en/*.png`, `docs/assets/setup/de/*.png` | AC1, AC2, AC6 | — | Dev | [x] |
| 2 | G2 | English guide, no new API | `docs/setup.md` | AC1, AC7 | 1 | Dev | [x] |
| 3 | G2 | German guide | `docs/setup.de.md` | AC2, AC7 | 2 | Dev | [x] |
| 4 | G2 | Manual setup | `docs/manual-setup.md` | AC3, AC8 | — | Dev | [x] |
| 5 | G2 | Troubleshooting | `docs/troubleshooting.md` | AC4 | — | Dev | [x] |
| 6 | G2 | README links, security notes, event list check | `README.md` | AC5 | 2–5 | Dev | [x] |
| 7 | G2 | Setup-guide rule and line 182 | `docs/CONTRIBUTING.md` | AC9 | — | Dev | [x] |
| 8 | G2 | Sweep: update anchors, architecture clause, deployment area, changelog | `docs/update.md`, `docs/ARCHITECTURE.md`, `docs/areas/deployment.md`, `CHANGELOG.md` | AC1, AC3 | 2, 4 | Dev | [x] |
| 9 | G3 | Dry runs on the early draft PR, no new API: browser guide (EN, then DE pages), manual guide; duration and deviations logged | — (fixes in G2 files) | AC7, AC8 | 1–8 | Product Manager, Dev | [ ] |
