# GitHub App step

## Scope

The setup step under `/setup/github` that creates the owner's private GitHub App through GitHub's manifest flow and
stores its App ID, private key and webhook secret encrypted ([Storage](storage.md)): the step page, the manifest and
the signed state, GitHub's return, the conversion and the owner check. The owner relies on it to create an app with
read-only permissions that belongs to the account they chose; webhook processing and the GitHub API calls rely on the
credentials it stores.

## Behavior

- **Worker secrets:** the Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` stay a
  manual alternative and take precedence ([Deployment](deployment.md#worker-secrets)). Each that is a non-empty string
  counts as set. All three set: the step's main column shows the heading and one card with the _Worker secrets_ text
  as an info notice, and no form. One or two set: the same with the _partial Worker secrets_ text as an error notice.
  While any of the three is set, both POSTs answer **409** with the same view and call neither GitHub nor D1. No page
  shows a value. The two texts name the three secrets and say how to set all three or delete them.
- **Account name:** the account or organization name is checked against
  `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$` (1 to 39 letters, digits and inner hyphens) before it enters a URL
  or the app name, and is never encoded or trimmed. The account type is exactly `personal` or `organization`.
- **Manifest code:** the `code` of GitHub's return must match `^[A-Za-z0-9_-]{1,100}$` before it enters the URL of
  the conversion. The app's slug must match `^[a-z0-9-]{1,100}$` before it enters the install link.
- **Pages:** the step page, the review, finish and created pages and the notice-only page each have their heading
  above one card with everything else ([Setup wizard](setup-wizard.md#pages-and-response-headers)). The notice-only
  page (the step's answers with _unavailable_, _form expired_, _invalid return_, _state invalid_, _code rejected_,
  _answer invalid_, _owner mismatch_ or _store failed_) ends with a link back to the step; the created page has no
  link back.

### The step page

- `GET /setup/github` (signed in) answers **200** with one of: the _Worker secrets_ view, the _partial Worker
  secrets_ view, the _reset needed_ view (the stored `github_app_id` cannot be read with the current `SELUNA_SECRET`,
  or the key check value is damaged; the heading and one card with the _reset needed_ text as an error notice and
  nothing else, no form; the start page is reached through the step navigation), or the form.
- The form view shows the heading and one card with the _intro_, a notice when one is given, the saved App ID (or
  _no saved app_ and, with an app, the _replace hint_) and the form: two radio inputs `account_type` (`personal`,
  `organization`), a text input `account`, the session-bound CSRF field and a primary button. A stored value that is
  not an App ID is shown as _no saved app_. The _intro_ says that Seluna sends GitHub a manifest with the app's name,
  the webhook address and read-only permissions and saves the credentials encrypted once the owner confirmed on
  GitHub; the _replace hint_ says that a new app replaces the saved one and the old app is deleted on GitHub by hand.
- The view reads D1 only when none of the Worker secrets is set; a D1 failure answers **503** with the notice-only
  page and _unavailable_.

### Starting the flow

- `POST /setup/github` in this order: the body is read ([Setup wizard](setup-wizard.md#forms)); the CSRF token
  (signed-in form, [Setup login](setup-login.md#csrf-protection)) must be valid, else **403**, the notice-only page and
  _form expired_; any Worker secret set, **409**; exactly one `account_type` that parses and exactly one `account`
  that is an account name, else **400** with the form page and _invalid account_ (which states the name rule); the
  key check changed or corrupt, **409** with the _reset needed_ view; a D1 failure, **503** with _unavailable_.
- Success answers **200** with the **review page**: the heading, then one card with the review intro, the account
  and its type, the app name, the permissions (all read-only), the events, and one form `method="post"` whose
  `action` is `https://github.com/settings/apps/new?state=<state>` for a personal account or
  `https://github.com/organizations/<account>/settings/apps/new?state=<state>` for an organization, with the hidden
  field `manifest` as its only field (no `csrf` field: the form posts to another site). The review intro says that
  Seluna saves the app only if GitHub created it for the account shown. This is the only page whose
  `Content-Security-Policy` has `form-action https://github.com` in place of `form-action 'self'`.
- **Manifest** (the JSON of the field `manifest`, keys in this order): `name` `seluna-<account>` cut to its first 34
  characters; `url` `https://github.com/LarsLaskowski/Seluna`; `hook_attributes`
  `{"url":"<origin>/webhook","active":true}`; `redirect_url` `<origin>/setup/github/callback`; `public` `false`;
  `default_permissions` read-only `actions`, `contents`, `issues`, `pull_requests`, `vulnerability_alerts`,
  `security_events`, `secret_scanning_alerts` and `metadata`; `default_events` `pull_request`, `workflow_run`,
  `dependabot_alert`, `code_scanning_alert`, `secret_scanning_alert`, `issues`, `issue_comment`, `fork` and `star`
  ([decision 0039](../decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)). `<origin>` is the origin
  of the request. The owner can edit the app's name on GitHub's page. A new permission is a change of this manifest.
- **State:** `v1.<type>.<account>.<expires>.<nonce>.<mac>`: `<type>` is `personal` or `organization`, `<account>` the
  name as entered, `<expires>` the time of the request plus 3,600,000 ms in decimal, `<nonce>` 16 random bytes as
  base64url (22 characters), `<mac>` the HMAC-SHA256 (base64url without padding, 43 characters) of the ASCII text
  `github-state.v1.<type>.<account>.<expires>.<nonce>.<session token>`. The key is derived like the session key with
  salt and info `seluna/setup-github/v1` ([Setup login](setup-login.md#session)). The state has at most 139
  characters and consists of letters, digits, `-`, `_` and `.`. Nothing is kept in D1 or a cookie.
- A state is **valid** for a session when it has exactly that form (canonical base64url, an expiry without leading
  zero of at most 15 digits), its MAC verifies in constant time for the request's session token, and
  `now < expires ≤ now + 1 hour`. It then yields the account type and account it was issued for.

### GitHub's return and finishing

- GitHub redirects to `/setup/github/callback?code=<code>&state=<state>` without the wizard's cookies
  (`SameSite=Strict`). `GET /setup/github/callback` answers, signed in or not and after the `SELUNA_SECRET` check,
  **200** with the **finish page** when the query has exactly one `code` that passes the manifest code allow-list and
  exactly one `state` of the form above. Its main column shows the heading, then one card with the finish intro, a
  notice when one is given (_GitHub unavailable_, below) and the page's one form, which posts the hidden fields
  `code` and `state` (escaped) to `/setup/github/callback` and carries no `csrf` field. Otherwise it answers **400**
  with the notice-only page and _invalid return_. Neither answer calls GitHub or D1 or sets a cookie (a valid `lang`
  parameter still sets the language cookie); the response carries `Referrer-Policy: no-referrer`.
- The finish form is a request from the instance's own page, so the browser sends the session cookie. The valid state
  takes the place of the `csrf` field: its MAC is bound to this session, so neither a page on another site nor a host
  under the same registrable domain can submit it. The finish page sets no `seluna_csrf` cookie, which would replace
  the owner's and expire every other open form.
- `POST /setup/github/callback` without a session answers the login page and calls nothing. With one, in this order:
  1. the body is read ([Setup wizard](setup-wizard.md#forms));
  2. exactly one `state` field that is valid for the session, else **403** with the notice-only page and _state
     invalid_; GitHub is not called;
  3. any Worker secret set, **409** with that view;
  4. exactly one `code` field that passes the allow-list, else **400** and _invalid return_;
  5. the key check changed or corrupt, **409** with the _reset needed_ view; a D1 failure, **503** with
     _unavailable_; GitHub is not called in these cases;
  6. the conversion ([The conversion](#the-conversion)): _rejected_ **400** and _code rejected_; _unavailable_ **502**
     with the finish page again (same `code` and `state`) and _GitHub unavailable_; _malformed_ **502** with the
     notice-only page and _answer invalid_;
  7. the **owner check**: the answer's `owner.login` must pass the account name allow-list and equal the state's
     account ignoring ASCII letter case, and `owner.type` must be exactly `User` for `personal` or `Organization`
     for `organization`, else **403** with the notice-only page and _owner mismatch_; nothing is stored, no install
     link is shown and the key is not converted. Without it, anyone could send the owner's browser to the return path
     with a code of their own app and the owner's state;
  8. the private key is converted to PKCS#8 and must import as an RS256 signing key, else **502** with _answer
     invalid_;
  9. the three credentials are stored in one transaction ([Storage](storage.md#key-check)); a result other than
     stored, or a D1 failure, answers **503** with _store failed_;
  10. stored: **200** with the **created page**: the heading, then one card with _app saved_ as an info notice, the
      _install intro_ and a link to `https://github.com/apps/<slug>/installations/new`, or, when the answer has no
      slug that passes the allow-list, the _install manually_ text (which says where to install the app by hand) and
      no link. Both recommend installing the app on _Only select repositories_. After the three credentials were
      stored, the slug is kept in `meta` `github_app_slug` as `<appId>:<slug>` (only when the answer has an
      allow-listed slug), and the owner in `meta` `github_app_owner` as `<appId>:<ownerId>:<type>:<login>` (only
      when the answer's `owner` has a positive safe integer `id`, a `login` that is an account name and a `type` of
      exactly `User` or `Organization`, parsed apart from the owner check so that an unusable `id` never makes the
      answer _malformed_); a failure of either write is dropped and the page is still _created_.
- The notices of a return that leaves an app on GitHub unsaved (_state invalid_, _answer invalid_, _owner mismatch_,
  _store failed_) tell the owner to delete that app on GitHub and start again. _code rejected_ says the code was
  already used or is older than one hour and has the owner compare the App ID saved in the step with the one in the
  app's settings on GitHub before deleting anything. _GitHub unavailable_ says to finish again later while the return
  is valid (one hour).

### The conversion

- One `POST https://api.github.com/app-manifests/<code>/conversions` with
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: seluna/<version>`, no
  `Authorization`, no body, no redirect followed and a 10-second timeout that also covers reading the body (as for
  the [GitHub API](github-api.md#limits-and-errors) calls).
- A 2xx answer of at most 1 MiB (counted in bytes before decoding) that is UTF-8 JSON is narrowed to: `id` (a
  positive safe integer), `owner` (`login`, a string of at most 39 characters, and `type`, a string), `slug` (kept
  only when it passes the allow-list), `pem` (a string of at most 16,384 characters) and `webhook_secret` (a
  non-empty string of at most 1,024 characters). Any other 2xx body (also `webhook_secret: null`, a missing or
  enterprise `owner`) is _malformed_. **404** and **422** are _rejected_; any other status, a redirect among them,
  and a failed or aborted request are _unavailable_; the body of every non-2xx answer is cancelled unread. The client
  secret and every other field are discarded.
- **Stored values:** `github_app_id` the decimal App ID, `github_private_key` the PKCS#8 PEM
  (`-----BEGIN PRIVATE KEY-----`, lines of 64 characters), `github_webhook_secret` the webhook secret as GitHub
  generated it. The key is accepted as a PKCS#1 (`RSA PRIVATE KEY`) or PKCS#8 (`PRIVATE KEY`) PEM of at most 16,384
  characters with canonical base64 and nothing around it; nothing is ever decrypted or logged.

## Limits and errors

- An app that GitHub created but Seluna did not save (a session that expired during the detour, an unreadable answer,
  an app of another account than the one entered, a failed write, a code an earlier attempt used while its answer was
  lost) stays on GitHub and is deleted there by hand; the notices say so. GitHub's rejection of a used code does not
  tell whether an earlier attempt saved the app, hence the comparison _code rejected_ asks for. GitHub's own limit of
  one hour for the flow, and the state's, bound the return. A session that expires during the detour loses the
  return: sign in again and start over.
- Whether GitHub returns `code` and `state` as documented, whether the browser sends the session cookie with the
  finish form and whether `form-action https://github.com` lets GitHub's own redirects through were not captured from
  a real run when this step was written; each deviation fails closed (a fixed notice, nothing stored).
- GitHub's answers and errors never reach a page or a log entry; only the fixed notices above are shown.

## Related decisions

- [`decisions/0017-github-app-manifest-flow.md`](../decisions/0017-github-app-manifest-flow.md) — the manifest flow,
  the signed-out return and the finish form protected by its state, the owner check, the PKCS#8 conversion, the
  one-transaction write and the precedence of the Worker secrets.
- [`decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md`](../decisions/0039-issue-comment-fork-star-events-and-the-app-owner.md)
  — the four events and their permissions, the stored owner and the recommendation of _Only select repositories_.
- [`decisions/0007-github-app-credentials-encrypted-in-d1.md`](../decisions/0007-github-app-credentials-encrypted-in-d1.md)
  — the GitHub App credentials kept encrypted in D1.

## Not here

- The paths, form reading, cookies, page rules and languages: [Setup wizard](setup-wizard.md).
- The session and the CSRF check: [Setup login](setup-login.md).
- The app check and the installations on the start page, the reset: [Status page](status-page.md).
- The Telegram step: [Telegram step](telegram-step.md).
- The `secrets` and `meta` rows, the encryption and the key check: [Storage](storage.md).
- Calls of the GitHub API as the app: [GitHub API](github-api.md).
