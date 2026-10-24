# Plan: Navigation between the setup pages

Source: Issue #66 | [spec.md](spec.md)
Status: Draft
Tier: standard — a behavior change of the page frame (a step navigation, one removed link, one style rule) that creates, changes or removes no security control.
Security areas touched: Setup login (`src/setup/pages.ts`: the markup of every page and the `STYLE` constant whose hash the `Content-Security-Policy` names; the step navigation also appears on the pages `GET /setup/github/callback` answers signed out)

## Problem / root cause

See [spec.md](spec.md), *Problem*: no step page has a recognisable way back to `/setup`, and no page shows where in
the setup the owner is.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | No Telegram view links to `/setup`; the GitHub step links to `/setup` only in `reset-needed`; the review, finish and created pages do not. | `src/setup/pages.ts` 443–489 (`renderTelegramPage`), 540–545 (`reset-needed`), 568–608 | confirmed |
| 2 | Every page, the login and _not configured_ pages included, is framed by the one private `layout(language, body)`, whose header holds the brand and the unnamed language `<nav>`. | `pages.ts` 113–123; callers 128, 321, 331, 344, 488, 565, 578, 597 | confirmed |
| 3 | The finish page and the GitHub notice-only page are answered on `GET /setup/github/callback` with or without a session. | `src/setup/handler.ts` 398–416 (`finishPage`, `githubNoticePage`); `docs/areas/setup-wizard.md` 353–360 | confirmed |
| 4 | A successful sign-out, settings save or reset answers 303; the start page is rendered on those paths only for 403, 400, 409 and 503. | `handler.ts` 250–253 (`signOut`), 579–588 (`saveSettings`), 597–607 (`resetSaved`) | confirmed |
| 5 | `startPageLink` is used once in production code and asserted in two tests. | `pages.ts` 543; `pages.test.ts` 224; `texts.test.ts` 222, 253; `texts.ts` 111, 225, 397 | confirmed |
| 6 | The body-text snapshots compare the whole `<body>` text minus the brand, so the header's text is part of every snapshot. | `pages.test.ts` 458–465 (`bodyText`), 615–623 | confirmed |
| 7 | The frame test asserts the exact header markup, which the step navigation and the language `aria-label` change. | `pages.test.ts` 625–640 | confirmed |
| 8 | The header background is `var(--card)`, the body text `var(--fg)`, and the pair `--fg` on `--card` is tested at 4.5:1 in both modes; `a:focus-visible` gets the 3px outline. | `pages.ts` 28–32, 59; `pages.test.ts` 1607–1609, 1793 | confirmed |
| 9 | `STYLE` is 3,015 characters (printable ASCII), far below the 8,192-byte limit. | sum of the string literals of `STYLE` in `pages.ts` 19–60, counted by a script | confirmed |
| 10 | `aria-current` is a global ARIA state, valid on a `span`. | WAI-ARIA 1.2, *aria-current* (used in all host-language elements) | confirmed |
| 11 | Decision 0034 is unreleased, so it is extended in place. | `git merge-base --is-ancestor e5f3f28 v0.5.0` → not an ancestor; `git ls-remote --tags origin` lists v0.3.0–v0.5.0 only | confirmed |
| 12 | No handler test asserts the header or a link to `/setup`; the handler's link checks use `toContain`/`toMatch` and survive an extra navigation link. | `grep` of `<nav`, `languageLabel`, `startPageLink`, `href="/setup"` in `src/setup/handler.test.ts`: no hit; 918, 1779, 1870, 2870 | confirmed |
| 13 | The two-navigation header wraps at 360 px. | `header.site` is `display:flex; flex-wrap:wrap` (`pages.ts` 31–32); real rendering is not checked (decision 0034, *Consequences*) | confirmed |

## Acceptance criteria

The criteria are those of [spec.md](spec.md), AC1–AC12.

## Tests per criterion

All in the `workers` project. `ALL_PAGES` in `src/setup/pages.test.ts` gains a field `current: "start" | "telegram"
| "github" | undefined` per entry (undefined for login and _not configured_), from which the step-navigation tests derive
the expected markup of *Approach*.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `the $page page in $language has exactly one link to /setup, the Start page item of the step navigation` (every entry with `current` telegram or github; label `TEXTS[language].startPageLink`) | `src/setup/pages.test.ts` |
| AC2 | `the $page page in $language shows the step navigation with its step as the current item` (every entry with `current` telegram or github: the step `<nav>` equals the *Approach* markup for that item) | `src/setup/pages.test.ts` |
| AC3 | `the $page page in $language shows the step navigation with the start page as the current item and no link to /setup` (every start entry: exact step `<nav>`, no `href="/setup"`) | `src/setup/pages.test.ts` |
| AC4 | `the $page page in $language has exactly one aria-current, on a span inside the step navigation, items in order` | `src/setup/pages.test.ts` |
| AC5 | `the $page page in $language names the step navigation and the language navigation` (rewrite of the frame test at 625–640 to the *Approach* header); `texts word the navigation as the area document does` (`stepsLabel`, `startPageLink` in English and German); `texts keep the same keys in the same order in English and German` (`Object.keys(TEXTS.de)` equals `Object.keys(TEXTS.en)`); the existing `startPageLink` expectation at 253 changes to "Start page" | `src/setup/pages.test.ts`, `src/setup/texts.test.ts` |
| AC6 | `the $page page in $language has no step navigation and no aria-current` (entries with `current` undefined; the href test already pins the two language links) | `src/setup/pages.test.ts` |
| AC7 | `renderGitHubPage reset-needed view shows the reset needed notice and no link in its card in $language` (replaces the test at 216–227: the card's content is exactly the notice paragraph) | `src/setup/pages.test.ts` |
| AC8 | the existing `links to /setup?lang=en, /setup?lang=de and its own links only` test with each entry's `links` extended by the navigation links of its `current` (`/setup` and `/setup/github` for telegram, `/setup` and `/setup/telegram` for github, `/setup/telegram` and `/setup/github` for start); `the step navigation of the $page page in $language links only to /setup, /setup/telegram and /setup/github` (no `?`, no `#`); the external-address test unchanged | `src/setup/pages.test.ts` |
| AC9 | `GET /setup/github/callback signed out shows the step navigation with GitHub App as the current item` (valid return and invalid return); `handleSetup answers GET /setup and /setup/telegram without a session with the login page and no step navigation` | `src/setup/handler.test.ts` |
| AC10 | `STYLE shows the current item of the step navigation in bold in the text colour` (a rule for `.steps [aria-current=page]` with `font-weight:700`, no `color` other than `var(--fg)`, no `text-decoration` other than `none`); `STYLE gives the header the card background` (`header.site` background `var(--card)`, so the existing `--fg on --card` contrast test covers the item); the existing focus, width and style-limit tests unchanged | `src/setup/pages.test.ts` |
| AC11 | the existing snapshot tests at 615–623, with `bodyText` also removing `<nav class="steps" …>…</nav>` (new markup, like the brand); after G3 the snapshot file is updated and its diff holds only the two _reset needed_ body-text entries | `src/setup/pages.test.ts`, `src/setup/__snapshots__/pages.test.ts.snap` |
| AC12 | none: documentation; the Reviewer reads `docs/areas/setup-wizard.md` against the final code in step 8 | `docs/areas/setup-wizard.md` |

## Approach

**Markup** (layout fixed here; the Tester's expectations follow it exactly). `layout()` writes the header as three
lines, the step navigation only when a current item is given:

```html
<header class="site">
<p class="brand">Seluna setup</p>
<nav class="steps" aria-label="Setup steps"><a href="/setup">Start page</a> | <a href="/setup/telegram">Telegram chat</a> | <span aria-current="page">GitHub App</span></nav>
<nav aria-label="Language">Language: <a href="/setup?lang=en">English</a> | <a href="/setup?lang=de">Deutsch</a></nav>
</header>
```

- Items always in the order start, telegram, github, separated by ` | ` like the language links. The current item is
  `<span aria-current="page">label</span>`, the others `<a href="path">label</a>`.
- Labels: `startPageLink`, `telegramHeading`, `githubHeading`; the name `stepsLabel`; the language navigation's name
  `languageLabel`. Every text through `escapeHtml`.
- Current item per page: `renderStartPage` (both views) `"start"`; `renderTelegramPage` (every view) `"telegram"`;
  `renderGitHubPage` (every view), `renderGitHubReviewPage`, `renderGitHubFinishPage` `"github"`; `renderLoginPage`
  and `renderNotConfiguredPage` none (no step `<nav>` line; the language `<nav>` gets its `aria-label` there too).
  The handler is not changed: the item follows the render function, not the path or the session (spec E1, E4).
- `reset-needed` view: `titled(heading, '<p class="notice error">…</p>')`, the `<p><a href="/setup">…</a></p>` removed.
- **Style:** one rule appended to `STYLE`: `.steps [aria-current=page]{font-weight:700}`. The span inherits
  `var(--fg)` and has no underline; `nav{font-size:.9rem}` already applies. The hash in the policy follows the
  constant as before.
- **Texts:** `SetupTexts` gains `stepsLabel` right after `languageLabel`, followed by `startPageLink`, moved from its
  place after `resetButton`; English "Setup steps" / "Start page", German "Einrichtungsschritte" / "Startseite"; the
  same order in both tables.

## Options considered

- **Current item as text vs. as a link with `aria-current`, navigation in the header vs. back links in each view** —
  decided in the spec (*Open questions*) and recorded in decision 0034 (options 8–10).
- **`startPageLink`: reuse with new values (chosen) vs. delete it and add a new key** — the issue asks for reuse, the
  key's name still describes the label, and one key less to keep in sync; deleting would be an equal amount of code
  but contradict the issue's note.
- **Language navigation named by `aria-label` = `languageLabel` (chosen) vs. left unnamed** — two navigation
  landmarks without distinct names are indistinguishable in a screen reader's landmark list; the existing text serves,
  no new key. Unnamed would keep the header byte-identical but leave S8 half met.
- **Separators ` | ` (chosen) vs. a `<ul>` list** — the list announces "3 items" but needs list-reset and flex rules in
  `STYLE`; the separators match the language navigation beside it and add no rule.
- **Snapshot text without the step navigation (chosen) vs. regenerating every body-text snapshot** — keeping the
  snapshots as the oracle of "the main column did not change" (decision 0034, option 4) makes the update a two-entry
  diff that a reviewer can read; regenerating every body-text entry (two per page view) would hide a real text change among the navigation lines.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/setup/pages.ts` | `layout()` gains the current item and writes the step navigation and the language `aria-label`; new private `NavigationItem` and `stepNavigationHtml`; every render function passes its item; `reset-needed` loses its link; `STYLE` gains one rule |
| Worker | `src/setup/texts.ts` | `SetupTexts.stepsLabel` new; `startPageLink` moved and reworded, both tables |
| Tests | `src/setup/pages.test.ts`, `src/setup/texts.test.ts`, `src/setup/handler.test.ts`, `src/setup/__snapshots__/pages.test.ts.snap` | tests of *Tests per criterion*; adapted tests below |
| Docs | `docs/areas/setup-wizard.md`, `docs/decisions/0034-…`, `docs/decisions/README.md` | area document (G5); record and index already edited by the Lead |

## Signatures (for the Dev's skeleton)

Exported: only the interface gains a member (the skeleton writes it with its final values, since a data key has no
body to stub):

```ts
export interface SetupTexts {
  readonly pageTitle: string;
  readonly languageLabel: string;
  /** The accessible name of the step navigation. */
  readonly stepsLabel: string;
  /** The label of the step navigation's start page item. */
  readonly startPageLink: string;
  // … the other members unchanged, `startPageLink` removed from its old place
}
```

Private in `src/setup/pages.ts` (G3, no skeleton):

```ts
/** The items of the step navigation, in their order. */
type NavigationItem = "start" | "telegram" | "github";

/** The step navigation with `current` as marked text and the other items as links. */
function stepNavigationHtml(language: Language, current: NavigationItem): string;

/** A complete page: the header (brand, the step navigation when `current` is given, the language navigation) and `body` as the main column. */
function layout(language: Language, body: string, current: NavigationItem | undefined): string;
```

No exported render function changes its signature.

## Test files

`src/setup/pages.test.ts`, `src/setup/texts.test.ts`, `src/setup/handler.test.ts` and the snapshot file
`src/setup/__snapshots__/pages.test.ts.snap` (*Layout* in `.squad/stack.md`: one test file per module).

Existing test code the change breaks, adapted by the **Tester** (all in G2, the snapshot file in G4):

- `pages.test.ts` 625–640, the frame test: rewritten to the *Approach* header (AC5, AC6).
- `pages.test.ts` 216–227, the reset-needed link test: replaced (AC7).
- `pages.test.ts` 366–437, `ALL_PAGES`: the `current` field and the extended `links` (AC8).
- `pages.test.ts` 458–465, `bodyText`: also removes the step `<nav>` (AC11).
- `texts.test.ts` 253: `startPageLink` becomes "Start page"; the object of that test keeps listing the key.
- `src/setup/__snapshots__/pages.test.ts.snap`: updated with `npx vitest run src/setup/pages.test.ts -u` after G3;
  the Tester confirms with `git diff` that only the two `github reset-needed` body-text entries changed and reports
  any other changed entry as a defect instead of keeping it.

Expected failures after the skeleton (G1): the reset-needed body-text snapshots ("Start page" in place of "Open the
start page") until G3 removes the link and G4 updates them.

Files no unit test can cover: none.

## Areas

`docs/areas/setup-wizard.md` (setup wizard): the step navigation in the frame, the language navigation's name, the
extended _Language_ sentence, the _reset needed_ view without its link, the texts.

## Documentation updates

Sweep of `docs/areas/*.md`, `docs/ARCHITECTURE.md`, `docs/setup.md` and `README.md` for statements this change
extends (`links to`, `language links`, `header`, `Open the start page`): hits only in `docs/areas/setup-wizard.md`.

| Document | Passage | Change | Owner |
| -------- | ------- | ------ | ----- |
| `docs/areas/setup-wizard.md` | *Pages and response headers*, **Frame** (417–421) | the header also holds, on every page but login and _not configured_, the step navigation: its name, the items in order, the current item as bold text with `aria-current="page"`, not a link, chosen by the page, not the path or session; the language navigation is named _Language_ | Lead (G5) |
| `docs/areas/setup-wizard.md` | **Colours** (439–447) | the current item's text colour on the header background is part of the 4.5:1 list; its marking is bold, not colour alone | Lead (G5) |
| `docs/areas/setup-wizard.md` | **Style limits** (457–463) | the internal addresses of the step navigation are fixed (`/setup`, `/setup/telegram`, `/setup/github`); external list unchanged | Lead (G5) |
| `docs/areas/setup-wizard.md` | *GitHub App*, *The step page* (312–315) | _reset needed_ view without "and a link to the start page, `/setup`" | Lead (G5) |
| `docs/areas/setup-wizard.md` | *Language* (489–490) | the sentence extended: pages with the step navigation also link to its items | Lead (G5) |
| `docs/areas/setup-wizard.md` | *Texts* (533, 586) | the navigation texts "Setup steps", "Start page" and the reuse of the two headings; _reset needed_ without "followed by the link Open the start page" | Lead (G5) |
| `docs/decisions/0034-…`, `docs/decisions/README.md` | record and index title | extended in place with options 8–10 (done in this step) | Lead |

`docs/ARCHITECTURE.md`, `docs/setup.md`, `README.md`: none (no statement there names the header or the page links).

## Architecture check

`docs/ARCHITECTURE.md` and the guarantees of `.squad/project.md` (*Setup login*): pages stay script-free with no
external resource and the strict policy; the hash follows the constant; no route, status, header, cookie or D1/GitHub
call changes; the signed-out callback pages gain only three fixed internal links, which every login page visitor can
already request (each answers the login page without a session). No guarantee is weakened.

## Security considerations

- [ ] No limits: the change parses no input.
- [ ] None: no exception path is added; the navigation is fixed text through `escapeHtml`.

## Decision records

- `docs/decisions/0034-setup-page-layout-checked-on-the-style.md` (Accepted, unreleased, extended in place: the step
  navigation, options 8–10, one consequence; index title updated).

## Out of scope / follow-ups

As in [spec.md](spec.md), *Out of scope*. No follow-up issue.

## Security notes

Non-blocking note of Security (plan review), appended verbatim:

**Non-blocking (one note for the Tester):** the AC6 and AC9 tests that check the login and *not configured* pages have no step navigation should assert that no `class="steps"` and no `aria-current` appear anywhere in the response body, not only in the header. That way a later change to `layout()` cannot quietly put the navigation onto the pages a signed-out visitor sees.

## Challenge notes

Minor objections of the Devil's Advocate (plan challenge), appended verbatim:

1. **minor**: Update the JSDoc above `renderLoginPage` in /home/user/Seluna/src/setup/pages.ts:125, which says "Each page links to exactly `/setup?lang=en` and `/setup?lang=de`". After this change it is untrue for every page with the step navigation. Reword it in G3 to match the extended *Language* sentence, or move it to `layout()`. The plan's *Affected projects* row for pages.ts does not list this comment, and it would survive the area-document sweep because that sweep covers only `docs/`. Why minor: it is a stale comment the Dev can fix with no plan change.
2. **minor**: Add /home/user/Seluna/src/setup/texts.test.ts:253 (`startPageLink: "Open the start page"`) to the plan's *Expected failures after the skeleton (G1)*. G1 changes that value to "Start page", so this assertion fails too until the Tester updates it in G2. The plan currently lists only the reset-needed snapshot entries. Why minor: the Tester already changes that line in G2, so only the list of expected failures is incomplete.
