# 0048: Setup guide in English and German

- **Status:** Accepted
- **Date:** 2026-11-05
- **Area:** Deployment
- **Source:** Issue #20
- **Supersedes:** —

## Context

Issue #20 asks for the setup guide in English and German. Everything in the repository is written in English
(`AGENTS.md`), while the setup pages and the notifications already ship in German too, so a German-speaking owner
sets up an instance whose pages speak German. How the guide is made is
[decision 0047](0047-setup-guide-screenshots-of-selunas-own-pages.md).

## Options considered

1. **English only**, as every other document — one text and one set of screenshots to keep correct; a German-speaking
   owner reads an English guide about German pages.
2. **A German guide next to the English one**, as an exception to English-only documentation — the guide matches
   the language of the pages it shows, and the issue's owner asks for it; every guide edit and every screenshot is
   made twice. Chosen (the Product Manager).

## Decision

Option 2: the setup guide exists as `docs/setup.md` and `docs/setup.de.md`, with screenshots in each language; every
other document stays English only. The rules for keeping the two in step are in `docs/CONTRIBUTING.md`
(_Setup guides_).

## Consequences

- Two languages double every later guide edit and screenshot, the messenger sections of 1.1.0 and 1.2.0 included.
- A further language would be a new decision, not an extension of this one.
