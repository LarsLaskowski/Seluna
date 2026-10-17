# 0021: Missing-tables notice on the setup login

- **Status:** Proposed
- **Date:** 2026-10-17
- **Area:** Setup wizard
- **Source:** Issue #51
- **Supersedes:** —

## Context

An instance whose deploy command skipped the D1 migrations (issue #46,
[decision 0020](0020-deploy-command-checked-in-the-setup-guide.md)) has a database without tables. The first D1
access of the setup wizard is the login's attempt count in the `meta` table, which runs before the secret is
checked, so every sign-in on such an instance answers 503 with the _unavailable_ notice. That notice reads like a
transient error, and the owner has no hint that the deploy command is the cause. The login catches every D1 error
without reading it, so that no error text reaches the log or the response, and this must stay so. The login page is
answered to anyone; only the secret, checked under the attempt count, separates the owner from everyone else
([decision 0015](0015-setup-login.md)).

## Options considered

1. **After a D1 failure on the login, read the table names from `sqlite_master` and compare them with the tables the
   migrations create** — a positive check of the schema that never reads the error; when that read fails too, the
   answer stays _unavailable_. One extra query, only on the failure path. Production D1's answer to a
   `sqlite_master` read was not measured (the session cannot reach Cloudflare); the Workers test pool's D1 answers
   it, and the repository's migration test already relies on it there.
2. **Match the error message against `no such table`** — needs D1's wrapped message format, which is not documented
   as stable and was not captured from production, and puts the error text, which must stay unread, into a
   decision.
3. **Check Wrangler's `d1_migrations` table for the latest migration name** — couples Seluna to a table Wrangler
   owns (no Seluna code reads it) and to the migration file names.
4. **Check the schema before every login** — one more query on every attempt for no gain; the failure path is the
   only one that needs the answer.
5. **Show the notice only after the secret was verified** — with the attempt count unusable the secret would be
   checked without a count, an unthrottled oracle that breaks the rule that at most five attempts in 15 minutes
   have their secret checked.
6. **Use the check on every D1 failure of the signed-in pages too** — a session needs a successful login, which
   needs the `meta` table; with the single migration of today no table can be missing behind a valid session
   unless it is dropped by hand. Revisit with a migration that adds a table.
7. **Show the notice on the signed-out login page itself** — adds a D1 read to every signed-out page view, which
   today reads no D1.

## Decision

When the login's D1 access fails, the wizard reads the table names from `sqlite_master`; if a table of the schema is
missing it answers with the _migrations missing_ notice, which names the deploy command `npm run deploy`, and
otherwise, or when that read fails, with _unavailable_ (option 1). The rules are in
[`areas/setup-wizard.md`](../areas/setup-wizard.md#login).

## Consequences

Anyone who submits the login form with a valid CSRF token learns that an instance's database has no tables, before
the secret is checked. That is accepted: such an instance holds no data, its login cannot succeed, and the
_unavailable_ notice already told the same visitor that D1 fails. The list of schema tables lives beside the store
modules and a test pins it to the tables the migrations create, so a migration that adds a table fails that test
until the list is extended. A database that has every table but an outdated column is not detected and still shows
_unavailable_. Whether production D1 answers the `sqlite_master` read as the test pool does is unverified; if it
fails there, the login shows _unavailable_ as before, and a live check on a deployed copy
(`npx wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type = 'table'"`) settles it.
