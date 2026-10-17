# 0019: Language tables of the setup wizard excluded from duplication detection

- **Status:** Proposed
- **Date:** 2026-10-17
- **Area:** —
- **Source:** Issue #11 / PR #50
- **Supersedes:** —

## Context

`src/setup/texts.ts` holds one `SetupTexts` table per language of the setup wizard. The type forces every table
to have the same keys, and they are kept in the same order so a missing or stale translation is easy to spot.
SonarQube Cloud's copy-paste detection ignores the values of string literals, so two tables that differ only in
their text are reported as duplicated blocks. Each change that adds texts adds duplicated lines in every
language; with PR #50 the share on new code reached 3.3 %, above the quality gate's limit of 3 %. No other file
has new duplicated lines, and the local analyzers report nothing.

## Options considered

1. **Exclude `src/setup/texts.ts` from duplication detection (`sonar.cpd.exclusions`)** — one configuration line;
   the file stays in the analysis, its issues, hotspots and coverage are still reported. Real duplication
   added to that file later would go unnoticed, which is acceptable for a file that holds only data.
2. **One table keyed by text with the translations side by side (`{ key: { en, de } }`), derived per language**
   — no structural duplication, but a rewrite of the whole file and of its type for no behavioral gain, and a
   third language would change every entry.
3. **Reorder or reshape one language's table so the token streams differ** — passes the gate by accident,
   breaks the side-by-side readability and fails again with the next added keys.
4. **Move the texts to JSON files** — leaves the TypeScript analysis only because JSON is not checked for
   duplication, adds a JSON import path to the Worker bundle and loses the compile-time key check.

## Decision

`src/setup/texts.ts` is listed in `sonar.cpd.exclusions` in `sonar-project.properties`, with a comment that its
language tables are structurally identical on purpose. It is excluded from duplication detection only — not from
the analysis (`sonar.exclusions`) or the coverage measure.

## Consequences

The duplication condition of the quality gate measures the code again instead of the translations. A file that
holds code as well as texts must not be added to the list; if `texts.ts` gains logic beyond the tables, that
logic moves to its own module or this decision is revisited. A further data-only file is added to the list only
with its own reason recorded here.
