# 0047: Setup guides with screenshots of Seluna's own pages, in English and German

- **Status:** Proposed
- **Date:** 2026-11-05
- **Area:** Deployment
- **Source:** Issue #20
- **Supersedes:** —

## Context

Issue #20 asks for a setup guide that someone without prior knowledge follows alone, without a command line, with a
screenshot for every step, in English and German, plus a manual setup with Wrangler and a troubleshooting page, before
version 1.0.0. Most steps happen on other services (@BotFather, the Cloudflare deploy flow, GitHub's app creation and
installation, Telegram), whose pages need real accounts to capture, carry private values and change without notice.
The repository is written in English (`AGENTS.md`), while the setup pages and the notifications already ship in German
too. [Decision 0034](0034-setup-page-layout-checked-on-the-style.md) left the project without browser tooling.

## Options considered

1. **Screenshots of Seluna's own pages only, rendered with made-up values and captured with a headless browser by
   hand; the other services' steps in text with a link to their own documentation** — no private value can leak, no
   dependency, and the screenshots follow Seluna's releases; the other services' screens are not shown. Chosen (the
   Product Manager's answer on the spec).
2. **Screenshots of every step, the other services' captured by the Product Manager** — closest to the issue, but
   each capture needs anonymizing, ages with the other service, and is taken twice for the German guide.
3. **A committed screenshot generator (a script or a browser test project)** — repeatable, but it is code with
   tests, a browser dependency in CI for pages that change rarely, the trade-off decision 0034 already declined.
4. **A German guide** next to the English one, as an exception to English-only documentation — the setup pages and
   messages are German already, and the issue's owner asks for it. Chosen; other documents stay English only.
5. **The manual setup edits `wrangler.jsonc` with the database id** — a local change every later pull conflicts
   with; Wrangler finds the database by its name `seluna` instead, once the reader has created it. Not chosen.

## Decision

The setup guide exists as `docs/setup.md` and `docs/setup.de.md`, shows screenshots of Seluna's own pages only
(rendered with made-up values, captured by hand, no committed generator) and links the other services' documentation
for their steps; a change of a setup page's text or look updates both guides and their screenshots in the same pull
request. The rules of the deployment paths are in [`areas/deployment.md`](../areas/deployment.md).

## Consequences

- A reader sees no picture of @BotFather, the Cloudflare deploy flow or GitHub's pages; the text names their controls
  and links their own documentation, which may change without Seluna noticing.
- Renewing a screenshot is manual work for whoever changes a page; nothing fails when it is forgotten except the
  review, which `docs/CONTRIBUTING.md` asks to check.
- Two languages double every later guide edit, the messenger sections of 1.1.0 and 1.2.0 included.
- The external setup test, one week of real use and the 1.0.0 release (issue #20) are verified by the Product
  Manager after the guides are merged.
