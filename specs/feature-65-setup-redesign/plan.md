# Plan: Visual redesign of the setup pages

Source: Issue #65 | [spec.md](spec.md)
Status: Draft
Tier: standard — the pages' style and markup change visibly, while no security control is created, changed or removed: the Content-Security-Policy keeps its directives and sources, its hash follows the constant as before, and routes, forms, CSRF fields and cookies stay as they are.
Security areas touched: Setup login — `src/setup/pages.ts` (`STYLE`, `layout`, the `render*Page` functions), the area's "no script, no external resource and a strict Content-Security-Policy" (`.squad/project.md`, decision 0015)

## Problem / root cause

The feature is described in [spec.md](spec.md) (criteria AC1–AC14).

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | Today's style is five lines: a 32rem column, block inputs, padded buttons, one bordered `.notice`; no colours, no dark mode, no button kinds | `src/setup/pages.ts:19-24` | confirmed |
| 2 | The `style-src` hash is computed from `STYLE` on every call and `layout` renders the same constant, so a new style needs no CSP change | `contentSecurityPolicy`, `src/setup/pages.ts:50-55`; `layout`, `:72` | confirmed |
| 3 | Issue: "existing allow-list tests" cover "no `style=` attribute" | `src/setup/pages.test.ts:140-176`, `:368-406` check `<script`, `<link`, `<img`, `<iframe`, one `<style>`, external addresses; no test looks for `style=` | refuted |
| 4 | Issue: "no page contains an external `src`/`href`/`action`" | status view's app link `src/setup/pages.ts:136`, created page's install link `:465`, review form action `:521`; the GitHub tests list them as `external` (`pages.test.ts:368-383`); these three stay (AC2) | refuted |
| 5 | The shared page table renders the start page only in its notice-only view | `PAGES`, `src/setup/pages.test.ts:60-93` | confirmed |
| 6 | The installation list of #15 is built and sits in the status section | `installationsHtml`, `src/setup/pages.ts:185-208`; decision 0026 | confirmed |
| 7 | Every `Notice` is rendered by `noticeHtml` as `<p class="notice" role="alert">`, on refused or failed requests only | `src/setup/pages.ts:57-61`; `Notice`, `src/setup/texts.ts:4-28`; `formPage` and its callers in `src/setup/handler.ts:118-150`, `:245`, `:548-560` | confirmed |
| 8 | The page title text exists in both languages and appears today only in the document title | `pageTitle`, `src/setup/texts.ts:128`, `:299`; `layout`, `src/setup/pages.ts:72` | confirmed |
| 9 | The rules group already has a heading text, rendered as a paragraph; quiet hours have none besides the switch's label | `src/setup/pages.ts:255-261` | confirmed |
| 10 | Neither the installation login nor the enterprise slug is bounded in length before it is rendered | `parseAccount`, `src/github/installations.ts:31-37`; `accountHtml`, `src/setup/pages.ts:149-175` | confirmed |
| 11 | The time zone options come from the runtime (`Intl.supportedValuesOf`), so their text can change with a runtime update | `timeZones`, `src/settings.ts:73-81` | confirmed |
| 12 | The Workers test plugin supports Vitest file snapshots (`toMatchSnapshot`), writing `src/setup/__snapshots__/pages.test.ts.snap` on a local run and failing on a missing snapshot under `CI=true` | to verify: the Tester, step 5, runs the AC4 tests once locally on the base code and checks that the snapshot file is written with one entry per view and language and that a second run passes; if not, the fallback in *Approach* (AC4 snapshots) applies. Hint: `node_modules/@cloudflare/vitest-plugin/dist/worker/lib/cloudflare/snapshot.mjs` exists | unverified |
| 13 | Existing tests that assert markup this change rewraps: only the _reset needed_ paragraph | `src/setup/pages.test.ts:417` asserts `<p>${githubResetNeeded}</p>\n<p><a href="/setup">…`; every other exact-markup assertion (`pages.test.ts:593-594`, `:624-625`, `:638`, `:709-759`, `:871-884`; `handler.test.ts:168-169`, `:923-936`, `:1042-1050`, `:1777-1808`, `:2717-2819`) targets markup that stays (`<h1>`, step and back links, status `<p>` lines, the installations list, form start tags, inputs) | confirmed |
| 14 | No browser tooling is installed; tests run in the Workers runtime and in the `node` project for workflow scripts | `package.json` devDependencies; `vitest.config.ts` projects | confirmed |
| 15 | `docs/ARCHITECTURE.md` says nothing about the page style; the area index scope already names "the page and header rules" | grep for style/CSS/dark in `docs/ARCHITECTURE.md`, `docs/areas/*.md`; `docs/areas/README.md` index | confirmed |
| 16 | Decision 0015 is released (tags up to `v0.5.0` on origin) and is not contradicted: one hashed inline `<style>` remains | `git ls-remote --tags origin`; options 17–19 | confirmed |

## Acceptance criteria

The criteria are AC1–AC14 of [spec.md](spec.md).

## Tests per criterion

All tests go into `src/setup/pages.test.ts` (one test file per module, `.squad/stack.md` *Layout*). The AC4 snapshot
file is `src/setup/__snapshots__/pages.test.ts.snap`, written by Vitest. The tests of AC1–AC4 guard behavior that
holds on the base code and pass there; they are written in step 5 anyway, because AC4's snapshot must be taken
from the code before the Dev changes it. The others fail on the base code.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `the $page page in $language has exactly one style element with STYLE as its content` over the new table `ALL_PAGES` (*Approach*, test data), counting `<style` anywhere (an SVG's too); `htmlResponse sets the security headers, Content-Type and Content-Language` (existing, unchanged: the hash of `STYLE`) | `src/setup/pages.test.ts` |
| AC2 | `the $page page in $language has no style attribute, script, link, img, iframe or xlink:href`; `the $page page in $language has exactly its own external addresses in src, href and action` (the view's `external` list of `ALL_PAGES`) | `src/setup/pages.test.ts` |
| AC3 | `STYLE loads nothing: no url(, @import or @font-face`; `STYLE names only system and generic font families`; `STYLE is at most 8192 bytes as UTF-8` | `src/setup/pages.test.ts` |
| AC4 | `the body text of the $page page in $language is unchanged` and `the forms of the $page page in $language are unchanged` (both `toMatchSnapshot` on `ALL_PAGES`, written from the base code); `the name and username of a chat keep their escaping and own bdi` (existing `renderTelegramPage` tests, `pages.test.ts:214-260`, unchanged) | `src/setup/pages.test.ts` |
| AC5 | `the $page page in $language starts with a header holding the page title and both language links`; `the $page page in $language has one main element holding its only h1` | `src/setup/pages.test.ts` |
| AC6 | `renderStartPage status view shows the heading block, status, reset, steps, settings and sign-out in this order, each in its own section`; `renderStartPage without a reset shows no reset section and no empty section`; `renderStartPage without a notice shows no notice element`; `renderStartPage notice-only view shows the notice, the steps section and the sign-out section` | `src/setup/pages.test.ts` |
| AC7 | `renderStartPage puts quiet hours, start and end in one fieldset whose legend holds the quiet hours switch in $language`; `renderStartPage puts the eight rules and the release notice in one fieldset with the rules label as legend in $language` | `src/setup/pages.test.ts` |
| AC8 | `every button of the $page page in $language has its kind: sign-out secondary, reset danger, every other primary` (over `ALL_PAGES`, the kind read from the button's class) | `src/setup/pages.test.ts` |
| AC9 | `every notice is shown in the error style in $language` (each `Notice` on the login page and on one step page); `the chat id secret, Worker secrets and app saved texts are shown in the info style in $language`; `the partial Worker secrets and reset needed texts are shown in the error style in $language` | `src/setup/pages.test.ts` |
| AC10 | `STYLE declares the same colour properties as #rrggbb for light and dark mode`; `STYLE sets color-scheme light dark`; `in $mode mode $pair has a contrast ratio of at least $ratio` (one case per pair and mode, the pairs of *Approach*) | `src/setup/pages.test.ts` |
| AC11 | `STYLE draws a focus outline of at least 2px under focus-visible for links, buttons, inputs, selects, checkboxes and radio buttons`; `STYLE never removes the outline under plain focus`; `STYLE gives cards, buttons, inputs, selects and notices a border` | `src/setup/pages.test.ts` |
| AC12 | `STYLE wraps long words in the body`; `STYLE keeps inputs, selects and buttons within their container`; `STYLE has no nowrap, no pre, no fixed width above 20rem and no fixed height`; `STYLE sizes fonts only in rem, em or %`; `the $page page in $language keeps the viewport meta element`; `renderStartPage shows a 300-character login and enterprise slug in full, escaped`; `renderTelegramPage shows a 128-character name without spaces in full`; `renderTelegramPage lists 100 chats` (with the existing 100-installations test, `pages.test.ts:762`) | `src/setup/pages.test.ts` |
| AC13 | `in $mode mode the card background differs from the page background`; `in $mode mode the card border has a contrast ratio of at least 3 against the page background` (shared with AC10); `STYLE separates cards by a bottom margin of at least 0.75rem` | `src/setup/pages.test.ts` |
| AC14 | none — documentation; see *Verification without tests* | — |

## Verification without tests

- AC14: `docs/areas/setup-wizard.md` is written by the Lead in the docs group (task 8) against the final `STYLE` and
  markup, checked by `decision-check.py` (links) and read by the Reviewer in step 8 against the diff.
- Residual, not a criterion: how the pages render in a real browser is not verified (decision 0034); the
  screenshots of #20 are the first real rendering.

## Approach

### Markup (`src/setup/pages.ts`)

The layout is fixed here; the Tester's tests match it. Every element below is new markup; texts, their order,
form fields and attributes stay (AC4). Class names are exactly these.

- `layout`: the body becomes
  `<header class="site">\n<p class="brand">{pageTitle}</p>\n<nav>{languageLabel}: <a …>English</a> | <a …>Deutsch</a></nav>\n</header>\n<main>\n{body}\n</main>`
  — the nav line itself is unchanged. The brand is a paragraph, not a heading. The `<head>` is unchanged (the
  viewport meta stays; no new meta element).
- Login page: `<h1>`, intro, notice, then `<section class="card">` holding the form; the button `class="primary"`.
- _Not configured_ page: `<h1>`, then one `<section class="card">` with the paragraphs.
- Start page, status view, in this order: `<h1>`, start body, notice (only when given); `<section class="card">`
  with the status (`<h2>` and the status lines as today, the installation lines and list unchanged inside it);
  when a reset is needed `<section class="card">` with the reset heading, text and form, its button
  `class="danger"`; `<section class="card">` with the step links list; `<section class="card">` with the settings
  `<h2>` and form; `<section class="actions">` with the sign-out form, its button `class="secondary"`. Notice-only
  view: `<h1>`, start body, notice, the steps section, the actions section. No section is emitted empty.
- Settings form: after the time zone select,
  `<fieldset class="group">\n<legend>{quiet_hours checkbox label, unchanged}</legend>\n{start label, input, end label, input}\n</fieldset>`
  and `<fieldset class="group">\n<legend>{rulesLabel}</legend>\n{eight rule checkboxes}\n{update_notice checkbox}\n</fieldset>`
  (the `<p>` around the rules label becomes the legend); then the save button `class="primary"`.
- Telegram step and GitHub App step pages, the review page and the finish page: `<h1>`, then one
  `<section class="card">` holding everything that followed the heading before (intro, notice, saved line, links,
  forms), in the same order. Every submit button there is `class="primary"`.
- Notices: `noticeHtml` renders `<p class="notice error" role="alert">` (was `class="notice"`). The texts _chat id
  secret_, _Worker secrets_ and _app saved_ ("The GitHub App is saved.") are rendered as `<p class="notice info">`,
  _partial Worker secrets_ and _reset needed_ (GitHub step) as `<p class="notice error">` — no role added (spec,
  *Out of scope*).
- No inline SVG and no decoration element: the decoration is CSS-only.

### Style (`STYLE`)

The CSS is the Dev's, bound by these rules, which the tests read:

- It starts with `:root{color-scheme:light dark;…}` declaring the light colours, and contains exactly one
  `@media (prefers-color-scheme:dark){:root{…}}` declaring the same properties for dark mode, each as `#rrggbb`.
  The properties: `--bg` (page), `--fg` (text), `--card` (card and header background, input and select
  background), `--border` (card border), `--control` (input, select and secondary button border, fieldset border),
  `--link`, `--primary`, `--on-primary`, `--secondary`, `--on-secondary`, `--danger`, `--on-danger`,
  `--error-bg`, `--error-fg`, `--error-border`, `--info-bg`, `--info-fg`, `--info-border`, `--focus`. No other
  rule names a colour literally; every rule uses `var(--…)`. Text on the page background and in the header uses
  `--fg`; links use `--link` (the header has the `--card` background).
- Contrast pairs (AC10, AC13), each in both modes, at least 4.5:1: `--fg`/`--bg`, `--fg`/`--card`,
  `--link`/`--card`, `--link`/`--bg`, `--on-primary`/`--primary`, `--on-secondary`/`--secondary`,
  `--on-danger`/`--danger`, `--error-fg`/`--error-bg`, `--info-fg`/`--info-bg`; at least 3:1: `--border`/`--bg`,
  `--control`/`--card`, `--primary`/`--card`, `--danger`/`--card`, `--error-border`/`--card`,
  `--error-border`/`--bg`, `--info-border`/`--card`, `--info-border`/`--bg`, `--focus`/`--bg`, `--focus`/`--card`.
  Notices appear on the page background (login, start page) and inside cards (step pages), hence both. The
  Tester computes the ratio by WCAG 2.1 (relative luminance from sRGB, `(L1 + 0.05) / (L2 + 0.05)`), with no
  rounding up.
- `--card` differs from `--bg` in each mode (AC13); `.card` declares `margin-bottom` of at least `0.75rem` as its
  own declaration (AC13).
- `body` declares `overflow-wrap:anywhere` and the font stack `system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`
  (AC3 accepts `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `Roboto`, `"Helvetica Neue"`,
  `Arial`, `sans-serif`, `ui-monospace`, `monospace`); `main` has `max-width` in `rem` and no `width`.
- A rule whose selectors include `input`, `select` and `button` declares `box-sizing:border-box` and
  `max-width:100%`. No `white-space:nowrap` or `pre`, no `height` or `max-height` declaration, no `width`,
  `min-width` or `flex-basis` with an absolute length above `20rem` (`px`, `pt`, `cm`, `mm`, `in`, or `rem`/`em`
  above 20). Every `font-size` is in `rem`, `em` or `%`. No `transition` or `animation`.
- `:focus-visible` (on `a`, `button`, `input`, `select`, alone or as part of the selectors) declares
  `outline:<n>px solid var(--focus)` with n ≥ 2 and an `outline-offset`; no rule with `:focus` (without
  `-visible`) sets `outline` to `none` or `0`. `.card`, `button`, `input`, `select` and `.notice` each get a
  `border` declaration (one rule may cover several).
- Buttons: `.primary` filled with `--primary`/`--on-primary`, `.secondary` with `--secondary`/`--on-secondary` and
  a `--control` border, `.danger` with `--danger`/`--on-danger`; all with a `min-height` of at least `2.75rem`
  (44 px at the default size). `.notice.error` and `.notice.info` use their three colours, with a thicker start
  border. `.group` (fieldset) uses a `--control` border; checkbox and radio labels stay on one line with their box.
- Header: full width, `--card` background, `--border` bottom border, brand and nav side by side with `flex-wrap`,
  so they stack at 360 px.
- Look within these rules: free for the Dev, approved in step 9.

### Test data and helpers (Tester, `src/setup/pages.test.ts`)

- `ALL_PAGES`: one entry per view and language, each with its `links` and `external` lists, replacing `PAGES` and
  `GITHUB_PAGES` (their tests move onto it): login without a notice and with _wrong secret_; _not configured_; the
  start page's status view with a saved app with slug, listed installations and reset needed, the status view with
  Worker secrets, installations unavailable and no reset, the status view with no app (installations hidden), and
  the notice-only view with _unavailable_; Telegram _chat id secret_, notice-only (_send failed_), code, problem
  (_token missing_, with and without a saved chat), chats, no chats; GitHub Worker secrets, partial Worker
  secrets, reset needed, notice-only (_state invalid_), form without and with a saved app, created with and
  without slug; the review page (personal and organization); the finish page with and without _GitHub
  unavailable_. External lists: the status view with slug `https://github.com/apps/<slug>`, created with slug
  `https://github.com/apps/<slug>/installations/new`, the review page its form action; every other view `[]`.
- `bodyText(html)`: the text between `<body>` and `</body>`, with the element `<p class="brand">…</p>` removed (absent
  on the base code), the content of `<select id="time_zone">…</select>` removed (runtime-dependent, fact 11),
  tags removed, whitespace collapsed, trimmed; character references left as they are.
- `formsSignature(html)`: per `<form>` its `method` and `action`, then each start tag of `label`, `input`,
  `select`, `option`, `button` and `textarea` inside it, in order, as the tag name with `type`, `name`, `value`,
  `id`, `for`, `required`, `pattern`, `maxlength`, `inputmode`, `autocomplete`, `checked`, `selected` in this
  order (`class` ignored); the `option` tags of `time_zone` reduced to the selected one.
- AC4 snapshots: `expect(bodyText(page)).toMatchSnapshot()` and `expect(formsSignature(page)).toMatchSnapshot()`,
  run once on the base code without `CI=true` so Vitest writes the snapshot file, which is committed with the tests
  in step 5 (the "before" output is that file, captured from commit `78ca2ac`'s `src/setup/pages.ts`). The Dev
  never updates it (`-u` is not run after step 5); a failing snapshot is a defect of the change. Fallback if
  fact 12 fails: the Tester renders the same views on the base code in a scratch run and writes the two outputs
  per view as an expected-value table `BEFORE` in `src/setup/pages.test.ts`, with the same tests comparing against
  it.
- `cssRules(style)`: splits `STYLE` into rules `{ media, selectors, declarations }` (one level of `@media`), used by
  the AC3 and AC10–AC13 tests; `colours(style, mode)` reads the custom properties of `:root` (light) or of the
  dark `@media` block.

## Options considered

- Verification of the look: static checks on `STYLE` and the markup (chosen) against a browser test tool with
  screenshots and a manual check by the owner at approval — both lost (decision 0034, options 1–3).
- The "before" of AC4: Vitest snapshots from the base code (chosen) against expected texts assembled from the
  language tables in the test, which rebuilds the render logic (decision 0034, options 4–5).
- Colours: custom properties per mode (chosen) against literal colours per rule (decision 0034, options 6–7).
- Where a step page's intro and notice go: inside the one card with the rest (chosen) against outside the card as
  on the login page — the step pages have no form-only part to set apart, and one card keeps their view
  descriptions in the area document simple.
- The actions area as `<section class="actions">` (chosen) against a `<div>` — the issue lists `<section>` among
  the allowed elements, a `<div>` is not; both render the same.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/setup/pages.ts` | `STYLE` rewritten; `layout`, `noticeHtml`, `renderLoginPage`, `stepLinksHtml`, `logoutFormHtml`, `statusHtml` (wrapped by the caller), `resetHtml`, `settingsFormHtml`, `renderStartPage`, `renderNotConfiguredPage`, `renderTelegramPage`, `chatsHtml`, `codeHtml`, `renderGitHubPage`, `githubFormHtml`, `githubCreatedHtml`, `renderGitHubReviewPage`, `renderGitHubFinishPage` get the markup of *Approach* |
| Worker tests | `src/setup/pages.test.ts`, `src/setup/__snapshots__/pages.test.ts.snap` (new) | tests of *Tests per criterion*; `PAGES` and `GITHUB_PAGES` folded into `ALL_PAGES`; the test at `:417` adapted |
| Docs | `docs/areas/setup-wizard.md`, `docs/decisions/0034-setup-page-layout-checked-on-the-style.md`, `docs/decisions/README.md` | layout rules; the record and its index row |

## Signatures (for the Dev's skeleton)

None exported: every exported function of `src/setup/pages.ts` keeps its signature, and `STYLE` stays an exported
`string` constant. Internal helpers may change; the plan fixes none of their signatures. No skeleton step (step 4).

## Test files

- `src/setup/pages.test.ts` (existing) and its snapshot file `src/setup/__snapshots__/pages.test.ts.snap` (new, Vitest's
  own location for that test file).

Existing test code affected: `src/setup/pages.test.ts:408-420` (the _reset needed_ view asserts `<p>` without a
class) — the Tester adapts it to `<p class="notice error">` in step 5; `PAGES` (`:60-93`) and `GITHUB_PAGES` (up to
`:365`) are replaced by `ALL_PAGES` by the Tester. No test in `src/setup/handler.test.ts` needs a change (fact 13);
if the Dev finds one failing on markup, it goes to the Tester (*Loop limits*).

Files no unit test can cover: none.

## Areas

- [Setup wizard](../../docs/areas/setup-wizard.md): the layout rules in _Pages and response headers_, and the page
  descriptions reworded where the header would contradict them (*Documentation updates*). No new area.

## Documentation updates

Sweep: `docs/ARCHITECTURE.md` and `docs/areas/*.md` searched for the style, the page structure and every "shows",
"shows only" or "in this order" description of a setup page. Hits, all in `docs/areas/setup-wizard.md`, all owned by
the Lead (docs group, task 8):

- _Pages and response headers_ (lines 402-423): the layout rules of the spec's *Area documents* section — header
  with the page title and the language links, the main column with the only `<h1>`, the cards per part, the actions
  area, the settings groups and their legends, the button kinds and which button has which, the error and info
  notices and which texts use which, light and dark colours after the system setting, the 360 px width rules, the
  contrast ratios, the focus ring, and the style's limits (one `<style>`, no `style=` attribute, no `url(`,
  `@import`, `@font-face`, system fonts, at most 8 KiB); and the statement that the page descriptions elsewhere in
  the area list the content of the main column.
- _Paths_ (lines 30-33): the start page's order, naming its parts as cards and the sign-out as the actions area.
- _Status and settings_ (line 172): the notice-only start page.
- _Telegram chat_ (lines 202-204, 235-243, 256-259): the _chat id secret_ view ("only the heading and …"), the step
  page, the notice-only page, the code page.
- _GitHub App_ (lines 295-297, 306-312, 321-326, 347-349, 376-380): the Worker secrets views, the step page and its
  views, the review page, the finish page, the created page.
- _Related decisions_: a link to decision 0034.

No hit in `docs/ARCHITECTURE.md` (fact 15); `.squad/project.md`, `README.md` and the area index need no change.

## Architecture check

The guarantee of the Setup login area — no script, no external resource, a strict Content-Security-Policy with one
hashed inline style (`.squad/project.md`; decision 0015) — is kept and now tested more widely: every view (AC1),
no `style=` attribute and no new external address (AC2), nothing loaded by the style (AC3). The policy's directives
do not change, and the hash still follows the constant (fact 2). No other guarantee is touched.

## Security considerations

- [x] Every byte or length limit on parsed input says whether it applies before or after decoding — no limits:
  the change parses no input; the 8 KiB bound is on the constant, counted in UTF-8 bytes.
- [x] Every exception that can reach a user-visible failure reason or message is listed — none: rendering stays
  string concatenation of escaped values; no new failure path.
- Every value from outside (names, usernames, logins, slugs, the account, code and state) keeps its escaping and its
  place in the markup; class names are constants, never derived from input (AC4, AC12's long-text tests).

## Decision records

- `docs/decisions/0034-setup-page-layout-checked-on-the-style.md` (Proposed) — static verification of the look
  instead of a browser, snapshots for the unchanged texts, colours as custom properties; indexed.

## Challenge notes

Minor objections of the Devil's Advocate (plan challenge), verbatim:

1. minor: Add the pair `--control`/`--bg` (or `--secondary`/`--bg`, at least 3:1, in both modes) to the AC10 contrast pairs and to its test. Why: the only secondary button, *Sign out*, sits in `<section class="actions">` on the page background, not in a card (*Approach*, start page). But the plan's 3:1 pairs only measure `--control` against `--card`. As written, the spec's requirement that button borders reach 3:1 "against their surroundings" is never tested for the one button that is not in a card.
2. minor: Add these views to `ALL_PAGES`, so that AC1, AC2, AC4 and AC8 also cover them: the start page's status view with a notice (for example `form-expired`), the Telegram code view with a notice, and the GitHub form view with a notice. Why: these are real views. `formPage` passes a notice to every start, Telegram and GitHub render (`src/setup/handler.ts:118-150`), and the status view with a notice is answered at `handler.ts:251`, `:560` and `:570`. AC6 also places the notice in the start page's heading block.

## Security notes

Non-blocking findings of Security (plan review, APPROVED), verbatim:

1. AC3's "STYLE loads nothing" test, as planned, misses some ways CSS can load a resource. The plan's guard is three plain substring checks (`url(`, `@import`, `@font-face`). The CSS tokenizer also accepts: any letter case (`URL(`, `@IMPORT`, `@Font-Face`); CSS escapes in the name (`u\72l(`, `\75rl(`, `@\69mport`); functions that fetch from a bare string with no `url(`: `image-set("…")`, `-webkit-image-set("…")`, `src("…")`, `image("…")`, `cross-fade(…)`, `element(#…)`; and `@namespace "…"`. The CSP blocks all of these at runtime, so this is not an exposure today, but a test with this name would claim more than it checks. Complete fix: match case-insensitively, and reject any `\` in `STYLE`, any `@` rule other than `@media`, and the function names `image-set(`, `-webkit-image-set(`, `src(`, `image(`, `cross-fade(`, `element(`.
2. The hash only matches if the browser sees exactly the bytes that were hashed. `STYLE` is inserted raw into `<style>…</style>`, and the HTML parser changes some characters before the browser computes the CSP hash (CR and CRLF become LF, NUL is replaced). A `</style` sequence would also end the element early. Suggested test alongside AC1/AC3: `STYLE` is printable ASCII only (no CR, LF or NUL) and contains no `<`.

## Out of scope / follow-ups

- Navigation between the pages (the issue that follows #65) and a reorder of the start page.
- Screenshots and any browser rendering check: with #20.
