# Spec: Setup wizard step: create the GitHub App through the manifest flow

Status: Draft

Source: Issue #10. Product Manager's answer to the Lead's escalation (2026-10-17): build the conversion client and its
fixtures from GitHub's documented example and schema (reference-built, as decision 0016 did for Telegram), record the
residual risk in the decision record, and run the live check on a deployed copy (personal account and organization,
install, a delivery passes the signature check) before the pull request is marked ready for review.

## Problem / motivation

An instance cannot receive GitHub events today unless the owner creates a GitHub App or webhook by hand and sets
`GITHUB_WEBHOOK_SECRET` as a Worker secret. Issue #10 asks for one-click creation of a private GitHub App through
GitHub's manifest flow, for a personal account or an organization, with exactly the read-only permissions and events
the rules need, the credentials stored encrypted in D1, and the webhook signature check reading the stored secret.
The Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` stay a manual alternative
that takes precedence.

## Behavior

- B1: The signed-in start page lists a second step, _GitHub App_, linking to `/setup/github`.
- B2: `GET /setup/github` (signed in) shows one of: the app is configured by the three Worker secrets (no form); only
  some of the three Worker secrets are set (no form, explains how to resolve it); the stored credentials cannot be read
  with the current `SELUNA_SECRET` (no form, explains the reset); otherwise the saved App ID or "none saved", and a
  form to choose personal account or organization and enter the account or organization name.
- B3: Submitting the form checks the CSRF token, refuses while any of the three Worker secrets is set or the stored
  credentials cannot be read, validates the account type and name against an allow-list, and answers a review page
  that shows the app name, permissions and events and carries one form that posts the manifest to GitHub — the
  personal-account URL or the organization's URL, each with a signed `state`. That page alone allows forms to post to
  `https://github.com`.
- B4: The manifest names the app `seluna-<account>` (at most 34 characters), points the webhook at
  `https://<instance>/webhook` and the redirect at `https://<instance>/setup/github/callback`, is private, and asks for
  read-only Actions, Pull requests, Dependabot alerts, Code scanning alerts, Secret scanning alerts and Metadata, and
  the events Pull request, Workflow run, Dependabot alert, Code scanning alert and Secret scanning alert — nothing else.
- B5: GitHub's return (`GET /setup/github/callback?code=…&state=…`) arrives without the wizard's cookies. It answers,
  signed in or not, a finish page whose one form posts `code` and `state` back to the same path; it calls neither
  GitHub nor D1, sets no cookie, and answers a fixed notice when `code` or `state` is missing, repeated or outside its
  allow-list.
- B6: Submitting the finish form (signed in) checks that the `state` was issued to this session less than one hour
  ago, refuses while any of the three Worker secrets is set, checks the `code` allow-list and that the stored
  credentials can be written with the current `SELUNA_SECRET`, and only then exchanges the code with GitHub
  (`POST /app-manifests/{code}/conversions`).
- B7: From GitHub's answer the App ID, the private key and the webhook secret are taken; the private key is converted
  from PKCS#1 to PKCS#8 and must import as an RS256 signing key; the three values are stored encrypted, together or not
  at all. The client secret and every other field are discarded.
- B8: On success the page says the app is saved, links to the app's installation page on GitHub (or, without a usable
  slug, says how to find it) and recommends "All repositories".
- B9: Every failure ends on a page with a fixed notice in the page language: an invalid or foreign return, a code
  GitHub no longer accepts, GitHub unreachable (the finish form is offered again), an unreadable answer, a failed save,
  a needed reset. No text from GitHub, D1 or the runtime reaches a page or the log.
- B10: `POST /webhook` takes the webhook secret from the Worker secret `GITHUB_WEBHOOK_SECRET` when it is set, else
  from D1; nothing usable stored, a changed `SELUNA_SECRET` or a D1 failure answers 503 as before.
- B11: Each of `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` that is set takes precedence over
  the stored value of the same credential; the wizard shows the Worker-secret configuration without any value.

## Acceptance criteria

- [ ] AC-a: The app is created with exactly the permissions and events above (issue #10).
- [ ] AC-b: Works for a personal account and for an organization (issue #10).
- [ ] AC-c: After installing, a delivery of the app passes the signature check (issue #10).

The criteria the Tester turns into tests are in `plan.md`; AC-a to AC-c are also part of the Product Manager's live
check on a deployed copy before the pull request is marked ready.

## Out of scope

- Reading the App ID and private key for API calls (JWT, installation tokens): issue #15.
- The reset after a changed `SELUNA_SECRET` and the status page with the app's name and link: issue #11.
- Deleting or updating an app on GitHub from the wizard.

## Open questions

None: the Product Manager decided the one open question (reference-built client and fixtures, live check before
ready for review).
