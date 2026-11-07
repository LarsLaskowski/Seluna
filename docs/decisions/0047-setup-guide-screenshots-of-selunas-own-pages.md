# 0047: Setup guide with screenshots of Seluna's own pages only

- **Status:** Accepted
- **Date:** 2026-11-05
- **Area:** Deployment
- **Source:** Issue #20
- **Supersedes:** —

## Context

Issue #20 asks for a setup guide that someone without prior knowledge follows alone, without a command line, with a
screenshot for every step, plus a manual setup with Wrangler and a troubleshooting page, before version 1.0.0. Most
steps happen on other services (@BotFather, the Cloudflare deploy flow, GitHub's app creation and installation,
Telegram), whose pages need real accounts to capture, carry private values and change without notice.
[Decision 0034](0034-setup-page-layout-checked-on-the-style.md) left the project without browser tooling. Which
languages the guide exists in is [decision 0048](0048-setup-guide-in-english-and-german.md).

## Options considered

1. **Screenshots of Seluna's own pages only, rendered with made-up values and captured with a headless browser by
   hand; the other services' steps in text with a link to their own documentation** — no private value can leak, no
   dependency, and the screenshots follow Seluna's releases; the other services' screens are not shown. Chosen (the
   Product Manager's answer on the spec).
2. **Screenshots of every step, the other services' captured by the Product Manager** — closest to the issue, but
   each capture needs anonymizing and ages with the other service.
3. **A committed screenshot generator (a script or a browser test project)** — repeatable, but it is code with
   tests, a browser dependency in CI for pages that change rarely, the trade-off decision 0034 already declined.
4. **A manual setup with the Wrangler command line and a GitHub App created by hand** (`docs/manual-setup.md`) —
   a second path for readers who prefer the command line; it needs its own dry run and a second set of instructions
   to keep correct, and the browser path already needs no command line. Not chosen (the Product Manager, after the
   dry run of the browser guide).
5. **Other services' steps quoting their exact labels and menu paths** — easiest to follow on the day they are
   written, but those pages change without notice and checking them needs test accounts at every service. Not
   chosen (the Product Manager).

## Decision

Option 1, without options 4 and 5: the setup guide is the only setup path, shows screenshots of Seluna's own pages
only, captured by hand without a committed generator, and describes the other services' steps in plain words that do
not depend on their labels. The rules a change follows are in `docs/CONTRIBUTING.md` (_Setup guides_); the deployment
the guide describes is in [`areas/deployment.md`](../areas/deployment.md).

## Consequences

- A reader sees no picture of @BotFather, the Cloudflare deploy flow or GitHub's pages, and no exact label of them;
  the text says what to do there and links their own documentation, so a change of those pages leaves the guides
  correct. Where a service documents a step only as a command (Cloudflare's deletion of a Worker, issue #157), the
  step has no link: a command reference would contradict the guides' promise that the reader types no command, and a
  menu path would tie the text to that service's labels.
- A reader who wants the command line has no guide of Seluna's; Wrangler's own documentation applies.
- Renewing a screenshot is manual work for whoever changes a page; nothing fails when it is forgotten except the
  review, which `docs/CONTRIBUTING.md` asks to check.
- The external setup test, one week of real use and the 1.0.0 release (issue #20) are verified by the Product
  Manager after the guides are merged.
