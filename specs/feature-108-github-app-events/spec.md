# Spec: Subscribe the GitHub App to issues, comments, forks and stars

Source: Issue #108
Status: Draft

## Problem

Owners want to hear about other people's activity: new issues, comments, forks and stars. The app the setup wizard
creates cannot receive these events. Checked against the code: `src/github/manifest.ts` requests only `actions`,
`pull_requests`, `vulnerability_alerts`, `security_events`, `secret_scanning_alerts` and `metadata` (all `read`) and the
events `pull_request`, `workflow_run`, `dependabot_alert`, `code_scanning_alert` and `secret_scanning_alert`. Seluna
also does not know who the owner is. The conversion answer is narrowed to `owner.login` and `owner.type` only
(`src/github/conversion.ts`), not `owner.id`, and no rule reads `sender` (`docs/areas/notifications.md`, *Pull request
rules*). So the rules of #109 and #110 cannot leave out the owner's own actions or bots. Apps that already exist keep
their old permissions until the owner accepts new ones on GitHub (decision 0006), and nothing tells the owner what to
accept. Installation tokens are requested without a `permissions` object (`src/github/installation-token.ts`), so each
one carries every permission of the app, and from now on that includes `contents: read`. This issue prepares the app,
the owner record and the shared helpers. The rules themselves come in #109 and #110.

## Scenarios

- S1: Given a new instance, when the owner reaches the review page of the GitHub App step, then it lists the
  permissions read-only Actions, Contents, Issues, Pull requests, Dependabot alerts, Code scanning alerts, Secret
  scanning alerts and Metadata. It also lists the events `pull_request`, `workflow_run`, `dependabot_alert`,
  `code_scanning_alert`, `secret_scanning_alert`, `issues`, `issue_comment`, `fork` and `star`, and the manifest posted
  to GitHub holds exactly these.
- S2: Given the owner finishes the manifest flow for a personal account, when the app is saved, then Seluna also stores
  the app's owner (account id, login, type `User`), tied to the saved App ID. The status page then shows
  _GitHub App owner:_ `<login> (personal account)`.
- S3: Given the app belongs to an organization, when the status page is shown, then it says _GitHub App owner:_
  `<login> (organization)` followed by the notice "The app belongs to an organization, so Seluna cannot tell your own
  actions from anyone else's: activity of every account is reported, yours too."
- S4: Given an app created before this change, or one configured through the Worker secrets, so that no owner is
  stored for the current App ID, when the owner opens the status page, then Seluna reads the owner once from GitHub
  (`GET /app`), stores it and shows it as in S2 or S3. Later views show what is stored, and GitHub is not asked for
  the owner again.
- S5: Given an existing app that lacks permissions or events of the manifest, when the owner opens the status page,
  then under _GitHub App:_ it shows _Missing on the app:_ with each missing permission (name and level) and each missing
  event, and a link "Add them in the app's settings on GitHub" to the app's permission settings page.
- S6: Given the app has the permissions but an installation has not accepted them, when the status page lists the
  installations, then that installation's entry ends with `, missing: <permissions and events>` and a link "Review and
  accept on GitHub" to that installation's settings page.
- S7: Given the app and every listed installation have everything the manifest asks for, when the status page is
  shown, then it shows no _Missing_ line, no link to accept anything and no extra notice.
- S8: Given any delivery that needs the GitHub API (today the draft lookup of the CI failure rule), when Seluna
  requests an installation token, then the request names an explicit list of permissions. The list holds only what
  Seluna's API calls read, and never `contents`.
- S9: Given a webhook payload, when a rule asks whether it is the owner's own action, then the answer is yes only when
  the owner is a personal account and `sender.id` equals the stored owner id (a renamed login changes nothing). When a
  rule asks whether a bot sent it, the answer is yes exactly when `sender.type` is `Bot`.
- S10: Given an instance with the new app, when GitHub delivers `issues`, `issue_comment`, `fork` or `star`, then the
  delivery is accepted and recorded as today, and no message is sent until the rules of #109 and #110 exist.
- S11: Given the owner reads the setup guide, when they install the app, then the guide recommends _Only select
  repositories_ and says that a new repository has to be added to the installation by hand.

## Errors and edge cases

- E1: `GET /app` fails (refused, timed out, redirected, unreadable, a malformed answer, no usable app or key). The
  status page still answers 200. The owner line shows _owner unavailable_, the missing-permission check of the app
  shows "Seluna could not read the app's permissions from GitHub.", nothing is stored, and the next view tries again.
- E2: The owner GitHub reports for the current App ID differs from the stored one (the app was transferred, or the login
  was renamed). The stored owner is replaced with GitHub's answer, and the page shows the new one.
- E3: After a reset or a new app, the stored owner belongs to another App ID. It counts as absent: S4 applies, and it
  is never used for the new app.
- E4: `owner.type` is neither `User` nor `Organization`, `owner.id` is not a positive safe integer, or the login fails
  the account name allow-list. This happens in the conversion answer and in `GET /app` alike. Nothing is stored for
  the owner and the page shows _owner unavailable_. In the manifest flow the app itself is still saved, because the
  owner check of decision 0017 already passed on login and type.
- E5: The payload has no `sender`, a `sender` that is not an object, a missing or non-numeric `id`, or a `type` that is
  not a string. Then neither helper says yes: not the owner's action, not a bot. The owner is unknown or an
  organization: never the owner's action.
- E6: The app or an installation has a permission at `write` where the manifest asks for `read`. That counts as
  granted. A permission or event the app has beyond the manifest is not reported.
- E7: The installations list fails or the instance has more than 100 installations. The existing _installations
  unavailable_ or _more installations_ behavior applies, and only the listed installations are checked. A suspended
  installation is checked like any other.
- E8: An installation has not yet accepted `issues` or `contents`. Token requests for it still succeed, because the
  explicit list never names a permission the API calls do not need, so the draft lookup keeps working. An installation
  that lacks a listed permission (for example `pull_requests` revoked) gets the existing failure result.
- E9: A token cached in `token_cache` by a version before this change may carry every permission of the app. It is not
  used after the update.
- E10: A slug, login or installation id from GitHub that does not pass its allow-list never enters a link. The
  _Missing_ text is still shown, without the link.

## Non-functional requirements

- Security: the app stays read-only. `contents: read` is added only because GitHub requires it for the `fork` event;
  `star` needs only `metadata`. Installation tokens are narrowed so that no token Seluna holds can read code. The new
  decision record gives the reasons, and `.squad/project.md` (*Security areas*, *Minimal GitHub App permissions*) lists
  the new permissions and the narrowed tokens.
- The owner's account id, login and type are public and are stored as plain text in D1, tied to the App ID like the
  `meta` slug row. Nothing secret is added.
- A signed-in status page makes at most two GitHub requests (`GET /app` and the existing installations list), each
  under the existing request rules (10 s timeout, 1 MiB, no redirect, no retry). The page never fails because of them.
  The signed-out pages and the login still call neither GitHub nor D1.
- Compatibility: existing apps keep working with their old permissions. No D1 schema change is required by the spec
  (the plan decides whether one is needed for E9). New links point only to `https://github.com`.
- All new texts exist in English and German.
- The shapes of `GET /app` (`owner`, `permissions`, `events`, `slug`), of the installation's `permissions` and
  `events`, of the settings page URLs and of the token request's `permissions` field come from GitHub's documentation.
  None of them is a captured answer. Each deviation fails closed: _owner unavailable_, or a failed check shown as such,
  never a false "nothing missing". Before the pull request is ready, the Product Manager's live check on a deployed
  copy confirms them (decisions 0017 and 0026).
- Logs: nothing new is logged, and no token, key or GitHub answer text appears anywhere.

## Acceptance criteria

- [ ] AC1: `src/github/manifest.test.ts` pins the permission list (the six of today plus `issues: read` and
  `contents: read`, all `read`) and the event list (the five of today plus `issues`, `issue_comment`, `fork`, `star`),
  and the review page lists them (S1).
- [ ] AC2: A completed manifest flow stores the owner's id, login and type for the saved App ID. An answer whose owner
  fails E4 saves the app without an owner (S2, E4).
- [ ] AC3: With no owner stored for the current App ID, the signed-in status page reads `GET /app` once, stores the
  owner and shows it. With one stored and unchanged, it stores nothing. A different owner for the same App ID replaces
  it. An owner stored for another App ID is ignored (S4, E2, E3).
- [ ] AC4: The status page shows the owner line for a personal account, the organization notice for an organization,
  and _owner unavailable_ when `GET /app` fails or its owner is malformed, always with status 200 (S2, S3, E1, E4).
- [ ] AC5: `isOwnAction` and `isBotSender` have unit tests for the owner, another user, a bot, a renamed owner login with
  the same id, an organization or unknown owner, and malformed payloads (no `sender`, a non-object, a missing or string
  `id`, a non-string `type`) (S9, E5).
- [ ] AC6: With a permission or event missing on the app, the status page names it and links to the app's permission
  settings page. With one missing on an installation, that entry names it and links to the installation's page. With
  nothing missing, the page has no _Missing_ text and no such link. `write` counts as granted and extras are not
  reported (S5, S6, S7, E6, E7).
- [ ] AC7: When `GET /app` fails, the status page says the app's permissions could not be checked and shows no
  _Missing_ line. A value that fails its allow-list produces no link (E1, E10).
- [ ] AC8: Against the GitHub test double, the access-token request carries an explicit `permissions` object that holds
  only the permissions Seluna's API calls read and does not hold `contents`, `issues` or any write level (S8, E8).
- [ ] AC9: A token cached before the update is not used afterwards (E9).
- [ ] AC10: Deliveries of `issues`, `issue_comment`, `fork` and `star` are accepted and recorded, and no message is
  sent (S10).
- [ ] AC11: A new decision record covers the new permissions and events, the owner definition (account id, organization
  means no filter), the narrowed tokens, and why `contents: read` is accepted, including the rejected alternative of
  polling forks from the cron. `.squad/project.md` (*Security areas*), `docs/areas/setup-wizard.md`,
  `docs/areas/github-api.md`, `docs/areas/notifications.md`, `docs/areas/storage.md`, `docs/setup.md` (S11) and
  `docs/update.md` are updated.

## Out of scope

- The rules for issues, comments, forks and stars, and passing the owner into the rule input (#109, #110).
- Changing an existing app's permissions or an installation's acceptance automatically; GitHub requires the owner.
- Reporting permissions or events beyond the manifest, and checking more than the first 100 installations.
- Restricting installation tokens to single repositories.

## Open questions

- Should the owner be stored in `settings`, as the issue says, or in `meta`? Answered: `docs/areas/storage.md` reserves
  `settings` for the owner's choices and `meta` for values the instance keeps for itself, like the app's slug
  (`github_app_slug` as `<appId>:<slug>`). The owner is the second kind, so the plan picks the table. The spec requires
  only plain text tied to the App ID.
- When is the owner of an older app fetched? Answered: on the signed-in status page (S4), which already calls GitHub
  (decision 0026). No rule reads the owner in this issue, and #109 decides what a delivery does without one.
- Is the "pull request fixtures say `sender` is the owner" claim true? Answered: confirmed. Every fixture with a
  `sender` has `example-owner` of type `User` (ids 1000 and 1000001), so senders other than the owner need new fixture
  files.
- Does the setup guide already recommend _Only select repositories_? Answered: no. `docs/setup.md` recommends _All
  repositories_ so that new repositories are covered. This issue reverses that, and the guide states the trade-off
  (S11).

## Area documents

- `docs/areas/setup-wizard.md`: the manifest's permissions and events. The status section's owner line, organization
  notice and _owner unavailable_. The _Missing on the app_ line and the per-installation _missing_ suffix with their
  links, and the new texts.
- `docs/areas/github-api.md`: the `GET /app` read (owner, permissions, events, slug) and its failure. The installation
  entry's `permissions` and `events`. The explicit `permissions` list of the token request, and what happens to tokens
  cached by an earlier version.
- `docs/areas/storage.md`: the owner row (format, tied to the App ID, plain text, who writes it, what the reset keeps or
  deletes).
- `docs/areas/notifications.md`: the four new events reach the rules, and no rule reports them yet. The owner and bot
  definitions the rules will use (account id; an organization or unknown owner means no filter).
