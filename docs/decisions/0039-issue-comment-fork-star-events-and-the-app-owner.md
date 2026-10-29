# 0039: Issue, comment, fork and star events, the app owner and narrowed installation tokens

- **Status:** Accepted
- **Date:** 2026-10-29
- **Area:** GitHub API
- **Source:** Issue #108
- **Supersedes:** — (amends [0017](0017-github-app-manifest-flow.md): the manifest asks for two more read
  permissions and four more events, and the finish stores the app's owner. Amends
  [0026](0026-github-app-authentication-and-installation-tokens.md): installation tokens name an explicit permission
  list, and the status page makes two GitHub requests under one app JWT. Amends
  [0007](0007-github-app-credentials-encrypted-in-d1.md): the additional data of a `token_cache` row also names the
  token's permission list.)

## Context

Issue #108 prepares the rules of #109 (issues and comments) and #110 (forks and stars). The app needs the events
`issues`, `issue_comment`, `fork` and `star`. Each event needs a permission:

- `issues` needs Issues.
- `issue_comment` needs Issues (GitHub's documentation names only Issues; whether Pull requests alone delivers the
  comments of a pull request is not relied on, because the app has both).
- `fork` needs Contents.
- `star` needs only Metadata.

The rules must leave out the owner's own actions and bots, so Seluna has to know who owns the app. Until now the
manifest conversion was narrowed to the owner's `login` and `type`, and no rule read `sender`. An existing app keeps
its permissions until the owner accepts new ones on GitHub ([0006](0006-github-app-per-user-manifest-flow.md)).

Installation tokens were requested without a `permissions` object, so each token carried every permission the
installation had granted, and once the owner accepts Contents, every new token could read code. GitHub's
documentation says a request without `permissions` gets all of them, and its token answer names the permissions
the token got. The only API call made with an installation token is the draft lookup,
`GET /repos/{owner}/{repo}/pulls/{number}`.

The private key is stored encrypted and readable only with `SELUNA_SECRET` (0007). Whoever has both the database
and `SELUNA_SECRET` can already mint tokens with every permission of the app, and Actions read already exposes logs
and artifacts.

## Options considered

How Seluna learns about forks:

1. **The `fork` event with `contents: read`.** No delay and no state. A leak of the private key together with
   `SELUNA_SECRET` would expose repository code as well; that widens what such a leak exposes, not the ways to cause
   one. Chosen.
2. **Polling the forks list from the cron**, which needs only Metadata. It adds up to ten minutes of delay, a
   remembered state per repository and GitHub requests on every cron run.

Who the owner is:

3. **The app's `owner` account, compared by its numeric `id`.** It survives a renamed login. An organization owner
   means no owner filter, because a webhook's `sender` is a person and Seluna cannot tell which member is the
   instance's user. Chosen.
4. **Comparing the login.** A rename would silently break the filter.
5. **Asking the owner for their own account in the wizard.** It is one more form and value, and it is wrong for an
   organization's app anyway.

Where the owner is kept:

6. **A `meta` row tied to the App ID, like `github_app_slug`.** It holds a value the instance learns, not a choice
   of the owner. A row of another App ID reads as absent. Chosen.
7. **`settings`, as the issue suggested.** `settings` holds the owner's choices, which the settings form writes in
   one batch.

How an older app's owner is learned:

8. **From `GET /app` on the signed-in status page.** That page now asks `GET /app` on every view anyway, for the
   permission check, and a changed owner is replaced from the answer. Chosen. What a delivery does without a known
   owner is decided by #109.
9. **On a delivery.** It adds a GitHub request to the webhook path, and in this issue no rule needs the owner yet.

The permission list of an installation token:

10. **Only what the API calls read: `metadata: read` and `pull_requests: read`, and a token accepted only when the
    answer's `permissions` holds nothing else.** Every installation has both (Metadata is always granted), so naming
    them never makes GitHub refuse the token. A list that names a permission an installation has not accepted yet
    would. Checking the answer turns "no token can read code" from a hope into a check: a GitHub that ignored the list
    would hand out a token with every permission, which Seluna then refuses and never caches. Chosen.
11. **Every manifest permission except Contents.** That list includes Issues, which an existing installation has not
    accepted until the owner reviews it, so the draft lookup would fail until then. It also grants more than is read.

Cached tokens when the permission list changes. A token cached before this update cannot read code, because an
existing app gets Contents only after the update, when the owner accepts it. The case that matters is a later
change of the list: if #109 or #110 widens it, a narrower cached token would fail the new calls.

12. **The additional data of a `token_cache` row also names the token's permission list.** A cached token then counts
    only for the list it was issued for, so any change to the list takes effect immediately. A row of another list
    no longer decrypts, which 0026 already treats as no cached token, so it is replaced on the next call. No migration
    is needed. Chosen.
13. **A migration that deletes `token_cache` on each change of the list.** It runs only where the deploy applies
    migrations, and every change needs another one.
14. **Accepting the old rows until they expire.** For up to 55 minutes, calls that need the new list would fail.

The links to accept permissions on GitHub:

15. **Built from the allow-listed login, slug and installation id, by account type.** Only `https://github.com`
    paths of a fixed form. Chosen.
16. **The `html_url` of GitHub's answers.** That puts a URL from an external answer into the page, which would need
    its own allow-list.

The status page's GitHub requests:

17. **One app JWT for `GET /app` and the installations list, both sent at the same time.** A view stays at one
    signature and one timeout (0026). Chosen.
18. **Each request signs its own JWT.** Two signatures and, in sequence, up to two timeouts.

## Decision

The manifest adds `issues: read` and `contents: read`, and the events `issues`, `issue_comment`, `fork` and `star`.
The app's owner is its `owner` account, identified by account id and kept in `meta` tied to the App ID. It is
stored when the manifest flow finishes and is otherwise read from `GET /app` on the status page; an organization
owner means no owner filter. Installation tokens are requested with the explicit list `metadata: read`,
`pull_requests: read` and accepted only when GitHub's answer grants nothing else. A cached token counts only for the
list it was issued for.

The rules are in the area documents [`areas/github-api.md`](../areas/github-api.md),
[`areas/setup-wizard.md`](../areas/setup-wizard.md) and [`areas/storage.md`](../areas/storage.md).

## Consequences

- Existing instances receive the new events only after the owner adds the permissions and events to the app and
  accepts them on each installation. The status page names what is missing and links to the page where it is done.
- The setup guide and the created page now recommend _Only select repositories_. A new repository has to be added
  to the installation by hand. This limits deliveries to the chosen repositories. On a selected public repository,
  strangers still decide the volume.
- Every delivery costs a Worker request and D1 rows written, whether or not a rule reports it: about 3 for the
  `deliveries` insert (the row, its primary-key index and its `received_at` index), 1 for the `meta` upsert, and
  about 3 more when the cleanup deletes the row 7 days later. That is about 7 rows per delivery. Against the free
  plan's 100,000 rows written a day (Cloudflare's documentation), this allows about 14,000 deliveries a day for the
  whole instance.
- Every cached installation token is requested again once after the update.
- Residual risk, volume: anyone can open issues, comment, and star and unstar on a selected public repository.
  Each of these is a delivery. When the daily D1 write budget runs out, every delivery answers 503, including
  secret scanning alerts and CI failures that GitHub does not send again, and login-attempt writes fail too. Pull
  requests allowed this before; the new events make it cheaper. A follow-up issue proposes not recording
  deliveries that no rule reads.
- Residual risk, shapes:
  - The shapes rest on GitHub's documentation, not on captured answers to this app: the installation's
    `permissions` and `events`, the settings page URLs, and the token request's and answer's `permissions`.
  - The app object of `GET /app` follows a real app object (`specs/feature-108-github-app-events/sample-app.json`,
    from a check run of this repository).
  - Each deviation fails closed. The Product Manager's live check on a deployed copy confirms them before the pull
    request is marked ready: an app created with the new manifest, an older app's missing list and its acceptance,
    a draft lookup with the narrowed token (its answer's `permissions` is exactly the list), and the owner line for a personal account.
