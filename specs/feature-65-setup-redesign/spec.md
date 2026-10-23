# Spec: Visual redesign of the setup pages

Source: Issue #65
Status: Draft

## Problem

The owner of an instance sets it up through the pages under `/setup`: the login, the _not configured_ page, the start
page (status, reset, setup steps, settings, sign-out), the Telegram step (chats, code, notice-only, _chat id secret_)
and the GitHub App step (form, Worker secrets views, _reset needed_, review, finish, created, notice-only). They work,
but they look bare: the whole style today is five lines (`STYLE` in `src/setup/pages.ts:19-24`) — a 32rem column, block
inputs, padded browser-default buttons and one bordered `.notice` box. Everything sits in one long column without
grouping, status, settings and actions look alike, a destructive button (_Reset and create the GitHub App again_) looks
like _Save settings_, and there is no dark mode. On a phone the long settings form is hard to scan. The pages are also
what the setup guide of #20 will show in screenshots, so they should look tidy before that guide is written.

The pages must keep the security model of [decision 0015](../../docs/decisions/0015-setup-login.md) (options 17–19): no
script, no external resource, exactly one inline `<style>` allowed by its SHA-256 hash in the Content-Security-Policy.

## Scenarios

Texts in quotes are the existing English texts (`src/setup/texts.ts`); the German pages show their existing German
counterparts in the same places.

- S1: Given the signed-out owner on a desktop browser in light mode, when they open `/setup`, then the page shows a
  header bar with "Seluna setup" and the language links "Language: English | Deutsch", and below it one centred
  column with the heading "Sign in", the intro "Enter the SELUNA_SECRET of this instance to open the setup." and a
  card holding the password field and the primary button "Sign in".
- S2: Given the signed-in owner, when they open `/setup` and the status can be read, then they see, one below the
  other, the heading with the start body (and a notice, if any), then separate cards: the _Status_ card (Version,
  Telegram chat, GitHub App, Installations, Last delivery from GitHub), the reset card only when a reset is needed
  (its button "Reset and create the GitHub App again" styled as a danger action), the setup steps card (the links
  "Telegram chat" and "GitHub App"), the _Settings_ card and an actions area with the secondary button "Sign out".
  The order is today's order ([Setup wizard](../../docs/areas/setup-wizard.md#paths)).
- S3: Given the _Settings_ card, when the owner reads it, then the switch "Quiet hours: notifications arrive without
  sound" heads a framed group that holds "Start" and "End", "Notify me about" heads a second framed group that holds
  the eight rule switches and "Tell me when a new Seluna release is available", and "Save settings" is the card's
  primary button.
- S4: Given an operating system or browser set to dark mode, when the owner opens any setup page, then the page, its
  cards, texts, links, buttons, notices and the browser's own form controls (selects, time fields, checkboxes, radio
  buttons) are shown in dark colours, and the start page's cards stay visibly separate from the page background.
- S5: Given a phone with a viewport 360 CSS px wide, when the owner opens any setup page, then the content fits the
  width without scrolling sideways, form controls and buttons span the card's width or wrap, and nothing overlaps.
- S6: Given a keyboard user, when they move with Tab through a page, then every link, button, input, select, checkbox
  and radio button shows a clearly visible focus ring, in light and in dark mode.
- S7: Given a request that was refused or failed (for example a wrong secret on the login: "That is not the
  SELUNA_SECRET of this instance."), when its page is shown, then the notice appears in the error style above the
  content it concerns, as today with its alert role.
- S8: Given the Telegram chat is set by the Worker secret `TELEGRAM_CHAT_ID`, when the owner opens the Telegram step,
  then the _chat id secret_ text is shown in the info style; likewise the _Worker secrets_ text of the GitHub App
  step and "The GitHub App is saved." on the created page. The _partial Worker secrets_ and _reset needed_ texts of
  the GitHub App step, which stop the owner until they fix something, are shown in the error style.
- S9: Given the Telegram step or the GitHub App step, when the owner opens it in any of its views (chat list, no
  chats, code page, form, review page, finish page, created page, notice-only), then the step's content sits in a
  card below the page heading, and each form's submit button ("Send test message", "Save chat", "Next", "Continue to
  GitHub", "Finish") is a primary button.
- S10: Given the _not configured_ page (no usable `SELUNA_SECRET`), when anyone opens `/setup`, then it shows the same
  header and its paragraphs in a card.
- S11: Given the owner switches to German with "Deutsch", when the page reloads, then the layout is the same, the
  longer German labels and buttons wrap inside their cards, and every text is the existing German one.
- S12: Given a D1 failure on `GET /setup`, when the notice-only start page is shown, then the error notice, the setup
  steps card and the sign-out action appear in the same layout as S2.

## Errors and edge cases

- E1: Long text without spaces — a Telegram chat name of 128 code points, an app slug of 100 characters, an
  installation's login or enterprise slug of any length (GitHub's answer is not cut by Seluna:
  `parseAccount`, `src/github/installations.ts:31-37`; shown by `accountHtml`, `src/setup/pages.ts:149-175`), the
  version string, `GITHUB_APP_PRIVATE_KEY` or
  `npx wrangler secret put TELEGRAM_BOT_TOKEN` in a German or English text — wraps inside its card at 360 px; the page
  never grows wider than the viewport.
- E2: Long lists — 100 installations with the _more installations_ text, 100 chats in the Telegram list, the full
  time zone list — stay inside their card; the page only grows downward.
- E3: The style is not applied (the browser blocks it because something on the way changed the page and the hash no
  longer matches, or the user turned styles off): every page stays usable in document order — every text, label,
  link and form is the same as today and works without the style.
- E4: Forced colours (for example Windows high-contrast mode): cards, buttons, form controls, notices and the focus
  ring stay distinguishable, because they are drawn with borders and outlines, not only with background colours.
- E5: Browser zoom at 200 % (or a large default font size): text and controls grow, nothing overlaps or is cut off,
  and at 1280 px window width the page does not scroll sideways.
- E6: Hostile or right-to-left names (a chat name with markup, a name starting with U+202E RIGHT-TO-LEFT OVERRIDE, a
  username that tries to pose as a name): they are still shown escaped and each in its own `<bdi>`, so they neither
  inject markup nor reorder the surrounding layout or text.
- E7: Optional parts absent — no notice, no reset needed, no installations line, no chats, no saved chat: no empty
  card, box or frame is left in their place.
- E8: An older browser without `prefers-color-scheme` or `:focus-visible`: the page is shown in the light colours and
  the browser's default focus indication stays visible.
- E9: Repeated or concurrent loads: every load of every page carries the same `<style>` content and the same
  `style-src` hash; nothing depends on the request, the language or the time.

## Non-functional requirements

- Security: the Content-Security-Policy keeps exactly its current directives and sources
  ([Setup wizard](../../docs/areas/setup-wizard.md#pages-and-response-headers)); the `style-src` hash follows the
  `STYLE` constant (`contentSecurityPolicy`, `src/setup/pages.ts:50-55`). Every page has exactly one `<style>`
  element, also counting an element inside an inline SVG; no `style=` attribute, no script, no `<link>`, `<img>`,
  `<iframe>`, no CSS `url(`, `@import` or `@font-face`, and no `href`, `src`, `xlink:href` or `action` other than
  today's. An inline SVG, if any, is decoration only (`aria-hidden="true"`) and carries none of these.
- Assets: system font stack only; no web font, no image file, no icon font, no new route.
- Size: `STYLE` is sent with every page and is not cached (`Cache-Control: no-store`); it stays at most 8 KiB (8,192
  bytes as UTF-8).
- Accessibility: text contrast at least 4.5:1 against its background, and the borders of cards, inputs and buttons
  and the focus ring at least 3:1 against their surroundings, in light and in dark mode (WCAG 2.1 AA, 1.4.3 and
  1.4.11); each page keeps exactly one `<h1>`, and the header's product name is not a heading; no animation or
  transition.
- Verification: the project has no browser tooling (tests run in the Workers runtime only), so every criterion is
  checked on the rendered markup and on `STYLE` itself: the layout rules that make S4, S5, E1, E2, E4 and E5 hold
  are stated as properties of `STYLE` (AC10–AC13), and the colours are declared so that a test can read them (below).
  How the pages look in a real browser is not checked by this change; the residual risk (a rule that holds in the
  constant but renders badly) is accepted, and the screenshots of the setup guide (#20) are the first real
  rendering.
- Colours: each mode declares its colours once, as `#rrggbb` values of named custom properties (the light set on
  `:root`, the dark set inside `@media (prefers-color-scheme: dark)`), and every rule uses them through `var(...)`,
  so the contrast of every pair can be computed from `STYLE`.
- Compatibility: the current versions of Chrome, Edge, Firefox and Safari on desktop, Android and iOS; older
  browsers get a readable page (E8). The interface languages are left-to-right.
- Behavior: routes, status codes, headers, cookies, form fields, form actions and methods, CSRF fields and every text
  stay as they are; the redesign changes only the style and the markup the style needs (class names, `<header>`,
  `<main>`, `<section>`, `<fieldset>`/`<legend>`).
- Configuration and logs: no new configuration, no log entry.

## Acceptance criteria

- [ ] AC1: Every page view — login (with and without each notice), _not configured_, the start page's status view
  (with and without reset, installations listed, unavailable and hidden) and notice-only view, every Telegram and
  GitHub App step view, the review, finish and created pages — in English and German contains exactly one `<style`
  element, its content is `STYLE`, and the response's `style-src` hash is the SHA-256 of `STYLE` (S1, S2, S9, S10,
  S12, E9).
- [ ] AC2: None of these page views contains a `style=` attribute, `<script`, `<link`, `<img`, `<iframe` or
  `xlink:href`, and the external addresses in its `src`, `href` and `action` attributes are exactly those it has
  today (the status view's `https://github.com/apps/<slug>` link, the created page's install link, the review
  page's form action, and none on every other page) (S1, S9, E6).
- [ ] AC3: `STYLE` contains no `url(`, `@import` or `@font-face`, names only generic and system font families, and is
  at most 8,192 bytes as UTF-8 (S1, E9).
- [ ] AC4: For every page view of AC1 in both languages, the text of the page body (markup removed, whitespace
  collapsed) equals the text of the same view before this change, except that the page title ("Seluna setup",
  "Seluna-Einrichtung") appears once more at its start; every form keeps its `method`, `action` and controls (element,
  `type`, `name`, `value`, `id`, `for`, `required`, `pattern`, `maxlength`, `inputmode`, `autocomplete`, `checked`,
  `selected`) in the same order; every name and username keeps its escaping and its own `<bdi>` (S11, E3, E6).
- [ ] AC5: Every page starts its body with a `<header>` that holds the page title as text (not a heading) and the two
  language links, followed by one `<main>` that holds the page's only `<h1>` and the rest of its content (S1, S10,
  S11).
- [ ] AC6: The start page's status view shows, in this order, the heading block (heading, start body, notice when
  given), the status, the reset part only when a reset is needed, the setup steps, the settings and the sign-out, each
  of the last five in its own card or actions area; the notice-only view shows the heading block, the setup steps
  and the sign-out the same way; a part that is not shown leaves no empty element behind, and a page without a
  notice has no notice element (S2, S12, E7).
- [ ] AC7: In the settings form the quiet hours switch, "Start" and "End" are in one `<fieldset>` whose `<legend>`
  holds the quiet hours switch with its label; the eight rule switches and the release notice switch are in a second
  `<fieldset>` whose `<legend>` is the text "Notify me about" ("Benachrichtige mich über") (S3).
- [ ] AC8: The button "Sign out" is styled as secondary, "Reset and create the GitHub App again" as a danger action,
  and every other submit button of the setup pages ("Sign in", "Save settings", "Send test message", "Save chat",
  "Next", "Continue to GitHub", "Finish") as primary (S2, S3, S9).
- [ ] AC9: Every notice (each value of the notices table) is shown in the error style; the _chat id secret_ text,
  the _Worker secrets_ text and the created page's "The GitHub App is saved." in the info style; the _partial Worker
  secrets_ and _reset needed_ texts of the GitHub App step in the error style (S7, S8).
- [ ] AC10: `STYLE` declares light colours by default and dark colours under `@media (prefers-color-scheme: dark)`,
  as custom properties (non-functional requirements, _Colours_), and sets `color-scheme: light dark` so that the
  browser's form controls follow. In each mode, the WCAG 2.1 contrast ratio computed from the declared colours is at
  least 4.5:1 for: body text on the page background, body text on the card background, link text on the card
  background, muted text (if declared) on the card background, the text of the primary, secondary and danger buttons
  on their own backgrounds, the text of the error and info notices on their backgrounds; and at least 3:1 for: the
  card border against the page background, the input and button borders against the card background (a button whose
  background has 3:1 against the card counts instead of its border), the notice borders against the card background,
  and the focus ring against both the page and the card background (S4, E8).
- [ ] AC11: `STYLE` gives every link, button, input, select, checkbox and radio button a focus ring under
  `:focus-visible`, drawn with `outline` (not only `box-shadow`) with a width of at least 2px, and does not remove
  the outline under plain `:focus` (so E8's browsers keep their default); cards, buttons, inputs, selects and
  notices each have a `border` (not only a background), so they stay distinguishable in forced-colours mode (S6, E4,
  E8).
- [ ] AC12: `STYLE` holds the width rules that keep a 360 px viewport free of sideways scrolling: `overflow-wrap:
  anywhere` (or `break-word` together with `word-break: break-word`) on the body, so E1's texts and `<code>` wrap;
  `box-sizing: border-box` and `max-width: 100%` on inputs, selects and buttons; no `white-space: nowrap` or `pre`;
  no `width`, `min-width` or `flex-basis` with an absolute length above 20rem; the main column limited by
  `max-width` only; font sizes in `rem`, `em` or `%`, never `px`, so zoom and a large default font scale the page
  (E5); lists such as E2's take no fixed height. The `viewport` meta element of every page stays as it is
  (`width=device-width, initial-scale=1`). Every page view of AC1 renders the long texts of E1 and 100
  installations and chats of E2 without any of them being cut (S5, E1, E2, E5).
- [ ] AC13: In each mode, the card background colour declared in `STYLE` differs from the page background colour, the
  card border meets the 3:1 ratio of AC10 against the page background, and consecutive cards are separated by a
  vertical margin or gap of at least 0.75rem, so the start page's parts stay visibly separate in light and dark mode
  (S2, S4, S11).
- [ ] AC14: `docs/areas/setup-wizard.md` (_Pages and response headers_) describes the layout rules: header, main
  column, cards per section, the grouped settings, the button kinds, the notice kinds, dark mode, the width and
  contrast limits and the constraints of AC1–AC3 (S2).

## Out of scope

- New links or navigation between the pages (the navigation issue that follows #65).
- New routes, a stylesheet route, external fonts or assets (decision 0015, options 18 and 19).
- Text changes in either language, also new texts for headings or legends, and a new order of the parts of a page.
- Screenshots of the pages and a browser test tool: no browser dependency is added, and the screenshots belong to
  the setup guide of #20, which needs them anyway.
- A light/dark switch on the page (the pages follow the system setting only), a print style, and a right-to-left
  layout of the page.
- Changes to roles and ARIA attributes beyond `aria-hidden` on decoration (the notices keep `role="alert"`; the info
  and error texts of S8 get no new role).

## Open questions

- Which texts are "info" and which are "error" notices (issue: "notice styles for info and error")?
  Answered: every value of the `Notice` type (`src/setup/texts.ts:4-28`) is shown only on a refused or failed
  request, through `noticeHtml` with `role="alert"` (`src/setup/pages.ts:57-61`), so all of them are error notices;
  `reset-not-needed` too, which answers 409. The texts that replace a step's form are classed by whether the owner
  must act: _chat id secret_ and _Worker secrets_ describe a deliberate configuration (info), _partial Worker
  secrets_ and _reset needed_ block the step until fixed (error); "The GitHub App is saved." reports success (info).
- Where does the header's product name come from, when texts stay as they are?
  Answered: the existing page title (`pageTitle`, "Seluna setup" / "Seluna-Einrichtung", `src/setup/texts.ts:128` and
  `:299`), today only in the document's title element, is shown in the header too; no new text is added.
- Which texts head the settings groups, when no new text may be added?
  Answered: the rules group has its heading today as a paragraph ("Notify me about", `rulesLabel`,
  `src/setup/pages.ts:260`), which becomes the legend. The quiet hours group has no heading text; its switch's label
  "Quiet hours: notifications arrive without sound" names the group, so the switch with its label is the legend. The
  release notice switch is a notification switch and joins the rules group, where it already follows the rules.
- Does the start page change its order? The start body "Set up your instance step by step:" sits above the status,
  far from the step links it introduces.
  Answered: no. The issue's scope is the style and only the markup it needs; the order is documented
  ([Setup wizard](../../docs/areas/setup-wizard.md#paths)) and moving parts is listed out of scope. A reorder belongs
  to the navigation issue.
- Is the installation list of #15 there to be styled?
  Answered: yes. It is built (`installationsHtml`, `src/setup/pages.ts:185-208`; decision 0026), so this change styles
  it inside the status card (S2, E2).
- Do the existing tests already guard "no `style=` attribute" and "no external `src`/`href`/`action`", as the issue
  says?
  Answered: partly. `src/setup/pages.test.ts:140-176` and `:368-406` check for `<script`, `<link`, `<img`, `<iframe`,
  one `<style>` and external addresses, but no test looks for a `style=` attribute, and the shared page list
  (`:60-93`) renders the start page only in its notice-only view. External addresses do exist today — the status
  view's app link (`src/setup/pages.ts:136`), the created page's install link (`:465`) and the review form's action
  (`:521`) — so AC2 keeps exactly those instead of "none".
- Does the Content-Security-Policy need a change for a new style?
  Answered: no. `contentSecurityPolicy` hashes the `STYLE` constant at every call (`src/setup/pages.ts:50-55`), and
  `layout` renders the same constant (`:72`), so the hash follows the new style; no source is added.
- May the decoration use an inline SVG?
  Answered: the issue allows inline SVG or CSS-only decoration that needs no new CSP source. An SVG `<style>` element
  would be a second style element and an SVG `href` a fetch, so an SVG, if used, is bound by the same rules (AC1,
  AC2); decoration is optional.

## Area documents

- [Setup wizard](../../docs/areas/setup-wizard.md), _Pages and response headers_: the layout rules — a header with the
  page title and the language links, one centred main column with the page's only `<h1>`, a card per part of a page
  (the start page's status, reset, setup steps and settings, an actions area for sign-out, one card for a step's
  content), the two settings groups with their legends, primary, secondary and danger buttons, error and info
  notices and which texts use which, light and dark colours after the system setting, the 360 px width, the contrast
  ratios and the visible focus ring, and the style's limits (one `<style>`, no `style=` attribute, no `url(`,
  `@import` or `@font-face`, system fonts, at most 8 KiB). It also states that every page has the header and the main
  column, and that the descriptions of a page or view elsewhere in the area (what it "shows", "shows only" or "in this
  order") list the content of the main column. Those descriptions — _Paths_ (the order of the start page), _Status and
  settings_ (the notice-only start page), _Telegram chat_ (the _chat id secret_ view "only the heading and …", the
  step page, the notice-only page, the code page), _GitHub App_ (the step page's views, the notice-only page, the
  review, finish and created pages) — are reread against the new markup and reworded where they would contradict the
  header (for example "shows only the heading" becomes "shows in its main column only the heading"); _Paths_ also
  names the start page's parts as cards.

## Challenge

1. MAJOR — AC12 and AC13 need a browser no one in the pipeline has, and screenshots cannot be attached by the squad.
   Accepted, scope narrowed: both criteria are rewritten as properties of `STYLE` that a unit test checks on the
   constant (AC12: `overflow-wrap`, `box-sizing` and `max-width: 100%` on controls, no `nowrap`, no fixed width above
   20rem, relative font sizes, an unchanged viewport meta; AC13: card and page backgrounds differ, the card border's
   3:1 ratio, a gap of at least 0.75rem between cards). AC11 now names the static rules behind S6 and E4 (outline
   under `:focus-visible`, borders on cards, buttons, controls and notices). Screenshots leave #65 and stay with
   #20 (_Out of scope_); a new _Verification_ requirement records that no real rendering is checked and accepts that
   residual risk. No browser dependency is added, so no decision record is needed for one; no escalation, because
   the issue does not ask for screenshots or a browser check, only for the look, which the static rules carry.
2. MINOR — AC10's contrast clause has no verification path. Accepted: AC10 lists every colour pair with its required
   ratio in both modes, and a new _Colours_ requirement has each mode declare its colours once as `#rrggbb` custom
   properties used through `var(...)`, so a test computes each ratio from `STYLE`.
3. MINOR — E1 misses the enterprise slug. Accepted, and widened: `parseAccount` (`src/github/installations.ts:31-37`)
   bounds neither the login nor the enterprise slug, so E1 now names both as "of any length", and AC12's long-text
   data covers them through E1.
4. MINOR — the area-document outline is too narrow. Accepted: _Area documents_ now says that _Pages and response
   headers_ states the header and main column of every page and that page descriptions elsewhere list the main
   column's content, and names the sections whose "shows" and "shows only" wordings are reread and reworded where
   they would contradict the header, instead of "Nothing else in the area changes".
