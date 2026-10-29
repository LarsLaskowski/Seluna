# Spec: Subscribe the GitHub App to issues, comments, forks and stars

Source: Issue #108
Status: Draft

## Problem

Owners want to hear about other people's issues, comments, forks and stars (issue #108). The app the wizard creates
cannot receive these events: `src/github/manifest.ts` requests six read permissions and five events, none of them
these. Seluna does not know who the owner is either: the conversion answer is narrowed to `owner.login` and
`owner.type`, not `owner.id` (`src/github/conversion.ts`), and no rule reads `sender`. So the rules of #109 and #110
could not leave out the owner's own actions or bots. Existing apps keep their old permissions until the owner accepts
new ones on GitHub (decision 0006), and nothing tells the owner what to accept. Installation tokens are requested
without a `permissions` object (`src/github/installation-token.ts`), so each one carries every permission of the app,
which would now include `contents: read`.

## Scenarios

- S1: Given a new instance, when the owner reaches the review page, then it lists the permissions as read-only
  Actions, Contents, Issues, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts and
  Metadata. It lists the events as today's five plus `issues`, `issue_comment`, `fork` and `star`, and the manifest
  holds exactly these.
- S2: Given the manifest flow finishes for a personal account, when the app is saved, then Seluna also stores the
  owner (account id, login, type `User`), tied to the App ID. The status page shows _GitHub App owner:_ `<login>
  (personal account)`.
- S3: Given an organization's app, when the status page is shown, then it shows _GitHub App owner:_ `<login>
  (organization)` and the notice "The app belongs to an organization, so Seluna cannot tell your own actions from
  anyone else's: activity of every account is reported, yours too."
- S4: Given any app, when the signed-in status page is shown, then it asks `GET /app` (on every view, for S5).
  - The owner line shows a successful answer's owner, else the owner stored for the current App ID, else _owner
    unavailable_.
  - A successful answer's owner is stored when none is stored for the App ID, or when it differs from the stored one.
    This covers an app created before this change or configured through the Worker secrets.
- S5: Given the app lacks permissions or events of the manifest, when the status page is shown, then under _GitHub
  App:_ it shows _Missing on the app:_ with each permission (name and level) and event. A link "Add them in the app's
  settings on GitHub" goes to `https://github.com/settings/apps/<slug>/permissions` (personal account) or
  `https://github.com/organizations/<login>/settings/apps/<slug>/permissions` (organization). The slug is the
  answer's, falling back to the stored `github_app_slug` of the current App ID.
- S6: Given an installation lacks something the app has, when the installations are listed, then its entry ends with
  `, missing: <permissions and events>`. A link "Review and accept on GitHub" goes to
  `https://github.com/settings/installations/<id>` (user account) or
  `https://github.com/organizations/<login>/settings/installations/<id>` (organization). What the app itself lacks is
  named only on the app's line (S5): an installation can accept it only after the app requests it.
- S7: Given nothing is missing on the app or any listed installation, when the status page is shown, then there is no
  _Missing_ text, no such link and no extra notice.
- S8: Given a delivery needs the GitHub API (today the draft lookup), when Seluna requests an installation token, then
  the request names an explicit permission list. The list holds only what Seluna's API calls read, never `contents`.
- S9: Given a payload, when a rule asks whether it is the owner's own action, then the answer is yes only for a
  personal-account owner whose stored id equals `sender.id` (a renamed login changes nothing). Whether a bot sent it
  is yes exactly when `sender.type` is `Bot`.
- S10: Given the new app, when GitHub delivers `issues`, `issue_comment`, `fork` or `star`, then the delivery is
  accepted and recorded as today, and no message is sent until #109 and #110 exist.
- S11: Given the owner installs the app, when they read `docs/setup.md` or the created page's _install intro_ and
  _install manually_ texts (English and German), then both recommend _Only select repositories_ instead of _All
  repositories_. They also say that new repositories have to be added by hand.

## Errors and edge cases

- E1: `GET /app` fails (refused, timed out, redirected, unreadable, malformed, no usable app or key). The page is still
  200, and the owner line follows S4. The app's check shows "Seluna could not read the app's permissions from GitHub."
  Installation entries show no _missing_ suffix. Nothing is stored, and the next view tries again.
- E2: The app was transferred or its owner renamed. A successful answer replaces the stored owner (S4).
- E3: The stored owner belongs to another App ID (after a reset or a new app). It counts as absent and is never shown
  or used.
- E4: An owner whose `type` is neither `User` nor `Organization`, whose `id` is not a positive safe integer, or whose
  login fails the account name allow-list is not stored. This holds in the conversion answer and in `GET /app`.
  Through `GET /app` it counts as a failed answer for the owner line. The manifest flow still saves the app, since
  decision 0017's owner check passed.
- E5: The payload has no `sender`, a `sender` that is not an object, a missing or non-numeric `id`, or a non-string
  `type`. Then neither helper says yes. An unknown or organization owner never makes an own action.
- E6: `write` where the manifest asks `read` counts as granted. Permissions or events beyond the manifest are not
  reported.
- E7: The installations list fails, or there are more than 100 installations. The existing _installations unavailable_
  or _more installations_ behavior applies, and only listed installations are checked. Suspended ones are checked too.
- E8: An installation that has not accepted `issues` or `contents` still gets tokens, because the list never names
  them. One that lacks a listed permission gets the existing failure result.
- E9: A token cached by a version before this change may carry every permission of the app. It is not used after the
  update.
- E10: No link is built from a slug, login or installation id that fails its allow-list. The same holds for an
  enterprise or unknown installation account and for an unknown owner type. The _Missing_ text is still shown.
- E11: A failed owner write (D1 error) is ignored, like the slug write after the manifest flow: 200, GitHub's owner
  shown, a new write on the next view. Other D1 failures of the page keep their 503.

## Non-functional requirements

- Security: the app stays read-only.
  - `contents: read` is only there because GitHub requires it for `fork`; `star` needs `metadata`.
  - No token Seluna holds can read code.
  - The new decision record gives the reasons, and `.squad/project.md` (*Security areas*) lists the permissions and
    the narrowed tokens.
- The owner's id, login and type are public. They are stored as plain text in D1, tied to the App ID like the slug
  row.
- A signed-in status page makes at most two GitHub requests (`GET /app`, installations), under the existing request
  rules. Both share one app JWT and run at the same time, so a view stays at one signature and about 10 seconds
  (decision 0026). The page never fails on them. Signed-out pages call neither GitHub nor D1.
- Load: `star` and `issue_comment` can arrive often. Each delivery is a Worker request, a `deliveries` row and D1
  reads and writes. The plan states the expected extra load against the free plan. _Only select repositories_ (S11)
  is the owner's way to limit it.
- Compatibility: existing apps keep working with their old permissions. The plan decides whether E9 needs a
  migration. New links point only to `https://github.com`.
- All new texts exist in English and German. Nothing new is logged.
- The shapes of `GET /app`, of the installation's `permissions` and `events`, of the settings URLs and of the token
  request's `permissions` field come from GitHub's documentation, not captured answers.
  - Every deviation fails closed: never a false "nothing missing".
  - The Product Manager's live check on a deployed copy confirms them before the pull request is ready (decisions
    0017 and 0026).

## Acceptance criteria

- [ ] AC1: `src/github/manifest.test.ts` pins the eight `read` permissions and nine events of S1, and the review page
  lists them (S1).
- [ ] AC2: A completed manifest flow stores the owner's id, login and type for the saved App ID. An owner failing E4
  saves the app without an owner (S2, E4).
- [ ] AC3: A successful `GET /app` stores its owner when none is stored for the App ID or when it differs. The same
  owner causes no write. An owner of another App ID is ignored. A failed write still answers 200 with GitHub's owner
  (S4, E2, E3, E11).
- [ ] AC4: The owner line shows the answer's owner, else the stored one, else _owner unavailable_. It uses the
  personal-account form or the organization notice, always with 200 (S2, S3, S4, E1, E4).
- [ ] AC5: `isOwnAction` and `isBotSender` have unit tests for: the owner, another user, a bot, a renamed login with
  the same id, an organization or unknown owner, and malformed payloads (no `sender`, a non-object, a missing or
  string `id`, a non-string `type`) (S9, E5).
- [ ] AC6: Something missing on the app is named with the link for its owner type. Something the app has but an
  installation lacks is named on that entry with the link for its account type. Nothing missing means no _Missing_
  text and no link. `write` counts as granted, and extras are not reported (S5, S6, S7, E6, E7).
- [ ] AC7: With `GET /app` failed, the page says the permissions could not be checked and shows no _Missing_ text or
  suffix. No link is built in E10's cases. The slug falls back to the stored one (S5, E1, E10).
- [ ] AC8: Against the GitHub test double, the token request carries an explicit `permissions` object. It holds only
  what Seluna's API calls read: no `contents`, no `issues`, no write level (S8, E8).
- [ ] AC9: A token cached before the update is not used afterwards (E9).
- [ ] AC10: As a regression guard, deliveries of `issues` (`opened`), `issue_comment` (`created`), `fork` and `star`
  (`created`) are accepted and recorded, and send nothing.
  - Each comes from its own fixture file under `test/fixtures/<event>/`; the plan names the `fork` file, which has no
    action.
  - Each folder's README marks them as documentation-shaped until the live check (S10).
- [ ] AC11: A new decision record covers:
  - the new permissions and events;
  - the owner definition (account id; an organization means no filter) and the narrowed tokens;
  - why `contents: read` is accepted, with fork polling from the cron as the rejected alternative.

  `.squad/project.md` (*Security areas*), the four area documents below and `docs/update.md` are updated.
- [ ] AC12: The created page's _install intro_ and _install manually_ texts (English and German), `docs/setup.md` and
  their description in `docs/areas/setup-wizard.md` recommend _Only select repositories_ with its trade-off (S11).

## Out of scope

- The rules for issues, comments, forks and stars, and passing the owner into the rule input (#109, #110).
- Changing permissions or accepting them automatically; GitHub requires the owner.
- Permissions or events beyond the manifest, more than 100 installations, tokens restricted to single repositories.

## Open questions

- `settings` (as the issue says) or `meta` for the owner? Answered: `docs/areas/storage.md` keeps `settings` for the
  owner's choices and `meta` for the instance's own values, such as `github_app_slug` (`<appId>:<slug>`). The plan
  picks; the spec requires only plain text tied to the App ID.
- When is an older app's owner fetched? Answered: on the signed-in status page (S4), which already calls GitHub
  (decision 0026). #109 decides what a delivery does without an owner.
- Do the fixtures' senders all equal the owner? Answered: confirmed. Every fixture with a `sender` has `example-owner`,
  type `User`, so other senders need new fixture files.
- Does Seluna already recommend _Only select repositories_? Answered: no. `docs/setup.md` and `src/setup/texts.ts`
  recommend _All repositories_, and this issue reverses that (S11).

## Area documents

- `docs/areas/setup-wizard.md`: the manifest lists, the owner line and organization notice, the _Missing_ line and
  suffix with their links, the new texts, the created page's recommendation.
- `docs/areas/github-api.md`: the `GET /app` read and its failure, the installations' `permissions` and `events`, the
  token request's permission list, tokens cached by an earlier version.
- `docs/areas/storage.md`: the owner row (format, App ID binding, writer, reset).
- `docs/areas/notifications.md`: the four new events reach the rules unreported; the owner and bot definitions for
  the rules.

## Challenge

- M1 (stored owner, S4 against E1/AC3/AC4): accepted. One rule decides the owner line (S4): the answer's owner, else
  the stored one, else _owner unavailable_. A successful answer replaces a changed owner. S4, E1, E2, AC3 and AC4 are
  reworded.
- M2 (the created page recommends _All repositories_, `src/setup/texts.ts` 241, 244, 460, 463 and
  `docs/areas/setup-wizard.md` 757–760): accepted, confirmed. S11 covers the created-page texts in both languages, and
  the new AC12 covers them with `docs/setup.md` and the area document.
- m1 (links per account type, slug for Worker-secret apps): accepted. S5 and S6 give both URL forms. E10 drops the
  link for enterprise or unknown accounts and an unknown owner type. The slug comes from the answer, falling back to
  the stored one.
- m2 (status page cost): accepted. One shared JWT and two parallel requests keep a view at one signature and about
  10 seconds (NFR).
- m3 (installation lines when the app lacks a permission): accepted. Entries name only what the app has but the
  installation lacks (S6). Without an answer there is no suffix (E1).
- m4 (failed owner write): accepted as E11. It is ignored like the slug write, and covered by AC3.
- m5 (AC10 passes today): accepted. AC10 is a regression guard with one documentation-shaped fixture per event.
- m6 (event volume): accepted as the load NFR.
- Spec size: the revision shortened the spec to fit within `SPEC_MAX_WORDS` without dropping a scenario or criterion.
