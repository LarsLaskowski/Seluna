# 0015: Setup login

- **Status:** Proposed
- **Date:** 2026-10-15
- **Area:** Setup wizard
- **Source:** Issue #8
- **Supersedes:** —

## Context

Every instance is reachable from the internet, and its `/setup` wizard will create and store the GitHub App
credentials and pick the Telegram chat (issues #9–#11). Issue #8 asks for a login with `SELUNA_SECRET` compared in
constant time, an HMAC-signed session cookie that expires after 12 hours (`HttpOnly`, `Secure`, `SameSite=Strict`,
path `/setup`), a lock for 15 minutes after 5 failed attempts with the counter in D1, a CSRF token in every form,
server-rendered HTML without a framework or external resources under a strict Content-Security-Policy, English and
German chosen from `Accept-Language` and switchable, and a refusal to start without a `SELUNA_SECRET` of at least
32 characters. The Worker runs on the free plan (little CPU per request), `SELUNA_SECRET` already has the
32-character minimum and is the source of the storage key ([decision 0007](0007-github-app-credentials-encrypted-in-d1.md)),
other keys from it get their own HKDF info, and a counter such as this one belongs in `meta`
([decision 0014](0014-d1-schema-and-data-access.md)).

## Options considered

The session:

1. **A stateless token `v1.<expires>.<mac>`, HMAC-SHA256 under a key derived from `SELUNA_SECRET`** — no D1 read on
   any page, changing `SELUNA_SECRET` ends every session, and nothing needs cleaning up. A copied token stays valid
   until it expires; sign-out only clears the cookie. Chosen.
2. **A random session id stored in D1** — revocable on sign-out, but a D1 read on every page, a table or key
   scheme and a cleanup job, for one owner on one instance.

The CSRF token:

3. **Signed double submit: a random `seluna_csrf` cookie and, in every form, the HMAC of its value** — works on the
   login page before there is a session and needs no storage; a cookie planted by someone else is useless without
   the key, because the matching form value cannot be computed. Chosen.
4. **A token stored in D1 per form** — storage and cleanup for what option 3 does without.
5. **No token, relying on `SameSite=Strict` and the `Origin` header** — the issue asks for a token, and
   `SameSite` does not separate sites under the same registrable domain.

When the failed attempt is counted:

6. **Before the secret is checked, in one atomic upsert that returns the new count; a correct secret deletes the
   row** — parallel attempts are counted one after another, so no burst gets more than five checks. Chosen.
7. **After a wrong secret** — a read, check and write: attempts sent at the same moment all read the same count,
   and a burst checks as many secrets as it sends.

The lock's timing:

8. **Failures form a series while each comes within 15 minutes of the previous one; the fifth locks for 15 minutes
   from itself; rejected attempts change neither the count's time nor the lock** — the lock always lasts the full
   15 minutes the issue names, the owner's own attempt during the lock does not prolong it, and the whole state is
   one JSON value in one `meta` row. Chosen.
9. **A fixed 15-minute window from the first failure** — the lock after a fifth failure late in the window would
   last only seconds.
10. **Every rejected attempt extends the lock** — an owner who retries during the lock locks themselves out again.

Whose attempts are counted:

11. **One count for the instance** (the issue's "counter in D1") — an attacker cannot spread guesses over many
    addresses; the price is that anyone can keep the owner locked out by sending five wrong attempts every
    15 minutes. Accepted: the secret has at least 32 random characters, so the lock is a second line of defense,
    and the owner can wait or delete the row. Chosen.
12. **A count per client address** — no lockout of the owner by others, but every address gets five fresh guesses,
    and the instance would store client addresses.

How the secret is compared:

13. **HMAC-SHA256 of both values under a fresh random key, compared with `crypto.subtle.verify`** — constant time by
    the runtime for any two lengths, the same primitive as the webhook check ([decision 0012](0012-webhook-signature-verification.md)).
    Chosen.
14. **`crypto.subtle.timingSafeEqual`** — a Cloudflare extension that needs equal lengths, so the length check
    before it is a branch of its own.

Where the secret's text stays:

15. **In `src/crypto.ts`: it exports a check, the comparison and the derivation of the signing keys, all from the
    Worker environment** — no other module holds `SELUNA_SECRET` as a string, and no exported function derives a
    key from a plain string, as decision 0007 requires. Chosen.
16. **A function that returns the secret's text to the wizard** — the text would travel through the wizard's code.

The page style under the CSP:

17. **One inline `<style>`, allowed by its SHA-256 hash, computed from the same constant that is rendered** — no
    extra route, no `'unsafe-inline'`, and the hash cannot drift from the style. Chosen.
18. **A stylesheet route** — a route that must answer without a login, for a few lines of CSS.
19. **`style-src 'unsafe-inline'`** — weaker than the issue's "strict" policy.

How the language is switched:

20. **A `?lang=` link on every page, remembered in a `seluna_lang` cookie; else `Accept-Language`; else English** —
    works on the login page, before any setting can be read, and needs no form. Chosen.
21. **A language setting in D1** — needs the login first, but the login page itself must already be in the
    owner's language.

## Decision

`/setup` and everything below it answer only the login page until the owner signs in with `SELUNA_SECRET`, compared
in constant time inside `src/crypto.ts`; a session is a stateless HMAC-signed token of 12 hours in an `HttpOnly`,
`Secure`, `SameSite=Strict` cookie on `/setup`, every form is protected by a signed double-submit CSRF token, and
login attempts are counted in one `meta` row before the secret is checked, locking the login for 15 minutes after
the fifth failure. The rules are in the area document [`areas/setup-wizard.md`](../areas/setup-wizard.md).

## Consequences

- The wizard steps (#9, #10, #11) add their pages to the signed-in branch of the wizard and put the CSRF field in
  every form; a step that submits a form to another site (the manifest form of #10 posts to GitHub) widens
  `form-action` for that page only. Because the cookies are `SameSite=Strict`, the return from GitHub (a
  navigation started on github.com) arrives without the session, so #10 must handle it while signed out.
- Sign-out cannot revoke a copied token before it expires; changing `SELUNA_SECRET` revokes every session at once,
  and the reset of #11 is the way to do that deliberately.
- Anyone can keep the login locked (option 11). If that becomes a problem in practice, an unlock path for the
  owner (for example a second secret) is a new decision.
- The format of the `meta` row `login_attempts` and of the session token are fixed by this change; the token
  carries a version (`v1`) so a later format can be told apart.
- The atomic count rests on D1 running one statement at a time and on SQLite's upsert with `RETURNING` and its
  JSON functions; the store tests verify both against the D1 of the Workers test pool, including
  ten attempts sent at once of which exactly five are allowed.
