# Plan: Accept GitHub's stateless installation token format

Source: Issue #122 | [spec.md](spec.md)
Status: Draft
Tier: security — the change widens the allow-list that decides which credential text Seluna caches and puts into the `Authorization` header. That is a guard on credential handling listed under *Security areas*, not only a size bound, and in doubt the higher tier applies.
Security areas touched: GitHub API client (`src/github/token-text.ts`, used by `parseInstallationToken` in `src/github/installation-token.ts`); Encrypted credentials (`readCachedToken` in `src/store/token-cache.ts` applies the same check to decrypted `token_cache` rows); `.squad/project.md` (*Security areas*) text updated to match

## Problem / root cause

See [spec.md](spec.md), *Problem*. Cause: `TOKEN_TEXT = /^\w{1,255}$/` (`src/github/token-text.ts:1`) refuses the
documented stateless form `ghs_APPID_JWT`.

## Verified facts

| # | Claim | Evidence | Status |
| - | ----- | -------- | ------ |
| 1 | GitHub documents a stateless installation token format `ghs_APPID_JWT`, rolled out from 2026-04-27 | OpenAPI `paths./app/installations/{installation_id}/access_tokens.post.description` (`github/rest-api-description`, `main`, read 2026-11-04); `github/docs` `data/reusables/apps/ghs-stateless-token-format.md` | confirmed |
| 2 | GitHub documents no maximum token length | `components.schemas.installation-token.properties.token` is `{"type":"string"}`; neither docs file names a length | confirmed |
| 3 | Today's check is `/^\w{1,255}$/`, used by the answer check and the cache read | `src/github/token-text.ts:1`; `src/github/installation-token.ts:54`; `src/store/token-cache.ts:43` | confirmed |
| 4 | A refused token makes the draft lookup a failure: CI failure titled _draft status unknown_, comment on a pull request dropped, nothing cached | `installation-token.ts:54,89-91` returns `undefined`; `docs/areas/notifications.md`, *Draft lookup* | confirmed |
| 5 | The pull request read is the only call with an installation token | `docs/areas/github-api.md`, *Installation tokens*; the status page uses the app JWT (`app-info.ts`, `installations.ts`) | confirmed |
| 6 | `token_cache.ciphertext` has no length limit | `migrations/0001_initial_schema.sql:35` (`TEXT NOT NULL`) | confirmed |
| 7 | Without the `m` flag, JavaScript's `$` does not match before a final `\n` | ECMAScript `$` assertion (only end of input without `m`); existing case "a trailing line feed" in `src/github/token-text.test.ts` passes today | confirmed |
| 8 | Decision 0026 is released | `git ls-remote --tags origin` lists `v0.7.0`; 0026 was added by #78, before it | confirmed |
| 9 | Real stateless tokens are at most 4096 characters from `[A-Za-z0-9_.-]` | to verify: the Product Manager's live check on a deployed copy with GitHub's opt-in header (decision 0045), after the release; owner Product Manager | unverified |

## Acceptance criteria

The spec's AC1–AC6 ([spec.md](spec.md), *Acceptance criteria*).

## Tests per criterion

`STATELESS_TOKEN` is the reference-built token of *Approach*. Every case about a control character writes it as an
escape in the test source (`\t`, `\r\n`, `\n`, `\u0000`, `\u007F`) and asserts the input has the expected
length or `includes` that character, so a lost escape fails the run (`.squad/team.md`, *Escapes in files*). The
guard that fails when such an input lost its backslash is that assertion. Without it, `a\n` written as `an` would be
accepted silently.

| AC | Test(s) | Test file |
| -- | ------- | --------- |
| AC1 | `isInstallationTokenText accepts the stateless token` (the case also asserts `STATELESS_TOKEN.length > 255`, two `.`, at least one `-` and one `_` after the prefix); `isInstallationTokenText accepts a hyphen` (`a-b`) and `a dot` (`a.b`), moved from the rejected list | `src/github/token-text.test.ts` |
| AC1 | `parseInstallationToken narrows an answer with the stateless token to its token and expiry` | `src/github/installation-token.test.ts` |
| AC1 | `readCachedToken reads a stateless token` | `src/store/token-cache.test.ts` |
| AC2 | `isInstallationTokenText accepts 4096 characters`; rejected cases: empty, 4097 characters, a space, a tab, `a\r\nX: y`, a trailing line feed, `U+0000`, `U+007F`, `+`, `/`, `=`, `:`, `ä` (the "256 characters" case becomes 4097) | `src/github/token-text.test.ts` |
| AC2 | existing `parseInstallationToken rejects …` cases adapted: "a token of 256 characters" → "a token of 4097 characters", "a token with a hyphen" → "a token with a space" (`ghs_a b`); "a token that is a number" and "a token with a line break" stay unchanged (E6, E1) | `src/github/installation-token.test.ts` |
| AC3 | `isPullRequestDraft sends a stateless token as the Bearer token of the pull request read and stores it` (the token route answers `installationTokenBody(STATELESS_TOKEN, …)`; the `/repos/...` request's `authorization` is `Bearer ${STATELESS_TOKEN}`; the row decrypts to it); `isPullRequestDraft reuses a cached stateless token without a token request` | `src/github/api-client.test.ts` |
| AC4 | `isPullRequestDraft answers the draft state with a stateless token` (two cases: the captured pull request answers `{ kind: "ok", draft: false }`, its draft variant `{ kind: "ok", draft: true }`). Mapping the answer to the title is unchanged code, pinned by the existing tests `processWebhook sends the CI failure of the real pull request run when the lookup answers not a draft`, `… decides no-match when the pull request is a draft` and `processWebhook stores the comment on a pull request without issue.draft when the lookup answers not a draft` in `src/webhook.test.ts`, which stay unchanged | `src/github/api-client.test.ts` |
| AC5 | `readCachedToken treats a cached token of 4097 characters as no cached token` and `… a cached token with a space as no cached token`: they pass on today's code (both forms are refused already), so the Tester writes them in step 5 and reports them green; they pin the new bound on the cache path | `src/store/token-cache.test.ts` |
| AC6 | no test: the Reviewer checks `docs/areas/github-api.md` against the code in step 8 | — |

## Approach

- `src/github/token-text.ts`: `const TOKEN_TEXT = /^[A-Za-z0-9_.-]{1,4096}$/;` written out, with no flag (`m`, `i`, `u`,
  `s` or `v` would each change what matches or how `$` binds). The doc comment of `isInstallationTokenText` names the
  new form and both token kinds, for example "Whether `text` has the form of an installation token, classic or
  stateless (`ghs_<App ID>_<JWT>`): 1 to 4096 characters from `[A-Za-z0-9_.-]`". `parseInstallationToken` and
  `readCachedToken` keep calling it unchanged.
- `test/github.ts` (Tester): `export const STATELESS_TOKEN: string`, `ghs_` + an invented App ID + `_` + the
  base64url (no padding) of `{"alg":"RS256","typ":"JWT"}` + `.` + the base64url of an invented payload (for example
  `iss`, `iat`, `exp`, an installation id) + `.` + a fixed 342-character base64url text standing in for an RS256
  signature, containing `-` and `_`. The doc comment says it is built from GitHub's documented form, not captured, and
  grants nothing. It is deterministic (no random bytes, no clock).
- No new user-visible output: the titles and texts are today's.

## Options considered

1. Flat class `[A-Za-z0-9_.-]`, 1–4096: chosen, confirmed by the Product Manager (spec Q1).
2. A structural check (classic | `ghs_<digits>_<part>.<part>.<part>`): lost, because it rests on undocumented
   structure, fails closed on the next variation and gives no header safety beyond option 1.
3. No check, relying on `Headers` refusing a line break: lost, because the token would be cached unchecked and have no
   length bound.

Details in decision 0045.

## Affected projects and types

| Project | Type / file | Change |
| ------- | ----------- | ------ |
| Worker | `src/github/token-text.ts` (`TOKEN_TEXT`, doc comment of `isInstallationTokenText`) | new pattern and comment |
| Tests | `test/github.ts` | new export `STATELESS_TOKEN` |
| Tests | `src/github/token-text.test.ts`, `src/github/installation-token.test.ts`, `src/store/token-cache.test.ts`, `src/github/api-client.test.ts` | cases added and adapted (*Tests per criterion*) |

## Signatures (for the Dev's skeleton)

None: no production member is new or changed (the checking function keeps its signature). The new test constant
in the GitHub test helpers is described under *Approach* and written by the Tester; there is no skeleton step.

## Test files

`src/github/token-text.test.ts`, `src/github/installation-token.test.ts`, `src/store/token-cache.test.ts`,
`src/github/api-client.test.ts`; helper `test/github.ts`.

Existing test code affected: no signature changes. Existing cases whose input the new rule handles differently, all
adapted by the Tester in step 5: in `src/github/token-text.test.ts` "256 characters", "a hyphen" and "a dot"; in
`src/github/installation-token.test.ts` "a token of 256 characters" and "a token with a hyphen". `readCachedToken
reads a token of 255 characters` (`src/store/token-cache.test.ts:330`) still holds and stays.

Files no unit test can cover: none.

## Areas

- `docs/areas/github-api.md`, *Installation tokens*: the accepted token form and bound (AC6).

## Documentation updates

Swept: `docs/areas/*.md`, `docs/ARCHITECTURE.md`, `README.md`, `SECURITY.md`, `docs/UNIT_TESTS.md` for the token form
(`255`, `[A-Za-z0-9_]`). Hits: `docs/areas/github-api.md:42` and `.squad/project.md:71` only. `ARCHITECTURE.md:20` and
`storage.md` name the cache, not the form: no change.

- `docs/areas/github-api.md` (Dev): *Installation tokens*: "a `token` of 1 to 4096 characters from `[A-Za-z0-9_.-]`
  (the classic form and GitHub's stateless `ghs_<App ID>_<JWT>`)"; the cache-read sentence keeps "the allow-list".
  *Limits and errors*: the token form follows GitHub's note on the stateless format; a token outside it fails
  closed. *Related decisions*: add 0045.
- `.squad/project.md` (*Security areas*, GitHub API client, line 71) (Dev): `[A-Za-z0-9_]`, 1–255 characters →
  `[A-Za-z0-9_.-]`, 1–4096 characters.
- `.squad/project.md` (*Test doubles*, GitHub API double) (Tester): name `STATELESS_TOKEN`, reference-built from the
  documented form, beside `installationTokenBody`.
- `CHANGELOG.md`, `Unreleased` (Dev): a `### Fixed` entry saying that installation tokens in GitHub's new stateless
  format are accepted, so CI failures in pull requests no longer read _draft status unknown_ and comments on pull
  requests are no longer dropped once GitHub issues them.

## Architecture check

No guarantee in `docs/ARCHITECTURE.md` or `.squad/project.md` is weakened. A token is still checked before it is
cached or sent, never logged, stored only encrypted, and cannot end or add a header line: the class holds no
whitespace, control character or `:`. The draft guarantee's exception (_draft status unknown_) is now reached less
often, not more.

## Security considerations

- [x] The bound of 4096 applies to the decoded JSON string (UTF-16 code units). Every accepted character is ASCII,
  so an accepted token is 4096 bytes at most. The answer body is bounded before decoding by the 1 MiB reader.
- [x] No new exception: the check is a pure `RegExp.test` on a string, and a refused token is the existing failure
  result without text.

## Decision records

- `docs/decisions/0045-installation-token-allow-list-for-the-stateless-format.md` (Proposed): amends released 0026
  (token allow-list), indexed.

## Out of scope / follow-ups

See [spec.md](spec.md), *Out of scope*. No follow-up issue. A real token from the live check that fails the form is a
new issue (decision 0045).

## Challenge notes

Minor objection of the plan challenge, verbatim:

1. `minor`: the list of existing tests that flip misses six cases, and one AC5 case already exists. Why minor: the Tester will see these cases fail once the regex changes, but the plan says its list is complete. A case adapted by deleting it, instead of moving it to 4097, would lose the length-bound pin on the cache and lookup paths. The plan's *Test files* section ("Existing cases whose input the new rule handles differently, all adapted…") names only `token-text.test.ts` and two cases in `installation-token.test.ts` (lines 106–107). These cases also expect a refusal, and they pass under the new rule: `src/store/token-cache.test.ts:262` "a token with a hyphen" (`ghs-abc`) and `:266` "a token of 256 characters", in the table "readCachedToken treats a row that decrypts to $case as no cached token"; `src/github/installation-token.test.ts:429` "answers a token with a hyphen" and `:431–432` "answers a token of 256 characters"; `src/github/api-client.test.ts:515` "answers a token with a hyphen" and `:517–518` "answers a token of 256 characters", in `UNREADABLE_TOKEN_ANSWERS`. Also, the plan's AC5 row has the Tester write a new "a cached token with a space as no cached token" case. That case already exists at `src/store/token-cache.test.ts:264`. Instruction for the Tester: in each of the three tables above, change the hyphen case to a token with a character the new class still refuses (for example `ghs_a b` or `ghs_a+b`), and change every 256-character case to 4097 characters, keeping it as a refusal. Cover AC5 by turning the existing 256 case at `token-cache.test.ts:266` into 4097, plus the existing space case at line 264. Do not add a duplicate space test.

## Security notes

Non-blocking findings of Security's plan review (`APPROVED`), verbatim:

- **non-blocking:** `STATELESS_TOKEN` in `test/github.ts` will be a literal starting with `ghs_` in a shape GitHub may recognise as an installation token. That could trip GitHub push protection or open a secret scanning alert on the repository, and Seluna itself notifies on those. The Tester could build it from parts (e.g. `"ghs" + "_" + …`) and keep the doc comment saying it is invented. If a push is blocked, the orchestrator handles it.
- **non-blocking:** plan fact 9 (real tokens fit 4096 characters from `[A-Za-z0-9_.-]`) is still unverified. This is a functional risk, not a security one: a token outside the form fails closed, as today. Decision 0045 records it and the Product Manager accepted it.
