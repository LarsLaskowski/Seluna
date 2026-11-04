# 0045: Installation token allow-list for GitHub's stateless token format

- **Status:** Accepted
- **Date:** 2026-11-04
- **Area:** GitHub API
- **Source:** Issue #122
- **Supersedes:** — (amends [0026](0026-github-app-authentication-and-installation-tokens.md): its token allow-list,
  `[A-Za-z0-9_]` and at most 255 characters, is replaced; 0026 stays unedited)

## Context

0026 accepted an installation token only as 1 to 255 characters from `[A-Za-z0-9_]`, the form of GitHub's documented
example (`ghs_` and 36 letters and digits). GitHub's OpenAPI description of
`POST /app/installations/{installation_id}/access_tokens` and its documentation now say that since 2026-04-27 newly
minted installation tokens are rolled out in a stateless format, `ghs_APPID_JWT`. A JWT holds `.` and `-`, and with an
RS256 signature alone it is longer than 255 characters. GitHub gives no maximum length (the schema is a plain
`string`). A token the allow-list refuses makes every draft lookup fail, so CI failures in pull requests read
_draft status unknown_ and comments on pull requests without `issue.draft` are dropped. The allow-list exists so a
token can never end or add a line of the `Authorization` header it is sent in, and so its size is bounded. No real
stateless token was available, and the session could not reach GitHub's changelog post on the format.

## Options considered

1. **A flat class `[A-Za-z0-9_.-]`, 1 to 4096 characters** — covers the classic and the stateless form (the base64url
   alphabet and the `.` separators). None of these characters can end or add a header line. It assumes nothing
   about the inner structure GitHub has not documented. 4096 is well above a JWT with a few claims and an RS256
   signature (under about 1,000 characters), and it still bounds the header. Chosen, confirmed by the Product Manager.
2. **A structural check, the classic form or `ghs_<digits>_<part>.<part>.<part>`** — stricter, but it rests on details
   GitHub has not documented (the separator and part count, the prefix of every token). It would fail closed on the
   next variation, and it adds nothing to the header safety the character class already gives.
3. **No check, relying on the runtime's `Headers` to refuse a line break** — drops the guarantee that a token is
   checked before it is cached or sent, and the length bound with it.

## Decision

An installation token, from GitHub's answer and from the cache, is accepted when it is 1 to 4096 characters from
`[A-Za-z0-9_.-]`. The token is not decoded: `expires_at` stays the only source of its expiry. The form is stated in
[GitHub API](../areas/github-api.md#installation-tokens).

## Consequences

- Classic tokens, and those already cached, still pass, so nothing is requested again because of this change.
- Residual risk: no real stateless token was available, so the form and the bound rest on GitHub's documentation
  alone, and the unit tests share that assumption through a reference-built token in `test/github.ts`. A longer token
  or a character outside the class fails closed, as before: the lookup fails and nothing is cached.
- The Product Manager's live check on a deployed copy (0026) can turn the format on for a token request with GitHub's
  temporary opt-in request header (GitHub changelog, 2026-05-15, linked from GitHub's note on the format). A token
  captured that way, with its signature removed, is the sample a later issue would use to narrow or widen the
  form. Seluna's own requests never send that header.
- To revisit: GitHub documents a maximum length or another alphabet, or a real token fails the check.
