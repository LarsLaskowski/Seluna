# 0018: Settings, status page and reset in the setup wizard

- **Status:** Accepted
- **Date:** 2026-10-17
- **Area:** Setup wizard
- **Source:** Issue #11
- **Supersedes:** —

## Context

Issue #11 asks for the owner's settings (notification language, IANA time zone, quiet hours, one switch per rule,
the update notice), a status page (version, Telegram chat, GitHub App with link, time of the last received
delivery) as the entry point after setup, and a reset when the key check of
[0007](0007-github-app-credentials-encrypted-in-d1.md) reports a changed `SELUNA_SECRET`. 0007 (released) already
fixes what the reset clears: `secrets`, the key check value and `token_cache`, and it never restores old credentials.
The settings are read later by the rules (#13, #16, #17), the message format (#12), quiet hours (#14) and the update
notice (#18), which do not exist yet; the time of the last delivery is written by #12. The stored credentials hold
no name or link of the app, and the Worker cannot ask GitHub for them before #15 brings app authentication.

## Options considered

How the settings are stored:

1. **One `settings` row per setting, each read on its own with its default when absent or invalid** — a damaged
   value costs only that setting, consumers read what they need, and it matches the existing `telegram_chat_id` row.
   Chosen.
2. **One JSON row with every setting** — one read, but one bad byte resets everything, and the shape needs its own
   versioning.

Which time zones are accepted:

3. **Exactly the names the runtime lists in `Intl.supportedValuesOf("timeZone")`, plus `UTC`** — the select offers
   the same list the check uses, so every stored value is canonical. Chosen.
4. **Any value `Intl.DateTimeFormat` accepts as `timeZone`** — also accepts letter-case variants, aliases and
   offsets such as `+01:00`, which would then be stored in forms no list or comparison expects.

How the GitHub App's name and link are shown:

5. **Keep the slug of the conversion answer (already narrowed by an allow-list) in `meta`, tied to its App ID, and
   show it as the name with a link to `https://github.com/apps/<slug>`** — no new external field and no API call;
   an app created before this change, or by hand, is shown by its App ID alone. Chosen.
6. **Narrow the answer's `name` as well** — the exact name, but one more external field in the narrowing of a
   security area, for display only; GitHub derives the slug from the name.
7. **Ask GitHub (`GET /app`) on every status page** — needs the app JWT of #15.

When the reset is offered and what guards it:

8. **Only while the credentials cannot be read (key check changed or corrupt, or a stored credential that does not
   decrypt), as a signed-in form with the session-bound CSRF token, deleting only while the key check value and the
   stored credentials are still the ones checked** — a destructive button is not always on the page, and neither a
   new app's first write nor a rewrite of the credentials under a matching key check (which keeps the key check
   value) can be deleted by a reset that read the earlier state. Chosen.
   A guard on the key check value alone was weighed and lost: it misses the "key matches, a credential does not
   decrypt" case, where a concurrent write keeps the key check value and the reset would delete the new app's
   credentials, orphaning the app; documenting that window as accepted was rejected for a destructive operation.
   Because each statement of the delete batch sees what the earlier ones changed, one guard on every delete fails:
   once `secrets` is emptied the fingerprint no longer matches and the later deletes do nothing. The batch therefore
   deletes `token_cache` and then `secrets` under both pins, and then the key check value under its own pin and only
   while no `secrets` row is left — equivalent, since only the reset deletes `secrets` rows, so rows left by a
   concurrent write block that last delete too.
9. **A reset that is always available** — more general, but an accidental click deletes working credentials and
   leaves an orphaned app on GitHub.

The time of the last delivery:

10. **This change only reads `meta` `last_delivery`; #12 writes it with its pipeline** — the webhook route is not
    changed twice. Chosen.
11. **Write it now after a valid signature** — a useful line earlier, but #12 rebuilds that path with deduplication.

How a time is shown:

12. **A fixed `YYYY-MM-DD HH:MM (<zone>)` built from `Intl.DateTimeFormat` parts** — the same text in both
    languages, testable exactly. Chosen.
13. **The locale's own date style** — friendlier, but the text depends on the runtime's ICU version.

## Decision

The owner's choices are kept as one `settings` row each, read with a per-setting default whenever a row is absent or
invalid and never cached between requests, so a change takes effect on the next event without a deployment. The
signed-in start page `/setup` shows the status and the settings form; the reset that clears `secrets`, `token_cache`
and the key check value is offered and accepted only while the stored credentials cannot be read, and deletes only
while the key check value and the stored credentials are still the ones it checked. The rules are in [`areas/setup-wizard.md`](../areas/setup-wizard.md)
and [`areas/storage.md`](../areas/storage.md).

## Consequences

- #12, #13, #14, #16, #17 and #18 read the settings through the one reader of this change and never keep them across
  requests; quiet hours are one stored value (off, or start and end together), so #14 reads them through that reader
  and never as separate start and end rows, and switching them off drops the times; #12 writes `meta` `last_delivery` in the format the storage area defines, and the status page shows
  _none received yet_ until then.
- The key check now reports **corrupt** when it is absent while `secrets` holds a credential, as the storage area's
  table already said for reads and writes; the GitHub step therefore refuses to start a flow whose credentials could
  never be stored, instead of leaving an orphaned app on GitHub.
- The reset does not delete the old app on GitHub (the wizard cannot authenticate as it); the reset text tells the
  owner to delete it by hand. The Telegram chat and the settings survive a reset, since neither is encrypted.
- An app whose slug was not kept (created before this change, by hand, or whose slug write failed) is shown by its
  App ID without a link until it is created again; the slug write is display data and its failure does not undo
  the stored credentials.
- The set of time zones follows the runtime: a stored zone the runtime stops listing reads as `UTC`, and a time the
  runtime cannot format in the zone is shown in UTC, so the start page that carries the reset never fails on it.
