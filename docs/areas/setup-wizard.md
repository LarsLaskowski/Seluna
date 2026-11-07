# Setup wizard

## Scope

The pages under `/setup` through which the owner sets up an instance: which request reaches which page, how form
bodies and cookies are read, what every page and response looks like, and in which language. The owner relies on it
to keep everyone else out and to get pages that load nothing from anywhere else. The login, the status page and the
two setup steps build on it, each in its own area document ([Not here](#not-here)).

## Behavior

### Paths

- The wizard owns `/setup` and every path that starts with `/setup/`. Other paths are not part of it, also
  `/setupx`, `/SETUP` or `/setup%2F` ([HTTP routes](http-routes.md)). The path is matched after the URL is parsed,
  so dot segments are already resolved: `/setup/../health` is `/health`. The root `/` is not part of the wizard
  either; `GET /` and `HEAD /` redirect to `/setup` ([HTTP routes](http-routes.md)).
- Every request under `/setup` is decided in this order:
  1. **No usable `SELUNA_SECRET`** (absent, not a string, or shorter than 32 characters as counted in
     [Storage](storage.md#encryption)): **503** with the _not configured_ page, for every method and path. No body
     is read and no cookie other than the language cookie is set.
  2. **`POST /setup/login`**: the login ([Setup login](setup-login.md#login)), with or without a session.
  3. **`GET /setup/github/callback`**: GitHub's return
     ([GitHub App step](github-app-step.md#githubs-return-and-finishing)), with or without a session.
  4. **No valid session** ([Setup login](setup-login.md#session)): **200** with the login page, for every other
     method and path (a `POST /setup/github/callback` without a session included).
  5. **With a valid session**:
     - `GET /setup` is the start page, the status page, and `POST /setup/settings`, `POST /setup/reset`,
       `POST /setup/channel/activate` and `POST /setup/channel/remove` are its forms ([Status page](status-page.md));
     - `POST /setup/logout` signs out ([Setup login](setup-login.md#sign-out));
     - `GET` and `POST /setup/telegram`, `POST /setup/telegram/verify`, `POST /setup/telegram/token` and
       `POST /setup/telegram/token/remove` are the Telegram step ([Telegram step](telegram-step.md));
     - `GET` and `POST /setup/github` and `POST /setup/github/callback` are the GitHub App step
       ([GitHub App step](github-app-step.md));
     - every other method and path answers **404** with an empty body, `GET /setup/settings` and
       `GET /setup/reset` included.

### Forms

- Every form of the wizard posts its fields as the request body, and reading the body is the first step of every
  form: it is read with the 1 MiB limit of [HTTP routes](http-routes.md#request-body-size), counted in bytes before
  decoding, and answers **413** above it and **400** when it cannot be read, both with an empty body.
- The body is parsed as `application/x-www-form-urlencoded`, whatever the `Content-Type` says: `+` is a space, `%XX`
  is decoded as UTF-8, a broken escape stays as it is, and names are decoded like values. The parsed text is never
  longer than the number of bytes read.
- Every form except the two of the manifest flow carries a CSRF token, checked right after the body is read
  ([Setup login](setup-login.md#csrf-protection)).

### Cookies

- Every cookie the wizard sets has `Path=/setup; HttpOnly; Secure; SameSite=Strict`, so the browser sends it to
  `/setup` and the paths below it only and never with a request started by another site.
- Cookie values are read as they appear in the `Cookie` header (pairs split at `;`, name and value trimmed of
  spaces, the value neither unquoted nor decoded); a value that does not have the expected form is ignored. At most
  the first four values of a cookie name are looked at.
- The wizard's cookies are the session cookie `seluna_session` and the CSRF cookie `seluna_csrf`
  ([Setup login](setup-login.md)) and the language cookie `seluna_lang` ([Language](#language)).

### Pages and response headers

- Pages are complete HTML documents rendered on the server, UTF-8, without a framework, without any script,
  without any external resource (no script, font, style or image is loaded from anywhere), and with one inline
  `<style>` element.
- **Frame:** the body of every page starts with a header bar (`<header>`) that holds the page title as text, not as a
  heading, then the step navigation on the pages that have it, then the language navigation (a `<nav>` named
  _Language_ through `aria-label`, with a visible label and the two language links, [Language](#language)); below it
  one centred main column (`<main>`, limited by a maximum width only) holds the page's only `<h1>` and the rest of
  the page. The descriptions of a page or view in the area documents (what it shows, shows only, or in which order)
  list the content of the main column.
- **Step navigation:** a `<nav class="steps">` named _Setup steps_ through `aria-label`, separate from the language
  navigation. It lists three items in this order, separated by " | ": _Start page_ (`/setup`), _Telegram chat_
  (`/setup/telegram`) and _GitHub App_ (`/setup/github`), in the page's language. The current item is plain text in a
  `<span aria-current="page">`, not a link, and is the only element of the page with `aria-current`; the other two
  are links to exactly those addresses, without query or fragment. The current item is fixed by the page that is
  rendered, not by the request path or the session: _Start page_ on every view of the start page, _Telegram chat_ on
  every view of the Telegram step page, and _GitHub App_ on every view of the GitHub App step page (the created page
  included) and on the review and finish pages — the finish page and the notice-only page of _invalid return_ carry
  it also when answered without a session. The login page and the _not configured_ page have no step navigation and
  no `aria-current` attribute, so they link to nothing but the two language links.
- **Cards:** the parts of a page sit in cards (a bordered box whose background differs from the page's, cards
  separated by at least 0.75rem). The login page has its heading, intro and notice above one card with the form; the
  _not configured_ page its heading above one card with the paragraphs; the start page and the Telegram step page
  have the cards their area documents list ([Status page](status-page.md),
  [Telegram step](telegram-step.md#the-step-page)); every other page and view has its heading above one card with
  everything else, in the order its area document gives. A part that is not shown leaves no empty card or notice
  behind.
- **Buttons:** the sign-out button, the remove button of the Telegram step's token card and the remove button of the
  Messengers card are secondary buttons, the reset button is a danger button, and every other submit button is a
  primary button. Buttons are at least 2.75rem high.
- **Notices:** every notice is shown as an error notice with `role="alert"`, except these info notices, which carry
  no role: _chat id secret_ and _worker secret token_ (Telegram step), _Telegram active, not set up_ (Telegram step),
  _Active, but not set up_ (Messengers card), _Worker secrets_ (GitHub App step) and _app saved_ (created page). The
  _partial Worker secrets_ and _reset needed_ texts of the GitHub App step are error notices.
- **Colours:** the pages follow the system setting: light colours by default, dark colours under
  `@media (prefers-color-scheme: dark)`, and `color-scheme: light dark`, so the browser's own controls (selects,
  time fields, checkboxes, radio buttons) follow too; a browser without the media query shows the light colours.
  Each mode declares its colours once, as `#rrggbb` custom properties on `:root` (the dark set inside the media
  query), and every rule uses them through `var(...)`. In each mode the WCAG 2.1 contrast ratio is at least 4.5:1
  for text on the page and card backgrounds, links on both, the current item of the step navigation (text colour) on
  the header background, the text of each button kind and of each notice kind on its background, and at least 3:1
  for the card border on the page, the control border on the card and the page, the primary and danger button
  backgrounds and the notice borders on the card (the notice borders on the page too), and the focus ring on both.
  The current item of the step navigation is bold, in the text colour and without underline, so it differs from the
  links in more than colour.
- **Focus and borders:** links, buttons, inputs (checkboxes and radio buttons included) and selects get a 3px
  outline in the focus colour under `:focus-visible`; no rule removes the outline under plain `:focus`, so a browser
  without `:focus-visible` keeps its default. Cards, buttons, inputs, selects and notices have a border, so they stay
  distinguishable in forced-colours mode.
- **Width:** a 360 px viewport needs no sideways scrolling: the body wraps long words (`overflow-wrap: anywhere`),
  inputs, selects and buttons are `box-sizing: border-box` with `max-width: 100%`, and the style has no
  `white-space: nowrap` or `pre`, no width above 20rem, no fixed height, and font sizes only in `rem`, `em` or `%`, so
  zoom and a large default font scale the page. The `viewport` meta element is `width=device-width, initial-scale=1`.
  Nothing is animated.
- **Style limits:** the content of the `<style>` element is one constant, the same on every page and response; no
  page has another `<style>` element, a `style=` attribute, a `<link>`, `<img>`, `<iframe>` or `xlink:href`, and the
  only external addresses in `src`, `href` and `action` are the status page's app link and its app settings and
  installation review links (`https://github.com/settings/...` and `https://github.com/organizations/...`, built only
  from allow-listed parts, [Status page](status-page.md#the-app-on-github)), the created page's install link and the
  review page's form action ([GitHub App step](github-app-step.md)); the internal addresses of the step navigation
  are fixed (`/setup`, `/setup/telegram`, `/setup/github`). The style loads nothing: no `url(`, no at-rule but
  `@media`, no CSS escape (`\`), none of the functions `image-set(`, `-webkit-image-set(`, `image(`, `src(`,
  `cross-fade(` and `element(`; it names only system and generic font families, is printable ASCII without `<` (so
  the bytes the browser hashes are the bytes the policy names) and is at most 8,192 bytes as UTF-8.
- Every text placed in a page is HTML-escaped (`&`, `<`, `>`, `"`, `'`). No page echoes anything from the request
  (not the secret, not a token other than the page's own CSRF token, not a header, not the path) except the GitHub
  finish page, which echoes the `code` and `state` of the return in hidden fields after their allow-lists, escaped,
  and the review page, which shows the account as entered, after its allow-list, escaped
  ([GitHub App step](github-app-step.md)).
- Every response under `/setup` (pages, redirects, 404, 413, 400) carries:

  | Header                    | Value                                                                                                        |
  | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `Content-Security-Policy` | `default-src 'none'; style-src 'sha256-<hash>'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` |
  | `X-Content-Type-Options`  | `nosniff`                                                                                                    |
  | `X-Frame-Options`         | `DENY`                                                                                                       |
  | `Referrer-Policy`         | `no-referrer`                                                                                                |
  | `Cache-Control`           | `no-store`                                                                                                   |

  `<hash>` is the base64 (with padding) SHA-256 of the UTF-8 bytes of the content of the page's `<style>` element.
  The GitHub review page alone has `form-action https://github.com` instead of `form-action 'self'`, so that its form
  can post the manifest ([GitHub App step](github-app-step.md#starting-the-flow)). A page also carries
  `Content-Type: text/html; charset=utf-8` and `Content-Language` with its language.

### Language

- The interface is in English (`en`) and German (`de`); every text exists in both ([Texts](#texts)).
- The language of a response is, in this order: the query parameter `lang` when it is exactly `en` or `de`; else
  the first of the first four `seluna_lang` cookie values that is exactly `en` or `de`; else the `Accept-Language`
  header; else English.
- A valid `lang` parameter also sets the cookie `seluna_lang` to it, with `Max-Age=31536000` (one year).
- Every page links to exactly `/setup?lang=en` and `/setup?lang=de`, whatever path it is answered on (a page
  answered on `/setup/logout` or `/setup/login` links to `/setup` too), and its `<html lang>` is its language. A page
  with the step navigation ([Pages and response headers](#pages-and-response-headers)) also links to its items other
  than the current one.
- `Accept-Language` is read as RFC 9110 defines it: a comma-separated list of language ranges, each with an
  optional weight `;q=<0 to 1, at most three decimals>`. A range counts for German when its first subtag is `de`
  and for English when it is `en`, in any case (`de`, `de-DE`, `DE-at`). The language with the highest weight
  wins; on equal weights the one listed first. A weight of 0 excludes the range; `*`, other languages and entries
  that do not fit the grammar are skipped. Examples: `de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7` → German,
  `en-US,en;q=0.9` → English, `fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7` → German, `de;q=0,en;q=0.1` → English,
  `fr` → English.

### Texts

- The wording of every page title, heading, label, button and notice is kept in one table per language, English and
  German, with the same keys: a table that lacks a text of the other does not type-check (implemented in
  `src/setup/texts.ts`; the message texts of the notifications are in `src/i18n/`). The German texts translate the
  English ones. The area documents name a notice or text by its key in italics (_form expired_) and do not repeat
  its wording.
- A notice is a fixed text. It never carries a reason from the runtime, D1, Telegram or GitHub, a secret, a token
  or a submitted value; the only values a page shows are those its area document names (an App ID, a chat id, an
  account name or login, a version, a time).
- A notice that the owner can act on says what to do: where a value comes from and where it is changed (a Worker
  secret in the Cloudflare dashboard, a bot token from @BotFather), or which step to open. The content each page
  must convey is stated in its area document.
- The _not configured_ page says that the setup cannot start because the Worker secret `SELUNA_SECRET` is missing or
  shorter than 32 characters, without saying which of the two; it explains how to create a random string of at
  least 32 characters (a password manager, or `openssl rand -hex 32`) and how to set it (in the Cloudflare dashboard
  under the Worker's _Settings_ → _Variables and Secrets_, or with `npx wrangler secret put SELUNA_SECRET`), then
  to reload the page.
- The _unavailable_ notice says only that the setup is unavailable and to try again; it never says why.

## Limits and errors

- 404, 413 and the 400 of an unreadable body under `/setup` carry no body; every other error answer of the wizard
  (503, 403, 409, 429, 400, 502) carries a page with a fixed notice or text and never a reason from the runtime, D1,
  Telegram or GitHub.
- At most four values per cookie name are looked at; the `Accept-Language` and `Cookie` headers are otherwise
  limited only by the platform's header size, and reading them takes time proportional to their length, also for
  adversarial input such as long runs of spaces, `;` or `,`.
- A host under the same registrable domain that plants cookies can still make a page look signed out or a form fail
  (at most four values per cookie name are read, and the browser sends a cookie with a longer path first), but it
  cannot make a form succeed ([Setup login](setup-login.md#csrf-protection)).
- Nothing in this area is logged beyond the per-request entry of [HTTP routes](http-routes.md#logging) (method,
  path, status).

## Related decisions

- [`decisions/0015-setup-login.md`](../decisions/0015-setup-login.md) — pages without script and with a hashed inline
  style under a strict Content-Security-Policy, the language cookie.
- [`decisions/0034-setup-page-layout-checked-on-the-style.md`](../decisions/0034-setup-page-layout-checked-on-the-style.md)
  — the page layout and its colours as custom properties per mode, verified on the style and the rendered markup
  instead of in a browser.
- [`decisions/0007-github-app-credentials-encrypted-in-d1.md`](../decisions/0007-github-app-credentials-encrypted-in-d1.md)
  — the 32-character minimum of `SELUNA_SECRET` and separate keys per purpose.

## Not here

- The routes outside `/setup`, the body size limit and the request log: [HTTP routes](http-routes.md).
- The `meta` table and the encryption key: [Storage](storage.md).
- How `SELUNA_SECRET` is set at deploy time: [Deployment](deployment.md#worker-secrets).
- <a id="login"></a><a id="failed-attempts-and-the-lock"></a><a id="session"></a><a id="sign-out"></a><a id="csrf-protection"></a>The
  login, its lock, the session, sign-out and the CSRF protection of every form: [Setup login](setup-login.md).
- <a id="status-and-settings"></a><a id="messengers"></a><a id="reset"></a>The start page: the status, the app on
  GitHub, the settings, the Messengers card and the reset: [Status page](status-page.md).
- <a id="telegram-chat"></a><a id="the-bot-token"></a><a id="the-step-page"></a><a id="confirming-a-chat"></a><a id="chat-proof"></a>The
  Telegram step: the bot token, the chat search, the test message and the chat proof:
  [Telegram step](telegram-step.md).
- <a id="github-app"></a><a id="the-step-page-1"></a><a id="starting-the-flow"></a><a id="githubs-return-and-finishing"></a>The
  GitHub App step: the manifest flow, its state, the conversion and the stored credentials:
  [GitHub App step](github-app-step.md).
