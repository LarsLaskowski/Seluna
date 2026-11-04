# Spec: Accept GitHub's stateless installation token format

Source: Issue #122
Status: Draft

## Problem

Seluna asks GitHub for an installation token before it reads a pull request's draft state
([Notifications, Draft lookup](../../docs/areas/notifications.md#draft-lookup)). Today a token is accepted only when it
is 1 to 255 characters from `[A-Za-z0-9_]` (`TOKEN_TEXT` in `src/github/token-text.ts`, used by
`parseInstallationToken` in `src/github/installation-token.ts` and `readCachedToken` in `src/store/token-cache.ts`).

GitHub's OpenAPI description of `POST /app/installations/{installation_id}/access_tokens` and its docs
(`data/reusables/apps/ghs-stateless-token-format.md` in `github/docs`) say: "Starting April 27, 2026, GitHub began a
staged rollout of a stateless format (`ghs_APPID_JWT`) to all newly minted GitHub App installation tokens … If your
application expects or relies on installation tokens being exactly 40 characters long, it may not handle this new
token format correctly." A JWT holds `.` separators, base64url `-`, and with RS256 its signature alone is 342 characters,
so a stateless token fails the allow-list. GitHub then answered a token request with success, but Seluna treats it
as a failure and caches nothing. So, once the rollout reaches the owner's app:

- every CI failure in a pull request is reported with the title `CI failed in pull request (draft status unknown)`,
  drafts included;
- every comment on a pull request whose payload has no `issue.draft` is dropped (the issue does not mention this
  second effect; it follows from the documented draft lookup);
- every lookup sends one more token request, because nothing is cached.

## Scenarios

- S1: Given GitHub answers the token request with a stateless token `ghs_<App ID>_<JWT>` and a valid `expires_at`
  and `permissions`, when a CI failure in a pull request that is not a draft is delivered, then the owner gets the
  usual `CI failed in pull request` notification, without _draft status unknown_.
- S2: Given the same token answer, when the CI failure is in a draft pull request, then no notification is sent.
- S3: Given the same token answer, when a comment on a pull request whose payload has no `issue.draft` is delivered
  and the pull request is not a draft, then the comment notification is sent.
- S4: Given a stateless token was cached by an earlier lookup and expires more than 5 minutes from now, when the next
  lookup for that installation runs, then it reuses the cached token and sends no token request.
- S5: Given GitHub still answers with a classic token (`ghs_` and 36 letters and digits, as in
  `test/fixtures/github/installation-token.json`), or one is still cached from an earlier version, when a lookup runs,
  then it works as today.

## Errors and edge cases

Each refused token below is a failure of the GitHub API client: nothing is cached, the CI failure is reported marked
_draft status unknown_ and a comment on a pull request is dropped, exactly as for any other failed lookup today. A
refused token is never put into a request header.

- E1: A token holding whitespace (space, tab) or a control character (`U+000D`, `U+000A`, `U+0000`, or any other
  below `U+0020` or `U+007F`), anywhere, also as one trailing line feed: refused.
- E2: A token holding a character other than ASCII letters, digits, `_`, `-` and `.` (such as `+`, `/`, `=`, `:`, a
  non-ASCII letter): refused.
- E3: An empty token: refused.
- E4: A token longer than the length bound (Open questions, Q1): refused; a token of exactly the bound is accepted.
- E5: A cached row whose decrypted token fails the same check counts as no cached token, and a new one is requested
  (as today).
- E6: A token that is not a string: refused (unchanged).

## Non-functional requirements

- Security: the token goes only into `Authorization: Bearer <token>`; the accepted characters can never end or add a
  header line, and the length is bounded (Q1). The token is still never logged, shown or stored in plain text.
- Compatibility: classic tokens, and classic tokens already cached by an earlier version, keep working (S5); no
  migration, `token_cache.ciphertext` is `TEXT` without a length limit.
- No new configuration, log line or request.
- The token and its JWT are not decoded or verified: `expires_at` from the answer stays the only source of the
  expiry.

## Acceptance criteria

- [ ] AC1: A token in the documented stateless form `ghs_<App ID>_<header>.<payload>.<signature>` (base64url parts
  with `-` and `_`, as long as a real RS256 JWT) is accepted by the token answer check and by the cache read; a
  classic token is still accepted (S1, S4, S5).
- [ ] AC2: A token with whitespace, a control character, any other character outside `[A-Za-z0-9_.-]`, an empty
  token and a token one character over the bound are refused; a token of exactly the bound is accepted (E1, E2, E3,
  E4, E6).
- [ ] AC3: With the GitHub test double answering a stateless token, the draft lookup sends the pull request read
  with `Authorization: Bearer <that token>`, caches the token, and a second lookup reuses it without a token request
  (S1, S4).
- [ ] AC4: With the GitHub test double answering a stateless token, a CI failure in a pull request that is not a
  draft keeps its usual title, one in a draft is dropped, and a comment on a pull request that is not a draft is kept
  (S1, S2, S3).
- [ ] AC5: A cached row whose token fails the check counts as no cached token (E5).
- [ ] AC6: `docs/areas/github-api.md` states the accepted token form and bound (Area documents).

## Out of scope

- Decoding the JWT, checking its App ID against the configured one, or reading its expiry.
- The temporary opt-in request header GitHub offers for testing the format: Seluna does not send it.
- Other GitHub token kinds (`ghp_`, `github_pat_`, `gho_`, `ghu_`, `ghr_`), the Telegram bot token form.
- Telling the owner on the status page that tokens are refused.

## Open questions

- Q1: What is the length bound? GitHub's OpenAPI description (`components.schemas.installation-token.token`, plain
  `string`) and its docs give no maximum, and the GitHub changelog post they link (2026-05-15) cannot be reached from
  this session. No real stateless token is in the repository or on the issue. Not answered: escalated to the
  Product Manager.
- Q2: Is the documented form really `ghs_APPID_JWT`? Answered: yes, in the OpenAPI description of the operation
  (`main` of `github/rest-api-description`) and in `github/docs`, both read on 2026-11-04.
- Q3: Does a refused token make CI failures read _draft status unknown_? Answered: yes, `parseInstallationToken`
  returns `undefined`, `installationToken` returns `undefined`, the pull request read is the failure result, and the
  draft lookup gives the CI failure that title ([Notifications](../../docs/areas/notifications.md#draft-lookup)); a
  comment on a pull request is dropped by the same path.
- Q4: Does any other call use an installation token? Answered: no, the pull request read is the only one
  (`docs/areas/github-api.md`, *Installation tokens*); the status page uses the app token.

## Area documents

- `docs/areas/github-api.md`, *Installation tokens*: a 2xx answer is accepted with a `token` of 1 to N characters
  from `[A-Za-z0-9_.-]` (or the narrower form the plan picks), covering the classic and the stateless
  `ghs_<App ID>_<JWT>` form; the cache read applies the same check. *Limits and errors*: the token form follows
  GitHub's OpenAPI note on the stateless format, with its source.
- `.squad/project.md`, *Security areas* (GitHub API client): the allow-list text `[A-Za-z0-9_]`, 1–255 characters
  changes with it.
- Decision 0026 is released (v0.7.0) and states the old allow-list: a new record supersedes that point.
