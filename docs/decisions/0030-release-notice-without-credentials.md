# 0030: Release notice from an unauthenticated release check

- **Status:** Proposed
- **Date:** 2026-10-21
- **Area:** Scheduled jobs
- **Source:** Issue #18
- **Supersedes:** —

## Context

Every owner runs their own copy ([0005](0005-one-instance-per-user.md)) and learns about a new release only by
watching the upstream repository. The settings have offered the switch "Tell me when a new Seluna release is
available" (`update_notice`, default on) since 0.2.0 ([0018](0018-settings-and-status-page.md)), and nothing reads
it. Issue #18 asks the daily run to read `GET /repos/LarsLaskowski/Seluna/releases/latest` without credentials,
compare it with the running version, send one message with a link and remember the version in `meta`, so each release
is reported once. The running version is `package.json`'s, fixed at build time
([0011](0011-public-http-surface.md)); releases are tagged `vA.B.C` and become the latest full release through the
release workflow ([0009](0009-releases-only-by-tag-push.md)). Until now every GitHub call but the manifest conversion
is made as the app ([0026](0026-github-app-authentication-and-installation-tokens.md)). The reader is built from a
captured answer (`v0.4.0`, anonymized).

## Options considered

How the release is read:

1. **Without credentials, through the client's request rules (GitHub API headers, no redirects, 10 seconds, 1 MiB,
   narrowed to `tag_name`)** — the upstream repository is public and the owner's app is not installed on it, so no
   app token could read it; nothing is sent that could leak. GitHub limits unauthenticated requests per outgoing
   address, which Workers share: a refused check waits for the next day. Chosen.
2. **As the owner's app** — the app has no installation on the upstream repository.
3. **A personal token as a new Worker secret** — a credential and a setup step for a link once per release.

What the answer may contribute:

4. **Only `tag_name`, accepted exactly as `v<major>.<minor>.<patch>` (each part a whole number without leading zeros,
   at most 9 digits); the message and the button URL are built from the parsed numbers** — no text of the answer
   reaches a message, a URL or a log, whatever the upstream repository or a forged answer holds. Chosen.
5. **`name`, `body` or `html_url` as well** — release text in the owner's chat and a URL to vet, for no gain.

How the notice is sent and remembered:

6. **As an `outbox` row written in one batch with the remembered version, both guarded by the remembered value read
   before** — the outbox guarantee and the cron's retry cover the notice, a failed write reports the release again
   the next day, and of two runs at once only one writes the row. Chosen.
7. **Sent directly, then remembered** — a Telegram outage loses the notice, or a failed write sends it daily.

With the switch off:

8. **Nothing is read, requested or remembered** — switching it on later reports the latest release once if it is
   newer than both the running and the remembered version. Chosen.
9. **Remember silently while off** — the owner who switches it on would never hear of the release they missed.

## Decision

The daily run, with the update notice on, reads the latest release of the upstream repository without credentials,
accepts only a `vA.B.C` tag, and when that version is newer than the running one and the remembered one writes the
notice as an `outbox` row together with the remembered version in one guarded batch and sends it like any row. The
rules are in [`areas/scheduled-jobs.md`](../areas/scheduled-jobs.md).

## Consequences

- The Worker makes a second GitHub request outside the app authentication, besides the manifest conversion; the
  security model and the _GitHub App authentication_ security area say so.
- A check GitHub refuses (its limit for unauthenticated requests, an outage) is retried only the next day, so a
  notice can come a day or more late.
- A release published by hand without the pre-release flag is the latest before its checks run and can be reported
  ([0009](0009-releases-only-by-tag-push.md)); the notice only links it.
- A copy built from `main` between releases runs the last released version and is told about nothing it already
  contains; a copy whose `package.json` version is not `A.B.C` checks nothing.
- A tag form other than `vA.B.C` (a pre-release suffix, a new scheme) is never reported until the reader changes.
- Residual risk: the reader rests on one captured answer; a deviation fails closed (no notice, one log entry). The
  request from a deployed copy is checked once live (the plan's live check).
