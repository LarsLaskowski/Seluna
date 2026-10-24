# Spec: Navigation between the setup pages

Source: Issue #66
Status: Approved by Lead

## Problem

The owner sets up an instance on the pages under `/setup`. Once they leave the start page for a step, there is no
recognisable way back: none of the Telegram step's views links to `/setup` (`renderTelegramPage` in
`src/setup/pages.ts`), the GitHub App step links there only in its _reset needed_ view, and the review, finish and
created pages not at all. The only links that lead to `/setup` from a step are the language links in the header
(`/setup?lang=en`, `/setup?lang=de`, `layout()` in `src/setup/pages.ts`), which read as a language switch, not as a
way back. No page shows where in the setup the owner is. The owner falls back on the browser's back button, which
on pages answered to a form (the code page, the review page) offers to send the form again.

Claims of the issue checked against the code at `0bdf3a7`, each one confirmed: no Telegram view links to `/setup`;
the language links are the only links to `/setup?…` on a step page; the GitHub step links to `/setup` only in
`reset-needed` (`pages.ts`, `renderGitHubPage`, case `reset-needed`); `docs/areas/setup-wizard.md` (_Language_)
says every page links to exactly `/setup?lang=en` and `/setup?lang=de`; decision 0019 excludes `src/setup/texts.ts`
from duplication detection (`sonar-project.properties`).

## Scenarios

Names in English; the German page shows the German labels (S5). "The step navigation" is the new navigation in the
header bar; its items are always, in this order: _Start page_, _Telegram chat_, _GitHub App_.

- S1: Given the owner is signed in and on the Telegram step page (any of its views: the chat list, no chats, a
  problem, the _chat id secret_ view, the notice-only page or the code page), when they look at the header bar, then
  they see the step navigation with _Telegram chat_ marked as the current page (not a link), and _Start page_ and
  _GitHub App_ as links; selecting _Start page_ opens `/setup`, the start page.
- S2: Given the owner is signed in and on the GitHub App step page (any of its views: the form, _Worker secrets_,
  _partial Worker secrets_, _reset needed_, the notice-only page or the created page), when they look at the header
  bar, then _GitHub App_ is marked as the current page (not a link), and _Start page_ and _Telegram chat_ are links.
- S3: Given the owner is on the GitHub review page (after _Next_) or the GitHub finish page (back from GitHub), when
  they look at the header bar, then _GitHub App_ is marked as the current page and _Start page_ and _Telegram chat_
  are links; on the review page they can go back to the start page without sending the manifest to GitHub.
- S4: Given the owner is on the start page (the status page, with or without the reset section, or the notice-only
  start page, also when the start page is answered on `/setup/logout`, `/setup/settings` or `/setup/reset`: _form
  expired_ (403), _settings invalid_ (400), _reset not needed_ (409) or _unavailable_ (503); a successful sign-out,
  save or reset answers a 303 redirect, not a page), when they look at the header bar, then _Start page_ is marked as the current
  page (not a link) and _Telegram chat_ and _GitHub App_ are links to `/setup/telegram` and `/setup/github`; the
  step links card in the main column stays as it is.
- S5: Given a page in German, when the owner looks at the step navigation, then its items read _Startseite_,
  _Telegram-Chat_ and _GitHub-App_, and a screen reader names it _Einrichtungsschritte_; in English _Start page_,
  _Telegram chat_, _GitHub App_ and _Setup steps_.
- S6: Given the GitHub step's _reset needed_ view, which tells the owner to reset the saved credentials on the start
  page, when the owner wants to go there, then they use _Start page_ in the step navigation: the card shows the _reset
  needed_ notice without its own "Open the start page" link, so the page has one link to the start page.
- S7: Given a visitor who is not signed in, or an instance without a usable `SELUNA_SECRET`, when the login page or
  the _not configured_ page is shown (on any path under `/setup`), then its header bar holds the page title and the
  two language links only, as today: no step navigation.
- S8: Given the owner uses a screen reader on a page with the step navigation, when they list the page's landmarks,
  then they find two navigations, each with its own name: the step navigation _Setup steps_ and the language links
  _Language_ (_Einrichtungsschritte_ and _Sprache_ in German, the language name being the existing `languageLabel`
  text), and the current item is announced as the current page.

## Errors and edge cases

- E1: Signed out on a page with the step navigation. GitHub's return `GET /setup/github/callback` is answered
  signed out with the finish page or the GitHub notice-only page (_invalid return_), and a session can expire while
  any step page is open. The page shows the step navigation like every other GitHub view; it contains only the three
  fixed paths, nothing from the request or the instance. Following _Start page_ or _Telegram chat_ without a valid
  session answers the login page (status 200), as every path under `/setup` does without a session; after signing in
  the owner lands on `/setup`.
- E2: Leaving the finish page through the step navigation before selecting _Finish_. Nothing is saved. The return
  stays valid until one hour after _Next_ on the GitHub step, and only in the same session: a `GET` of the return
  address (the browser's back button, or the address again) shows the finish page again, but _Finish_ after the hour,
  after signing out or in another sign-in answers _state invalid_ (403). No warning is shown.
- E3: Leaving the Telegram code page through the step navigation before entering the code. No chat is saved; the
  owner searches again and sends a new test message to save one. No warning is shown.
- E4: A page answered on another path than its own (the code page with _wrong code_ on `/setup/telegram/verify`, the
  start page answered on `/setup/logout`, `/setup/settings` or `/setup/reset` with _form expired_, _settings
  invalid_, _reset not needed_ or _unavailable_, the GitHub notice-only page on
  `/setup/github/callback`). The current item is the one of the page shown, not of the URL path: _Telegram chat_ for
  every Telegram view, _GitHub App_ for every GitHub view, the review, finish and created pages, _Start page_ for the
  start page.
- E5: The answers without a body under `/setup` (404, 413, the 400 of an unreadable body) and the 303 redirects. No
  page, so no navigation; unchanged.
- E6: A 360 px viewport and the longer German labels. The header bar wraps its parts onto further lines; nothing needs
  sideways scrolling; zoom and a large default font scale the labels.
- E7: Views that show only a notice and no form (_chat id secret_, _Worker secrets_, _partial Worker secrets_, the
  notice-only pages). They show the step navigation like every other view of their page.
- E8: Hostile input. The navigation's links and labels are fixed per language; no request value (path, query, header,
  cookie, form field) and no stored value reaches the navigation, so an account name, a chat name, a `code` or a
  `state` cannot add a link or markup there.
- E9: The language links on a step page still lead to `/setup?lang=…`, so switching the language on a step page
  still opens the start page.

## Non-functional requirements

- Security: the pages keep having no script and no external resource. The step navigation adds only the internal
  addresses `/setup`, `/setup/telegram` and `/setup/github`, without a query; no page gains an external address in
  `src`, `href` or `action`, and the `Content-Security-Policy` keeps its form (its style hash follows the style
  constant). A signed-out page that shows the navigation (E1) reveals nothing beyond the three fixed paths, which every
  visitor of the login page can already reach. The signed-out pages keep calling neither D1 nor GitHub.
- Style: the style keeps every rule of decision 0034 (_Pages and response headers_ in `docs/areas/setup-wizard.md`):
  one constant, colours only through the custom properties of each mode, no width above 20rem, sizes in `rem`, `em`
  or `%`, printable ASCII, at most 8,192 bytes. The current item has a contrast of at least 4.5:1 on the header
  background in both colour modes, and the navigation's links get the focus outline under `:focus-visible`.
- Accessibility: the step navigation is a navigation landmark with its own accessible name, different from the
  language links; the current item carries `aria-current="page"`; the visual marking of the current item does not rely
  on colour alone.
- Texts: every new text exists in English and German, in the same key order in both tables of `src/setup/texts.ts`.
- Compatibility: no stored data, cookie, route, status code or response header changes; existing bookmarks and links
  keep working.
- Configuration: none. Logs: none added; the per-request log entry is unchanged.
- Time: no request to D1, GitHub or Telegram is added; rendering adds only fixed markup.

## Acceptance criteria

- [ ] AC1: Every Telegram page view (`chat-id-secret`, `notice-only`, `code`, `problem`, `chats`, with and without a
  notice and a saved chat) and every GitHub page view (`worker-secrets`, `partial-worker-secrets`, `reset-needed`,
  `notice-only`, `created` with and without a slug, `form` with and without a saved app and a notice), the review page
  for both account types and the finish page with and without a notice contain, in both languages, exactly one link
  whose `href` is `/setup`; it is the step navigation's _Start page_ item, labelled "Start page" in English and
  "Startseite" in German (S1, S2, S3, S5, S6, E7).
- [ ] AC2: On every Telegram page view the step navigation marks _Telegram chat_ as the current page and links _GitHub
  App_ to `/setup/github`; on every GitHub page view, the review page and the finish page it marks _GitHub App_ as the
  current page and links _Telegram chat_ to `/setup/telegram`; the item labels are the page headings of the two steps
  in the page's language ("Telegram chat"/"Telegram-Chat", "GitHub App"/"GitHub-App") (S1, S2, S3, S5, E4).
- [ ] AC3: Every view of the start page (status with and without the reset section, with and without a notice,
  notice-only) shows the step navigation with _Start page_ as the current page and links _Telegram chat_ to
  `/setup/telegram` and _GitHub App_ to `/setup/github`, and contains no link whose `href` is exactly `/setup`; its
  main column, the step links card included, is unchanged (S4, E4).
- [ ] AC4: On every page with the step navigation exactly one element carries `aria-current="page"`; it is the
  current item, it sits in the step navigation and it is not a link; the navigation lists its three items in the
  order _Start page_, _Telegram chat_, _GitHub App_ (S1, S2, S3, S4, S8).
- [ ] AC5: The step navigation is a navigation landmark named "Setup steps" in English and "Einrichtungsschritte" in
  German, separate from the language navigation; the language navigation, on every page, is named by the existing
  `languageLabel` text ("Language", "Sprache") and keeps its visible text and links exactly as today; the new texts
  exist in both language tables in the same key order (S5, S8).
- [ ] AC6: The login page (with and without a notice) and the _not configured_ page, in both languages, have no step
  navigation and no `aria-current` attribute, and their `href` values are exactly `/setup?lang=en` and
  `/setup?lang=de` (S7).
- [ ] AC7: The _reset needed_ view of the GitHub App step shows the _reset needed_ text as an error notice and no link
  in its card; the "Open the start page" link is gone from it (S6).
- [ ] AC8: For every page and view of the page list in `src/setup/pages.test.ts` the internal `href` values are
  exactly the page's own links, the navigation links of AC1 to AC3 and the two language links, and the external
  addresses in `src`, `href` and `action` are exactly those of today; no navigation `href` has a query or a fragment
  (E8, non-functional requirements: security).
- [ ] AC9: `GET /setup/github/callback` without a session answers the finish page (valid return) and the GitHub
  notice-only page (_invalid return_) with the step navigation and _GitHub App_ as the current page, and a `GET` of
  `/setup` and `/setup/telegram` without a session answers the login page with status 200 and no step navigation (E1).
- [ ] AC10: In the style the current item is shown in bold, in the text colour and without underline, so it differs
  from the links in more than colour; its text colour reaches at least 4.5:1 on the header background in both colour
  modes; the navigation links get the focus outline; and every style rule of decision 0034 still holds (E6,
  non-functional requirements: style, accessibility).
- [ ] AC11: Apart from the step navigation and AC7, the text and the form controls of every page and view stay those
  of the snapshots taken before the change: with the step navigation left out of the compared text, the only snapshot
  entries this change updates are the body texts of the _reset needed_ view in both languages, which lose "Open the
  start page" (E5, E9, non-functional requirements: compatibility).
- [ ] AC12: `docs/areas/setup-wizard.md` describes the step navigation (which pages show it, its items, its order, the
  current item and its marking, the pages without it), extends the _Language_ sentence on the links of every page
  instead of contradicting it, drops the start page link from the _reset needed_ view and its _Texts_ entry, and lists
  the new texts under _Texts_ (S1 to S8).

## Out of scope

- Styling beyond what the navigation needs (#65 delivered the redesign).
- A redirect from `/` to `/setup` (separate issue).
- Changing what the language links point to (E9).
- A warning or confirmation when the owner leaves a page before finishing it: E2 and E3 describe the behavior of
  today, which the navigation only makes easier to reach.
- The answers without a page (E5).
- Steps that do not exist yet (the delivery channel of a later issue joins the navigation in its own change).
- A link to the current step from its own sub-pages (review, finish, created, code page): the current item is not a
  link; the existing in-page links (_Search for chats_, _Back to the GitHub App step_) stay as they are.

## Open questions

- Is the current item a link? Answered: no. The issue's scope says every signed-in page *except the start page
  itself* shows the link to `/setup`, so the start page's own item is not a link; the same rule applies to the two
  steps. A link there would reload the page, and on a sub-page (review, finish, created, code page) it would lead to
  another view than the one marked current. `aria-current="page"` is valid on an element that is not a link.
- Which labels? Answered: _Start page_ / _Startseite_. The wording "Open the start page" of `startPageLink` is a
  call to action that does not fit a navigation item and the start page's heading is "You are signed in"; the key
  `startPageLink` itself is reused for the item with the new values (Challenge, note 2), so no key is left unused. The two
  steps reuse their page headings (`telegramHeading`, `githubHeading`), the names the start page's step links already
  use, so one page has one name everywhere. The issue writes _Telegram_; "Telegram chat" is that step's existing name.
  The navigation's accessible name _Setup steps_ / _Einrichtungsschritte_ is new, needed because a page then has two
  navigations (S8).
- Does "signed-in pages" mean pages answered with a session? Answered: no, the page kind decides. The issue lists all
  GitHub views, finish included, and the finish page and the GitHub notice-only page are also answered signed out on
  `GET /setup/github/callback` (`finishPage` and `githubNoticePage` in `src/setup/handler.ts`); the navigation holds
  only fixed paths, so showing it there reveals nothing (E1, AC9). The login and _not configured_ pages, the only
  pages a signed-out visitor sees otherwise, have none (S7).
- The _reset needed_ view already links to `/setup`; how does "exactly one link to `/setup`" hold? Answered: its card
  link "Open the start page" is removed (AC7) and the navigation's _Start page_ is the one link; the _reset needed_
  text keeps telling the owner to reset on the start page.
- Where does the navigation sit? Answered: in the header bar that `layout()` renders, beside the page title and the
  language links, so the area document's descriptions of each page's main column stay valid.
- Does the created page get a link back to the GitHub App step, which #102 removed? Answered: no; on the created page
  _GitHub App_ is the current item and not a link, so the created page still has no link to `/setup/github`.

## Area documents

- `docs/areas/setup-wizard.md`:
  - _Pages and response headers_, **Frame**: the header bar of the start page, every Telegram and GitHub App step
    view and the review, finish and created pages also holds the step navigation (its name, the three items in order,
    the current item marked with `aria-current="page"` and shown as bold text, not a link); the login and _not
    configured_ pages hold only the title and the language links. The style and colour rules gain the current item
    (contrast on the header background, not colour alone).
  - _Language_: the sentence that every page links to exactly `/setup?lang=en` and `/setup?lang=de` is extended by
    the navigation's links on the pages that show it.
  - _GitHub App_, _The step page_: the _reset needed_ view without its link to the start page.
  - _Texts_: the labels "Setup steps", "Start page" (and the reuse of "Telegram chat" and "GitHub App" as items, and
    of "Language" as the language navigation's name); the _reset needed_ entry without "followed by the link Open the
    start page".

## Challenge

The four minor objections of the Devil's Advocate's spec challenge, verbatim, each with the Lead's answer (folded in
from the former *Challenge notes*).

1. **minor** – S8 asks for two navigations with different names, but the language `<nav>` has no accessible name today (`pages.ts:120`: `<nav>${languageLabel}: <a …>English</a> | <a …>Deutsch</a></nav>`, no `aria-label`/`aria-labelledby`). AC5 only names the new one and says the language links stay "exactly as today". The Lead should decide in the plan whether the language nav also gets a name (for example `aria-label` with the existing `languageLabel` text, which needs no new text) or stays unnamed. Then reword S8 to match: either "two navigations, each with its own name" or "the step navigation named Setup steps beside the unnamed language navigation".
   - **Answer: accepted.** The language navigation gets `aria-label` with the existing `languageLabel` text
     ("Language", "Sprache"; no new text), so the two landmarks are told apart by name. S8 now reads "two
     navigations, each with its own name", and AC5 names both and says the language navigation's visible text and
     links stay as today.
2. **minor** – AC7 removes the only use of `startPageLink` (`pages.ts:543`), which would leave the key unused in both tables (`src/setup/texts.ts:111`, 225, 397). It is still asserted in `src/setup/texts.test.ts:222`/253, and the issue says "reuse `startPageLink` where it fits". The plan should say what happens to it: delete it from the type, both tables and `texts.test.ts`, or rename/reuse it for the new _Start page_ item with the new values "Start page"/"Startseite". Either way, no unused key may remain.
   - **Answer: accepted, reuse.** `startPageLink` becomes the label of the _Start page_ item, with the values "Start
     page" and "Startseite"; it moves next to the new key of the navigation's name in the type and both tables, and
     `texts.test.ts` asserts the new value. The issue asks to reuse the key where it fits; its name still describes
     the label of the link to the start page. The open question on labels says so.
3. **minor** – S4 and E4 call the start page "the answer of _Sign out_ … on `/setup/logout`". But a successful sign-out answers 303 to `/setup` (`handler.ts:253`). The start page comes back on `/setup/logout` only on an expired form (403 _form expired_, `handler.ts:250-251`). Likewise `/setup/settings` answers a page only on 400/503 (`handler.ts:580`, 586; success is 303 at 588), and `/setup/reset` only on 409/503 (`handler.ts:601`, 607; success is 303 to `/setup/github` at 605). Reword S4/E4 to "the start page answered on `/setup/logout`, `/setup/settings` or `/setup/reset` (form expired, settings invalid, reset not needed, unavailable)", so the Tester renders those cases and does not look for a page after a redirect.
   - **Answer: accepted.** Confirmed in `src/setup/handler.ts` (`signOut`, `saveSettings`, `resetSaved`: success is
     a 303). S4 and E4 now name the four answers that render the start page on those paths (_form expired_ 403,
     _settings invalid_ 400, _reset not needed_ 409, _unavailable_ 503) and say that a success redirects.
4. **minor** – E2 says "The return stays valid for one hour". The state's hour runs from the _Next_ request on the GitHub step, not from leaving the finish page. Its MAC is also bound to the session token (`docs/areas/setup-wizard.md:341-349`; `src/setup/github-state.ts:4`, 24, 63), so after signing out or after a new sign-in, _Finish_ answers _state invalid_ (403). Reword E2 to "the return stays valid until one hour after _Next_ and only in the same session; GET on the return address shows the finish page again, but _Finish_ after that answers _state invalid_". Then neither the Tester nor the documentation promises more than the code keeps.
   - **Answer: accepted.** E2 now says the return stays valid until one hour after _Next_ and only in the same
     session, that a `GET` of the return address shows the finish page again, and that _Finish_ after the hour, after
     signing out or in another sign-in answers _state invalid_ (403), as `docs/areas/setup-wizard.md` (_State_)
     describes.
