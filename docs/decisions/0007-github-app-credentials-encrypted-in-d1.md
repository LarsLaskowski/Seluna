# 0007: GitHub App credentials encrypted in D1

- **Status:** Proposed
- **Date:** 2026-10-15
- **Area:** Storage
- **Source:** Issue #2, Issue #7
- **Supersedes:** —

## Context

After the manifest flow the instance must keep the App's private key and webhook secret between requests. Worker
secrets can only be set through Wrangler or the dashboard, not by the Worker itself during `/setup`. Issue #7 sets
the goal that someone who can only read D1 learns nothing, and asks for AES-256-GCM with a random 12-byte IV per
value, a key derived with HKDF-SHA256 from the Worker secret `SELUNA_SECRET` (fixed salt and info
`seluna/secrets/v1`), and a key check value in `meta` that turns a changed `SELUNA_SECRET` into a dedicated error
the setup wizard (issue #11) can show. Issue #7 also lists a table `token_cache` with a plain `token` column for
the installation tokens of issue #15. The setup login (issue #8) refuses a `SELUNA_SECRET` shorter than 32
characters.

## Options considered

Where the credentials live:

1. **Worker secrets (`wrangler secret put`)** — never stored in the database, but the user must run an extra step
   and the setup wizard cannot finish on its own.
2. **Plaintext in D1** — trivial, but a database export or backup exposes the keys.
3. **Encrypted in D1 (AES-256-GCM)** — the wizard stores them itself; the encryption key is a Worker secret that
   never enters the database, so a database leak alone reveals nothing. Chosen.

How the key is derived:

4. **HKDF-SHA256 with a fixed salt and info** (issue #7) — one Web Crypto call, deterministic, cheap on every
   request of a free-plan Worker. HKDF does not slow down guessing, so it is only as strong as `SELUNA_SECRET` is
   random. Chosen, with salt and info both `seluna/secrets/v1`: a fixed salt adds nothing over a fixed info for one
   key per instance, and one label names the format version once.
5. **PBKDF2 or another password hash** — slows guessing of a weak, human-chosen secret, but only through
   deliberate CPU cost on every derivation, which the free plan's small CPU budget per request cannot spare, and
   the deploy form already asks for a random string.

How weak secrets are kept out:

6. **`SELUNA_SECRET` counts as configured only from 32 characters on, also for encryption** — the same rule the
   setup login applies (issue #8), so a ciphertext in D1 is never protected by a secret short enough to guess.
   Characters are Unicode code points, as a user counts them. Chosen.
7. **Accept any non-empty secret here and leave the minimum to the login** — one rule fewer, but nothing then
   stops a short secret from protecting the stored credentials if a write path ever bypasses the wizard.

How the minimum is enforced is weighed in options 17 to 19 below.

How a changed `SELUNA_SECRET` is detected:

8. **A known text encrypted under the key, stored in `meta` (`key_check`)** — checked by decrypting it, so the
   only primitive is the AES-GCM already used; a wrong key fails the tag check. Chosen.
9. **An HMAC of a constant under a second key derived with another info** — deterministic and equally sound,
   but a second derivation and a second primitive for the same answer.
10. **No key check, only the failed decryption of a credential** — cannot tell a changed secret from an altered
    row, and issue #7 asks for a dedicated error.

What the ciphertext is bound to:

11. **Additional authenticated data naming the row (`secrets/<key>`, `token_cache/<installation_id>/<expires_at>`,
    `meta/key_check`)** — a ciphertext moved to another row, for instance the webhook secret's into the App id's,
    fails to decrypt instead of being used as the wrong credential. For `token_cache` the plain `expires_at` is
    bound too, so a changed expiry cannot make an expired token look valid. Costs nothing. Chosen.
12. **No additional data** — what issue #7 describes; leaves row swapping by someone who can write D1 undetected.

How encrypted values are stored:

13. **Base64 text in TEXT columns** — what D1 returns for a TEXT column is a string on every path; the length check
    on `iv` is a plain `length()`. Chosen.
14. **BLOB columns** — a third smaller, but the JavaScript type D1 returns for a BLOB is not pinned in its
    documentation, so the reader would have to guess its shape.

The installation tokens:

15. **Encrypted like the credentials (`token_cache` with `iv` and `ciphertext` instead of `token`)** — an
    installation token grants read access to the owner's repositories for up to an hour; stored in plain text it
    would break issue #7's goal and the rule that nothing secret is kept in plain text in D1. Chosen, deviating
    from the column list of issue #7.
16. **Plain `token` column as listed in issue #7** — saves one encryption per cached token, but a database reader
    could use the token until it expires.

Where the 32-character minimum is enforced:

17. **In the only function that yields the key, `keyFromEnv(env)`** — it reads `SELUNA_SECRET` from the Worker
    environment, checks the minimum and derives the key; the narrowing and the derivation stay private. No caller
    can derive a key from a shorter secret, and the check runs at run time. Chosen.
18. **A separate narrowing function and a public `deriveKey(secret: string)`** — the first draft of this change;
    any later caller could derive a key from a short secret and bypass option 6.
19. **A branded `SelunaSecret` type that only the narrowing function produces, taken by `deriveKey`** — closes the
    bypass at the type level, but one cast reopens it, and the project allows a cast after a runtime check.

## Decision

The GitHub App credentials (table `secrets`) and the installation tokens (table `token_cache`) are stored only as
AES-256-GCM ciphertext under a key derived with HKDF-SHA256 from `SELUNA_SECRET`, which must have at least 32
characters, checked in the only function that yields the key; each ciphertext is bound to its row, and a key check value in `meta` reports a changed
`SELUNA_SECRET` as its own result. The Telegram bot token is a Worker secret, not a value in D1
([decision 0013](0013-deploy-to-cloudflare-and-workers-builds.md)). The rules are in the area document
[`areas/storage.md`](../areas/storage.md).

## Consequences

- A database dump is useless without the Worker secret, as long as `SELUNA_SECRET` is random; a guessable secret
  could be found offline from the key check value or any ciphertext, which the 32-character minimum and the deploy
  form's advice (a password manager or `openssl rand -hex 32`) guard against.
- Losing or changing `SELUNA_SECRET` means running the setup again: the wizard (issue #11) clears `secrets`, the
  key check value and `token_cache`, and the user creates the credentials anew. Key rotation is a deliberate
  procedure, not an automatic one.
- Salt, info, the additional data and the base64 format are fixed with the first stored credential; changing any
  of them makes every stored value unreadable, so a change needs a new label (`seluna/secrets/v2`) and a
  migration path.
- Issue #15 encrypts each cached installation token with the functions of this change before it writes
  `token_cache`, with the additional data `token_cache/<installation_id>/<expires_at>`.
- The reset after a changed or lost `SELUNA_SECRET` (issue #11) always creates new GitHub App credentials and never
  stores old ones again: D1's Time Travel keeps the deleted rows restorable for a while (Cloudflare documents up to
  30 days), so re-storing them would keep a possibly exposed key alive.
- Any other key taken from `SELUNA_SECRET`, such as a session or signing key for the setup login (issue #8), is
  derived with its own HKDF info next to `keyFromEnv` in `src/crypto.ts`; the storage key is never reused for
  another purpose.
- A credential is written only while the key check value it was checked against is still stored, so a write
  racing a reset or a first write under another secret never leaves a credential no key check covers (the
  rules are in the area document).
- A key check value is classified by its form before it is decrypted: a malformed one is corrupt, while a
  well-formed one that fails to decrypt reports a changed secret even when it was altered, because AES-GCM's tag
  check cannot tell an altered value from another key. Both lead to the same reset, so the overlap costs nothing
  but the wording of the message.
