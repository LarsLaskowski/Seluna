# 0034: Setup page layout and navigation, checked on the style instead of in a browser

- **Status:** Accepted
- **Date:** 2026-10-23
- **Area:** Setup wizard
- **Source:** Issue #65, issue #66
- **Supersedes:** —

## Context

The setup pages under `/setup` had a five-line style and no grouping, button kinds or dark mode (issue #65). The
redesign has to stay within [decision 0015](0015-setup-login.md) (options 17–19): one inline `<style>` allowed by
its SHA-256 hash, no script, no external resource, no stylesheet route. The project has no browser tooling: the
tests run inside the Workers runtime, which renders no page, and the squad cannot attach images to a pull request.
Yet the issue's goals — readable at 360 px, dark mode, visible focus, visually separate sections — are about
rendering, and the texts of both languages must not change while the markup around them does.

Issue #66 then added a way back: from a step page the only links to the start page were the language links, which do
not read as a way back, and no page showed where in the setup the owner is.

## Options considered

How the look is verified:

1. **As properties of the style constant and of the rendered markup, checked by unit tests** — the colours are
   declared once per mode as custom properties, so a test computes every WCAG contrast ratio; the width, wrapping,
   focus and border rules are checked on the constant; the markup (header, main column, cards, fieldsets, button
   and notice classes) on every rendered view. Runs in the existing test project, no dependency. Does not prove
   how a real browser renders the pages. Chosen.
2. **A browser test tool (Playwright or Puppeteer) with screenshots or a layout check** — measures real rendering,
   but adds a dependency with a browser binary, a third test project outside the Workers runtime and a slower CI,
   for pages that change rarely; the screenshots could still not be attached by the squad.
3. **A manual check by the owner at pull request approval** — real rendering, but not repeatable, not part of any
   gate, and lost for the next change of the style.

How "the texts stay unchanged" is verified:

4. **Snapshots of each view's body text and form controls, written from the code before the change** — the
   oracle is the old output itself; the redesign may add markup but not change a text or a field. Chosen.
5. **Expected texts assembled in the test from the language tables** — rebuilds the render logic in the test,
   with the same author's view of what a page contains.

Where the colours live:

6. **Named custom properties, one set on `:root` and one for `prefers-color-scheme: dark`** — one place per mode,
   readable by a test. Chosen.
7. **Literal colours in each rule** — no single list to check, and the dark mode repeats every rule.

How the owner moves between the pages (issue #66):

8. **One step navigation in the header bar of every page of the start page, a step or a step's sub-page, with the
   current item as text marked `aria-current="page"`** — the same place on every page, and the area document's
   descriptions of each main column stay valid. The current item is not a link: a link to the page shown would reload
   it, and on a sub-page (review, finish, created, code page) it would lead to another view than the one marked
   current. Which pages show it follows the page, not the session, so GitHub's signed-out return shows it too; it
   holds only fixed paths. Chosen.
9. **The current item as a link with `aria-current="page"`** — the usual pattern for a menu, but the start page would
   link to itself, against the issue's scope, and the sub-pages would mark a link to another view as current.
10. **Back links in the main column of each view** — the pattern the step pages had; one link per view to maintain,
    no marking of the current step, and nothing on the views that have none today.

## Decision

The setup pages get a header, one main column, a card per part of a page, grouped settings and primary, secondary
and danger buttons, styled by the one hashed `<style>` whose colours are custom properties per mode; the look is
verified by unit tests on that style and on the rendered markup, and the texts and form controls by snapshots
taken from the code before the change. Every page but the login and _not configured_ pages carries a step navigation
in its header bar whose current item is marked text, not a link. The layout rules are in [`areas/setup-wizard.md`](../areas/setup-wizard.md#pages-and-response-headers).

## Consequences

- No test renders a page in a browser: a rule that holds in the constant can still look wrong. The risk is
  accepted; the screenshots of the setup guide (#20) are the first real rendering, and a defect found there is a
  new issue.
- A later change of the style keeps the custom-property declaration, or the contrast tests have nothing to read.
- A deliberate change of a page text or form field updates its snapshot in the same pull request, which makes it
  visible in the review.
- Decision 0015's constraints are unchanged; the hash still follows the constant.
- A new step (the delivery channel of a later issue) joins the step navigation; the step navigation is left out of
  the snapshot text, so it is checked by its own tests.
